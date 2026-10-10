#!/usr/bin/env node
// Measures the rendered WAVs (reads the files from disk, independent of synth.mjs):
//   node demo/showreel/audio/analyze.mjs
// - length in frames, silence of the timeline gaps and the tail
// - low band (<120 Hz) vs full band RMS
// - transient onset alignment of slams / impacts / stamps (sfx.wav) and drop hits (music.wav)
// - croak formant peaks and pitch
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHOWREEL = path.resolve(HERE, '..');
const TL = JSON.parse(fs.readFileSync(path.join(SHOWREEL, 'timeline.json'), 'utf8'));
const DIR = path.join(SHOWREEL, 'public', 'audio');

function readWav(file) {
  const b = fs.readFileSync(file);
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') throw new Error('not a wav: ' + file);
  let o = 12, fmt = null, data = null;
  while (o + 8 <= b.length) {
    const id = b.toString('ascii', o, o + 4), sz = b.readUInt32LE(o + 4);
    if (id === 'fmt ') fmt = { ch: b.readUInt16LE(o + 10), sr: b.readUInt32LE(o + 12), bits: b.readUInt16LE(o + 22) };
    if (id === 'data') data = { off: o + 8, sz };
    o += 8 + sz + (sz & 1);
  }
  if (fmt.bits !== 24 || fmt.ch !== 2) throw new Error('expected 24-bit stereo');
  const n = data.sz / 6, L = new Float64Array(n), R = new Float64Array(n);
  for (let i = 0, p = data.off; i < n; i++) {
    for (const ch of [L, R]) { let v = b[p] | (b[p + 1] << 8) | (b[p + 2] << 16); if (v & 0x800000) v -= 0x1000000; ch[i] = v / 8388608; p += 3; }
  }
  return { ...fmt, n, L, R };
}
const W = Object.fromEntries(['music', 'sfx', 'score'].map((k) => [k, readWav(path.join(DIR, k + '.wav'))]));
const SR = W.score.sr, idx = (t) => Math.round(t * SR);
const dbf = (x) => (x > 0 ? 20 * Math.log10(x) : -Infinity);
const rms = (w, a, b, L = w.L, R = w.R) => { let s = 0; for (let i = idx(a); i < idx(b); i++) s += L[i] * L[i] + R[i] * R[i]; return Math.sqrt(s / (2 * (idx(b) - idx(a)))); };
const peak = (w, a, b) => { let p = 0; for (let i = idx(a); i < idx(b); i++) p = Math.max(p, Math.abs(w.L[i]), Math.abs(w.R[i])); return p; };

console.log('── files ──');
for (const [k, w] of Object.entries(W)) console.log(`  ${k.padEnd(6)} ${w.sr} Hz ${w.bits}-bit ${w.ch}ch  ${w.n} frames = ${(w.n / w.sr).toFixed(3)} s`);

console.log('\n── silence checks (RMS / peak, dBFS) ──');
const gaps = TL.music.filter((m) => m.part === 'gap').map((m) => [m.start, m.end]);
for (const [a, b] of [...gaps, [35.9, 36.0]])
  console.log(`  ${a.toFixed(2)}-${b.toFixed(2)}  ` + Object.entries(W).map(([k, w]) => `${k} ${dbf(rms(w, a, b)).toFixed(1)}/${dbf(peak(w, a, b)).toFixed(1)}`).join('   '));

// 4th-order Butterworth low-pass at 120 Hz (two biquads)
function lowpass(x, f) {
  const y = Float64Array.from(x);
  for (const Q of [0.5411961, 1.3065630]) {
    const w = 2 * Math.PI * f / SR, cw = Math.cos(w), al = Math.sin(w) / (2 * Q), a0 = 1 + al;
    const b0 = (1 - cw) / 2 / a0, b1 = (1 - cw) / a0, b2 = b0, a1 = -2 * cw / a0, a2 = (1 - al) / a0;
    let z1 = 0, z2 = 0;
    for (let i = 0; i < y.length; i++) { const v = y[i], o = b0 * v + z1; z1 = b1 * v - a1 * o + z2; z2 = b2 * v - a2 * o; y[i] = o; }
  }
  return y;
}
console.log('\n── low end: RMS of <120 Hz band vs full band (score) ──');
const lowL = lowpass(W.score.L, 120), lowR = lowpass(W.score.R, 120);
for (const [name, a, b] of [['whole', 0, 36], ['intro', 0, 4], ['build', 4, 7.75], ['drop', 8, 16], ['montage', 16, 22], ['breakdown', 22, 24], ['groove', 24, 28], ['final', 32, 34]]) {
  const full = rms(W.score, a, b), low = rms(W.score, a, b, lowL, lowR);
  const hi = Math.sqrt(Math.max(0, full * full - low * low));
  console.log(`  ${name.padEnd(9)} full ${dbf(full).toFixed(1)}  <120Hz ${dbf(low).toFixed(1)}  >120Hz ${dbf(hi).toFixed(1)} dBFS   low-full ${(dbf(low) - dbf(full)).toFixed(1)} dB, low share of power ${(100 * low * low / (full * full)).toFixed(0)}%`);
}

console.log('\n── stereo: L/R correlation and mono fold-down (score) ──');
for (const [name, a, b] of [['whole', 0, 36], ['drop', 8, 16], ['final', 32, 34]]) {
  let lr = 0, ll = 0, rr = 0, m = 0;
  for (let i = idx(a); i < idx(b); i++) { const L = W.score.L[i], R = W.score.R[i]; lr += L * R; ll += L * L; rr += R * R; m += ((L + R) / 2) ** 2; }
  console.log(`  ${name.padEnd(6)} correlation ${(lr / Math.sqrt(ll * rr)).toFixed(2)}  mono fold-down ${(10 * Math.log10(m / ((ll + rr) / 2))).toFixed(1)} dB vs stereo RMS`);
}

// Onset on a 1 kHz high-passed copy (so sustained sub/pad energy doesn't mask the transient):
// first sample after the local baseline where |x| rises above baseline + 30% of the local peak.
function highpass(x, f) {
  const y = Float64Array.from(x), w = 2 * Math.PI * f / SR, cw = Math.cos(w), al = Math.sin(w) / (2 * Math.SQRT1_2), a0 = 1 + al;
  const b0 = (1 + cw) / 2 / a0, b1 = -(1 + cw) / a0, b2 = b0, a1 = -2 * cw / a0, a2 = (1 - al) / a0; let z1 = 0, z2 = 0;
  for (let i = 0; i < y.length; i++) { const v = y[i], o = b0 * v + z1; z1 = b1 * v - a1 * o + z2; z2 = b2 * v - a2 * o; y[i] = o; }
  return y;
}
const HP = Object.fromEntries(['music', 'sfx'].map((k) => [k, { L: highpass(W[k].L, 1000), R: highpass(W[k].R, 1000) }]));
function onset(w, t) {
  const pre0 = idx(t - 0.04), pre1 = idx(t - 0.012), a = idx(t - 0.012), b = idx(t + 0.06);
  let base = 0, pk = 0;
  for (let i = pre0; i < pre1; i++) base = Math.max(base, Math.abs(w.L[i]), Math.abs(w.R[i]));
  for (let i = a; i < b; i++) pk = Math.max(pk, Math.abs(w.L[i]), Math.abs(w.R[i]));
  const thr = base + 0.3 * (pk - base);
  for (let i = a; i < b; i++) if (Math.abs(w.L[i]) > thr || Math.abs(w.R[i]) > thr) return { dt: (i / SR - t) * 1000, rise: dbf(pk) - dbf(Math.max(base, 1e-6)) };
  return { dt: NaN, rise: 0 };
}
console.log('\n── onset alignment (ms, + = late) ──');
const evs = TL.sfx.filter((e) => ['slam', 'impact', 'stamp'].includes(e.type));
let worst = 0;
for (const e of evs) { const o = onset(HP.sfx, e.t); worst = Math.max(worst, Math.abs(o.dt)); console.log(`  sfx   ${e.type.padEnd(7)} @ ${e.t.toFixed(3)}  onset ${o.dt.toFixed(2).padStart(6)} ms  (rise ${o.rise.toFixed(1)} dB)`); }
const build = TL.music.find((m) => m.part === 'build'), drops = TL.music.filter((m) => m.part === 'drop' || m.part === 'final');
for (const t of [...[0, 1, 2, 3].map((k) => build.start + k), ...drops.map((m) => m.start)]) { const o = onset(HP.music, t); worst = Math.max(worst, Math.abs(o.dt)); console.log(`  music hit     @ ${t.toFixed(3)}  onset ${o.dt.toFixed(2).padStart(6)} ms  (rise ${o.rise.toFixed(1)} dB)`); }
console.log(`  worst |error| ${worst.toFixed(2)} ms ${worst <= 5 ? '(within ±5 ms)' : '(OUT OF TOLERANCE)'}`);

// ── croak: spectral envelope peaks + pitch track ──
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let k = 0; k < len / 2; k++) { const a = i + k, b = a + len / 2, xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr; re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi; const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } }
  }
}
const croak = TL.sfx.find((e) => e.type === 'croak');
if (croak) {
  const F = 4096, hop = 1024, a = idx(croak.t), b = idx(croak.t + 0.42), acc = new Float64Array(F / 2);
  let frames = 0;
  for (let s = a; s + F <= b + F / 2; s += hop) {
    const re = new Float64Array(F), im = new Float64Array(F);
    for (let i = 0; i < F; i++) { const j = s + i; re[i] = (j < b ? (W.sfx.L[j] + W.sfx.R[j]) / 2 : 0) * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / F)); }
    fft(re, im); for (let k = 0; k < F / 2; k++) acc[k] += re[k] * re[k] + im[k] * im[k]; frames++;
  }
  const hz = SR / F, env = new Float64Array(F / 2), win = Math.round(90 / hz);
  for (let k = 0; k < F / 2; k++) { let s = 0, c = 0; for (let j = Math.max(0, k - win); j <= Math.min(F / 2 - 1, k + win); j++) { s += acc[j]; c++; } env[k] = 10 * Math.log10(s / c + 1e-30); }
  const peaks = [];
  for (let k = Math.round(150 / hz); k < Math.round(4000 / hz); k++) if (env[k] > env[k - 1] && env[k] >= env[k + 1]) peaks.push([k * hz, env[k]]);
  const top = Math.max(...env.slice(Math.round(60 / hz), Math.round(4000 / hz)));
  console.log('\n── croak spectral envelope (smoothed ±90 Hz), local maxima 150-4000 Hz ──');
  for (const [f, v] of peaks) console.log(`  ${f.toFixed(0).padStart(5)} Hz  ${(v - top).toFixed(1).padStart(6)} dB`);
  const band = (lo, hi) => { let s = 0; for (let k = Math.round(lo / hz); k < Math.round(hi / hz); k++) s += Math.pow(10, env[k] / 10); return 10 * Math.log10(s); };
  const all = band(40, 8000);
  console.log(`  energy share: <150 Hz ${(band(40, 150) - all).toFixed(1)} dB, 300-800 Hz ${(band(300, 800) - all).toFixed(1)} dB, 800-1500 Hz ${(band(800, 1500) - all).toFixed(1)} dB, 2-4 kHz ${(band(2000, 4000) - all).toFixed(1)} dB`);
  // pitch: autocorrelation on 40 ms windows
  const p = [];
  for (let t = 0.02; t < 0.4; t += 0.04) {
    const s = idx(croak.t + t), n = idx(0.04); let best = 0, lag = 0;
    for (let L = Math.round(SR / 160); L < Math.round(SR / 60); L++) { let c = 0, e1 = 0, e2 = 0; for (let i = 0; i < n; i++) { const x = W.sfx.L[s + i], y = W.sfx.L[s + i + L]; c += x * y; e1 += x * x; e2 += y * y; } const r = c / Math.sqrt(e1 * e2 + 1e-20); if (r > best) { best = r; lag = L; } }
    p.push(`${(t * 1000).toFixed(0)}ms:${lag ? (SR / lag).toFixed(0) : '-'}Hz(${best.toFixed(2)})`);
  }
  console.log('  pitch track (autocorr): ' + p.join(' '));
}

// ── per-event audibility: sfx vs music above 1 kHz (where UI sounds have to cut through), over each event's span ──
console.log('\n── sfx event level vs music underneath, >1 kHz band RMS (dB) ──');
const SPAN = { ping: 0.12, slam: 0.15, impact: 0.3, pop: 0.06, whoosh: 0.2, ding: 0.2, thwip: 0.13, stamp: 0.08, click: 0.03, enter: 0.05, success: 0.25, lock: 0.12, glitch: 0.15, croak: 0.4 };
const rows = [];
for (const e of TL.sfx) {
  const a = e.type === 'whoosh' ? e.t - 0.12 : e.t, b = e.end ?? a + (SPAN[e.type] || 0.15);
  const s = dbf(rms(HP.sfx, a, b, HP.sfx.L, HP.sfx.R)), m = dbf(rms(HP.music, a, b, HP.music.L, HP.music.R));
  rows.push(`${e.t.toFixed(2).padStart(6)} ${e.type.padEnd(7)} sfx ${s.toFixed(1).padStart(6)} music ${m.toFixed(1).padStart(6)} diff ${(s - m).toFixed(1).padStart(5)}`);
}
for (let i = 0; i < rows.length; i += 2) console.log('  ' + rows[i] + (rows[i + 1] ? '   |   ' + rows[i + 1] : ''));

// ── whoosh peak alignment: 10 ms RMS envelope maximum vs t ──
console.log('\n── whoosh envelope peak vs t (ms) ──');
const wp = [];
for (const e of TL.sfx.filter((x) => x.type === 'whoosh')) {
  let best = -1, bt = 0; const w = idx(0.005);
  for (let i = idx(e.t - 0.25); i < idx(e.t + 0.15); i += 24) { let s = 0; for (let j = i - w; j < i + w; j++) s += W.sfx.L[j] ** 2 + W.sfx.R[j] ** 2; if (s > best) { best = s; bt = i; } }
  wp.push(`${e.t.toFixed(1)}: ${((bt / SR - e.t) * 1000).toFixed(0)}`);
}
console.log('  ' + wp.join('  '));
