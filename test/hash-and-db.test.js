import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import sharp from 'sharp';
import { openDb } from '../src/db.js';
import { dHash, hamming } from '../src/hash.js';

const scam = await readFile(new URL('../test-set/images/scam-fake-giveaway.png', import.meta.url));
const ok = await readFile(new URL('../test-set/images/ok-patch-notes.png', import.meta.url));

test('a resized, recompressed copy hashes within a few bits; a different image does not', async () => {
  const original = await dHash(scam);
  const copy = await dHash(await sharp(scam).resize(480).jpeg({ quality: 60 }).toBuffer());
  const other = await dHash(ok);
  assert.ok(hamming(original, copy) <= 6, `copy differs by ${hamming(original, copy)} bits`);
  assert.ok(hamming(original, other) > 12, `other image differs by only ${hamming(original, other)} bits`);
});

test("a server's own decision beats the shared verdict", () => {
  const db = openDb(':memory:');
  db.putVerdict({ kind: 'link', key: 'a.example', verdict: 'block', source: 'ai' });
  db.putVerdict({ guildId: 'g1', kind: 'link', key: 'a.example', verdict: 'allow', source: 'mod' });
  assert.equal(db.getVerdict('g1', 'link', 'a.example').verdict, 'allow');
  assert.equal(db.getVerdict('g2', 'link', 'a.example').verdict, 'block');
});

test('expired verdicts are ignored', () => {
  const db = openDb(':memory:');
  db.putVerdict({ kind: 'link', key: 'old.example', verdict: 'allow', source: 'ai', ttlMs: 1000, now: 0 });
  assert.equal(db.getVerdict('g1', 'link', 'old.example', 5000), undefined);
});

test('near copies of a blocked image are found', async () => {
  const db = openDb(':memory:');
  db.putVerdict({ kind: 'image', key: await dHash(scam), verdict: 'block', source: 'ai' });
  const copy = await dHash(await sharp(scam).resize(600).toBuffer());
  assert.ok(db.findBlockedImage('g1', copy, 6));
  assert.equal(db.findBlockedImage('g1', await dHash(ok), 6), undefined);
});

test('a case can only be resolved once', () => {
  const db = openDb(':memory:');
  const id = db.addCase({ guildId: 'g', channelId: 'c', messageId: 'm', authorId: 'a', action: 'hold', items: [] });
  assert.equal(db.resolveCase(id, 'mod1', 'approved'), true);
  assert.equal(db.resolveCase(id, 'mod2', 'blocked'), false);
  assert.equal(db.getCase(id).resolution, 'approved');
});
