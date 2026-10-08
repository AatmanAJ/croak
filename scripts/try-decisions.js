// Runs the Decisions API on everything in test-set/ and reports speed, tokens, cost, and whether
// each example would have been caught. Images are also sent to the free moderation endpoint.
//
//   npm run try               3 rounds per example
//   ROUNDS=5 npm run try      more rounds for steadier timings
//
// Links live in test-set/links.json. Images go in test-set/images/, named by label:
// scam-*.png, nsfw-*.jpg, spam-*.webp or ok-*.png.

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { ApiError, decide, imageInput, PRICE_PER_MILLION_INPUT_TOKENS } from '../src/ai/decisions.js';
import { moderateImage } from '../src/ai/moderation.js';
import { describeMessage, MODERATION_QUESTIONS, QUESTION_NAMES } from '../src/ai/questions.js';
import { toDataUrl } from '../src/images.js';

// Same thresholds as the planned bot: delete at 0.9 or above, send to the mod queue at 0.6 or above.
const DELETE_AT = 0.9;
const QUEUE_AT = 0.6;
const ROUNDS = Number(process.env.ROUNDS ?? 3);
const IMAGE_DETAILS = ['low', 'auto'];
const LABELS = ['scam', 'nsfw', 'spam', 'ok'];
const IMAGE_FILE = /\.(png|jpe?g|webp|gif)$/i;

try {
  process.loadEnvFile();
} catch {
  // no .env file; fall through to the key check
}
if (!process.env.OPENAI_API_KEY) {
  fail('No OPENAI_API_KEY found. Paste your key into the .env file in this folder and run again.');
}

const links = JSON.parse(await readFile('test-set/links.json', 'utf8'));
const imageFiles = (await readdir('test-set/images')).filter((f) => IMAGE_FILE.test(f)).sort();

console.log(`Checking access to the Decisions API...`);
await warmUp();
console.log(`OK. Running ${links.length} links and ${imageFiles.length} images, ${ROUNDS} rounds each.\n`);

const results = { startedAt: new Date().toISOString(), rounds: ROUNDS, links: [], images: [] };

console.log(
  pad('LINKS AND INVITES', 22) + pad('label', 7) + probHeader() + pad('action', 8) + pad('ok?', 5) + pad('avg ms', 8) + 'tokens',
);
for (const example of links) {
  const run = await runDecisions(describeMessage(example));
  const row = { id: example.id, label: example.label, ...run, ...verdict(example.label, run.answers) };
  results.links.push(row);
  console.log(pad(example.id, 22) + pad(example.label, 7) + probCells(row.probs) + resultCells(row));
}

console.log(
  '\n' + pad('IMAGES', 26) + pad('label', 7) + pad('detail', 8) + probHeader() + pad('action', 8) + pad('ok?', 5) + pad('avg ms', 8) + 'tokens',
);
for (const file of imageFiles) {
  const label = LABELS.find((l) => file.startsWith(`${l}-`)) ?? '?';
  const prep = await timed(async () => toDataUrl(await readFile(`test-set/images/${file}`)));
  const dataUrl = prep.value;
  const text = 'A member posted this image in a Discord server.';

  const byDetail = {};
  for (const detail of IMAGE_DETAILS) {
    const run = await runDecisions(imageInput(text, dataUrl, detail));
    byDetail[detail] = { ...run, ...verdict(label, run.answers) };
    console.log(pad(file, 26) + pad(label, 7) + pad(detail, 8) + probCells(byDetail[detail].probs) + resultCells(byDetail[detail]));
  }

  const moderation = await runModeration(dataUrl);
  if (moderation.error) {
    console.log(`  free moderation check failed: ${moderation.error}`);
  } else {
    const s = moderation.scores;
    console.log(
      `  free moderation check: flagged=${moderation.flagged}, sexual ${fmt(s.sexual)}, ` +
        `violence ${fmt(s.violence)}, illicit ${fmt(s.illicit)}, avg ${Math.round(stats(moderation.ms).avg)} ms`,
    );
  }
  results.images.push({ file, label, prepMs: prep.ms, imageKb: Math.round((dataUrl.length * 3) / 4 / 1024), byDetail, moderation });
}

printSummary(results);
await mkdir('results', { recursive: true });
const outFile = `results/${results.startedAt.replace(/[:.]/g, '-')}.json`;
await writeFile(outFile, JSON.stringify(results, null, 2));
console.log(`\nFull results saved to ${outFile}`);

// ---------------------------------------------------------------------------

async function warmUp() {
  // Also opens the HTTPS connection, so the first timed call isn't slowed by the TLS handshake.
  try {
    await decide({ input: 'Hello everyone!', questions: [MODERATION_QUESTIONS[0]] });
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    if (err.status === 401) fail('OpenAI rejected the key (401). Check it was pasted into .env correctly.');
    if (err.status === 403) fail(`No access to the Decisions API on this account (403).\n${err.message}`);
    if (err.status === 429) fail(`Out of credit or rate limited (429).\n${err.message}`);
    throw err;
  }
}

async function runDecisions(input) {
  const runs = [];
  for (let i = 0; i < ROUNDS; i++) {
    runs.push(await timed(() => decide({ input, questions: MODERATION_QUESTIONS })));
  }
  const { answers, usage } = runs[0].value;
  return {
    answers,
    ms: runs.map((r) => r.ms),
    tokens: usage.input_tokens,
    // How far the same question's probability moved between rounds (0 = identical every time)
    drift: Math.max(...QUESTION_NAMES.map((name) => range(runs.map((r) => r.value.answers[name]?.probability ?? 0)))),
  };
}

async function runModeration(dataUrl) {
  try {
    const runs = [];
    for (let i = 0; i < ROUNDS; i++) runs.push(await timed(() => moderateImage(dataUrl)));
    const { flagged, category_scores: scores } = runs[0].value;
    return { flagged, scores, ms: runs.map((r) => r.ms) };
  } catch (err) {
    return { error: err.message };
  }
}

function verdict(label, answers) {
  const probs = Object.fromEntries(
    QUESTION_NAMES.map((name) => [name, answers[name]?.type === 'refusal' ? null : answers[name]?.probability]),
  );
  const top = Math.max(0, ...Object.values(probs).filter((p) => p != null));
  const action = top >= DELETE_AT ? 'delete' : top >= QUEUE_AT ? 'queue' : 'allow';
  const correct = label === 'ok' ? action === 'allow' : action !== 'allow';
  const refused = Object.values(probs).filter((p) => p == null).length;
  return { probs, action, correct, refused };
}

function printSummary({ links, images }) {
  const perThousand = (tokens) => `$${((tokens * 1000 * PRICE_PER_MILLION_INPUT_TOKENS) / 1e6).toFixed(3)}`;
  const line = (name, rows) => {
    if (rows.length === 0) return;
    const s = stats(rows.flatMap((r) => r.ms));
    const tokens = Math.round(mean(rows.map((r) => r.tokens)));
    const correct = rows.filter((r) => r.correct).length;
    console.log(
      `${pad(name, 22)}${correct}/${rows.length} right | ${Math.round(s.avg)} ms avg, ${Math.round(s.p50)} p50, ` +
        `${Math.round(s.p95)} p95 | ~${tokens} tokens each = ${perThousand(tokens)} per 1,000`,
    );
  };

  console.log(`\nSUMMARY (delete at ${DELETE_AT}+, mod queue at ${QUEUE_AT}+)`);
  line('Links', links);
  for (const detail of IMAGE_DETAILS) line(`Images (detail ${detail})`, images.map((i) => i.byDetail[detail]));

  const modMs = images.flatMap((i) => i.moderation.ms ?? []);
  if (modMs.length) {
    const s = stats(modMs);
    console.log(`${pad('Free moderation check', 22)}${Math.round(s.avg)} ms avg, ${Math.round(s.p95)} p95`);
  }
  if (images.length) console.log(`${pad('Image resize', 22)}${Math.round(mean(images.map((i) => i.prepMs)))} ms avg`);

  const all = [...links, ...images.flatMap((i) => Object.values(i.byDetail))];
  console.log(`${pad('Refused questions', 22)}${all.reduce((n, r) => n + r.refused, 0)}`);
  console.log(`${pad('Biggest drift', 22)}${Math.max(0, ...all.map((r) => r.drift)).toFixed(3)} (same input, different rounds)`);
}

// --- helpers ---------------------------------------------------------------

async function timed(fn) {
  const start = performance.now();
  const value = await fn();
  return { value, ms: performance.now() - start };
}

function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const pick = (q) => sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)];
  return { avg: mean(values), p50: pick(0.5), p95: pick(0.95) };
}

function mean(values) {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function range(values) {
  return Math.max(...values) - Math.min(...values);
}

function fmt(p) {
  return p == null ? 'REF' : p.toFixed(2);
}

function pad(value, width) {
  return String(value).padEnd(width);
}

function probHeader() {
  return QUESTION_NAMES.map((n) => pad(n, 6)).join('');
}

function probCells(probs) {
  return QUESTION_NAMES.map((n) => pad(fmt(probs[n]), 6)).join('');
}

function resultCells(row) {
  return pad(row.action, 8) + pad(row.correct ? 'yes' : 'NO', 5) + pad(Math.round(mean(row.ms)), 8) + row.tokens;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
