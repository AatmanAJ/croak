#!/usr/bin/env node
// Croak showreel: original score + sound design, synthesised from scratch in plain Node.
//
//   node demo/showreel/audio/synth.mjs
//
// In:  demo/showreel/timeline.json  (bpm, chords, `music` sections, `sfx` events)
// Out: demo/showreel/public/audio/music.wav  score only
//      demo/showreel/public/audio/sfx.wav    sound effects only
//      demo/showreel/public/audio/score.wav  music + sfx, mastered to ~-16 LUFS / <= -1.5 dBTP
// All three: 48 kHz, 24-bit PCM, stereo, exactly timeline.duration seconds.
// music.wav + sfx.wav == score.wav (the master gain curve is shared, so the stems sum back exactly).
//
// No samples, no dependencies, no third-party audio. Randomness is seeded: re-runs are bit-identical.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const T_START = Date.now();
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHOWREEL = path.resolve(HERE, '..');
const TL = JSON.parse(fs.readFileSync(path.join(SHOWREEL, 'timeline.json'), 'utf8'));
const OUT_DIR = path.join(SHOWREEL, 'public', 'audio');
const log = (...a) => console.log(...a);

// ═════════════════════════════ timeline ═════════════════════════════
const SR = 48000;
const N = Math.round(TL.duration * SR);
const BEAT = 60 / TL.bpm, BAR = 4 * BEAT, S16 = BEAT / 4;
const TAU = 2 * Math.PI;
const idx = (t) => Math.round(t * SR);

const part = (name, k = 0) => {
  const p = TL.music.filter((m) => m.part === name)[k];
  if (!p) throw new Error(`timeline.json: missing music part "${name}" #${k}`);
  return p;
};
const INTRO = part('intro'), BUILD = part('build'), GAP1 = part('gap', 0), DROP = part('drop'),
  MONT = part('montage'), BRK = part('breakdown'), GROOVE = part('groove'), BUILD2 = part('build2'),
  GAP2 = part('gap', 1), FINAL = part('final');
const NUM = String.raw`(\d+(?:\.\d+)?)`;
const grab = (text, re, fallback) => { const m = text.match(re); return m ? m.slice(1).map(Number) : fallback; };
const ROLL1 = grab(BUILD.notes, new RegExp(`snare roll\\D*?${NUM}\\s*to\\s*${NUM}`, 'i'), [BUILD.start + BAR, GAP1.start]);
const ROLL2 = grab(BUILD2.notes, new RegExp(`snare roll\\D*?${NUM}\\s*to\\s*${NUM}`, 'i'), [BUILD2.start + BAR, GAP2.start]);
const STUTTER = grab(MONT.notes, new RegExp(`stutter fill\\D*?${NUM}\\s*to\\s*${NUM}`, 'i'), [MONT.end - BEAT, MONT.end]);
const STABS = ((GROOVE.notes.match(/stabs at ([^a-z]*)/i) || [])[1]?.match(/\d+(?:\.\d+)?/g) || []).map(Number);
const TICK_FROM = grab(INTRO.notes, new RegExp(`hat from\\s*${NUM}`, 'i'), [INTRO.start + BAR])[0];
const STOP = grab(FINAL.notes, new RegExp(`stops on\\s*${NUM}`, 'i'), [FINAL.start + BAR])[0];
const FADE_END = grab(FINAL.notes, new RegExp(`zero by\\s*${NUM}`, 'i'), [FINAL.end - 0.1])[0];
const FADE_START = STOP + 0.8;

// Points where audio hard-cuts. Events that start before a cut are truncated there (2 ms fade).
const MUSIC_CUTS = [GAP1.start, GAP2.start, STOP];
const SFX_CUTS = [GAP1.start, GAP2.start];
const GAPS = [[GAP1.start, GAP1.end], [GAP2.start, GAP2.end]];
const cutAfter = (t, cuts) => { for (const c of cuts) if (c > t + 1e-6) return idx(c); return N; };

// ═════════════════════════════ harmony ═════════════════════════════
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const chordAt = (t) => TL.chords[Math.floor(t / BAR + 1e-9) % TL.chords.length];
// Voice-led voicings (C3..C5 region). Top line: C5 Db5 C5 Bb4.
const VOICING = { Fm: [53, 60, 65, 68, 72], Db: [53, 61, 65, 68, 73], Ab: [51, 60, 63, 68, 72], Eb: [51, 58, 63, 67, 70] };
const PAD_VOICING = { Fm: [41, 53, 60, 65, 68], Db: [37, 53, 61, 65, 68], Ab: [44, 51, 60, 63, 68], Eb: [39, 51, 58, 63, 67] };
const SUB_ROOT = { Fm: 29, Db: 37, Ab: 32, Eb: 27 }; // F1, Db2, Ab1, Eb1
const ARP = { Fm: [65, 68, 72, 75, 77], Db: [65, 68, 72, 73, 77], Ab: [63, 67, 68, 72, 75], Eb: [63, 67, 70, 73, 75] };
// 16-step hook: accents on 3+3+2+3+3+2 land on top/upper tones (F5 Eb5 F5 Eb5 F5 Ab4 over Fm)
const ARP_STEPS = [4, 0, 2, 3, 0, 2, 4, 0, 3, 0, 2, 4, 0, 2, 1, 2];
const ARP_VEL = [1, 0.45, 0.6, 0.9, 0.45, 0.6, 0.95, 0.45, 0.9, 0.45, 0.6, 0.95, 0.45, 0.6, 0.85, 0.55];
for (const c of TL.chords) if (!VOICING[c]) throw new Error(`no voicing for chord ${c}`);

// ═════════════════════════════ DSP kit ═════════════════════════════
function rng(label) { // mulberry32 seeded from an FNV-1a hash of the label
  let a = 2166136261 >>> 0;
  for (let i = 0; i < label.length; i++) { a ^= label.charCodeAt(i); a = Math.imul(a, 16777619) >>> 0; }
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const bi = (r) => r() * 2 - 1;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const db = (d) => Math.pow(10, d / 20);
const toDb = (g) => 20 * Math.log10(Math.max(g, 1e-12));
const smooth = (a, b, x) => { if (x <= a) return 0; if (x >= b) return 1; const u = (x - a) / (b - a); return u * u * (3 - 2 * u); };
const att = (t, a) => (t <= 0 ? 0 : t >= a ? 1 : t / a);
const expi = (a, b, x) => a * Math.pow(b / a, clamp(x, 0, 1));
const stereo = (n = N) => ({ L: new Float32Array(n), R: new Float32Array(n) });
const mono = (x) => ({ L: x, R: x });

// PolyBLEP band-limited saw / square
function blep(t, dt) {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
}
const saw = (p, dt) => 2 * p - 1 - blep(p, dt);
const sqr = (p, dt) => { let q = p + 0.5; if (q >= 1) q -= 1; return (p < 0.5 ? 1 : -1) + blep(p, dt) - blep(q, dt); };

// Topology-preserving-transform state-variable filter (Zavalishin / Simper). k = 1/Q.
const gOf = (f) => Math.tan(Math.PI * clamp(f, 10, SR * 0.45) / SR);
class Svf {
  constructor() { this.s1 = 0; this.s2 = 0; this.lp = 0; this.bp = 0; this.hp = 0; }
  tick(x, g, k) {
    const a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2;
    const v3 = x - this.s2, v1 = a1 * this.s1 + a2 * v3, v2 = this.s2 + a2 * this.s1 + a3 * v3;
    this.s1 = 2 * v1 - this.s1; this.s2 = 2 * v2 - this.s2;
    this.lp = v2; this.bp = v1; this.hp = x - k * v1 - v2;
    return v2;
  }
}

// RBJ biquads for static EQ
function biquad(type, f, Q = Math.SQRT1_2, gainDb = 0) {
  const w = TAU * f / SR, cw = Math.cos(w), sw = Math.sin(w), al = sw / (2 * Q), A = Math.pow(10, gainDb / 40);
  let b0, b1, b2, a0, a1, a2;
  if (type === 'lp') { b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; }
  else if (type === 'hp') { b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; }
  else if (type === 'bp') { b0 = al; b1 = 0; b2 = -al; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; }
  else if (type === 'peak') { b0 = 1 + al * A; b1 = -2 * cw; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cw; a2 = 1 - al / A; }
  else if (type === 'hs' || type === 'ls') {
    const s = type === 'hs' ? 1 : -1, sA = 2 * Math.sqrt(A) * al;
    b0 = A * ((A + 1) + s * (A - 1) * cw + sA); b1 = -2 * s * A * ((A - 1) + s * (A + 1) * cw); b2 = A * ((A + 1) + s * (A - 1) * cw - sA);
    a0 = (A + 1) - s * (A - 1) * cw + sA; a1 = 2 * s * ((A - 1) - s * (A + 1) * cw); a2 = (A + 1) - s * (A - 1) * cw - sA;
  } else throw new Error('biquad type ' + type);
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}
function filt(x, c) {
  let z1 = 0, z2 = 0;
  for (let i = 0; i < x.length; i++) { const v = x[i], y = c.b0 * v + z1; z1 = c.b1 * v - c.a1 * y + z2; z2 = c.b2 * v - c.a2 * y; x[i] = y; }
  return x;
}
const filtChain = (x, list) => { for (const [type, f, Q, g] of list) filt(x, biquad(type, f, Q, g)); return x; };
const filtStereo = (s, list) => { filtChain(s.L, list); if (s.R !== s.L) filtChain(s.R, list); return s; };
const noiseArr = (r, n) => { const x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = bi(r); return x; };
function normalize(s, target = 1) {
  let p = 0;
  for (const ch of s.L === s.R ? [s.L] : [s.L, s.R]) for (let i = 0; i < ch.length; i++) { const a = Math.abs(ch[i]); if (a > p) p = a; }
  const g = p > 0 ? target / p : 1;
  for (const ch of s.L === s.R ? [s.L] : [s.L, s.R]) for (let i = 0; i < ch.length; i++) ch[i] *= g;
  return s;
}

// Add a (short) stereo source into a full-length buffer, truncating at `cut` with a 2 ms fade.
function addTo(dst, src, start, gain = 1, pan = 0, cut = N) {
  const gl = gain * Math.min(1, 1 - pan), gr = gain * Math.min(1, 1 + pan), F = 96;
  const end = Math.min(start + src.L.length, cut, N);
  for (let d = Math.max(0, start); d < end; d++) {
    const i = d - start, toCut = cut - d, f = toCut < F ? toCut / F : 1;
    dst.L[d] += src.L[i] * gl * f; dst.R[d] += src.R[i] * gr * f;
  }
}

// ═════════════════════════════ effects ═════════════════════════════
// Freeverb (Jezar): 8 damped combs + 4 allpasses per channel, stereo spread. `kills` flush the tank (hard cuts).
function freeverb(inp, out, { room = 0.8, damp = 0.35, width = 1, pre = 0.02, kills = [] } = {}) {
  const sc = SR / 44100;
  const CT = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617].map((x) => Math.round(x * sc));
  const AT = [556, 441, 341, 225].map((x) => Math.round(x * sc));
  const SP = Math.round(23 * sc), fb = room * 0.28 + 0.7, d1 = damp * 0.4, d2 = 1 - d1;
  const mk = (lens) => lens.map((l) => new Float32Array(l));
  let cL = mk(CT), cR = mk(CT.map((l) => l + SP)), aL = mk(AT), aR = mk(AT.map((l) => l + SP));
  const ci = new Int32Array(16), ai = new Int32Array(8), st = new Float64Array(16);
  const PD = Math.max(1, idx(pre)), pdL = new Float32Array(PD), pdR = new Float32Array(PD); let pw = 0;
  const wet1 = width / 2 + 0.5, wet2 = (1 - width) / 2;
  const killSet = new Set(kills.map(idx));
  for (let i = 0; i < N; i++) {
    if (killSet.has(i)) { for (const b of [...cL, ...cR, ...aL, ...aR]) b.fill(0); st.fill(0); pdL.fill(0); pdR.fill(0); }
    const dl = pdL[pw], dr = pdR[pw]; pdL[pw] = inp.L[i]; pdR[pw] = inp.R[i]; if (++pw >= PD) pw = 0;
    const x = (dl + dr) * 0.015;
    let oL = 0, oR = 0;
    for (let c = 0; c < 8; c++) {
      let b = cL[c], j = ci[c], y = b[j]; st[c] = y * d2 + st[c] * d1; b[j] = x + st[c] * fb; if (++j >= b.length) j = 0; ci[c] = j; oL += y;
      b = cR[c]; j = ci[c + 8]; y = b[j]; st[c + 8] = y * d2 + st[c + 8] * d1; b[j] = x + st[c + 8] * fb; if (++j >= b.length) j = 0; ci[c + 8] = j; oR += y;
    }
    for (let a = 0; a < 4; a++) {
      let b = aL[a], j = ai[a], v = b[j], o = -oL + v; b[j] = oL + v * 0.5; if (++j >= b.length) j = 0; ai[a] = j; oL = o;
      b = aR[a]; j = ai[a + 4]; v = b[j]; o = -oR + v; b[j] = oR + v * 0.5; if (++j >= b.length) j = 0; ai[a + 4] = j; oR = o;
    }
    out.L[i] += oL * wet1 + oR * wet2; out.R[i] += oR * wet1 + oL * wet2;
  }
  return out;
}

// Ping-pong delay with filtered feedback.
function pingPong(inp, out, { time = 0.375, fb = 0.35, lp = 3500, hp = 350, kills = [] } = {}) {
  const D = idx(time), bL = new Float32Array(D), bR = new Float32Array(D); let w = 0;
  const lpa = 1 - Math.exp(-TAU * lp / SR), hpa = 1 - Math.exp(-TAU * hp / SR);
  let lL = 0, lR = 0, hL = 0, hR = 0;
  const killSet = new Set(kills.map(idx));
  for (let i = 0; i < N; i++) {
    if (killSet.has(i)) { bL.fill(0); bR.fill(0); lL = lR = hL = hR = 0; }
    const dl = bL[w], dr = bR[w];
    let nl = (inp.L[i] + inp.R[i]) * 0.5 + dr * fb, nr = dl * fb;
    lL += (nl - lL) * lpa; lR += (nr - lR) * lpa; hL += (lL - hL) * hpa; hR += (lR - hR) * hpa;
    bL[w] = lL - hL; bR[w] = lR - hR; if (++w >= D) w = 0;
    out.L[i] += dl; out.R[i] += dr;
  }
  return out;
}

// Stereo chorus: two modulated taps, quadrature LFOs.
function chorus(s, { rate = 0.31, depth = 0.0024, base = 0.012, mix = 0.5 } = {}) {
  const M = idx(base + depth) + 8, bL = new Float32Array(M), bR = new Float32Array(M); let w = 0;
  const read = (b, d) => { let p = w - d; while (p < 0) p += M; const i0 = Math.floor(p), fr = p - i0, i1 = (i0 + 1) % M; return b[i0] * (1 - fr) + b[i1] * fr; };
  for (let i = 0; i < N; i++) {
    const t = i / SR, xl = s.L[i], xr = s.R[i];
    bL[w] = xl; bR[w] = xr;
    const dL = (base + depth * Math.sin(TAU * rate * t)) * SR, dR = (base + 0.003 + depth * Math.sin(TAU * rate * 1.13 * t + 1.7)) * SR;
    const wl = read(bR, dR), wr = read(bL, dL);
    if (++w >= M) w = 0;
    s.L[i] = xl * (1 - mix * 0.5) + wl * mix; s.R[i] = xr * (1 - mix * 0.5) + wr * mix;
  }
  return s;
}

// ═════════════════════════════ drum & hit voices ═════════════════════════════
function makeKick(thin = false) {
  const r = rng('kick'), n = idx(0.48), x = new Float32Array(n);
  const click = new Float32Array(n);
  for (let i = 0; i < idx(0.012); i++) click[i] = bi(r) * Math.exp(-i / SR / 0.0012);
  filt(click, biquad('hp', 1500, 0.7));
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const f = 45 + 115 * Math.exp(-t / 0.032) + 60 * Math.exp(-t / 0.004); // ~160 Hz -> 45 Hz
    ph += TAU * f / SR;
    const body = Math.sin(ph) * Math.exp(-t / 0.14) * (1 - smooth(0.32, 0.47, t));
    const tick = 0.16 * Math.sin(TAU * 1900 * t) * Math.exp(-t / 0.0018);
    x[i] = Math.tanh(2.2 * (body + 0.38 * click[i] + tick)) / Math.tanh(2.2);
  }
  if (thin) { filt(x, biquad('hp', 230, 0.7)); filt(x, biquad('hp', 230, 0.7)); }
  return normalize(mono(x), thin ? 0.7 : 1);
}

function makeClap(seed) {
  const n = idx(0.42), L = new Float32Array(n), R = new Float32Array(n);
  const offs = [0, 0.0105, 0.0205, 0.031];
  for (const [ch, rr] of [[L, rng(seed + 'L')], [R, rng(seed + 'R')]]) {
    for (let i = 0; i < n; i++) {
      const t = i / SR; let e = 0;
      for (let k = 0; k < offs.length; k++) { const u = t - offs[k]; if (u >= 0) e += (k === 3 ? 1 : 0.8) * att(u, 0.0004) * Math.exp(-u / 0.0042); }
      const u = t - offs[3]; if (u > 0) e += 0.42 * Math.exp(-u / 0.085);
      ch[i] = bi(rr) * e * (1 - smooth(0.3, 0.42, t));
    }
    filtChain(ch, [['hp', 650, 0.7], ['bp', 1350, 0.9], ['peak', 2600, 1, 4], ['lp', 9500, 0.7]]);
  }
  return normalize({ L, R });
}

function makeSnare(seed, semis = 0) {
  const r = rng(seed), n = idx(0.32), x = new Float32Array(n);
  const nz = filtChain(noiseArr(r, n), [['hp', 1400, 0.7], ['lp', 9000, 0.7]]);
  const k = Math.pow(2, semis / 12); let p1 = 0, p2 = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR, f = (185 + 70 * Math.exp(-t / 0.012)) * k;
    p1 += TAU * f / SR; p2 += TAU * f * 1.63 / SR;
    const body = Math.sin(p1) * Math.exp(-t / 0.055) + 0.45 * Math.sin(p2) * Math.exp(-t / 0.035);
    const noise = nz[i] * att(t, 0.0005) * Math.exp(-t / 0.1);
    x[i] = Math.tanh(1.5 * (0.6 * body + 0.95 * noise)) * (1 - smooth(0.24, 0.32, t));
  }
  return normalize(mono(x));
}

const HAT_F = [205.3, 304.4, 369.6, 522.7, 540, 800]; // classic inharmonic square cluster
function makeHat(seed, { open = false, tick = false } = {}) {
  const r = rng(seed), len = open ? 0.5 : tick ? 0.05 : 0.1, n = idx(len), x = new Float32Array(n);
  const ph = HAT_F.map(() => r()), fr = HAT_F.map((f) => f * 1.72 * (1 + 0.01 * bi(r)));
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (let k = 0; k < 6; k++) { const dt = fr[k] / SR; ph[k] += dt; if (ph[k] >= 1) ph[k] -= 1; m += sqr(ph[k], dt); }
    x[i] = 0.55 * bi(r) + 0.45 * m / 6;
  }
  const hp = open ? 6000 : tick ? 8500 : 7200;
  filtChain(x, [['bp', open ? 9000 : 10500, 0.8], ['hp', hp, 0.7], ['hp', hp, 0.7]]);
  const dec = open ? 0.11 : tick ? 0.006 : 0.017;
  for (let i = 0; i < n; i++) { const t = i / SR; x[i] *= att(t, 0.0004) * Math.exp(-t / dec) * (1 - smooth(len * 0.7, len, t)); }
  return normalize(mono(x));
}

function makeShaker(seed) {
  const r = rng(seed), n = idx(0.09);
  const x = filtChain(noiseArr(r, n), [['bp', 6000, 1.4], ['hp', 3500, 0.7]]);
  for (let i = 0; i < n; i++) { const t = i / SR; x[i] *= (t < 0.006 ? (t / 0.006) ** 2 : Math.exp(-(t - 0.006) / 0.028)) * (1 - smooth(0.07, 0.09, t)); }
  return normalize(mono(x));
}

function makeTok(seed, f0) {
  const r = rng(seed), n = idx(0.12), x = new Float32Array(n); let p = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR; p += TAU * f0 * (1 + 0.25 * Math.exp(-t / 0.008)) / SR;
    x[i] = Math.sin(p) * Math.exp(-t / 0.028) * att(t, 0.0004) + 0.25 * bi(r) * Math.exp(-t / 0.0015);
  }
  return normalize(mono(x));
}

function makeCrash(seed) {
  const n = idx(2.2), out = stereo(n);
  for (const [ch, r] of [[out.L, rng(seed + 'L')], [out.R, rng(seed + 'R')]]) {
    const ph = HAT_F.map(() => r());
    for (let i = 0; i < n; i++) {
      let m = 0; for (let k = 0; k < 6; k++) { const dt = HAT_F[k] * 3.1 / SR; ph[k] += dt; if (ph[k] >= 1) ph[k] -= 1; m += sqr(ph[k], dt); }
      ch[i] = 0.7 * bi(r) + 0.3 * m / 6;
    }
    filtChain(ch, [['hp', 4200, 0.7], ['peak', 8000, 0.8, 3], ['lp', 14000, 0.7]]);
    for (let i = 0; i < n; i++) { const t = i / SR; ch[i] *= att(t, 0.001) * Math.exp(-t / 0.55) * (1 - smooth(1.8, 2.2, t)); }
  }
  return normalize(out);
}

// Cinematic impact for the drops: sub boom with pitch drop, noise crash, transient.
function makeImpact(seed) {
  const r = rng(seed), n = idx(3.2), out = stereo(n);
  const crL = filtChain(noiseArr(r, n), [['hp', 3500, 0.7]]), crR = filtChain(noiseArr(r, n), [['hp', 3500, 0.7]]);
  const tr = filtChain(noiseArr(r, n), [['lp', 5000, 0.7]]);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    ph += TAU * (44 + 52 * Math.exp(-t / 0.07) + 60 * Math.exp(-t / 0.006)) / SR;
    const boom = Math.tanh(1.6 * Math.sin(ph)) * att(t, 0.0008) * Math.exp(-t / 0.85) * (1 - smooth(2.6, 3.2, t));
    const ce = att(t, 0.0005) * Math.exp(-t / 0.55) * 0.32, te = Math.exp(-t / 0.006) * 0.5;
    out.L[i] = boom + crL[i] * ce + tr[i] * te; out.R[i] = boom + crR[i] * ce + tr[i] * te;
  }
  return normalize(out);
}

// Heavy hit for the build downbeats (layered on top of a kick).
function makeHeavyHit(seed) {
  const r = rng(seed), n = idx(1.6), out = stereo(n);
  const crL = filtChain(noiseArr(r, n), [['hp', 3000, 0.7]]), crR = filtChain(noiseArr(r, n), [['hp', 3000, 0.7]]);
  const th = filtChain(noiseArr(r, n), [['lp', 420, 0.7]]);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    ph += TAU * (40 + 45 * Math.exp(-t / 0.06)) / SR;
    const boom = 0.9 * Math.sin(ph) * att(t, 0.001) * Math.exp(-t / 0.38) * (1 - smooth(1.3, 1.6, t));
    const ce = 0.3 * att(t, 0.0005) * Math.exp(-t / 0.3), te = 0.9 * att(t, 0.0005) * Math.exp(-t / 0.05);
    out.L[i] = boom + crL[i] * ce + th[i] * te; out.R[i] = boom + crR[i] * ce + th[i] * te;
  }
  return normalize(out);
}

// Riser: noise through a rising resonant band-pass + an up-pitching detuned saw, volume swell.
function makeRiser(seed, dur, { lo = 300, hi = 9000, sawFrom = 41, sawOct = 3, sawAmt = 0.35 } = {}) {
  const r = rng(seed), n = idx(dur), out = stereo(n);
  const sL = new Svf(), sR = new Svf(), sS = new Svf();
  const ph = [r(), r(), r()], det = [-0.12, 0, 0.12];
  for (let i = 0; i < n; i++) {
    const x = i / n, fc = expi(lo, hi, x ** 1.15), k = 1 / (0.7 + 2.3 * x), g = gOf(fc);
    const na = 0.04 + 0.96 * x ** 2.2;
    sL.tick(bi(r), g, k); sR.tick(bi(r), g, k);
    let s = 0; const fs = mtof(sawFrom + 12 * sawOct * x ** 1.4);
    for (let j = 0; j < 3; j++) { const dt = fs * Math.pow(2, det[j] / 12) / SR; ph[j] += dt; if (ph[j] >= 1) ph[j] -= 1; s += saw(ph[j], dt); }
    sS.tick(s / 3, gOf(fs * 5), 0.9);
    const sa = sawAmt * x ** 2.6;
    out.L[i] = sL.bp * k * na + sS.lp * sa; out.R[i] = sR.bp * k * na + sS.lp * sa;
  }
  return normalize(out);
}

// Downlifter: falling band-passed noise + a sine dive.
function makeDownlifter(seed, dur) {
  const r = rng(seed), n = idx(dur), out = stereo(n), sL = new Svf(), sR = new Svf(); let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR, x = i / n, g = gOf(expi(6000, 160, x ** 0.7));
    sL.tick(bi(r), g, 0.8); sR.tick(bi(r), g, 0.8);
    ph += TAU * expi(220, 38, x ** 0.6) / SR;
    const e = att(t, 0.004) * Math.exp(-3.2 * x) * (1 - smooth(0.85, 1, x));
    const s = 0.3 * Math.sin(ph) * Math.exp(-t / 0.35);
    out.L[i] = (sL.bp * 0.8 + s) * e; out.R[i] = (sR.bp * 0.8 + s) * e;
  }
  return normalize(out);
}

// ═════════════════════════════ tonal voices ═════════════════════════════
function makePluck(m, vel, cutMax, r) {
  const n = idx(0.36), x = new Float32Array(n), f = mtof(m), sv = new Svf();
  let p1 = r(), p2 = r(), p3 = r();
  const d1 = f * Math.pow(2, 7 / 1200) / SR, d2 = f * Math.pow(2, -7 / 1200) / SR, d3 = 2 * f / SR;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    p1 += d1; if (p1 >= 1) p1 -= 1; p2 += d2; if (p2 >= 1) p2 -= 1; p3 += d3; if (p3 >= 1) p3 -= 1;
    const o = saw(p1, d1) + saw(p2, d2) + 0.3 * Math.sin(TAU * p3);
    sv.tick(o, gOf(260 + cutMax * (0.45 + 0.55 * vel) * Math.exp(-t / 0.06)), 0.75);
    x[i] = sv.lp * vel * att(t, 0.0008) * Math.exp(-t / 0.15) * (1 - smooth(0.28, 0.36, t)) * 0.5;
  }
  return mono(x);
}

function makeBassNote(m) {
  const n = idx(0.24), x = new Float32Array(n), f = mtof(m), sv = new Svf();
  let p1 = 0, p2 = 0.37; const d1 = f * 0.997 / SR, d2 = f * 1.003 / SR;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    p1 += d1; if (p1 >= 1) p1 -= 1; p2 += d2; if (p2 >= 1) p2 -= 1;
    sv.tick(saw(p1, d1) + 0.7 * sqr(p2, d2), gOf(180 + 900 * Math.exp(-t / 0.05)), 0.6);
    x[i] = Math.tanh(1.2 * sv.lp) * att(t, 0.003) * (1 - smooth(0.13, 0.22, t));
  }
  return mono(x);
}

const SS_DET = [-0.11002313, -0.06288439, -0.01952356, 0, 0.01991221, 0.06216538, 0.10745242]; // JP-8000 style spread
const SS_MIX = [0.6, 0.72, 0.85, 1, 0.85, 0.72, 0.6];
const SS_PAN = [-0.95, 0.65, -0.3, 0, 0.3, -0.65, 0.95];
const SS_GL = SS_PAN.map((p, s) => Math.cos((p + 1) * Math.PI / 4) * SS_MIX[s]);
const SS_GR = SS_PAN.map((p, s) => Math.sin((p + 1) * Math.PI / 4) * SS_MIX[s]);

function makeStab(chord, r) {
  const notes = VOICING[chord].slice(1).concat([VOICING[chord][2] + 12]);
  const n = idx(0.7), out = stereo(n), sl = new Svf(), sr = new Svf();
  const ph = new Float64Array(notes.length * 7).map(() => r()), dts = new Float64Array(notes.length * 7);
  notes.forEach((m, v) => SS_DET.forEach((d, s) => { dts[v * 7 + s] = mtof(m) * (1 + d * 0.2) / SR; }));
  const nzL = filtChain(noiseArr(r, n), [['bp', 1600, 0.8]]), nzR = filtChain(noiseArr(r, n), [['bp', 1600, 0.8]]);
  let pt = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR; let l = 0, rr = 0;
    for (let v = 0; v < notes.length; v++) for (let s = 0; s < 7; s++) {
      const k = v * 7 + s, dt = dts[k]; let p = ph[k] + dt; if (p >= 1) p -= 1; ph[k] = p;
      const y = saw(p, dt); l += y * SS_GL[s]; rr += y * SS_GR[s];
    }
    const g = gOf(900 + 8500 * Math.exp(-t / 0.09));
    sl.tick(l, g, 0.9); sr.tick(rr, g, 0.9);
    const e = att(t, 0.002) * Math.exp(-t / 0.2) * (1 - smooth(0.55, 0.7, t));
    pt += TAU * (70 + 60 * Math.exp(-t / 0.02)) / SR;
    const thump = 0.9 * Math.sin(pt) * Math.exp(-t / 0.06) * att(t, 0.001);
    const ne = 2.5 * Math.exp(-t / 0.025) * att(t, 0.0005);
    out.L[i] = sl.lp * e * 0.12 + nzL[i] * ne + thump; out.R[i] = sr.lp * e * 0.12 + nzR[i] * ne + thump;
  }
  normalize(out);
  for (const ch of [out.L, out.R]) for (let i = 0; i < n; i++) ch[i] = Math.tanh(1.8 * ch[i]); // denser, less peaky
  return normalize(out);
}

// ═════════════════════════════ arrangement: stems ═════════════════════════════
const stems = {};
const mk = (name, o = {}) => (stems[name] = { name, ...stereo(), ...o });
const DROP_REF = [DROP.start, MONT.start];
// Calibration targets are K-weighted loudness (LUFS) of each stem alone over its reference window.
mk('kick', { ref: DROP_REF, target: -17.5 });
mk('clap', { ref: DROP_REF, target: -20.5, a: 0.22 });
mk('snare', { ref: ROLL1, target: -23, a: 0.3, b: 0.08 });
mk('hats', { ref: DROP_REF, target: -23.5, a: 0.06 });
mk('perc', { gainFrom: 'hats', rel: 0, a: 0.12 });
mk('crash', { gainFrom: 'kick', rel: -12, b: 0.15 });
mk('hits', { gainFrom: 'kick', rel: 0, b: 0.35 });
mk('sub', { ref: DROP_REF, target: -19, duck: 'sub', depth: () => 0.9 });
mk('bass', { ref: DROP_REF, target: -24, duck: 'pump', depth: () => 0.5 });
mk('chords', { ref: DROP_REF, target: -15.5, duck: 'pump', depth: (t) => chordState(t).duck, b: (t) => chordState(t).b });
mk('chordTail', { gainFrom: 'chords', rel: 0, dry: false, b: 0.3 });
mk('pad', { ref: [INTRO.start, BUILD.start], target: -21, duck: 'pump', depth: () => 0.35, b: 0.35 });
mk('padTail', { gainFrom: 'pad', rel: 0, dry: false, b: 0.3 });
mk('pluck', { ref: DROP_REF, target: -18.5, duck: 'pump', depth: () => 0.45, a: 0.14, d: 0.3 });
mk('stabs', { ref: STABS.length ? [STABS[0], STABS[0] + BEAT] : DROP_REF, target: -15.5, a: 0.08, b: 0.32 });
mk('fx', { gainFrom: 'kick', rel: -11, b: 0.25 });
mk('drone', { ref: [INTRO.start, BUILD.start], target: -35, b: 0.2 });

function placeM(st, src, t, gain = 1, pan = 0) { addTo(st, src, idx(t), gain, pan, cutAfter(t, MUSIC_CUTS)); }

const SWING = 0.007; // late off-16ths (~55% swing feel)
const swingT = (t, r, hum = 0.0015) => { const s = Math.round(t / S16); return t + (s % 2 === 1 ? SWING : 0) + bi(r) * hum; };

// ---------- kicks & sidechain ----------
const kickTimes = [];
const addBeats = (a, b, thin = false) => { for (let t = a; t < b - 1e-9; t += BEAT) kickTimes.push({ t, thin }); };
addBeats(BUILD.start, GAP1.start); addBeats(DROP.start, BRK.start); addBeats(GROOVE.start, BUILD2.start);
addBeats(BUILD2.start, GAP2.start, true); addBeats(FINAL.start, STOP);

const KICK = makeKick(false), KICK_THIN = makeKick(true);
for (const k of kickTimes) placeM(stems.kick, k.thin ? KICK_THIN : KICK, k.t, 1);

const duckArr = { pump: new Float32Array(N), sub: new Float32Array(N) };
for (const k of kickTimes) {
  const s = idx(k.t), w = k.thin ? 0.4 : 1;
  for (let j = -idx(0.003); j < idx(0.3); j++) {
    const i = s + j; if (i < 0 || i >= N) continue;
    const dt = j / SR, lead = dt < 0 ? 1 + dt / 0.003 : 1;
    const p = lead * (1 - smooth(0, 0.26, dt)), q = lead * (1 - smooth(0, 0.16, dt));
    if (p * w > duckArr.pump[i]) duckArr.pump[i] = p * w;
    if (q * w > duckArr.sub[i]) duckArr.sub[i] = q * w;
  }
}

// ---------- heavy hits (build downbeats), impacts, crashes ----------
const HEAVY = makeHeavyHit('heavy');
for (let t = BUILD.start; t < GAP1.start - 1e-9; t += 2 * BEAT) placeM(stems.hits, HEAVY, t, 0.55);
const IMPACT = makeImpact('impact');
placeM(stems.hits, IMPACT, DROP.start, 1); placeM(stems.hits, IMPACT, FINAL.start, 1);
const CRASH = makeCrash('crash');
placeM(stems.crash, CRASH, DROP.start, 1.8); placeM(stems.crash, CRASH, FINAL.start, 1.8);
placeM(stems.crash, CRASH, MONT.start, 1, -0.1); placeM(stems.crash, CRASH, GROOVE.start, 0.8, 0.1);

// ---------- claps & snare rolls ----------
{
  const claps = [makeClap('clapA'), makeClap('clapB'), makeClap('clapC')], r = rng('claps');
  const back = (a, b, vel) => { for (let t = a + BEAT; t < b - 1e-9; t += 2 * BEAT) placeM(stems.clap, claps[Math.floor(r() * 3)], t, vel * (0.93 + 0.07 * r())); };
  back(BUILD.start, GAP1.start, 0.85); back(DROP.start, BRK.start, 1); back(GROOVE.start, BUILD2.start, 1);
  back(BUILD2.start, ROLL2[0], 0.7); back(FINAL.start, STOP, 1);
  const snares = Array.from({ length: 8 }, (_, s) => makeSnare('snare' + s, s));
  const roll = ([a, b]) => {
    const L = b - a, s1 = a + L * 4 / 7, s2 = a + L * 6 / 7, times = [];
    for (let t = a; t < s1 - 1e-9; t += 2 * S16) times.push(t);
    for (let t = s1; t < s2 - 1e-9; t += S16) times.push(t);
    for (let t = s2; t < b - 1e-9; t += S16 / 2) times.push(t);
    for (const t of times) { const p = (t - a) / L; placeM(stems.snare, snares[Math.min(7, Math.round(7 * p))], t, (0.35 + 0.65 * p ** 1.2) * (0.94 + 0.06 * r()), bi(r) * 0.08); }
  };
  roll(ROLL1); roll(ROLL2);
}

// ---------- hats & percussion ----------
{
  const r = rng('hats');
  const CH = [0, 1, 2, 3].map((k) => makeHat('ch' + k)), OH = [0, 1].map((k) => makeHat('oh' + k, { open: true }));
  const TK = [0, 1].map((k) => makeHat('tk' + k, { tick: true }));
  const pick = (a) => a[Math.floor(r() * a.length)];
  const ACC = [0.55, 0.32, 0.8, 0.38];
  const ch = (t, v) => placeM(stems.hats, pick(CH), swingT(t, r), v * (0.88 + 0.24 * r()), 0.18);
  // intro: sparse ticking hat
  for (let t = TICK_FROM; t < BUILD.start - 1e-9; t += 2 * S16) {
    const x = (t - TICK_FROM) / (BUILD.start - TICK_FROM);
    placeM(stems.hats, pick(TK), swingT(t, r), (0.42 + 0.3 * x) * (Math.round(t / S16) % 4 === 2 ? 1 : 0.7), 0.12);
    if (r() < 0.3 + 0.4 * x) placeM(stems.hats, pick(TK), swingT(t + S16, r), 0.22 + 0.2 * x, -0.1);
  }
  // build: 16ths with crescendo
  for (let t = BUILD.start; t < GAP1.start - 1e-9; t += S16) { const x = (t - BUILD.start) / (GAP1.start - BUILD.start); ch(t, (0.35 + 0.55 * x) * ACC[Math.round(t / S16) % 4] * 1.4); }
  // groove sections: 16th closed + offbeat open
  const groove = (a, b, lvl = 1) => {
    for (let t = a; t < b - 1e-9; t += S16) {
      const s = Math.round(t / S16) % 4;
      if (s === 2) placeM(stems.hats, pick(OH), swingT(t, r, 0.001), 0.62 * lvl * (0.9 + 0.2 * r()), -0.15);
      else ch(t, ACC[s] * lvl);
    }
  };
  groove(DROP.start, MONT.start); groove(MONT.start, BRK.start, 1.12); groove(GROOVE.start, BUILD2.start); groove(FINAL.start, STOP);
  // breakdown: soft 8ths in the second bar
  for (let t = BRK.start + BAR / 2; t < GROOVE.start - 1e-9; t += 2 * S16) ch(t, 0.3 + 0.35 * (t - BRK.start - BAR / 2) / (BAR / 2));
  // build2: thin 8ths, then 16ths under the roll
  for (let t = BUILD2.start; t < ROLL2[0] - 1e-9; t += 2 * S16) ch(t, 0.45 * ACC[Math.round(t / S16) % 4] * 1.5);
  for (let t = ROLL2[0]; t < GAP2.start - 1e-9; t += S16) { const x = (t - ROLL2[0]) / (GAP2.start - ROLL2[0]); ch(t, (0.4 + 0.5 * x) * ACC[Math.round(t / S16) % 4] * 1.3); }
  // montage extra percussion: shaker 16ths + syncopated toks
  const SH = [0, 1, 2].map((k) => makeShaker('sh' + k)), TOK = [makeTok('tokA', 620), makeTok('tokB', 830)];
  const SHV = [0.4, 0.7, 0.5, 0.85];
  for (let t = MONT.start; t < STUTTER[0] + BEAT - 1e-9; t += S16) placeM(stems.perc, pick(SH), swingT(t, r), SHV[Math.round(t / S16) % 4] * (0.85 + 0.3 * r()) * 0.7, -0.35);
  for (let bar = MONT.start; bar < STUTTER[0] + 1e-9; bar += BAR) [3, 6, 10, 13].forEach((s, j) => {
    const t = bar + s * S16; if (t < STUTTER[0] + BEAT) placeM(stems.perc, TOK[j % 2], swingT(t, r), 0.75 + 0.2 * r(), j % 2 ? 0.45 : -0.45);
  });
}

// ---------- sub (sustained roots, ducked) & offbeat mid-bass ----------
function subLevel(t) {
  if (t < BUILD.start) return 0.6 * smooth(INTRO.start + 0.3, BUILD.start, t) ** 1.4; // intro sub swell (F pedal)
  if ((t >= DROP.start && t < BRK.start) || (t >= GROOVE.start && t < BUILD2.start) || (t >= FINAL.start && t < STOP)) return 1;
  return 0;
}
{
  const st = stems.sub; let ph = 0, a = 0, f = mtof(SUB_ROOT[chordAt(0)]);
  for (let i = 0; i < N; i++) {
    const t = i / SR, target = t < BUILD.start ? subLevel(t) : subLevel(t);
    a += (target - a) * (target > a ? 0.004 : 0.02);
    const fT = mtof(SUB_ROOT[t < BUILD.start ? 'Fm' : chordAt(t)]); f += (fT - f) * 0.003;
    ph += TAU * f / SR; if (ph > TAU) ph -= TAU;
    if (a < 1e-6) continue;
    const y = Math.tanh(1.7 * Math.sin(ph)) / Math.tanh(1.7) * a;
    st.L[i] = y; st.R[i] = y;
  }
  const cache = {};
  for (const [a0, b0] of [[DROP.start, BRK.start], [GROOVE.start, BUILD2.start], [FINAL.start, STOP]])
    for (let t = a0 + BEAT / 2; t < b0 - 1e-9; t += BEAT) {
      const m = SUB_ROOT[chordAt(t)] + 12;
      placeM(stems.bass, cache[m] ||= makeBassNote(m), t, 1);
    }
}

// ---------- supersaw chords ----------
function chordState(t) {
  if (t < BUILD.start) return { amp: 0, cut: 240, k: 0.6, duck: 0, b: 0 };
  if (t < GAP1.start) { const x = (t - BUILD.start) / (GAP1.start - BUILD.start); return { amp: 0.22 + 0.43 * x * x, cut: expi(240, 3000, x ** 1.5), k: 0.55, duck: 0.5, b: 0.18 }; }
  if (t < DROP.start) return { amp: 0, cut: 6500, k: 1, duck: 0, b: 0 };
  if (t < MONT.start) return { amp: 1, cut: 6500, k: 1.0, duck: 0.75, b: 0.12 };
  if (t < BRK.start) return { amp: 1, cut: 9000, k: 1.0, duck: 0.75, b: 0.12 };
  if (t < GROOVE.start) return { amp: 0.42, cut: 1150 - 350 * Math.cos(TAU * 0.25 * (t - BRK.start)), k: 0.5, duck: 0, b: 0.3 };
  if (t < BUILD2.start) return { amp: 0.95, cut: 7500, k: 1.0, duck: 0.75, b: 0.12 };
  if (t < GAP2.start) { const x = (t - BUILD2.start) / (GAP2.start - BUILD2.start); return { amp: 0.3 + 0.7 * x * x, cut: expi(450, 6000, x ** 1.5), k: 0.55, duck: 0.35, b: 0.18 }; }
  if (t < FINAL.start) return { amp: 0, cut: 11000, k: 1, duck: 0, b: 0 };
  if (t < STOP) return { amp: 1.1, cut: 11000, k: 1.1, duck: 0.55, b: 0.16 };
  return { amp: 1.1, cut: expi(11000, 2500, (t - STOP) / 1.5), k: 1.1, duck: 0, b: 0 }; // feeds the reverb tail only
}
{
  const r = rng('supersaw'), NV = 5, NS = 7, pre = stereo();
  const ph = new Float64Array(NV * NS).map(() => r()), dts = new Float64Array(NV * NS);
  const fl = new Svf(), fr = new Svf(); let amp = 0, cut = 300, bar = -1;
  for (let i = idx(BUILD.start); i < N; i++) {
    const t = i / SR, st = chordState(t);
    amp += (st.amp - amp) * 0.02; cut += (st.cut - cut) * 0.004;
    const b = Math.floor(t / BAR + 1e-9);
    if (b !== bar) { bar = b; const notes = VOICING[chordAt(t)]; for (let v = 0; v < NV; v++) for (let s = 0; s < NS; s++) dts[v * NS + s] = mtof(notes[v]) * (1 + SS_DET[s] * 0.16) / SR; }
    if (amp < 1e-4 && st.amp === 0) continue;
    let l = 0, rr = 0;
    for (let v = 0; v < NV; v++) for (let s = 0; s < NS; s++) {
      const k = v * NS + s, dt = dts[k]; let p = ph[k] + dt; if (p >= 1) p -= 1; ph[k] = p;
      const y = 2 * p - 1 - blep(p, dt); l += y * SS_GL[s]; rr += y * SS_GR[s];
    }
    const g = gOf(cut);
    pre.L[i] = fl.tick(l, g, st.k) * amp; pre.R[i] = fr.tick(rr, g, st.k) * amp;
  }
  filtStereo(pre, [['hp', 200, 0.7], ['peak', 350, 1.0, -2.5]]); // leave 40-200 Hz to kick, sub and bass
  const s0 = idx(STOP), cuts = MUSIC_CUTS.map(idx);
  for (let i = 0; i < N; i++) {
    if (i < s0) {
      let f = 1; for (const c of cuts) { const d = c - i; if (d > 0 && d < 96) f = d / 96; }
      if (i >= idx(GAP1.start) && i < idx(GAP1.end)) f = 0; if (i >= idx(GAP2.start) && i < idx(GAP2.end)) f = 0;
      stems.chords.L[i] = pre.L[i] * f; stems.chords.R[i] = pre.R[i] * f;
    } else { const e = Math.exp(-(i - s0) / SR / 0.9); stems.chordTail.L[i] = pre.L[i] * e; stems.chordTail.R[i] = pre.R[i] * e; }
  }
}

// ---------- pad (intro, breakdown, build2, final) ----------
{
  const r = rng('pad'), pre = stereo(), bars = [];
  for (let t = INTRO.start; t < GAP1.start - 1e-9; t += BAR) bars.push({ t0: t, t1: Math.min(t + BAR, GAP1.start), A: t === INTRO.start ? 1.7 : 0.3, lvl: t < BUILD.start ? 1 : 0.75 });
  bars.push({ t0: BRK.start, t1: GROOVE.start, A: 0.5, lvl: 0.75 });
  for (let t = BUILD2.start; t < GAP2.start - 1e-9; t += BAR) bars.push({ t0: t, t1: Math.min(t + BAR, GAP2.start), A: t === BUILD2.start ? 0.8 : 0.3, lvl: 0.75 });
  bars.push({ t0: FINAL.start, t1: STOP, A: 0.05, lvl: 1, final: true });
  const DET = [-0.09, 0, 0.09], PAN = [-0.6, 0, 0.6];
  for (const bar of bars) {
    const notes = PAD_VOICING[chordAt(bar.t0 + 0.01)];
    const hardEnd = MUSIC_CUTS.includes(bar.t1) && !bar.final, Rl = bar.final ? 3.0 : hardEnd ? 0.004 : 0.45;
    const dur = bar.t1 - bar.t0, n = idx(dur + Rl), s0 = idx(bar.t0);
    for (const m of notes) {
      const lvl = bar.lvl * (m < 48 ? 0.8 : 1);
      for (let d = 0; d < 3; d++) {
        const f = mtof(m + DET[d]), dt = f / SR, gl = Math.min(1, 1 - PAN[d]), gr = Math.min(1, 1 + PAN[d]); let p = r();
        for (let i = 0; i < n && s0 + i < N; i++) {
          const t = i / SR;
          const e = (t < bar.A ? Math.sin(0.5 * Math.PI * t / bar.A) ** 2 : 1) * (t > dur ? Math.exp(-(t - dur) / (Rl / 4.5)) : 1);
          p += dt; if (p >= 1) p -= 1;
          const y = saw(p, dt) * e * lvl * 0.1;
          pre.L[s0 + i] += y * gl; pre.R[s0 + i] += y * gr;
        }
      }
    }
  }
  const padCut = (t) => {
    if (t < BUILD.start) return expi(320, 900, t / (BUILD.start - INTRO.start));
    if (t < DROP.start) return expi(900, 2600, (t - BUILD.start) / (GAP1.start - BUILD.start));
    if (t < GROOVE.start) return 1500 + 300 * Math.sin(TAU * 0.3 * t);
    if (t < FINAL.start) return expi(500, 2800, (t - BUILD2.start) / (GAP2.start - BUILD2.start));
    if (t < STOP) return 3200;
    return expi(3200, 1100, (t - STOP) / 1.6);
  };
  const fl = new Svf(), fr = new Svf();
  for (let i = 0; i < N; i++) { const g = gOf(padCut(i / SR)); pre.L[i] = fl.tick(pre.L[i], g, 0.85); pre.R[i] = fr.tick(pre.R[i], g, 0.85); }
  filtStereo(pre, [['hp', 70, 0.7]]);
  chorus(pre);
  const s0 = idx(STOP);
  for (let i = 0; i < N; i++) {
    const t = i / SR;
    let gate = GAPS.some(([a, b]) => t >= a && t < b) ? 0 : 1;
    for (const c of MUSIC_CUTS) { const d = idx(c) - i; if (d > 0 && d < 96) gate = Math.min(gate, d / 96); }
    if (i < s0) { stems.pad.L[i] = pre.L[i] * gate; stems.pad.R[i] = pre.R[i] * gate; }
    else { stems.padTail.L[i] = pre.L[i]; stems.padTail.R[i] = pre.R[i]; }
  }
}

// ---------- intro drone (dark filtered rumble) ----------
{
  const r = rng('drone'), sl = new Svf(), sr = new Svf(), st = stems.drone, end = idx(GAP1.start);
  for (let i = 0; i < end; i++) {
    const t = i / SR, g = gOf(380 + 140 * Math.sin(TAU * 0.21 * t));
    sl.tick(bi(r), g, 0.6); sr.tick(bi(r), g, 0.6);
    const e = smooth(0, 3.5, t) * (1 - 0.5 * smooth(BUILD.start, GAP1.start, t)) * Math.min(1, (end - i) / 96);
    st.L[i] = sl.lp * e; st.R[i] = sr.lp * e;
  }
}

// ---------- pluck arp ----------
{
  const r = rng('arp');
  const SECS = [[DROP.start, MONT.start, 0, 5200, 1], [MONT.start, MONT.end, 12, 6500, 0.85], [BRK.start, GROOVE.start, 0, 1600, 0.7],
    [GROOVE.start, BUILD2.start, 0, 5200, 1], [FINAL.start, STOP, 12, 6000, 0.85]];
  for (const [a, b, oct, cutMax, lvl] of SECS) {
    for (let t = a; t < b - 1e-9; t += S16) {
      const step = Math.round(t / S16) % 16, chord = chordAt(t);
      const vel = ARP_VEL[step] * (0.92 + 0.16 * r());
      placeM(stems.pluck, makePluck(ARP[chord][ARP_STEPS[step]] + oct, Math.min(1, vel), cutMax, r), swingT(t, r, 0.0008), lvl, step % 2 ? 0.16 : -0.16);
    }
  }
}

// ---------- accent stabs ----------
{ const r = rng('stabs'); for (const t of STABS) placeM(stems.stabs, makeStab(chordAt(t), r), t, 1); }

// ---------- risers & downlifters ----------
placeM(stems.fx, makeRiser('riser1', GAP1.start - BUILD.start), BUILD.start, 1);
placeM(stems.fx, makeRiser('riser2', GAP2.start - BUILD2.start), BUILD2.start, 1);
placeM(stems.fx, makeRiser('revcym', BEAT * 2, { lo: 2000, hi: 11000, sawAmt: 0 }), GROOVE.start - BEAT * 2, 0.6);
placeM(stems.fx, makeDownlifter('down1', 2.2), DROP.start, 0.8);
placeM(stems.fx, makeDownlifter('down2', 2.0), FINAL.start, 0.8);

log(`[synth] instruments rendered in ${((Date.now() - T_START) / 1000).toFixed(1)} s`);

// ═════════════════════════════ music bus ═════════════════════════════
const music = stereo(), sendA = stereo(), sendB = stereo(), sendD = stereo();
const stemGain = {}, stemReport = [];
for (const st of Object.values(stems)) {
  if (st.duck) { const d = duckArr[st.duck]; for (let i = 0; i < N; i++) { if (!d[i]) continue; const g = 1 - st.depth(i / SR) * d[i]; st.L[i] *= g; st.R[i] *= g; } }
  const g = st.ref ? db(st.target - lufs(st, ...st.ref)) : st.gainFrom ? stemGain[st.gainFrom] * db(st.rel || 0) : 1;
  stemGain[st.name] = g;
  const sends = [['a', sendA], ['b', sendB], ['d', sendD]].filter(([k]) => st[k]);
  for (let i = 0; i < N; i++) {
    const l = st.L[i] * g, r = st.R[i] * g; st.L[i] = l; st.R[i] = r;
    if (l === 0 && r === 0) continue;
    if (st.dry !== false) { music.L[i] += l; music.R[i] += r; }
    for (const [k, bus] of sends) { const s = typeof st[k] === 'function' ? st[k](i / SR) : st[k]; bus.L[i] += l * s; bus.R[i] += r * s; }
  }
  const L = (a, b) => lufs(st, a, b).toFixed(1).padStart(6);
  stemReport.push(`${st.name.padEnd(10)} gain ${toDb(g).toFixed(1).padStart(6)} dB | LUFS intro ${L(0, 4)} build ${L(4, 7.75)} drop ${L(8, 16)} montage ${L(16, 22)} brk ${L(22, 24)} final ${L(32, 34)}`
    + (process.env.SYNTH_DEBUG ? ` | 7.0 ${L(7, 7.4)} 7.35 ${L(7.35, 7.75)} 8.0 ${L(8, 8.4)} 8.5 ${L(8.5, 8.9)}` : ''));
}
// send conditioning: band-limit what feeds the reverbs/delay
filtStereo(sendA, [['hp', 250, 0.7], ['lp', 8000, 0.7]]);
filtStereo(sendB, [['hp', 200, 0.7], ['lp', 7500, 0.7]]);
filtStereo(sendD, [['hp', 400, 0.7], ['lp', 6000, 0.7]]);
const retA = freeverb(sendA, stereo(), { room: 0.62, damp: 0.45, pre: 0.012, kills: [GAP1.start, GAP2.start, STOP] });
const retB = freeverb(sendB, stereo(), { room: 0.9, damp: 0.28, pre: 0.028, kills: [GAP1.start, GAP2.start] });
const retD = pingPong(sendD, stereo(), { time: 3 * S16, fb: 0.36, kills: [GAP1.start, GAP2.start, STOP] });
for (const [name, ret, target] of [['roomVerb', retA, -25], ['hallVerb', retB, -23], ['delay', retD, -26.5]]) {
  const g = db(target - lufs(ret, ...DROP_REF));
  for (let i = 0; i < N; i++) { music.L[i] += ret.L[i] * g; music.R[i] += ret.R[i] * g; }
  stemReport.push(`${name.padEnd(10)} return, drop ${target} LUFS`);
}
// bus EQ: clear subsonics, a touch of air
filtStereo(music, [['hp', 24, 0.7], ['hp', 24, 0.7], ['hs', 9500, 0.7, 1.5]]);

// stutter fill (beat-repeat 1/16 -> 1/32 -> 1/64 with a rising high-pass)
function stutter(b, a, e) {
  const s = idx(a), span = idx(e) - s, src = { L: b.L.slice(s, s + span), R: b.R.slice(s, s + span) };
  const q = span / 4, plan = [[q, 2], [q / 2, 2], [q / 4, 4]], F = 48; let pos = 0;
  for (const [lenF, reps] of plan) {
    const len = Math.round(lenF);
    for (let k = 0; k < reps; k++) { for (let j = 0; j < len && pos + j < span; j++) { const w = Math.min(1, j / F, (len - j) / F); b.L[s + pos + j] = src.L[j] * w; b.R[s + pos + j] = src.R[j] * w; } pos += len; }
  }
  const hl = new Svf(), hr = new Svf();
  for (let j = 0; j < span; j++) {
    const x = j / span, g = gOf(40 * Math.pow(22, x ** 1.5));
    hl.tick(b.L[s + j], g, 1.2); hr.tick(b.R[s + j], g, 1.2);
    b.L[s + j] = hl.hp * (1 + 0.25 * x); b.R[s + j] = hr.hp * (1 + 0.25 * x);
  }
  for (let j = 0; j < F; j++) { b.L[s + span + j] *= j / F; b.R[s + span + j] *= j / F; }
}
stutter(music, STUTTER[0], STUTTER[1]);

// hard-cut gaps and the final fade (applied after every IIR stage so the gaps stay digitally silent)
function gatesAndFade(b) {
  const F = 96;
  for (const [a, e] of GAPS) {
    const s = idx(a), t = idx(e);
    for (let j = 1; j <= F; j++) { const w = (j - 1) / F; b.L[s - j] *= w; b.R[s - j] *= w; }
    for (let i = s; i < t; i++) { b.L[i] = 0; b.R[i] = 0; }
  }
  const f0 = idx(FADE_START), f1 = idx(FADE_END);
  for (let i = f0; i < N; i++) { const w = i >= f1 ? 0 : 0.5 * (1 + Math.cos(Math.PI * (i - f0) / (f1 - f0))); b.L[i] *= w; b.R[i] *= w; }
}
gatesAndFade(music);

// ═════════════════════════════ loudness / dynamics ═════════════════════════════
// ITU-R BS.1770-4 integrated loudness (48 kHz K-weighting coefficients from the spec).
function lufs(s, t0 = 0, t1 = TL.duration) {
  const a = idx(t0), b = idx(t1), n = b - a, P = [];
  for (const ch of [s.L, s.R]) {
    const y = new Float64Array(n); let x1 = 0, x2 = 0, y1 = 0, y2 = 0, u1 = 0, u2 = 0;
    for (let i = 0; i < n; i++) {
      const x = ch[a + i];
      const v = 1.53512485958697 * x - 2.69169618940638 * x1 + 1.19839281085285 * x2 + 1.69065929318241 * y1 - 0.73248077421585 * y2;
      x2 = x1; x1 = x; y2 = y1; y1 = v;
      const w = v - 2 * u1 + u2 + 1.99004745483398 * (y[i - 1] || 0) - 0.99007225036621 * (y[i - 2] || 0);
      u2 = u1; u1 = v; y[i] = w;
    }
    const c = new Float64Array(n + 1); for (let i = 0; i < n; i++) c[i + 1] = c[i] + y[i] * y[i]; P.push(c);
  }
  const B = idx(0.4), H = idx(0.1), z = [];
  for (let s0 = 0; s0 + B <= n; s0 += H) z.push((P[0][s0 + B] - P[0][s0] + P[1][s0 + B] - P[1][s0]) / B);
  const L = (m) => -0.691 + 10 * Math.log10(m);
  const abs = z.filter((m) => L(m) > -70); if (!abs.length) return -Infinity;
  const rel = L(abs.reduce((p, q) => p + q, 0) / abs.length) - 10;
  const g = abs.filter((m) => L(m) > rel);
  return L(g.reduce((p, q) => p + q, 0) / g.length);
}
const scaleBuf = (s, g) => { for (let i = 0; i < N; i++) { s.L[i] *= g; s.R[i] *= g; } return s; };

// RMS-detecting soft-knee glue compressor -> gain curve
function glueGain(s, { thr = -16, ratio = 2, knee = 6, attack = 0.015, release = 0.2, rms = 0.01 } = {}) {
  const g = new Float32Array(N), aR = 1 - Math.exp(-1 / (rms * SR)), aA = 1 - Math.exp(-1 / (attack * SR)), aL = 1 - Math.exp(-1 / (release * SR));
  let ms = 0, gr = 0, maxGr = 0;
  for (let i = 0; i < N; i++) {
    const p = Math.max(s.L[i] * s.L[i], s.R[i] * s.R[i]); ms += (p - ms) * aR;
    const over = 10 * Math.log10(ms + 1e-20) - thr;
    let t = 0;
    if (2 * over >= knee) t = (1 / ratio - 1) * over; else if (2 * over > -knee) t = (1 / ratio - 1) * (over + knee / 2) ** 2 / (2 * knee);
    gr += (t - gr) * (t < gr ? aA : aL); g[i] = db(gr); if (-gr > maxGr) maxGr = -gr;
  }
  return { g, maxGr };
}

// 4x polyphase windowed-sinc interpolation for true-peak detection
const TP_TAPS = (() => {
  const H = [];
  for (const fr of [0.25, 0.5, 0.75]) {
    const h = []; let sum = 0;
    for (let j = -5; j <= 6; j++) { const u = fr - j, w = 0.5 * (1 + Math.cos(Math.PI * u / 6.5)), v = (u === 0 ? 1 : Math.sin(Math.PI * u) / (Math.PI * u)) * w; h.push(v); sum += v; }
    H.push(h.map((v) => v / sum));
  }
  return H;
})();
function truePeakEnv(s) {
  const tp = new Float32Array(N), between = new Float32Array(N);
  for (const ch of [s.L, s.R]) {
    for (let n = 0; n < N - 1; n++) {
      let m = 0;
      for (let p = 0; p < 3; p++) {
        const h = TP_TAPS[p]; let y = 0;
        for (let k = 0; k < 12; k++) { const j = n - 5 + k; if (j >= 0 && j < N) y += h[k] * ch[j]; }
        const a = Math.abs(y); if (a > m) m = a;
      }
      if (m > between[n]) between[n] = m;
    }
  }
  for (let n = 0; n < N; n++) tp[n] = Math.max(Math.abs(s.L[n]), Math.abs(s.R[n]), between[n], n ? between[n - 1] : 0);
  return tp;
}
// Look-ahead limiter gain curve (min-hold + release + box smoothing): guarantees peak*gain <= ceiling.
function limiterGain(tp, ceiling, { look = 0.0015, release = 0.08 } = {}) {
  const W = Math.max(2, idx(look)), req = new Float32Array(N), hold = new Float32Array(N);
  for (let n = 0; n < N; n++) req[n] = tp[n] > ceiling ? ceiling / tp[n] : 1;
  const dq = new Int32Array(N); let h = 0, t = 0;
  for (let n = 0; n < N; n++) {
    while (t > h && req[dq[t - 1]] >= req[n]) t--; dq[t++] = n;
    if (dq[h] <= n - W) h++;
    hold[n] = req[dq[h]];
  }
  const a = 1 - Math.exp(-1 / (release * SR)); let env = 1;
  const P = new Float64Array(N + 1);
  for (let n = 0; n < N; n++) { env = Math.min(hold[n], env + (1 - env) * a); P[n + 1] = P[n] + env; }
  const g = new Float32Array(N);
  for (let n = 0; n < N; n++) { const e = Math.min(N, n + W); g[n] = (P[e] - P[n]) / (e - n); }
  return g;
}

// Music bus: reference level, glue compression, gentle soft clip.
const MUSIC_REF = -17;
scaleBuf(music, db(MUSIC_REF - lufs(music)));
const glue = glueGain(music, { thr: -14, ratio: 2, knee: 6, attack: 0.012, release: 0.18 });
for (let i = 0; i < N; i++) { music.L[i] *= glue.g[i]; music.R[i] *= glue.g[i]; }
const softClip = (x, T = 0.6) => { const a = Math.abs(x); return a <= T ? x : Math.sign(x) * (T + (1 - T) * Math.tanh((a - T) / (1 - T))); };
for (let i = 0; i < N; i++) { music.L[i] = softClip(music.L[i]); music.R[i] = softClip(music.R[i]); }

log(`[synth] music bus mixed in ${((Date.now() - T_START) / 1000).toFixed(1)} s`);

// ═════════════════════════════ SFX ═════════════════════════════
const S = {};
S.ping = (r, { n1 = 84, n2 = 89, det = 0 } = {}) => {
  const n = idx(0.34), x = new Float32Array(n), T2 = 0.062, f1 = mtof(n1 + det), f2 = mtof(n2 + det); let p1 = 0, p2 = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR; let y = 0; p1 += TAU * f1 / SR;
    if (t < T2 + 0.02) { const e = att(t, 0.0012) * Math.exp(-t / 0.07) * (1 - smooth(T2 - 0.005, T2 + 0.02, t)); y += e * (Math.sin(p1 + 1.1 * Math.exp(-t / 0.012) * Math.sin(2 * p1)) + 0.18 * Math.sin(2 * p1)); }
    if (t >= T2) { const u = t - T2; p2 += TAU * f2 / SR; const e = att(u, 0.0012) * Math.exp(-u / 0.1) * (1 - smooth(0.2, 0.278, u)); y += 1.05 * e * (Math.sin(p2 + 0.9 * Math.exp(-u / 0.014) * Math.sin(2 * p2)) + 0.16 * Math.sin(2 * p2)); }
    x[i] = y;
  }
  return normalize(mono(x));
};
S.slam = (r, { tune = 1 } = {}) => {
  const n = idx(0.65), out = stereo(n), m = new Float32Array(n);
  const crack = filtChain(noiseArr(r, n), [['bp', 2800, 0.8], ['hp', 900, 0.7]]), body = filtChain(noiseArr(r, n), [['lp', 700, 0.7]]);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR; ph += TAU * (42 + 125 * Math.exp(-t / 0.024)) * tune / SR;
    const thump = Math.tanh(1.8 * Math.sin(ph)) * att(t, 0.0006) * Math.exp(-t / 0.14) * (1 - smooth(0.5, 0.65, t));
    m[i] = thump + 2.2 * crack[i] * att(t, 0.0002) * Math.exp(-t / 0.022) + 0.8 * body[i] * att(t, 0.0005) * Math.exp(-t / 0.05);
  }
  let pk = 0; for (let i = 0; i < idx(0.08); i++) pk = Math.max(pk, Math.abs(m[i]));
  const q = 6 / pk; let hL = 0, hR = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR; let gl = 0, gr = 0;
    if (t < 0.095) { // ~80 ms of sample-rate reduction + bit-crush, slightly different per side
      if (i % 7 === 0) hL = m[i]; if (i % 11 === 0) hR = m[Math.max(0, i - 96)];
      const w = 1 - smooth(0.05, 0.09, t); gl = Math.round(hL * q) / q * w; gr = Math.round(hR * q) / q * w;
    }
    out.L[i] = Math.tanh(1.3 * (m[i] + 0.9 * gl)); out.R[i] = Math.tanh(1.3 * (m[i] + 0.9 * gr));
  }
  return normalize(out);
};
S.impact = (r) => {
  const n = idx(2.6), out = stereo(n);
  const thL = filtChain(noiseArr(r, n), [['lp', 320, 0.7]]), thR = filtChain(noiseArr(r, n), [['lp', 320, 0.7]]), sn = filtChain(noiseArr(r, n), [['bp', 1700, 0.7]]);
  const PART = [98, 207, 368, 589, 911, 1377], phL = PART.map(() => r() * TAU), phR = PART.map(() => r() * TAU); let pb = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR; pb += TAU * (36 + 38 * Math.exp(-t / 0.1)) / SR;
    const boom = 0.5 * Math.sin(pb) * att(t, 0.002) * Math.exp(-t / 0.6);
    let mL = 0, mR = 0; for (let k = 0; k < PART.length; k++) { const e = Math.exp(-t / (0.25 + 0.6 / (k + 1))); mL += Math.sin(TAU * PART[k] * t + phL[k]) * e; mR += Math.sin(TAU * PART[k] * 1.004 * t + phR[k]) * e; }
    const th = 2.6 * att(t, 0.001) * Math.exp(-t / 0.08), s = 0.9 * sn[i] * att(t, 0.0002) * Math.exp(-t / 0.012), me = 0.07 * att(t, 0.004), fade = 1 - smooth(2.2, 2.6, t);
    out.L[i] = (boom + thL[i] * th + s + mL * me) * fade; out.R[i] = (boom + thR[i] * th + s + mR * me) * fade;
  }
  return normalize(out);
};
S.pop = (r, { f0 = 480 } = {}) => {
  const n = idx(0.11), x = new Float32Array(n); let p = 0;
  for (let i = 0; i < n; i++) { const t = i / SR; p += TAU * f0 * (1 + 1.1 * (1 - Math.exp(-t / 0.011))) / SR; x[i] = (Math.sin(p) + 0.12 * Math.sin(2 * p)) * att(t, 0.0015) * Math.exp(-t / 0.026) * (1 - smooth(0.08, 0.11, t)); }
  return normalize(mono(x));
};
S.whoosh = (r, { dir = 1, len = 0.36, peak = 0.22, lo = 350, hi = 3200 } = {}) => {
  const n = idx(len), out = stereo(n), s1 = new Svf(), s2 = new Svf();
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const e = t < peak ? Math.pow(t / peak, 2.4) : Math.exp(-(t - peak) / 0.05) * (1 - smooth(len - 0.03, len, t));
    const sw = t < peak ? Math.pow(t / peak, 1.3) : 1 - 0.45 * Math.min(1, (t - peak) / (len - peak));
    const fc = lo * Math.pow(hi / lo, sw), nz = bi(r);
    s1.tick(nz, gOf(fc), 0.9); s2.tick(nz, gOf(Math.min(14000, fc * 3.5)), 1.4);
    const y = (s1.bp * 0.9 + s2.hp * 0.25) * e, pan = dir * (-0.85 + 1.7 * (t / len));
    out.L[i] = y * Math.min(1, 1 - pan); out.R[i] = y * Math.min(1, 1 + pan);
  }
  return Object.assign(normalize(out), { anchor: idx(peak) });
};
S.scan = (r, { dur = 0.4 } = {}) => {
  const n = idx(dur), out = stereo(n), sv = new Svf(), sz = new Svf(); let pa = 0, pb = 0, pz = 0, hold = 0;
  const x0 = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR, f = 380 * Math.pow(2600 / 380, (t / dur) ** 1.15), da = f / SR, dbb = f * 1.5 * 1.004 / SR, dz = 118 / SR;
    pa += da; if (pa >= 1) pa -= 1; pb += dbb; if (pb >= 1) pb -= 1; pz += dz; if (pz >= 1) pz -= 1;
    let y = (sqr(pa, da) * 0.6 + saw(pb, dbb) * 0.3) * (0.55 + 0.45 * Math.tanh(4 * Math.sin(TAU * 34 * t)));
    sv.tick(y, gOf(f * 2.2), 0.8); sz.tick(saw(pz, dz) * 0.22, gOf(1400), 1);
    if (i % 3 === 0) hold = sv.lp + sz.lp; // light sample-rate reduction for a digital edge
    x0[i] = Math.round(hold * 24) / 24 * att(t, 0.012) * (1 - smooth(dur - 0.03, dur, t));
  }
  const H = idx(0.0006); for (let i = 0; i < n; i++) { out.L[i] = x0[i]; out.R[i] = i >= H ? x0[i - H] : 0; }
  return normalize(out);
};
S.ding = (r) => {
  const n = idx(0.9), x = new Float32Array(n), f = mtof(84);
  for (let i = 0; i < n; i++) { const t = i / SR; x[i] = (Math.sin(TAU * f * t) * Math.exp(-t / 0.32) + 0.45 * Math.sin(TAU * f * 2.003 * t) * Math.exp(-t / 0.14)) * att(t, 0.0015) * (1 - smooth(0.75, 0.9, t)); }
  return normalize(mono(x));
};
S.thwip = (r) => {
  const n = idx(0.2), x = new Float32Array(n), sv = new Svf(), snap = filtChain(noiseArr(r, n), [['bp', 3400, 1.5]]); let p = 0, pw = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const f = t < 0.042 ? 240 * Math.pow(1750 / 240, Math.pow(t / 0.042, 0.85)) : 1750 * Math.pow(210 / 1750, Math.min(1, (t - 0.042) / 0.072) ** 0.8);
    p += TAU * f / SR;
    const tone = Math.sin(p) + 0.38 * Math.sin(2 * p + 0.3) + 0.12 * Math.sin(3 * p), e = att(t, 0.003) * (1 - smooth(0.098, 0.118, t));
    sv.tick(tone * e, gOf(f * 2.4), 0.45); // resonant low-pass tracking the pitch: rubbery
    let y = 0.75 * sv.lp + 0.25 * tone * e;
    const u = t - 0.116;
    if (u >= 0) { // wet snap: rising droplet "plip" + a tight noise crack
      pw += TAU * (700 + 1100 * (1 - Math.exp(-u / 0.004))) / SR;
      y += 0.7 * Math.sin(pw) * Math.exp(-u / 0.011) * att(u, 0.0004) + 0.9 * snap[i] * Math.exp(-u / 0.0022) * att(u, 0.0002);
    }
    x[i] = y;
  }
  return normalize(mono(x));
};
S.stamp = (r) => {
  const n = idx(0.4), x = new Float32Array(n), knock = filtChain(noiseArr(r, n), [['bp', 240, 2.2]]), slap = filtChain(noiseArr(r, n), [['bp', 2300, 0.7], ['hp', 900, 0.7]]); let p = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR; p += TAU * (58 + 80 * Math.exp(-t / 0.016)) / SR;
    const thud = Math.tanh(1.6 * Math.sin(p)) * att(t, 0.0008) * Math.exp(-t / 0.075);
    const k = knock[i] * att(t, 0.0006) * Math.exp(-t / 0.035) * 5;
    const s = slap[i] * (att(t, 0.0003) * Math.exp(-t / 0.014) + 0.6 * (t > 0.007 ? Math.exp(-(t - 0.007) / 0.01) : 0));
    x[i] = (thud + k + 2.2 * s) * (1 - smooth(0.32, 0.4, t));
  }
  return normalize(mono(x));
};
S.ticker = (r, { dur = 0.6 } = {}) => {
  const n = idx(dur + 0.03), out = stereo(n), times = [];
  for (let t = 0; t < dur - 0.005; t += 0.024 + 0.05 * Math.pow(t / dur, 2.5)) times.push(t);
  const click = filtChain(noiseArr(r, idx(0.004)), [['hp', 3000, 0.7]]);
  times.forEach((t0, j) => {
    const s = idx(t0), f = 2600 + 900 * (j / times.length), pan = j % 2 ? 0.18 : -0.18, v = 0.75 + 0.25 * r();
    for (let i = 0; i < idx(0.012) && s + i < n; i++) {
      const u = i / SR, y = v * (Math.sin(TAU * f * u) * Math.exp(-u / 0.0022) + 0.6 * (click[i] || 0) * Math.exp(-u / 0.0007));
      out.L[s + i] += y * Math.min(1, 1 - pan); out.R[s + i] += y * Math.min(1, 1 + pan);
    }
  });
  return normalize(out);
};
S.click = (r) => {
  const n = idx(0.09), x = new Float32Array(n), nz = filtChain(noiseArr(r, n), [['hp', 2200, 0.7]]);
  const hit = (t0, amp, fr) => { for (let i = idx(t0); i < n; i++) { const u = i / SR - t0; if (u > 0.025) break; x[i] += amp * (nz[i] * Math.exp(-u / 0.0009) + 0.55 * Math.sin(TAU * fr * u) * Math.exp(-u / 0.0035) + 0.3 * Math.sin(TAU * 950 * u) * Math.exp(-u / 0.005)); } };
  hit(0, 1, 2900); hit(0.048, 0.45, 3500);
  return normalize(mono(x));
};
function keyStroke(out, s, r, { body = 1700, thock = 340, thockDec = 0.009, vel = 1, pan = 0, heavy = false } = {}) {
  const len = idx(heavy ? 0.09 : 0.05), sv = new Svf(), k = heavy ? 0.5 : 0.33, gl = Math.min(1, 1 - pan), gr = Math.min(1, 1 + pan);
  for (let i = 0; i < len && s + i < out.L.length; i++) {
    const u = i / SR, nz = bi(r);
    sv.tick(nz, gOf(body), k);
    let y = 0.5 * sv.hp * Math.exp(-u / 0.0011) + 1.3 * k * sv.bp * Math.exp(-u / (heavy ? 0.02 : 0.012)) + 0.5 * Math.sin(TAU * thock * u) * Math.exp(-u / thockDec);
    if (heavy && u > 0.007) y += 0.5 * nz * Math.exp(-(u - 0.007) / 0.0015);
    y *= vel * att(u, 0.0002);
    out.L[s + i] += y * gl; out.R[s + i] += y * gr;
  }
}
S.type = (r, { dur = 1 } = {}) => {
  const n = idx(dur + 0.15), out = stereo(n), keys = Math.round(13 * dur), step = dur / keys; // ~13 keys/s
  for (let k = 0; k < keys; k++) {
    const t = Math.max(0, k * step + (k ? bi(r) * 0.3 * step : 0));
    const body = 1500 + 900 * r(), vel = 0.65 + 0.35 * r(), pan = bi(r) * 0.15;
    keyStroke(out, idx(t), r, { body, thock: 300 + 140 * r(), vel, pan });
    keyStroke(out, idx(t + 0.045 + 0.03 * r()), r, { body: body * 1.2, thock: 500, thockDec: 0.003, vel: vel * 0.35, pan });
  }
  out.keys = keys;
  return normalize(out);
};
S.enter = (r) => {
  const out = stereo(idx(0.3));
  keyStroke(out, 0, r, { body: 950, thock: 185, thockDec: 0.02, vel: 1, heavy: true });
  keyStroke(out, idx(0.11), r, { body: 1200, thock: 420, thockDec: 0.004, vel: 0.35 });
  return normalize(out);
};
S.success = (r) => {
  const n = idx(0.9), out = stereo(n);
  for (const [m, t0, pan, dec] of [[80, 0, -0.2, 0.12], [84, 0.07, 0, 0.12], [87, 0.14, 0.2, 0.38]]) {
    const f = mtof(m), s = idx(t0);
    for (let i = s; i < n; i++) {
      const u = (i - s) / SR, e = att(u, 0.002) * Math.exp(-u / dec) * (1 - smooth(0.7 - t0, 0.75 - t0, u));
      const y = e * (Math.sin(TAU * f * u + 0.7 * Math.exp(-u / 0.02) * Math.sin(TAU * 2 * f * u)) + 0.3 * Math.sin(TAU * 2 * f * u) + 0.08 * Math.sin(TAU * 3 * f * u));
      out.L[i] += y * Math.min(1, 1 - pan); out.R[i] += y * Math.min(1, 1 + pan);
    }
  }
  return normalize(out);
};
S.lock = (r) => {
  const n = idx(0.32), x = new Float32Array(n), hp = filtChain(noiseArr(r, n), [['hp', 3000, 0.7]]), mid = filtChain(noiseArr(r, n), [['bp', 650, 1.4]]);
  const M1 = [2350, 3720, 5140], A1 = [0.35, 0.25, 0.18], M2 = [1810, 2930]; let pth = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR; let y = 0.8 * hp[i] * Math.exp(-t / 0.0018) * att(t, 0.0002);
    for (let k = 0; k < 3; k++) y += A1[k] * Math.sin(TAU * M1[k] * t) * Math.exp(-t / 0.028);
    const u = t - 0.06;
    if (u >= 0) {
      pth += TAU * (95 + 60 * Math.exp(-u / 0.012)) / SR;
      y += Math.sin(pth) * Math.exp(-u / 0.045) * att(u, 0.0006) + 2.4 * mid[i] * Math.exp(-u / 0.03) * att(u, 0.0004) + 0.6 * hp[i] * Math.exp(-u / 0.0012);
      for (let k = 0; k < 2; k++) y += 0.15 * Math.sin(TAU * M2[k] * u) * Math.exp(-u / 0.05);
    }
    x[i] = y * (1 - smooth(0.26, 0.32, t));
  }
  return normalize(mono(x));
};
S.glitch = (r, { dur = 0.15 } = {}) => {
  const n = idx(dur), out = stereo(n); let t = 0;
  while (t < dur) {
    const len = 0.007 + 0.016 * r(), type = Math.floor(r() * 5), pan = bi(r) * 0.7, amp = 0.55 + 0.45 * r();
    const s = idx(t), e = Math.min(n, idx(t + len)), f = 150 * Math.pow(20, r()), rate = 1 + Math.floor(r() * 12); let p = 0, hold = 0;
    for (let i = s; i < e; i++) {
      const u = (i - s) / SR; let y = 0;
      if (type === 0) { p = (p + f / SR) % 1; y = p < 0.5 ? 1 : -1; }
      else if (type === 1) { if ((i - s) % rate === 0) hold = bi(r); y = hold; }
      else if (type === 2) { p += f * (1 + 6 * u / len) / SR; y = Math.sin(TAU * p); }
      else if (type === 4) { p = (p + 90 / SR) % 1; y = (p < 0.3 ? 1 : -1) * 0.8 + 0.2 * bi(r); }
      y = Math.round(y * 6) / 6 * amp * Math.min(1, (i - s) / 24, (e - i) / 24);
      out.L[i] += y * Math.min(1, 1 - pan); out.R[i] += y * Math.min(1, 1 + pan);
    }
    t += len;
  }
  filtStereo(out, [['lp', 12000, 0.7]]);
  return normalize(out);
};
// THE SONIC LOGO. Glottal-style buzz (band-limited harmonic series, ~95-130 Hz, fast rise-then-fall pitch)
// with vocal-fry pulsing, through vocal-tract formants (F1 ~400-700 Hz, F2 ~0.9-1.25 kHz, F3 2.5 kHz),
// shaped into two throaty syllables "cro" + "ak" with a soft k-plosive at either end.
S.croak = (r) => {
  const n = idx(0.62), x = new Float32Array(n);
  const E1 = 0.13, T2 = 0.165, E2 = 0.41;
  const f0At = (t) => t < T2 - 0.012
    ? 94 + 30 * (1 - Math.exp(-t / 0.014)) - 16 * smooth(0.035, E1, t)
    : 98 + 34 * (1 - Math.exp(-(t - T2 + 0.012) / 0.018)) - 56 * smooth(0.05, E2 - T2 + 0.02, t - T2 + 0.012);
  const envAt = (t) => {
    let e = 0;
    if (t < E1 + 0.03) e = att(t, 0.005) * (1 - 0.25 * smooth(0.03, E1, t)) * (1 - smooth(E1 - 0.02, E1 + 0.012, t));
    const u = t - (T2 - 0.004);
    if (u >= 0) e = Math.max(e, att(u, 0.006) * (1 + 0.15 * smooth(0, 0.06, u) - 0.35 * smooth(0.08, E2 - T2, u)) * (1 - smooth(E2 - 0.035, E2, t)));
    return e;
  };
  const F1At = (t) => t < T2 - 0.01 ? 380 + 90 * smooth(0, 0.06, t) : 600 + 120 * smooth(0, 0.05, t - T2) - 260 * smooth(0.12, E2 - T2, t - T2);
  const F2At = (t) => t < T2 - 0.01 ? 900 + 100 * smooth(0, 0.08, t) : 1150 + 100 * smooth(0, 0.05, t - T2) - 200 * smooth(0.12, E2 - T2, t - T2);
  const KMAX = 64, W = new Float64Array(KMAX + 1); for (let k = 1; k <= KMAX; k++) W[k] = Math.pow(k, -0.8);
  const f1 = new Svf(), f2 = new Svf(), f3 = new Svf(), lo = new Svf();
  const plos = filtChain(noiseArr(r, n), [['bp', 2000, 1.5]]);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR, f0 = f0At(t) * (1 + 0.006 * bi(r));
    ph += TAU * f0 / SR;
    // harmonic sum via Chebyshev recursion: sin(k*ph)
    const s1 = Math.sin(ph), c2 = 2 * Math.cos(ph); let sPrev = 0, sCur = s1, src = 0; const K = Math.min(KMAX, Math.floor(6500 / f0));
    for (let k = 1; k <= K; k++) { src += W[k] * sCur; const nx = c2 * sCur - sPrev; sPrev = sCur; sCur = nx; }
    const fry = 0.5 + 0.5 * Math.cos(TAU * 31 * t), am = 0.62 + 0.38 * fry; // ~31 Hz throaty pulsing
    const sub = 1 - 0.3 * (0.5 + 0.5 * Math.cos(ph / 2)); // period-doubling roughness
    const e = envAt(t), s = src * am * sub * e + 0.04 * bi(r) * e;
    f1.tick(s, gOf(F1At(t)), 0.2); f2.tick(s, gOf(F2At(t)), 1 / 7); f3.tick(s, gOf(2500), 1 / 9); lo.tick(s, gOf(260), 1);
    let y = 1.0 * 0.2 * f1.bp + 0.8 * f2.bp / 7 + 0.28 * f3.bp / 9 + 0.08 * lo.lp + 0.04 * s;
    const pk = t < 0.012 ? Math.exp(-t / 0.004) * 0.35 : 0, pe = t > E2 - 0.004 && t < E2 + 0.02 ? 0.25 * Math.exp(-(t - E2 + 0.004) / 0.004) : 0; // "c" .. "k"
    y += plos[i] * (pk + pe);
    x[i] = y;
  }
  filtChain(x, [['hp', 110, 0.7], ['peak', 2500, 1.2, 2.5]]);
  normalize(mono(x));
  for (let i = 0; i < n; i++) x[i] = Math.tanh(2.6 * x[i]) / Math.tanh(2.6) * (1 - smooth(0.52, 0.62, i / SR)); // dense, punchy
  return normalize(mono(x));
};

const SFX_LEVEL = { ping: -12, slam: -11, impact: -7, pop: -12, whoosh: -10, scan: -14, ding: -13, thwip: -11, stamp: -6, ticker: -8, click: -7, type: -7, enter: -8, success: -13, lock: -8, glitch: -11, croak: -7 };
const SFX_REV = { ping: 0.08, slam: 0.12, impact: 0.35, pop: 0.05, whoosh: 0.1, scan: 0.05, ding: 0.18, thwip: 0.06, stamp: 0.1, ticker: 0.03, click: 0.03, type: 0.02, enter: 0.05, success: 0.16, lock: 0.06, glitch: 0.05, croak: 0.17 };
const sfx = stereo(), sfxSend = stereo(), sfxLog = [];
{
  const r = rng('sfx'), counts = {};
  const storm = TL.sfx.filter((e) => e.type === 'ping' && e.t >= INTRO.start + BAR - 1e-9);
  for (const ev of TL.sfx) {
    const gen = S[ev.type]; if (!gen) throw new Error(`no generator for sfx type "${ev.type}"`);
    const k = counts[ev.type] = (counts[ev.type] || 0) + 1;
    const er = rng(`sfx:${ev.type}:${ev.t}`);
    let src, gain = SFX_LEVEL[ev.type], pan = 0;
    const dur = ev.end != null ? ev.end - ev.t : undefined;
    switch (ev.type) {
      case 'ping': {
        const si = storm.indexOf(ev);
        if (si < 0) src = gen(er);
        else {
          const x = si / Math.max(1, storm.length - 1), tr = [-4, -2, 0, 0, 3][Math.floor(r() * 5)];
          src = gen(er, { n1: 84 + tr, n2: 89 + tr, det: bi(r) * 0.12 });
          gain += -3 - 7 * x; pan = bi(r) * (0.2 + 0.65 * x);
        }
        break;
      }
      case 'slam': src = gen(er, { tune: 1 + bi(r) * 0.04 }); break;
      case 'pop': src = gen(er, { f0: 430 + 220 * r() }); pan = bi(r) * 0.2; break;
      case 'whoosh': src = gen(er, { dir: k % 2 ? 1 : -1, lo: 300 + 120 * r(), hi: 2800 + 900 * r() }); break;
      case 'scan': case 'ticker': case 'type': src = gen(er, { dur }); break;
      case 'click': src = gen(er); pan = bi(r) * 0.15; break;
      default: src = gen(er);
    }
    const start = idx(ev.t) - (src.anchor || 0), cut = cutAfter(ev.t, SFX_CUTS);
    addTo(sfx, src, start, db(gain), pan, cut);
    addTo(sfxSend, src, start, db(gain) * SFX_REV[ev.type], pan, cut);
    sfxLog.push(`${ev.t.toFixed(4).padStart(8)}  ${ev.type}${src.keys ? ` (${src.keys} keys, ${(src.keys / dur).toFixed(1)}/s)` : ''}`);
  }
}
filtStereo(sfxSend, [['hp', 300, 0.7], ['lp', 9000, 0.7]]);
{
  const ret = freeverb(sfxSend, stereo(), { room: 0.68, damp: 0.42, pre: 0.01, kills: SFX_CUTS });
  for (let i = 0; i < N; i++) { sfx.L[i] += ret.L[i] * 2.2; sfx.R[i] += ret.R[i] * 2.2; }
}
filtStereo(sfx, [['hp', 28, 0.7]]);
gatesAndFade(sfx);

// ═════════════════════════════ master ═════════════════════════════
const TARGET_LUFS = -16, CEIL_DBTP = -2.0; // spec: <= -1.5 dBTP; 0.5 dB margin for meter differences
const pre = stereo();
for (let i = 0; i < N; i++) { pre.L[i] = music.L[i] + sfx.L[i]; pre.R[i] = music.R[i] + sfx.R[i]; }
// Limit on the worst of score / music / sfx so every delivered file respects the ceiling.
const tpPre = truePeakEnv(pre);
for (const s of [music, sfx]) { const t = truePeakEnv(s); for (let i = 0; i < N; i++) if (t[i] > tpPre[i]) tpPre[i] = t[i]; }
let makeup = db(TARGET_LUFS - lufs(pre)), G = null, measured = 0;
const out = stereo();
for (let it = 0; it < 4; it++) {
  const ceil = db(CEIL_DBTP) / makeup;
  G = limiterGain(tpPre, ceil);
  for (let i = 0; i < N; i++) { const g = makeup * G[i]; out.L[i] = pre.L[i] * g; out.R[i] = pre.R[i] * g; }
  measured = lufs(out);
  if (Math.abs(measured - TARGET_LUFS) < 0.02) break;
  makeup *= db(TARGET_LUFS - measured);
}
let minG = 1, limited = 0; for (let i = 0; i < N; i++) { if (G[i] < minG) minG = G[i]; if (G[i] < 0.999) limited++; }
const musicOut = stereo(), sfxOut = stereo();
for (let i = 0; i < N; i++) {
  const g = makeup * G[i];
  musicOut.L[i] = music.L[i] * g; musicOut.R[i] = music.R[i] * g; sfxOut.L[i] = sfx.L[i] * g; sfxOut.R[i] = sfx.R[i] * g;
  out.L[i] = musicOut.L[i] + sfxOut.L[i]; out.R[i] = musicOut.R[i] + sfxOut.R[i];
}

// ═════════════════════════════ WAV writer (PCM 24-bit) ═════════════════════════════
function writeWav24(file, s) {
  const n = s.L.length, bytes = n * 6, buf = Buffer.alloc(44 + bytes);
  buf.write('RIFF', 0, 'ascii'); buf.writeUInt32LE(36 + bytes, 4); buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii'); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 6, 28); buf.writeUInt16LE(6, 32); buf.writeUInt16LE(24, 34);
  buf.write('data', 36, 'ascii'); buf.writeUInt32LE(bytes, 40);
  let o = 44, clips = 0;
  for (let i = 0; i < n; i++) for (const ch of [s.L, s.R]) {
    let v = Math.round(ch[i] * 8388607);
    if (v > 8388607) { v = 8388607; clips++; } else if (v < -8388608) { v = -8388608; clips++; }
    if (v < 0) v += 0x1000000;
    buf[o++] = v & 0xff; buf[o++] = (v >> 8) & 0xff; buf[o++] = (v >> 16) & 0xff;
  }
  fs.writeFileSync(file, buf);
  return clips;
}
for (const [name, s] of [['music', musicOut], ['sfx', sfxOut], ['score', out]])
  for (const ch of [s.L, s.R]) for (let i = 0; i < N; i++) if (!Number.isFinite(ch[i])) throw new Error(`non-finite sample in ${name} at ${i}`);
fs.mkdirSync(OUT_DIR, { recursive: true });
const clips = {};
for (const [name, s] of [['music', musicOut], ['sfx', sfxOut], ['score', out]]) clips[name] = writeWav24(path.join(OUT_DIR, `${name}.wav`), s);

// ═════════════════════════════ report ═════════════════════════════
const peakDb = (s) => { let p = 0; for (let i = 0; i < N; i++) p = Math.max(p, Math.abs(s.L[i]), Math.abs(s.R[i])); return toDb(p); };
const tpDb = (s) => { const t = truePeakEnv(s); let p = 0; for (let i = 0; i < N; i++) if (t[i] > p) p = t[i]; return toDb(p); };
log('\n── timeline ──');
log(`bpm ${TL.bpm}, ${N} frames @ ${SR} Hz; roll1 ${ROLL1}, roll2 ${ROLL2}, stutter ${STUTTER}, stabs ${STABS}, ticks from ${TICK_FROM}, stop ${STOP}, fade ${FADE_START.toFixed(2)}->${FADE_END}`);
log('\n── stems (pre-master, calibrated) ──'); stemReport.forEach((l) => log('  ' + l));
log(`  glue comp max GR ${glue.maxGr.toFixed(1)} dB`);
log('\n── sfx events ──'); sfxLog.forEach((l) => log('  ' + l));
log('\n── master ──');
log(`  makeup ${toDb(makeup).toFixed(2)} dB, limiter max GR ${(-toDb(minG)).toFixed(2)} dB on ${(100 * limited / N).toFixed(2)}% of samples`);
for (const [name, s] of [['music', musicOut], ['sfx', sfxOut], ['score', out]])
  log(`  ${name.padEnd(6)} ${lufs(s).toFixed(2)} LUFS  sample peak ${peakDb(s).toFixed(2)} dBFS  true peak ~${tpDb(s).toFixed(2)} dBTP  clipped samples ${clips[name]}`);
log('  short-term loudness by section (score):');
for (const m of TL.music) if (m.end - m.start >= 0.5) log(`    ${m.part.padEnd(10)} ${m.start.toFixed(2).padStart(6)}-${m.end.toFixed(2).padEnd(6)} score ${lufs(out, m.start, m.end).toFixed(1)}  music ${lufs(musicOut, m.start, m.end).toFixed(1)}  sfx ${lufs(sfxOut, m.start, m.end).toFixed(1)} LUFS`);
if (process.env.SYNTH_DEBUG) {
  const row = []; for (let t = 0; t + 0.4 <= TL.duration; t += 0.5) row.push(`${t.toFixed(1)}:${lufs(out, t, t + 0.4).toFixed(1)}`);
  const gr = []; for (let t = 0; t + 0.5 <= TL.duration; t += 0.5) { let m = 1; for (let i = idx(t); i < idx(t + 0.5); i++) m = Math.min(m, G[i]); if (m < 0.98) gr.push(`${t.toFixed(1)}:${(-toDb(m)).toFixed(1)}`); }
  log('  limiter GR (dB) per 0.5 s where > 0.2 dB: ' + gr.join(' '));
  log('  momentary (400 ms) score loudness: ' + row.join(' '));
  const tl = []; for (let t = 33.0; t + 0.4 <= TL.duration; t += 0.25) tl.push(`${t.toFixed(2)}: m ${lufs(musicOut, t, t + 0.4).toFixed(1)} s ${lufs(sfxOut, t, t + 0.4).toFixed(1)}`);
  log('  ending music/sfx momentary: ' + tl.join(' | '));
}
log(`\n[synth] done in ${((Date.now() - T_START) / 1000).toFixed(1)} s -> ${path.relative(process.cwd(), OUT_DIR)}/{music,sfx,score}.wav`);
