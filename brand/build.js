// Builds every Croak brand asset (SVG + PNG) from the definitions below.
// Text is converted to outlines with the brand fonts, so the files look identical everywhere.
//
//   npm run brand

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import opentype from 'opentype.js';
import sharp from 'sharp';

const require = createRequire(import.meta.url);
const OUT = new URL('./', import.meta.url).pathname;

export const COLORS = {
  pond: '#0E1F17', // darkest green, backgrounds and ink
  moss: '#18342A', // raised surfaces on pond
  frog: '#8FE04E', // primary brand green
  lily: '#F2F7E9', // off-white, eyes and light backgrounds
  tongue: '#FF5C8A', // the action colour: deleted, croaked
  amber: '#FFB547', // held for review
  mist: '#9DB3A6', // secondary text on pond
};

// --- fonts -------------------------------------------------------------------

async function loadFont(pkg, file) {
  const buffer = await readFile(require.resolve(`${pkg}/files/${file}`));
  return opentype.parse(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
}

const FONTS = {
  display: await loadFont('@fontsource/bricolage-grotesque', 'bricolage-grotesque-latin-800-normal.woff'),
  body: await loadFont('@fontsource/bricolage-grotesque', 'bricolage-grotesque-latin-400-normal.woff'),
  bodyBold: await loadFont('@fontsource/bricolage-grotesque', 'bricolage-grotesque-latin-700-normal.woff'),
  mono: await loadFont('@fontsource/jetbrains-mono', 'jetbrains-mono-latin-700-normal.woff'),
};

/** Text as an SVG path. anchor: 'start' | 'middle' | 'end'. tracking in 1/1000 em. */
// opentype.js 2.0's toPathData() sometimes rounds coordinates to NaN, so path data is written here.
function pathData(path) {
  return path.commands
    .map((c) =>
      c.type === 'Z'
        ? 'Z'
        : c.type + [c.x1, c.y1, c.x2, c.y2, c.x, c.y].filter((v) => v !== undefined).map((v) => v.toFixed(2)).join(' '),
    )
    .join('');
}

function text(str, { font = 'display', size, x, y, fill, anchor = 'start', tracking = 0 }) {
  // Glyphs are laid out by hand (advance + kerning) because opentype.js can't apply some of
  // these fonts' substitution tables. That only drops ligatures, which brand text doesn't need.
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
      const path = pathData(g.getPath(cursor, y, size));
      cursor += advances[i];
      return path;
    })
    .join('');
  return { svg: `<path d="${d}" fill="${fill}"/>`, width };
}

// --- the mark: a side-eyeing frog --------------------------------------------
// Drawn in a 1000 x 1000 box. Pupils look left and the lids sit low: suspicious of every link.

function frog({ body = COLORS.frog, eye = COLORS.lily, ink = COLORS.pond, pupil = ink, id = 'f' } = {}) {
  const eyes = [
    { cx: 300, cy: 395 },
    { cx: 700, cy: 395 },
  ];
  const r = { bump: 158, white: 108, pupil: 50 };
  return `
  <defs>
    ${eyes.map((e, i) => `<clipPath id="${id}-eye${i}"><circle cx="${e.cx}" cy="${e.cy}" r="${r.white}"/></clipPath>`).join('')}
  </defs>
  <g>
    <ellipse cx="500" cy="618" rx="392" ry="252" fill="${body}"/>
    ${eyes.map((e) => `<circle cx="${e.cx}" cy="${e.cy}" r="${r.bump}" fill="${body}"/>`).join('')}
    ${eyes
      .map(
        (e, i) => `
    <g clip-path="url(#${id}-eye${i})">
      <rect x="${e.cx - 120}" y="${e.cy - 22}" width="240" height="140" fill="${eye}"/>
      <circle cx="${e.cx - 50}" cy="${e.cy + 30}" r="${r.pupil}" fill="${pupil}"/>
      <rect x="${e.cx - 120}" y="${e.cy - 22}" width="240" height="14" fill="${pupil}"/>
    </g>`,
      )
      .join('')}
    <path d="M236 650 C 400 702 620 696 766 612" fill="none" stroke="${ink}" stroke-width="30" stroke-linecap="round"/>
    <circle cx="452" cy="548" r="13" fill="${ink}"/>
    <circle cx="548" cy="548" r="13" fill="${ink}"/>
  </g>`;
}

/** Place the 1000-unit frog at (x, y) with a given width. */
function placeFrog(x, y, width, opts) {
  return `<g transform="translate(${x} ${y}) scale(${width / 1000})">${frog(opts)}</g>`;
}

// --- assets ------------------------------------------------------------------

function avatar({ bg = COLORS.pond, ...frogOpts } = {}) {
  // Discord crops avatars to a circle; at this size the frog's widest points stay ~60px inside it.
  return svg(1024, 1024, `<rect width="1024" height="1024" fill="${bg}"/>${placeFrog(-13, -60, 1050, frogOpts)}`);
}

/** The frog alone on a transparent background, cropped to its outline. */
function mark(opts) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="650" viewBox="100 230 800 650">${frog(opts)}</svg>`;
}

/** One-colour frog: eyes and mouth are cut out, so it works on any background. */
function markMono(color) {
  const cutout = frog({ body: '#fff', eye: '#000', ink: '#000', pupil: '#fff', id: 'm' });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="650" viewBox="100 230 800 650">
    <mask id="mono" maskUnits="userSpaceOnUse" x="0" y="0" width="1000" height="1000">${cutout}</mask>
    <rect width="1000" height="1000" fill="${color}" mask="url(#mono)"/></svg>`;
}

function wordmark(color, size = 200) {
  const word = text('croak', { size, x: 0, y: size * 0.74, fill: color, tracking: -20 });
  return { body: word.svg, width: word.width, height: size * 0.98 };
}

/** Frog + wordmark side by side. The frog's chin sits on the text baseline. */
function lockup({ textColor, frogOpts = {}, bg }) {
  const pad = 28;
  const baseline = 180;
  const frogWidth = 240; // of the 1000-unit box; the frog's outline is 78.4% of that
  const s = frogWidth / 1000;
  const word = text('croak', { size: 190, x: pad + 784 * s + 48, y: baseline, fill: textColor, tracking: -20 });
  const width = pad + 784 * s + 48 + word.width + pad;
  return svg(
    Math.round(width),
    baseline + pad,
    `${bg ? `<rect width="100%" height="100%" fill="${bg}"/>` : ''}
    ${placeFrog(pad - 108 * s, baseline - 870 * s, frogWidth, frogOpts)}
    ${word.svg}`,
  );
}

/** Social share image (Open Graph / Twitter card), 1200 x 630. */
function ogImage() {
  const W = 1200;
  const H = 630;
  const headline = [
    text('Spam', { size: 132, x: 64, y: 268, fill: COLORS.lily, tracking: -25 }),
    text('croaks', { size: 132, x: 64, y: 392, fill: COLORS.frog, tracking: -25 }),
    text('here.', { size: 132, x: 64, y: 516, fill: COLORS.lily, tracking: -25 }),
  ];
  const sub = [
    text('Catches scam links, NSFW invites and fake', { font: 'body', size: 25, x: 66, y: 568, fill: COLORS.mist }),
    text('giveaways in your Discord before anyone clicks.', { font: 'body', size: 25, x: 66, y: 602, fill: COLORS.mist }),
  ];
  const brandRow = [
    `<g transform="translate(64 50)">${frogSmall(58)}</g>`,
    text('croak', { size: 46, x: 136, y: 92, fill: COLORS.lily, tracking: -15 }).svg,
  ];

  // A scam message the frog has just snatched
  const card = { x: 612, y: 74, w: 470, h: 150 };
  const msg = [
    `<rect x="${card.x}" y="${card.y}" width="${card.w}" height="${card.h}" rx="18" fill="${COLORS.moss}"/>`,
    `<circle cx="${card.x + 44}" cy="${card.y + 46}" r="22" fill="#5B6B63"/>`,
    text('nitro_drops', { font: 'bodyBold', size: 22, x: card.x + 80, y: card.y + 42, fill: COLORS.lily }).svg,
    text('Today at 4:20 PM', { font: 'body', size: 15, x: card.x + 212, y: card.y + 42, fill: COLORS.mist }).svg,
  ];
  const msgLines = [
    text('Free Nitro for 3 months, claim fast', { font: 'body', size: 21, x: card.x + 80, y: card.y + 76, fill: '#C9D6CF' }),
    text('dlscord-gift.com/nitro', { font: 'body', size: 21, x: card.x + 80, y: card.y + 106, fill: '#4FB8F5' }),
  ];
  msgLines.forEach((line, i) => {
    msg.push(line.svg);
    // Struck through: the message is gone
    msg.push(`<rect x="${card.x + 76}" y="${card.y + 68 + i * 30}" width="${line.width + 8}" height="4" rx="2" fill="${COLORS.tongue}"/>`);
  });
  const stamp = text('CROAKED  0.19s', { font: 'mono', size: 26, x: 0, y: 0, fill: COLORS.tongue });
  const stampSvg = `<g transform="translate(${card.x + 236} ${card.y + 160}) rotate(-7)">
      <rect x="-16" y="-34" width="${stamp.width + 32}" height="48" rx="10" fill="${COLORS.pond}" stroke="${COLORS.tongue}" stroke-width="4"/>
      ${stamp.svg}</g>`;

  const frogX = 668;
  const frogY = 196;
  const frogW = 560;
  const at = (lx, ly) => [frogX + (lx * frogW) / 1000, frogY + (ly * frogW) / 1000];
  const [mx, my] = at(250, 655); // left corner of the mouth
  const tongue = `<path d="M${mx} ${my} C ${mx - 150} ${my - 40}, ${mx - 170} ${card.y + card.h + 120}, ${mx - 70} ${card.y + card.h - 8}"
      fill="none" stroke="${COLORS.tongue}" stroke-width="20" stroke-linecap="round"/>
    <circle cx="${mx - 70}" cy="${card.y + card.h - 8}" r="17" fill="${COLORS.tongue}"/>`;

  return svg(
    W,
    H,
    `<rect width="${W}" height="${H}" fill="${COLORS.pond}"/>
    <circle cx="${frogX + frogW / 2}" cy="${H + 40}" r="330" fill="${COLORS.moss}"/>
    ${brandRow.join('')}
    ${headline.map((h) => h.svg).join('')}
    ${sub.map((s) => s.svg).join('')}
    ${msg.join('')}
    ${placeFrog(frogX, frogY, frogW)}
    ${tongue}
    ${stampSvg}`,
  );
}

/** Frog scaled so its outline is `width` px wide, origin at its top-left. */
function frogSmall(width) {
  const s = width / 784;
  return `<g transform="scale(${s}) translate(-108 -237)">${frog({ id: `s${Math.round(width)}` })}</g>`;
}

/** Banner on the bot's Discord profile, 680 x 240. Discord puts the avatar over the bottom-left. */
function discordBanner() {
  const W = 680;
  const H = 240;
  const line1 = text('Spam croaks here.', { size: 44, x: 40, y: 74, fill: COLORS.lily, tracking: -15 });
  const line2 = text('links, invites and images, checked in 0.2s', { font: 'mono', size: 14, x: 42, y: 104, fill: COLORS.frog });
  // The frog peeks up from the bottom-right edge, eyes just above the fold
  return svg(
    W,
    H,
    `<rect width="${W}" height="${H}" fill="${COLORS.pond}"/>
    <circle cx="${W - 150}" cy="${H + 60}" r="190" fill="${COLORS.moss}"/>
    ${line1.svg}${line2.svg}
    ${placeFrog(W - 330, 72, 360)}`,
  );
}

/** Browser tab icon: the frog on a rounded square. */
function favicon() {
  return svg(
    512,
    512,
    `<rect width="512" height="512" rx="112" fill="${COLORS.pond}"/>${placeFrog(-6, -28, 524, { id: 'fav' })}`,
  );
}

function svg(w, h, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;
}

async function write(name, svgString, pngSizes = []) {
  await writeFile(`${OUT}${name}.svg`, svgString);
  const svgWidth = Number(svgString.match(/width="([\d.]+)"/)[1]);
  for (const size of pngSizes) {
    const suffix = pngSizes.length > 1 ? `-${size}` : '';
    // Rasterise at the target size (not upscaled from the SVG's own size) so edges stay sharp
    await sharp(Buffer.from(svgString), { density: (72 * size) / svgWidth })
      .resize(size)
      .png()
      .toFile(`${OUT}png/${name}${suffix}.png`);
  }
}

await mkdir(`${OUT}png`, { recursive: true });

await write('avatar', avatar(), [1024]);
await write(
  'avatar-alt',
  avatar({ bg: COLORS.frog, body: COLORS.pond, eye: COLORS.lily, ink: COLORS.frog, pupil: COLORS.pond, id: 'alt' }),
  [1024],
);
await write('mark', mark(), [1024]);
await write('mark-mono-pond', markMono(COLORS.pond), [1024]);
await write('mark-mono-lily', markMono(COLORS.lily), [1024]);
await write('wordmark-on-dark', svgFromWordmark(COLORS.lily), [1200]);
await write('wordmark-on-light', svgFromWordmark(COLORS.pond), [1200]);
await write('lockup-on-dark', lockup({ textColor: COLORS.lily }), [1600]);
await write('lockup-on-light', lockup({ textColor: COLORS.pond }), [1600]);
await write('og-image', ogImage(), [1200]);
await write('discord-banner', discordBanner(), [680]);
await write('favicon', favicon(), [32, 180, 512]);
console.log('Brand assets written to brand/');

function svgFromWordmark(color) {
  const w = wordmark(color);
  return svg(Math.ceil(w.width) + 8, Math.ceil(w.height), `<g transform="translate(4 0)">${w.body}</g>`);
}
