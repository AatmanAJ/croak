// The judge with the AI, downloads and invite lookups replaced by fakes, so nothing is called for real.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { openDb } from '../src/db.js';
import { extractItems } from '../src/extract.js';
import { createJudge, verdictFromScores } from '../src/judge.js';
import { decideAction } from '../src/moderate.js';
import { createRepeatTracker, fingerprint } from '../src/repeats.js';

const scamImage = await readFile(new URL('../test-set/images/scam-fake-giveaway.png', import.meta.url));

/** A fake Decisions API that returns fixed scores and counts its calls. */
function fakeDecide(scores, { delayMs = 0, refuse = [] } = {}) {
  const fake = async () => {
    fake.calls++;
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    const answers = Object.fromEntries(
      Object.entries(scores).map(([name, probability]) => [
        name,
        refuse.includes(name) ? { type: 'refusal', name } : { type: 'predicate', name, probability },
      ]),
    );
    return { answers, usage: { input_tokens: 600 } };
  };
  fake.calls = 0;
  return fake;
}

function judgeWith(decide, extra = {}) {
  return createJudge({
    db: openDb(':memory:'),
    decide,
    expand: async (href) => href,
    resolveInvite: async () => null,
    fetchImage: async () => scamImage,
    ...extra,
  });
}

const ctx = { guildId: 'g1', text: 'hello' };
const link = (content) => extractItems({ content }).links[0];

test('thresholds: 0.9+ blocks, 0.6+ goes to review, below allows', () => {
  assert.equal(verdictFromScores({ scam: 0.95, nsfw: 0, spam: 0 }), 'block');
  assert.equal(verdictFromScores({ scam: 0.7, nsfw: null, spam: 0.1 }), 'review');
  assert.equal(verdictFromScores({ scam: 0.1, nsfw: 0.2, spam: 0.3 }), 'allow');
});

test('a repeat link comes from the cache without asking the AI again', async () => {
  const decide = fakeDecide({ scam: 0.99, nsfw: 0, spam: 0.5 });
  const judge = judgeWith(decide);
  const [first] = await judge.judgeAll([link('https://dlscord-gift.com/nitro')], ctx);
  const [second] = await judge.judgeAll([link('https://www.dlscord-gift.com/nitro/')], { guildId: 'g2', text: 'other' });
  assert.equal(first.verdict, 'block');
  assert.equal(first.source, 'ai');
  assert.equal(second.verdict, 'block');
  assert.equal(second.source, 'cache');
  assert.equal(decide.calls, 1);
});

test('fifty copies of one link at the same moment make one AI call', async () => {
  const decide = fakeDecide({ scam: 0.99, nsfw: 0, spam: 0.9 }, { delayMs: 20 });
  const judge = judgeWith(decide);
  const results = await Promise.all(Array.from({ length: 50 }, () => judge.judgeAll([link('https://raid.example/x')], ctx)));
  assert.equal(decide.calls, 1);
  assert.ok(results.every(([r]) => r.verdict === 'block'));
});

test('trusted sites skip the AI', async () => {
  const decide = fakeDecide({ scam: 1, nsfw: 1, spam: 1 });
  const [r] = await judgeWith(decide).judgeAll([link('https://www.youtube.com/watch?v=x')], ctx);
  assert.equal(r.verdict, 'allow');
  assert.equal(decide.calls, 0);
});

test('an AI failure becomes "unknown" instead of crashing', async () => {
  const decide = async () => {
    throw Object.assign(new Error('timed out'), { name: 'TimeoutError' });
  };
  const [r] = await judgeWith(decide).judgeAll([link('https://slow.example')], ctx);
  assert.equal(r.verdict, 'unknown');
  assert.equal(r.note, 'AI timed out');
});

test('invites to servers Discord marks explicit are blocked without the AI', async () => {
  const decide = fakeDecide({ scam: 0, nsfw: 0, spam: 0 });
  const judge = judgeWith(decide, {
    resolveInvite: async () => ({ guildId: 's1', name: 'Hot Leaks', nsfwLevel: 'Explicit' }),
  });
  const [r] = await judge.judgeAll(extractItems({ content: 'discord.gg/leaks' }).invites, ctx);
  assert.equal(r.verdict, 'block');
  assert.equal(r.reason, 'NSFW server invite');
  assert.equal(decide.calls, 0);
});

test('invites to the same server are allowed', async () => {
  const judge = judgeWith(fakeDecide({ scam: 1, nsfw: 1, spam: 1 }), {
    resolveInvite: async () => ({ guildId: 'g1', name: 'Home' }),
  });
  const [r] = await judge.judgeAll(extractItems({ content: 'discord.gg/home' }).invites, ctx);
  assert.equal(r.verdict, 'allow');
});

test('images: refused NSFW question falls back to the moderation endpoint', async () => {
  const decide = fakeDecide({ scam: 0.1, nsfw: 0, spam: 0.1 }, { refuse: ['nsfw'] });
  let moderated = 0;
  const judge = judgeWith(decide, {
    moderate: async () => {
      moderated++;
      return { category_scores: { sexual: 0.97 } };
    },
  });
  const [r] = await judge.judgeAll([{ kind: 'image', url: 'x', name: 'pic.png' }], ctx);
  assert.equal(moderated, 1);
  assert.equal(r.verdict, 'block');
  assert.equal(r.reason, 'NSFW image');
});

test('images: a near copy of a blocked image is blocked from the cache', async () => {
  const decide = fakeDecide({ scam: 0.99, nsfw: 0, spam: 0.9 });
  const judge = judgeWith(decide);
  await judge.judgeAll([{ kind: 'image', url: 'a', name: 'a.png' }], ctx);
  const [again] = await judge.judgeAll([{ kind: 'image', url: 'b', name: 'b.png' }], ctx);
  assert.equal(again.source, 'cache');
  assert.equal(decide.calls, 1);
});

test('actions: block deletes; unsure holds new members but only flags established ones', () => {
  const r = (verdict) => ({ verdict });
  assert.equal(decideAction([r('allow'), r('block')], { isNew: false }), 'delete');
  assert.equal(decideAction([r('review')], { isNew: true }), 'hold');
  assert.equal(decideAction([r('review')], { isNew: false }), 'flag');
  assert.equal(decideAction([r('unknown')], { isNew: true }), 'hold');
  assert.equal(decideAction([r('unknown')], { isNew: false }), 'allow');
  assert.equal(decideAction([r('allow')], { isNew: true }), 'allow');
});

test('the same post in three channels within a minute is caught', () => {
  const tracker = createRepeatTracker({ channels: 3, windowMs: 60_000 });
  const print = fingerprint({ content: 'FREE NITRO https://dlscord-gift.com/nitro' });
  const post = (channelId, at) => tracker.record({ guildId: 'g', userId: 'u', channelId, messageId: `${channelId}-${at}`, print, now: at });
  assert.equal(post('c1', 0), null);
  assert.equal(post('c2', 1000), null);
  assert.equal(post('c3', 2000).length, 3);
});

test('repeats spread over more than a minute, or short messages, are not caught', () => {
  const tracker = createRepeatTracker({ channels: 3, windowMs: 60_000 });
  const print = fingerprint({ content: 'FREE NITRO https://dlscord-gift.com/nitro' });
  const post = (channelId, at) => tracker.record({ guildId: 'g', userId: 'u', channelId, messageId: channelId, print, now: at });
  post('c1', 0);
  post('c2', 40_000);
  assert.equal(post('c3', 70_000), null);
  assert.equal(fingerprint({ content: 'gm' }), null);
});
