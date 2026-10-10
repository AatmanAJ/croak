// Render stills at given times (seconds) from one bundle, plus a contact sheet.
//   node stills.mjs 0.6 1.9 3.3   ->  out/stills/t0.60.jpg ... and out/stills/sheet.jpg
import { bundle } from '@remotion/bundler';
import { renderStill, selectComposition, openBrowser } from '@remotion/renderer';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const times = process.argv.slice(2).map(Number);
mkdirSync('out/stills', { recursive: true });
const serveUrl = await bundle({ entryPoint: path.resolve('src/index.jsx') });
const browser = await openBrowser('chrome', { chromeMode: 'chrome-for-testing' });
const composition = await selectComposition({ serveUrl, id: 'Showreel', puppeteerInstance: browser, chromeMode: 'chrome-for-testing' });
const files = [];
await Promise.all(
  times.map(async (s) => {
    const file = `out/stills/t${s.toFixed(2)}.jpg`;
    await renderStill({ serveUrl, composition, frame: Math.round(s * 60), output: file, imageFormat: 'jpeg', jpegQuality: 82, scale: 0.5, puppeteerInstance: browser, chromeMode: 'chrome-for-testing' });
    files[times.indexOf(s)] = file;
  }),
);
await browser.close({ silent: true });
// 2-column contact sheet, in the order given
const cols = Math.min(2, files.length);
const args = [];
files.forEach((f) => args.push('-i', f));
const labels = files.map((f, i) => `[${i}:v]pad=iw+8:ih+8:4:4:color=black[v${i}]`).join(';');
const stack = files.length === 1 ? `[v0]copy` : `${files.map((_, i) => `[v${i}]`).join('')}xstack=inputs=${files.length}:layout=${files.map((_, i) => `${(i % cols) ? 'w0' : '0'}_${Math.floor(i / cols) ? Array.from({ length: Math.floor(i / cols) }, () => 'h0').join('+') : '0'}`).join('|')}:fill=black`;
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args, '-filter_complex', `${labels};${stack}`, '-frames:v', '1', 'out/stills/sheet.jpg']);
console.log('out/stills/sheet.jpg');
