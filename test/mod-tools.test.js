// The mod tools: appeal conversations, the case "More actions" menu, watch and trust, croaking a
// message by hand, member reports, lockdown, the settings panel and the weekly digest.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { digestDue } from '../src/digest.js';
import { DAY, deny, fakeServer } from './fake-server.js';

const WEEK = 7 * DAY;

/** A croaked scam link from a new member: case #1, with a DM and a log entry. */
async function croaked(s) {
  const spammer = s.member('spammer', { newAccount: true });
  await s.moderator.handleMessage(s.message(spammer, 'free nitro https://scam.example/claim'));
  return spammer;
}

test('appeal: the member explains, a mod replies with their own message, the member replies back', async () => {
  const s = fakeServer();
  const spammer = await croaked(s);

  // Only the member can appeal, and only once
  const stranger = await s.press('croak:appeal:1', { by: s.member('stranger'), inGuild: false });
  assert.match(stranger.replies[0].content, /Only the person/);
  const opened = await s.press('croak:appeal:1', { by: spammer, inGuild: false });
  assert.equal(opened.modals[0].data.custom_id, 'croak:appealform:1');

  await s.press('croak:appealform:1', { by: spammer, inGuild: false, text: 'My account was hacked, I changed my password' });
  const appeal = s.log.posted.at(-1);
  assert.equal(appeal.reply.messageReference, 'logmsg1'); // threaded under the case
  assert.deepEqual(
    appeal.components[0].components.map((c) => c.data.custom_id),
    ['croak:accept:1', 'croak:reject:1', 'croak:reply:1'],
  );
  assert.equal(s.db.getCase(1).appeal, 'open');

  // A mod presses Reply… and writes a custom message
  const asked = await s.press('croak:reply:1');
  assert.equal(asked.modals[0].data.custom_id, 'croak:replyform:1');
  const dmsBefore = s.log.dms.length;
  const sent = await s.press('croak:replyform:1', { text: 'Thanks. Turn on 2FA and you can post links again tomorrow.' });
  assert.match(sent.replies[0].content, /^Sent/);
  const dm = s.log.dms[dmsBefore];
  assert.match(dm.content, /The Test Server mods replied[\s\S]*Turn on 2FA/);
  assert.equal(dm.components[0].components[0].data.custom_id, 'croak:mreply:1'); // they can answer
  assert.match(s.log.posted.at(-1).embeds[0].data.description, /Turn on 2FA/); // and the log shows it

  // The member replies; the mods see it with a Reply button
  await s.press('croak:mreplyform:1', { by: spammer, inGuild: false, text: 'Done, 2FA is on now' });
  const memberReply = s.log.posted.at(-1);
  assert.match(memberReply.embeds[0].data.description, /2FA is on now/);
  assert.equal(memberReply.components[0].components[0].data.custom_id, 'croak:reply:1');

  const kinds = s.db.caseEvents(1).map((e) => e.kind);
  assert.deepEqual(kinds.filter((k) => k !== 'action'), ['member_reply', 'mod_reply', 'member_reply']);
});

test('a mod without Manage Messages cannot reply to an appeal', async () => {
  const s = fakeServer();
  await croaked(s);
  const out = await s.press('croak:reply:1', { perms: deny });
  assert.match(out.replies[0].content, /Manage Messages/);
  assert.equal(out.modals.length, 0);
});

test('More actions: note, watch and block the whole site are recorded on the case', async () => {
  const s = fakeServer();
  await croaked(s);

  const noteForm = await s.press('croak:more:1', { values: ['note'] });
  assert.equal(noteForm.modals[0].data.custom_id, 'croak:noteform:1');
  await s.press('croak:noteform:1', { text: 'Same scam as last week' });

  const watched = await s.press('croak:more:1', { values: ['watch'] });
  assert.match(watched.replies[0], /Watching <@spammer> for 7 days/);
  assert.ok(s.db.memberFlags('g', 'spammer').watching > Date.now() + 6 * DAY);

  const blocked = await s.press('croak:more:1', { values: ['blocksite'] });
  assert.match(blocked.replies[0], /scam\.example/);
  assert.equal(s.db.getVerdict('g', 'domain', 'scam.example').verdict, 'block');

  const events = s.db.caseEvents(1);
  assert.ok(events.some((e) => e.kind === 'note' && e.text === 'Same scam as last week'));
  // The log entry gained a History field
  const history = s.log.edits.at(-1).embeds[0].data.fields.find((f) => f.name === 'History');
  assert.match(history.value, /scam\.example/);
});

test('More actions: kick and ban need their own permissions, and ban asks first', async () => {
  const s = fakeServer();
  await croaked(s);
  const noKick = await s.press('croak:more:1', { values: ['kick'], perms: { has: (p) => p !== 2n } }); // 2n = Kick Members
  assert.match(noKick.replies[0].content, /Kick Members/);
  assert.deepEqual(s.log.kicked, []);

  const ask = await s.press('croak:more:1', { values: ['ban'] });
  assert.match(ask.replies[0].content, /Ban <@spammer>\?/);
  assert.deepEqual(s.log.banned, []);
  await s.press('croak:banok:1');
  assert.deepEqual(s.log.banned, ['spammer']);
});

test('watched members have every link held; trusted members are never checked', async () => {
  const s = fakeServer({ scores: { scam: 0, nsfw: 0, spam: 0 } });
  const regular = s.member('regular');
  s.db.setWatch('g', 'regular', Date.now() + DAY, 'mod');
  const msg = s.message(regular, 'look at this https://fine.example/page');
  await s.moderator.handleMessage(msg);
  assert.deepEqual(s.log.deleted, [msg.id]);
  assert.equal(s.log.posted[0].embeds[0].data.title, 'Held for review: watched member');
  assert.deepEqual(s.log.timeouts, []);

  const s2 = fakeServer();
  const friend = s2.member('friend', { newAccount: true });
  s2.db.setTrusted('g', 'friend', true);
  await s2.moderator.handleMessage(s2.message(friend, 'https://scam.example/x'));
  assert.deepEqual(s2.log.deleted, []);
  assert.equal(s2.db.statsSince('g', 1).checks, 0);
});

test('member panel buttons: watch, trust and purge', async () => {
  const s = fakeServer({ scores: { scam: 0, nsfw: 0, spam: 0 } });
  const someone = s.member('someone');
  const a = s.message(someone, 'hello');
  const b = s.message(someone, 'anyone here?', { channelId: 'c2' });
  await s.moderator.handleMessage(a);
  await s.moderator.handleMessage(b);

  const watched = await s.press('croak:member:watch:someone');
  assert.match(watched.updates[0].embeds[0].data.footer.text, /Watching for 7 days/);
  assert.ok(s.db.memberFlags('g', 'someone').watching);

  await s.press('croak:member:trust:someone');
  assert.equal(s.db.memberFlags('g', 'someone').trusted, true);

  const purged = await s.press('croak:member:purge:someone');
  assert.match(purged.updates[0].embeds[0].data.footer.text, /Deleted 2 messages/);
  assert.deepEqual(s.log.deleted.sort(), [a.id, b.id].sort());
});

test('croaking a message by hand deletes it, blocks its link here, and opens a case', async () => {
  const s = fakeServer({ scores: { scam: 0.1, nsfw: 0, spam: 0 } }); // the AI thinks it's fine
  const sneaky = s.member('sneaky');
  const msg = s.message(sneaky, 'new drop https://sneaky.example/drop');
  const summary = await s.moderator.croakManually(msg, { by: s.member('mod', { mod: true }).user, reason: 'known scammer' });
  assert.match(summary, /^Croaked\. Case #1\./);
  assert.deepEqual(s.log.deleted.includes(msg.id), true);
  assert.equal(s.db.getCase(1).reason, 'croaked by mod#0001: known scammer');
  assert.equal(s.db.getVerdict('g', 'link', 'sneaky.example/drop').verdict, 'block');
  assert.equal(s.log.posted[0].embeds[0].data.title, 'Croaked: croaked by mod#0001: known scammer');

  // Mods can't croak other mods
  const other = s.message(s.member('mod2', { mod: true }), 'https://x.example');
  assert.match(await s.moderator.croakManually(other, { by: { id: 'mod', tag: 'mod#0001' } }), /other mods/);
});

test('a member report opens a case with Croak it / Dismiss, and Croak it deletes the message', async () => {
  const s = fakeServer({ scores: { scam: 0.2, nsfw: 0, spam: 0 } });
  const author = s.member('author');
  const msg = s.message(author, 'dm me for cheap robux');
  await s.press(`croak:reportform:c1:${msg.id}`, { by: s.member('reporter'), perms: deny, channelId: 'c1', text: 'robux scam' });

  const report = s.log.posted[0];
  assert.match(report.embeds[0].data.title, /Reported/);
  assert.deepEqual(
    report.components[0].components.map((c) => c.data.label),
    ['Croak it', 'Dismiss', 'Jump to message'],
  );
  assert.equal(s.db.getCase(1).action, 'report');

  await s.press('croak:block:1', { message: { id: 'logmsg1', embeds: [report.embeds[0].toJSON()], components: [] } });
  assert.ok(s.log.deleted.includes(msg.id));
  assert.equal(s.db.getCase(1).resolution, 'blocked');
});

test('lockdown slows every channel and pauses invites, then puts each back exactly', async () => {
  const s = fakeServer();
  s.guild.channels.cache.get('c2').rateLimitPerUser = 5; // #random already had a 5s slowmode
  const { summary } = await s.lockdown.start(s.guild, { minutes: 30, slowmode: 30, by: s.member('mod', { mod: true }).user });
  assert.match(summary, /3 channels on 30s slowmode, invites paused/);
  assert.ok(s.lockdown.isOn('g'));
  assert.deepEqual(s.log.invites, ['paused']);

  // Running it again extends instead of overwriting what to restore
  const again = await s.lockdown.start(s.guild, { minutes: 60, by: s.member('mod').user });
  assert.match(again.summary, /extended/);

  await s.lockdown.end(s.guild, null);
  assert.equal(s.guild.channels.cache.get('c1').rateLimitPerUser, 0);
  assert.equal(s.guild.channels.cache.get('c2').rateLimitPerUser, 5);
  assert.deepEqual(s.log.invites, ['paused', 'resumed']);
  assert.equal(s.lockdown.isOn('g'), false);
});

test('settings panel: dropdowns and toggles change settings, and need Manage Server', async () => {
  const s = fakeServer();
  const denied = await s.press('croak:set:preset', { values: ['strict'], perms: deny });
  assert.match(denied.replies[0].content, /Manage Server/);
  assert.equal(s.db.getSettings('g').preset, 'standard');

  const changed = await s.press('croak:set:preset', { values: ['strict'] });
  assert.equal(s.db.getSettings('g').preset, 'strict');
  assert.equal(changed.updates[0].components.length, 5);

  await s.press('croak:set:timeout', { values: ['1440'] });
  assert.equal(s.db.getSettings('g').timeoutMinutes, 1440);

  await s.press('croak:set:cat:nsfw');
  assert.equal(s.db.getSettings('g').categories.nsfw, false);
  await s.press('croak:set:cat:nsfw');
  assert.equal(s.db.getSettings('g').categories.nsfw, true);
});

test('the weekly digest is due once a week, only when turned on and a log channel is set', () => {
  const now = Date.now();
  assert.equal(digestDue({ digest: 'off', logChannelId: 'log', lastDigestAt: 0 }, now), false);
  assert.equal(digestDue({ digest: 'weekly', logChannelId: null, lastDigestAt: 0 }, now), false);
  assert.equal(digestDue({ digest: 'weekly', logChannelId: 'log', lastDigestAt: now - DAY }, now), false);
  assert.equal(digestDue({ digest: 'weekly', logChannelId: 'log', lastDigestAt: now - WEEK }, now), true);
});
