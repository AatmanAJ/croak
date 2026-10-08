import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/db.js';
import { saveModDecision } from '../src/overrides.js';
import { policyFor, toggleInList, withDefaults } from '../src/settings.js';

const DAY = 24 * 60 * 60 * 1000;

test('settings: defaults fill in, nested values merge', () => {
  const s = withDefaults({ preset: 'strict', categories: { spam: false } });
  assert.equal(s.preset, 'strict');
  assert.deepEqual(s.categories, { scam: true, nsfw: true, spam: false });
  assert.equal(s.timeoutMinutes, 60);
  assert.equal(s.automod.enabled, false);
});

test('policy: age-restricted channels and switched-off categories are ignored', () => {
  assert.deepEqual(policyFor(withDefaults()).ignore, []);
  assert.deepEqual(policyFor(withDefaults(), { nsfwChannel: true }).ignore, ['nsfw']);
  assert.deepEqual(policyFor(withDefaults({ categories: { spam: false } }), { nsfwChannel: true }).ignore, ['spam', 'nsfw']);
  assert.equal(policyFor(withDefaults({ preset: 'strict' })).deleteAt, 0.8);
});

test('toggleInList adds once and removes', () => {
  assert.deepEqual(toggleInList(['a'], 'b', true), ['a', 'b']);
  assert.deepEqual(toggleInList(['a', 'b'], 'b', true), ['a', 'b']);
  assert.deepEqual(toggleInList(['a', 'b'], 'a', false), ['b']);
});

test('a database from the first version upgrades and keeps its settings', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'croak-')), 'old.db');
  const old = new DatabaseSync(path);
  old.exec(`CREATE TABLE verdicts (guild_id TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL, key TEXT NOT NULL, verdict TEXT NOT NULL,
              scores TEXT, source TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER, PRIMARY KEY (guild_id, kind, key));
            CREATE TABLE guilds (guild_id TEXT PRIMARY KEY, log_channel_id TEXT, timeout_minutes INTEGER);
            CREATE TABLE cases (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, channel_id TEXT NOT NULL, message_id TEXT NOT NULL,
              author_id TEXT NOT NULL, action TEXT NOT NULL, items TEXT NOT NULL, created_at INTEGER NOT NULL, resolved_by TEXT, resolution TEXT);
            INSERT INTO guilds VALUES ('g1', 'log1', 15);
            INSERT INTO verdicts VALUES ('', 'link', 'scam.example', 'block', NULL, 'ai', 1, NULL);`);
  old.close();

  const db = openDb(path);
  const s = db.getSettings('g1');
  assert.equal(s.logChannelId, 'log1');
  assert.equal(s.timeoutMinutes, 15);
  assert.equal(db.getVerdict('g1', 'link', 'scam.example').verdict, 'block');
  db.updateSettings('g1', { preset: 'relaxed' });
  assert.equal(db.getSettings('g1').logChannelId, 'log1');
  assert.equal(db.getSettings('g1').preset, 'relaxed');
  db.close();
});

test('strikes count croaks and blocked reviews in 30 days, not ones mods overturned', () => {
  const db = openDb(':memory:');
  const add = (action, at) => db.addCase({ guildId: 'g', channelId: 'c', messageId: `m${at}`, authorId: 'u', action, items: [], now: at });
  const now = Date.now();
  add('delete', now - 40 * DAY); // too old
  add('delete', now - 2 * DAY);
  const overturned = add('delete', now - DAY);
  db.resolveCase(overturned, 'mod', 'approved');
  const blockedHold = add('hold', now - 1000);
  db.resolveCase(blockedHold, 'mod', 'blocked');
  add('flag', now - 500); // unresolved flag doesn't count
  assert.equal(db.strikes('g', 'u'), 2);
});

test('stats add up per day, and caseSummary finds reasons and sites', () => {
  const db = openDb(':memory:');
  db.bumpStats('g', { checks: 3, cacheHits: 2, aiCalls: 1, aiMs: 200 });
  db.bumpStats('g', { checks: 1, aiCalls: 1, aiMs: 300 });
  assert.deepEqual(db.statsSince('g', 1), { checks: 4, cacheHits: 2, aiCalls: 2, aiMs: 500 });
  assert.equal(db.aiCallsToday(), 2);
  assert.equal(db.guildAiCallsToday('g'), 2);

  const items = [{ kind: 'link', verdict: 'block', host: 'scam.example' }];
  db.addCase({ guildId: 'g', channelId: 'c', messageId: 'm1', authorId: 'u', action: 'delete', items, reason: 'scam link' });
  db.addCase({ guildId: 'g', channelId: 'c', messageId: 'm2', authorId: 'v', action: 'delete', items, reason: 'scam link' });
  const summary = db.caseSummary('g');
  assert.equal(summary.counts.delete, 2);
  assert.deepEqual(summary.reasons[0], { reason: 'scam link', n: 2 });
  assert.deepEqual(summary.topSites[0], ['scam.example', 2]);
});

test('housekeeping wipes old message text; forgetting a server deletes its data', () => {
  const db = openDb(':memory:');
  const old = db.addCase({ guildId: 'g', channelId: 'c', messageId: 'm', authorId: 'u', action: 'hold', items: [], content: 'hi', now: Date.now() - 40 * DAY });
  const fresh = db.addCase({ guildId: 'g', channelId: 'c', messageId: 'n', authorId: 'u', action: 'hold', items: [], content: 'hey' });
  db.housekeeping();
  assert.equal(db.getCase(old).content, null);
  assert.equal(db.getCase(fresh).content, 'hey');

  db.updateSettings('g', { preset: 'strict' });
  db.putVerdict({ guildId: 'g', kind: 'link', key: 'x', verdict: 'allow', source: 'mod' });
  db.putVerdict({ kind: 'link', key: 'shared', verdict: 'block', source: 'ai' });
  db.forgetGuild('g');
  assert.equal(db.getSettings('g').preset, 'standard');
  assert.equal(db.getCase(fresh), undefined);
  assert.equal(db.getVerdict('g', 'link', 'x'), undefined);
  assert.equal(db.getVerdict('g', 'link', 'shared').verdict, 'block'); // shared verdicts stay
});

test('a block from mods in three servers becomes a block for every server', () => {
  const db = openDb(':memory:');
  const block = (guildId) => saveModDecision(db, { guildId, kind: 'link', key: 'evil.example/x', verdict: 'block' });
  assert.equal(block('a'), false);
  assert.equal(block('b'), false);
  assert.equal(db.getVerdict('elsewhere', 'link', 'evil.example/x'), undefined);
  assert.equal(block('c'), true);
  const shared = db.getVerdict('elsewhere', 'link', 'evil.example/x');
  assert.equal(shared.verdict, 'block');
  assert.equal(shared.source, 'network');
});
