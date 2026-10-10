// Voiceover for the showreel, made with Fish Audio.
//
//   node vo/fish.mjs samples            -> public/vo/samples/<voice>.mp3 (one tagline per candidate voice)
//   node vo/fish.mjs build [voiceId]    -> public/vo/lines/NN.wav, public/vo/vo.wav, vo/report.json
//
// Every line from timeline.json is generated on its own, transcribed back with word timings so the
// leading silence can be cut, then placed so the first word lands exactly on its cue.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(
  readFileSync(path.join(ROOT, '.env'), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const KEY = env.FISH_AUDIO_API_KEY;
if (!KEY) throw new Error('Put FISH_AUDIO_API_KEY in demo/showreel/.env');

const timeline = JSON.parse(readFileSync(path.join(ROOT, 'timeline.json'), 'utf8'));

// generic library voices (no celebrity or character clones)
const VOICES = {
  'tech-male': '7d4e8a6444a442eb819c69981fdb8315',
  'conversational-narrator': '542fc7aab61e4561bae5ebd536d717c0',
  'movie-trailer': '72bab2b1967544c09b4da4de6d51673b',
  'ad-announcer': 'db9c58be76954861a561c83dcfd2bf74',
};
const DEFAULT_VOICE = VOICES['conversational-narrator'];

// how each line should be read
const DIRECTION = {
  'It starts with one link.': 'quiet, low, ominous',
  "Then it's everywhere.": 'ominous, building tension',
  'Fake Nitro.': 'punchy, intense',
  'Phishing.': 'punchy, intense',
  'NSFW.': 'punchy, intense',
  'Hacked accounts.': 'punchy, intense, rising',
  'Meet Croak.': 'confident, warm, with a smile',
  'AI moderation for Discord.': 'confident, clear',
  'Links.': 'crisp, quick',
  'Invites.': 'crisp, quick',
  'Images.': 'crisp, quick',
  'Croaked in point two seconds.': 'confident, satisfied',
  'QR scams.': 'snappy, energetic',
  'Look-alikes.': 'snappy, energetic',
  'Scam images.': 'snappy, energetic',
  'Spam blasts.': 'snappy, energetic',
  'Raids.': 'snappy, energetic',
  'All handled.': 'confident, relaxed',
  'And your mods always get the last word.': 'warm, reassuring',
  'Cases.': 'crisp',
  'Appeals.': 'crisp',
  'Lockdowns.': 'crisp, firm',
  'Set it up in one command.': 'friendly, confident',
  'Free during early access.': 'friendly, upbeat',
  'Croak.': 'proud, confident',
  'Spam croaks here.': 'playful, confident, with a smile',
};

async function tts(text, voice, opts = {}) {
  const key = createHash('sha1').update(JSON.stringify([text, voice, opts.speed || 1, opts.format || 'wav', opts.take || 0])).digest('hex').slice(0, 16);
  const cached = path.join(ROOT, 'public/vo/cache', `${key}.${opts.format || 'wav'}`);
  if (existsSync(cached)) return readFileSync(cached);
  const buf = await ttsLive(text, voice, opts);
  mkdirSync(path.dirname(cached), { recursive: true });
  writeFileSync(cached, buf);
  return buf;
}

async function ttsLive(text, voice, { speed = 1, format = 'wav' } = {}) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch('https://api.fish.audio/v1/tts', {
      method: 'POST',
      headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', model: 's2.1-pro-free' },
      body: JSON.stringify({
        text,
        reference_id: voice,
        format,
        sample_rate: 44100,
        latency: 'normal',
        normalize: true,
        temperature: 0.6,
        top_p: 0.7,
        prosody: { speed, volume: 0, normalize_loudness: true },
      }),
    });
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    const body = await res.text();
    if (res.status === 429 || res.status >= 500) {
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      continue;
    }
    throw new Error(`TTS ${res.status}: ${body.slice(0, 300)}`);
  }
  throw new Error('TTS kept failing');
}

// Transcribe locally with whisper.cpp (word timings). Fish's ASR needs paid API credit.
const WHISPER_MODEL = path.join(process.env.HOME, '.cache/hyperframes/whisper/models/ggml-small.en.bin');
async function asr(file) {
  const tmp = file.replace(/\.(wav|mp3)$/, '.16k.wav');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', file, '-ar', '16000', '-ac', '1', tmp]);
  execFileSync('whisper-cli', ['-m', WHISPER_MODEL, '-f', tmp, '-ml', '1', '-sow', '-oj', '-of', tmp.replace(/\.wav$/, ''), '-np', '-l', 'en'], { stdio: 'ignore' });
  const j = JSON.parse(readFileSync(tmp.replace(/\.wav$/, '.json'), 'utf8'));
  const segments = j.transcription
    .map((x) => ({ text: x.text.trim(), start: x.offsets.from / 1000, end: x.offsets.to / 1000 }))
    .filter((x) => x.text && !/^\[.*\]$/.test(x.text));
  return { text: segments.map((x) => x.text).join(' ').replace(/\s+([.,!?])/g, '$1'), segments };
}

// whisper's word edges are approximate, so take the start and end of speech from the waveform
function speechBounds(file) {
  const { stderr } = spawnSync('ffmpeg', ['-i', file, '-af', 'silencedetect=noise=-40dB:d=0.1', '-f', 'null', '-'], { encoding: 'utf8' });
  const total = probe(file);
  const starts = [...stderr.matchAll(/silence_start: ([\d.]+)/g)].map((m) => Number(m[1]));
  const ends = [...stderr.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]));
  const begin = starts.length && starts[0] < 0.01 && ends.length ? ends[0] : 0;
  const lastStart = starts.length ? starts[starts.length - 1] : total;
  const finish = lastStart > begin && (ends.length < starts.length || ends[ends.length - 1] >= total - 0.02) ? lastStart : total;
  return { start: begin, end: finish };
}

const probe = (f) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString().trim());
const words = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);

async function samples() {
  const dir = path.join(ROOT, 'public/vo/samples');
  mkdirSync(dir, { recursive: true });
  const line = '[confident, warm] Meet Croak. [punchy] Every link. Every invite. Every image. [playful, with a smile] Spam croaks here.';
  for (const [name, id] of Object.entries(VOICES)) {
    const out = path.join(dir, `${name}.mp3`);
    writeFileSync(out, await tts(line, id, { format: 'mp3' }));
    const r = await asr(out);
    console.log(name.padEnd(26), probe(out).toFixed(2) + 's', '|', r.text);
  }
}

async function build(voice = DEFAULT_VOICE) {
  const dir = path.join(ROOT, 'public/vo/lines');
  mkdirSync(dir, { recursive: true });
  const lines = timeline.vo;
  const report = [];
  for (let i = 0; i < lines.length; i++) {
    const { t, line } = lines[i];
    const next = i + 1 < lines.length ? lines[i + 1].t : timeline.duration;
    const room = next - t - 0.06;
    const raw = path.join(dir, `${String(i).padStart(2, '0')}.raw.wav`);
    let speed = 1;
    let r;
    for (let tries = 0; tries < 4; tries++) {
      writeFileSync(raw, await tts(`[${DIRECTION[line] || 'confident'}] ${line}`, voice, { speed, take: tries }));
      r = await asr(raw);
      const { start, end } = speechBounds(raw);
      const heard = words(r.text).join(' ');
      const want = words(line).join(' ');
      const spoken = end - start;
      const ok = spoken <= room + 0.02;
      const match = heard.replace(/0 2|point two|02/g, 'point two') === want || heard.includes(want.split(' ')[0]);
      Object.assign(r, { start, end, spoken, heard, want, match });
      if (ok && match) break;
      // too long for its slot: read it faster; wrong words: just try again
      if (!ok) speed = Math.min(1.45, speed * Math.min(1.25, (spoken / room) * 1.04));
    }
    // cut to the first word (keep 25 ms of breath) and fade the tail
    const out = path.join(dir, `${String(i).padStart(2, '0')}.wav`);
    const from = Math.max(0, r.start - 0.025);
    const len = r.end - from + 0.12;
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', raw, '-ss', from.toFixed(3), '-t', len.toFixed(3), '-af', `afade=t=out:st=${(len - 0.08).toFixed(3)}:d=0.08,aresample=48000`, '-ac', '1', out]);
    report.push({ i, t, line, speed: Number(speed.toFixed(3)), spoken: Number(r.spoken.toFixed(3)), room: Number(room.toFixed(3)), fits: r.spoken <= room + 0.02, heard: r.text, onsetCut: Number(from.toFixed(3)) });
    console.log(String(i).padStart(2), t.toFixed(2).padStart(6), `${r.spoken.toFixed(2)}s/${room.toFixed(2)}s`, speed !== 1 ? `x${speed.toFixed(2)}` : '     ', r.match ? 'ok ' : '?? ', line, '->', r.text);
  }
  // place every line so its first word lands on its cue (minus the 25 ms breath)
  const inputs = [];
  const chains = [];
  report.forEach((x, k) => {
    inputs.push('-i', path.join(dir, `${String(x.i).padStart(2, '0')}.wav`));
    chains.push(`[${k}:a]adelay=${Math.max(0, Math.round((x.t - 0.025) * 1000))}:all=1[a${k}]`);
  });
  const mix = `${chains.join(';')};${report.map((_, k) => `[a${k}]`).join('')}amix=inputs=${report.length}:normalize=0:dropout_transition=0,apad,atrim=0:${timeline.duration},loudnorm=I=-18:TP=-2:LRA=7[out]`;
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', mix, '-map', '[out]', '-ar', '48000', '-ac', '1', path.join(ROOT, 'public/vo/vo.wav')]);
  writeFileSync(path.join(ROOT, 'vo/report.json'), JSON.stringify({ voice, report }, null, 2));
  console.log('wrote public/vo/vo.wav', probe(path.join(ROOT, 'public/vo/vo.wav')).toFixed(3) + 's');
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === 'samples') await samples();
else if (cmd === 'build') await build(VOICES[arg] || arg || DEFAULT_VOICE);
else console.log('usage: node vo/fish.mjs samples | build [voice]');
