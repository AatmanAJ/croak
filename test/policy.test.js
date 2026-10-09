// The judge under different server policies, spending caps and failures. The AI is a fake.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import QRCode from 'qrcode';
import { openDb } from '../src/db.js';
import { extractItems } from '../src/extract.js';
import { createAiGuard, createJudge } from '../src/judge.js';
import { policyFor, withDefaults } from '../src/settings.js';

function fakeDecide(scores) {
  const fake = async () => {
    fake.calls++;
    return { answers: Object.fromEntries(Object.entries(scores).map(([name, probability]) => [name, { type: 'predicate', name, probability }])) };
  };
  fake.calls = 0;
  return fake;
}

const link = (url) => extractItems({ content: url }).links[0];

function judgeWith({ decide, image, guard, db = openDb(':memory:') }) {
  return {
    db,
    judge: createJudge({ db, decide, guard, expand: async (h) => h, resolveInvite: async () => null, fetchImage: async () => image }),
  };
}

test('an NSFW image is croaked normally but allowed in an age-restricted channel', async () => {
  const image = await QRCode.toBuffer('not a link, just text', { width: 200 }); // any image will do
  const { judge } = judgeWith({ decide: fakeDecide({ scam: 0.01, nsfw: 0.98, spam: 0.02 }), image });
  const item = { kind: 'image', url: 'https://cdn.discordapp.com/x.png', name: 'x.png' };
  const [normal] = await judge.judgeAll([item], { guildId: 'g', text: '', policy: policyFor(withDefaults()) });
  const [adult] = await judge.judgeAll([item], { guildId: 'g', text: '', policy: policyFor(withDefaults(), { nsfwChannel: true }) });
  assert.equal(normal.verdict, 'block');
  assert.equal(adult.verdict, 'allow');
  assert.equal(adult.source, 'cache'); // same image, judged once
});

test('sensitivity: 0.85 is a review at Standard, a croak at Strict, and allowed at Relaxed', async () => {
  const { judge } = judgeWith({ decide: fakeDecide({ scam: 0.85, nsfw: 0, spam: 0 }) });
  const run = async (preset) => (await judge.judgeAll([link('https://maybe.example/x')], { guildId: 'g', text: '', policy: policyFor(withDefaults({ preset })) }))[0];
  assert.equal((await run('standard')).verdict, 'review');
  assert.equal((await run('strict')).verdict, 'block');
  assert.equal((await run('relaxed')).verdict, 'review'); // relaxed reviews at 0.75
});

test('switching a category off ignores its score', async () => {
  const { judge } = judgeWith({ decide: fakeDecide({ scam: 0.05, nsfw: 0, spam: 0.97 }) });
  const policy = policyFor(withDefaults({ categories: { spam: false } }));
  const [r] = await judge.judgeAll([link('https://promo.example/join')], { guildId: 'g', text: '', policy });
  assert.equal(r.verdict, 'allow');
});

test('a look-alike domain is always shown to a mod, even when the AI is unsure', async () => {
  const { judge } = judgeWith({ decide: fakeDecide({ scam: 0.3, nsfw: 0, spam: 0.1 }) });
  const [r] = await judge.judgeAll([link('https://steamcommunlty.com/tradeoffer/new')], { guildId: 'g', text: '', policy: policyFor(withDefaults()) });
  assert.equal(r.verdict, 'review');
  assert.equal(r.reason, 'look-alike link');
  assert.match(r.hint.note, /steamcommunity/);
});

test('a QR code that opens a Discord login page is croaked without asking the AI', async () => {
  const image = await QRCode.toBuffer('https://discord.com/ra/stealme123', { width: 300 });
  const decide = fakeDecide({ scam: 0, nsfw: 0, spam: 0 });
  const { judge } = judgeWith({ decide, image });
  const [r] = await judge.judgeAll([{ kind: 'image', url: 'https://cdn.discordapp.com/qr.png', name: 'verify.png' }], { guildId: 'g', text: 'scan to verify' });
  assert.equal(r.verdict, 'block');
  assert.equal(r.source, 'rule');
  assert.equal(decide.calls, 0);
});

test('the daily AI limit turns new checks into "unknown" instead of spending more', async () => {
  const db = openDb(':memory:');
  const guard = createAiGuard({ db, limits: { dailyLimitTotal: 1, dailyLimitPerServer: 100, failuresBeforePause: 5, pauseMs: 60_000 } });
  const decide = fakeDecide({ scam: 0.1, nsfw: 0, spam: 0 });
  const { judge } = judgeWith({ decide, guard, db });
  await judge.judgeAll([link('https://one.example')], { guildId: 'g', text: '' });
  const [second] = await judge.judgeAll([link('https://two.example')], { guildId: 'g', text: '' });
  assert.equal(second.verdict, 'unknown');
  assert.equal(second.note, 'daily AI limit reached');
  assert.equal(decide.calls, 1);
});

test('after repeated AI failures, the AI is paused instead of hammered', async () => {
  let clock = 0;
  const db = openDb(':memory:');
  const guard = createAiGuard({ db, now: () => clock, limits: { dailyLimitTotal: 1e6, dailyLimitPerServer: 1e6, failuresBeforePause: 2, pauseMs: 60_000 } });
  let calls = 0;
  const decide = async () => {
    calls++;
    throw new Error('503 from OpenAI');
  };
  const { judge } = judgeWith({ decide, guard, db });
  await judge.judgeAll([link('https://a.example')], { guildId: 'g', text: '' });
  await judge.judgeAll([link('https://b.example')], { guildId: 'g', text: '' });
  const [paused] = await judge.judgeAll([link('https://c.example')], { guildId: 'g', text: '' });
  assert.equal(calls, 2);
  assert.equal(paused.note, 'AI paused after repeated errors');
  clock = 61_000;
  await judge.judgeAll([link('https://d.example')], { guildId: 'g', text: '' });
  assert.equal(calls, 3); // tries again after the pause
});

test('stats are counted per check', async () => {
  const { judge, db } = judgeWith({ decide: fakeDecide({ scam: 0.1, nsfw: 0, spam: 0 }) });
  await judge.judgeAll([link('https://x.example'), link('https://www.youtube.com/watch?v=1')], { guildId: 'g', text: '' });
  await judge.judgeAll([link('https://x.example')], { guildId: 'g', text: '' });
  const s = db.statsSince('g', 1);
  assert.equal(s.checks, 3);
  assert.equal(s.aiCalls, 1);
  assert.equal(s.cacheHits, 1);
});

test('images are only downloaded from Discord', async () => {
  const db = openDb(':memory:');
  const judge = createJudge({ db, decide: fakeDecide({ scam: 0, nsfw: 0, spam: 0 }), resolveInvite: async () => null });
  const [r] = await judge.judgeAll([{ kind: 'image', url: 'http://169.254.169.254/latest/meta-data', name: 'x' }], { guildId: 'g', text: '' });
  assert.equal(r.verdict, 'unknown');
  assert.match(r.note, /not downloading/);
});

test('well-known adult sites are croaked without the AI, but allowed in age-restricted channels', async () => {
  const decide = fakeDecide({ scam: 0, nsfw: 0, spam: 0 });
  const { judge } = judgeWith({ decide });
  const item = link('check out ma nudes @ https://beeg.com/');
  const [normal] = await judge.judgeAll([item], { guildId: 'g', text: '', policy: policyFor(withDefaults()) });
  const [adultChannel] = await judge.judgeAll([item], { guildId: 'g', text: '', policy: policyFor(withDefaults(), { nsfwChannel: true }) });
  const [tld] = await judge.judgeAll([link('https://anything.xxx/page')], { guildId: 'g', text: '' });
  assert.equal(normal.verdict, 'block');
  assert.equal(normal.reason, 'NSFW link');
  assert.equal(adultChannel.verdict, 'allow');
  assert.equal(tld.verdict, 'block');
  assert.equal(decide.calls, 0);
});

test("a server's own allow beats the adult-site rule", async () => {
  const { judge, db } = judgeWith({ decide: fakeDecide({ scam: 0, nsfw: 0, spam: 0 }) });
  db.putVerdict({ guildId: 'g', kind: 'domain', key: 'onlyfans.com', verdict: 'allow', source: 'mod' });
  const [r] = await judge.judgeAll([link('https://onlyfans.com/someone')], { guildId: 'g', text: '' });
  assert.equal(r.verdict, 'allow');
});
