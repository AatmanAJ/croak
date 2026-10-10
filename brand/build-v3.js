// Croak v3 brand files: the eyes mark, app icons, the Discord avatar and banner, and the social
// image. Text is converted to outlines so the files look the same everywhere.
//
//   node brand/build-v3.js   ->  brand/v3/*.svg and brand/v3/png/*.png

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import opentype from 'opentype.js';
import sharp from 'sharp';

const require = createRequire(import.meta.url);
const OUT = new URL('./v3/', import.meta.url).pathname;

const C = {
  lime: '#DAF36B',
  limeSoft: '#EEF9B8',
  limeDeep: '#B4CF4E',
  limeInk: '#55632C',
  olive: '#222F0E',
  ink: '#1C250F',
  body: '#3A4528',
  tongue: '#FF5C8A',
  tongueInk: '#C92A5C',
  canvas: '#DCDDD7',
};

async function loadFont(pkg, file) {
  const buffer = await readFile(require.resolve(`${pkg}/files/${file}`));
  return opentype.parse(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
}

const FONTS = {
  medium: await loadFont('@fontsource/inter-tight', 'inter-tight-latin-500-normal.woff'),
  semibold: await loadFont('@fontsource/inter-tight', 'inter-tight-latin-600-normal.woff'),
  regular: await loadFont('@fontsource/inter-tight', 'inter-tight-latin-400-normal.woff'),
  mono: await loadFont('@fontsource/jetbrains-mono', 'jetbrains-mono-latin-700-normal.woff'),
};

function pathData(path) {
  return path.commands
    .map((c) => (c.type === 'Z' ? 'Z' : c.type + [c.x1, c.y1, c.x2, c.y2, c.x, c.y].filter((v) => v !== undefined).map((v) => v.toFixed(2)).join(' ')))
    .join('');
}

/** Text as an SVG path. tracking is in 1/1000 em (negative tightens). */
function text(str, { font = 'medium', size, x, y, fill, anchor = 'start', tracking = 0 }) {
  const f = FONTS[font];
  const scale = size / f.unitsPerEm;
  const glyphs = [...str].map((ch) => f.charToGlyph(ch));
  const advances = glyphs.map((g, i) => {
    const kern = (i < glyphs.length - 1 && f.getKerningValue(g, glyphs[i + 1])) || 0;
    return (g.advanceWidth + kern) * scale + (tracking / 1000) * size;
  });
  const width = advances.reduce((a, b) => a + b, 0) - (tracking / 1000) * size;
  let cursor = anchor === 'middle' ? x - width / 2 : anchor === 'end' ? x - width : x;
  const d = glyphs
    .map((g, i) => {
      const p = pathData(g.getPath(cursor, y, size));
      cursor += advances[i];
      return p;
    })
    .join('');
  return { svg: `<path d="${d}" fill="${fill}"/>`, width };
}

/** The mark, drawn in a 32x32 box at (x, y) scaled to `size`. Pupils glance left. */
function mark({ x = 0, y = 0, size = 32, tile = C.olive, eye = C.lime, radius = 9, id = 'm' }) {
  const s = size / 32;
  const eyes = [11, 21];
  return `<g transform="translate(${x} ${y}) scale(${s})">
  <defs>${eyes.map((cx, i) => `<clipPath id="${id}${i}"><circle cx="${cx}" cy="17" r="5"/></clipPath>`).join('')}</defs>
  <rect width="32" height="32" rx="${radius}" fill="${tile}"/>
  ${eyes
    .map(
      // only the part of each eye below the lid is drawn, so no sliver of lime shows above it
      (cx, i) => `<g clip-path="url(#${id}${i})"><rect x="${cx - 6}" y="16.2" width="12" height="8" fill="${eye}"/><circle cx="${cx - 1.3}" cy="18.5" r="1.95" fill="${tile}"/></g>`,
    )
    .join('')}
</g>`;
}

const svg = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;

async function save(name, content, pngs = []) {
  await writeFile(`${OUT}${name}.svg`, content);
  for (const [file, w, h] of pngs) {
    await sharp(Buffer.from(content), { density: 300 }).resize(w, h).png().toFile(`${OUT}png/${file}`);
  }
}

await mkdir(`${OUT}png`, { recursive: true });

// Icons. The full-bleed tile: rounded corners come from whoever displays it (Discord, iOS).
// Avatars are cropped to a circle, so the eyes are drawn larger and centred on a full tile
const zoomed = (tile, eye, id) => svg(32, 32, `<rect width="32" height="32" fill="${tile}"/><g transform="translate(16 16.5) scale(1.12) translate(-16 -17)">${mark({ size: 32, radius: 0, tile, eye, id })}</g>`);
const tileFull = zoomed(C.olive, C.lime, 'a');
await save('mark', svg(32, 32, mark({ size: 32, id: 'b' })), [['favicon-32.png', 32, 32], ['icon-512.png', 512, 512]]);
await save('avatar', tileFull, [['avatar.png', 1024, 1024], ['apple-touch-icon.png', 180, 180]]);
await save('avatar-lime', zoomed(C.lime, C.olive, 'c'), [['avatar-lime.png', 1024, 1024]]);

// Wordmark lockup
{
  const w = text('croak', { font: 'semibold', size: 120, x: 150, y: 112, fill: C.ink, tracking: -60 });
  await save('lockup', svg(150 + w.width + 10, 150, mark({ x: 0, y: 15, size: 120, id: 'd' }) + w.svg), [['lockup.png', Math.round((150 + w.width + 10) * 2), 300]]);
}

// Social image, 1200 x 630
{
  const lines = ['Keep scams out of', 'fast-moving servers'];
  const head = lines.map((l, i) => text(l, { font: 'medium', size: 84, x: 72, y: 268 + i * 84, fill: C.ink, tracking: -55 }).svg).join('');
  const wm = text('croak', { font: 'semibold', size: 40, x: 128, y: 104, fill: C.ink, tracking: -60 });
  const sub = [
    'AI moderation for Discord. Checks every link, invite',
    'and image, and removes scams before anyone clicks.',
  ]
    .map((l, i) => text(l, { font: 'regular', size: 25, x: 74, y: 440 + i * 36, fill: C.body, tracking: -5 }).svg)
    .join('');
  const pill = `<rect x="72" y="520" width="262" height="58" rx="29" fill="${C.olive}"/>` + text('Add to Discord', { font: 'medium', size: 22, x: 100, y: 557, fill: C.limeSoft }).svg + `<circle cx="305" cy="549" r="21" fill="${C.lime}"/><path d="M296 549h17M306 542l7 7-7 7" stroke="${C.olive}" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
  // the verdict card
  const cx = 790, cy = 150;
  const card = `
  <g transform="rotate(4 ${cx + 170} ${cy + 160})">
    <rect x="${cx}" y="${cy}" width="340" height="320" rx="30" fill="#F4FBD6"/>
    <circle cx="${cx + 32}" cy="${cy + 40}" r="6" fill="${C.tongue}"/>
    ${text('New in #general', { font: 'regular', size: 19, x: cx + 46, y: cy + 47, fill: C.limeInk }).svg}
    ${text('dlscord-gift.com/nitro', { font: 'mono', size: 18, x: cx + 26, y: cy + 92, fill: C.ink }).svg}
    ${text('scam', { font: 'regular', size: 22, x: cx + 26, y: cy + 196, fill: C.limeInk }).svg}
    ${text('1.00', { font: 'medium', size: 92, x: cx + 82, y: cy + 196, fill: C.ink, tracking: -50 }).svg}
    <g transform="rotate(-10 ${cx + 170} ${cy + 260})">
      <rect x="${cx + 70}" y="${cy + 230}" width="200" height="56" rx="10" fill="none" stroke="${C.tongue}" stroke-width="5"/>
      ${text('CROAKED', { font: 'mono', size: 30, x: cx + 170, y: cy + 269, fill: C.tongueInk, anchor: 'middle', tracking: 120 }).svg}
    </g>
  </g>
  <rect x="${cx - 60}" y="${cy + 330}" width="250" height="110" rx="26" fill="${C.olive}"/>
  ${text('AI check took', { font: 'regular', size: 18, x: cx - 34, y: cy + 368, fill: C.limeDeep }).svg}
  ${text('190 ms', { font: 'medium', size: 46, x: cx - 34, y: cy + 418, fill: C.lime, tracking: -40 }).svg}`;
  const grid = `<g opacity="0.12" stroke="${C.limeInk}">${Array.from({ length: 20 }, (_, i) => `<path d="M${i * 64} 0V630"/>`).join('')}${Array.from({ length: 10 }, (_, i) => `<path d="M0 ${i * 64}H1200"/>`).join('')}</g>`;
  const body = `<rect width="1200" height="630" fill="${C.lime}"/>${grid}<circle cx="980" cy="120" r="380" fill="#F1FBC0" opacity="0.55"/>${mark({ x: 72, y: 66, size: 48, id: 'e' })}${wm.svg}${head}${sub}${pill}${card}`;
  await save('og-image', svg(1200, 630, body), [['og-image.png', 1200, 630]]);
}

// Discord profile banner, 680 x 240 (shown at 340 x 120)
{
  const t1 = text('Spam croaks here.', { font: 'medium', size: 64, x: 44, y: 116, fill: C.ink, tracking: -55 });
  const t2 = text('Links, invites and images, checked in 0.2s', { font: 'regular', size: 24, x: 46, y: 168, fill: C.body, tracking: -5 });
  const body = `<rect width="680" height="240" fill="${C.lime}"/><circle cx="600" cy="40" r="200" fill="#F1FBC0" opacity="0.6"/>${t1.svg}${t2.svg}${mark({ x: 540, y: 120, size: 96, id: 'f' })}`;
  await save('discord-banner', svg(680, 240, body), [['discord-banner.png', 680 * 2, 240 * 2]]);
}

console.log('wrote', OUT);
