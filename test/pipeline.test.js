// Whole messages through the pipeline against a fake Discord server: what gets deleted, who gets
// timed out, what lands in the mod log, and what the buttons do. The AI is a fake.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stepFor } from '../src/punish.js';
import { keywordFor, mergeKeywords, shouldMirror } from '../src/automod.js';
import { allow, DAY, fakeServer } from './fake-server.js';

test('a scam link from a new member: deleted, timed out, DM with an appeal button, case in the log', async () => {
  const s = fakeServer();
  const spammer = s.member('spammer', { newAccount: true });
  const msg = s.message(spammer, 'free nitro https://scam.example/claim');
  await s.moderator.handleMessage(msg);

  assert.deepEqual(s.log.deleted, [msg.id]);
  assert.deepEqual(s.log.timeouts, [60 * 60_000]);
  assert.equal(s.log.dms.length, 1);
  assert.match(s.log.dms[0].content, /two-factor/);
  assert.equal(s.log.dms[0].components[0].components[0].data.custom_id, 'croak:appeal:1');
  const posted = s.log.posted[0];
  assert.equal(posted.embeds[0].data.title, 'Croaked: scam link');
  assert.equal(posted.components[0].components[0].data.label, 'Not spam');
  const saved = s.db.getCase(1);
  assert.equal(saved.content, 'free nitro https://scam.example/claim');
  assert.equal(saved.log_message_id, 'logmsg1');
});

test('their other messages from the last few minutes are cleaned up too', async () => {
  const s = fakeServer();
  const spammer = s.member('spammer', { newAccount: true });
  const earlier = s.message(spammer, 'hey everyone, quick question about the event', { channelId: 'c2' });
  await s.moderator.handleMessage(earlier); // no links: allowed, but remembered
  const scam = s.message(spammer, 'free nitro https://scam.example/claim');
  await s.moderator.handleMessage(scam);
  assert.deepEqual(s.log.deleted.sort(), [earlier.id, scam.id].sort());
  assert.match(s.log.posted[0].embeds[0].data.description, /Removed 1 of their other recent message/);
});

test('borderline from an established member is flagged and left up; from a new member it is held', async () => {
  const s = fakeServer({ scores: { scam: 0.7, nsfw: 0, spam: 0.1 } });
  const regular = s.member('regular');
  const flagged = s.message(regular, 'check this https://maybe.example/a');
  await s.moderator.handleMessage(flagged);
  assert.deepEqual(s.log.deleted, []);
  assert.equal(s.log.posted[0].embeds[0].data.title, 'Flagged for review: possible scam link');
  assert.deepEqual(
    s.log.posted[0].components[0].components.map((c) => c.data.label),
    ['Approve', 'Block', 'Jump to message'], // the message is still up, so mods can jump to it
  );
  assert.equal(s.log.posted[0].components[1].components[0].data.custom_id, 'croak:more:1'); // the "More actions" menu

  const newbie = s.member('newbie', { newAccount: true });
  const held = s.message(newbie, 'check this https://maybe.example/b');
  await s.moderator.handleMessage(held);
  assert.deepEqual(s.log.deleted, [held.id]);
  assert.deepEqual(s.log.timeouts, []); // held, not punished
  assert.equal(s.log.posted[1].embeds[0].data.title, 'Held for review: possible scam link');
});

test('mods, the owner, exempt channels and exempt roles are never checked', async () => {
  const s = fakeServer({ settings: { exemptChannels: ['c2'], exemptRoles: ['partner'] } });
  await s.moderator.handleMessage(s.message(s.member('mod', { mod: true }), 'https://scam.example/1'));
  await s.moderator.handleMessage(s.message(s.member('owner'), 'https://scam.example/2'));
  await s.moderator.handleMessage(s.message(s.member('someone'), 'https://scam.example/3', { channelId: 'c2' }));
  await s.moderator.handleMessage(s.message(s.member('partner', { roles: ['partner'] }), 'https://scam.example/4'));
  assert.deepEqual(s.log.deleted, []);
  assert.equal(s.db.statsSince('g', 1).checks, 0);
});

test('a hold approved by a mod is reposted under the member’s name, without pings', async () => {
  const s = fakeServer({ scores: { scam: 0.7, nsfw: 0, spam: 0 } });
  const newbie = s.member('newbie', { newAccount: true });
  await s.moderator.handleMessage(s.message(newbie, 'my project @everyone https://myproject.example'));
  const { replies } = await s.press('croak:approve:1');

  assert.equal(s.log.webhookPosts.length, 1);
  assert.equal(s.log.webhookPosts[0].username, 'newbie');
  assert.deepEqual(s.log.webhookPosts[0].allowedMentions, { parse: [] });
  assert.equal(s.db.getVerdict('g', 'link', 'myproject.example').verdict, 'allow');
  assert.equal(s.db.getVerdict('g', 'link', 'myproject.example').source, 'mod');
  assert.match(replies[0].embeds[0].data.fields.at(-1).value, /Reposted/);

  // A second mod pressing the button gets told it's done
  const second = await s.press('croak:approve:1');
  assert.match(second.replies.at(-1).content, /already handled/);
});

test('three croaks against new members within a minute raise a raid alert', async () => {
  const s = fakeServer();
  for (const name of ['a', 'b', 'c']) {
    await s.moderator.handleMessage(s.message(s.member(name, { newAccount: true }), `https://scam.example/${name}`));
  }
  assert.ok(s.raids.isActive('g'));
  assert.ok(s.log.posted.some((p) => p.embeds?.[0]?.data.title === 'Possible raid'));
});

test('escalation: strict goes timeout, kick, ban', async () => {
  assert.equal(stepFor('strict', 1), 'timeout');
  assert.equal(stepFor('strict', 2), 'kick');
  assert.equal(stepFor('strict', 5), 'ban');
  assert.equal(stepFor('off', 9), 'timeout');

  const s = fakeServer({ settings: { escalation: 'strict', cleanupMinutes: 0 } });
  const repeat = s.member('repeat');
  for (let i = 0; i < 3; i++) await s.moderator.handleMessage(s.message(repeat, `https://scam.example/${i}`));
  assert.equal(s.log.timeouts.length, 1);
  assert.deepEqual(s.log.kicked, ['repeat']);
  assert.deepEqual(s.log.banned, ['repeat']);
});

test('AutoMod: only confident blocks of single-purpose domains are mirrored', () => {
  const r = (host, scores, source = 'ai') => ({ item: { kind: 'link', host }, verdict: 'block', scores, source });
  assert.equal(shouldMirror(r('scam.example', { scam: 0.99 })), true);
  assert.equal(shouldMirror(r('scam.example', { scam: 0.92 })), false);
  assert.equal(shouldMirror(r('scam.example', null, 'mod')), true);
  assert.equal(keywordFor('dlscord-gift.com'), '*dlscord-gift.com*');
  assert.equal(keywordFor('t.me'), null);
  assert.equal(keywordFor('bit.ly'), null);
  assert.equal(keywordFor('free-nitro.pages.dev'), '*free-nitro.pages.dev*');
  const many = Array.from({ length: 1000 }, (_, i) => `*k${i}.example*`);
  const merged = mergeKeywords(many, ['*new.example*']);
  assert.equal(merged.length, 1000);
  assert.equal(merged.at(-1), '*new.example*');
});
