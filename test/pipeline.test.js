// Whole messages through the pipeline against a fake Discord server: what gets deleted, who gets
// timed out, what lands in the mod log, and what the buttons do. The AI is a fake.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Collection } from 'discord.js';
import { createInteractions } from '../src/interactions.js';
import { openDb } from '../src/db.js';
import { createJudge } from '../src/judge.js';
import { createModerator } from '../src/moderate.js';
import { stepFor } from '../src/punish.js';
import { createRepeatTracker } from '../src/repeats.js';
import { createRaidDetector, createRecentMessages } from '../src/trackers.js';
import { keywordFor, mergeKeywords, shouldMirror } from '../src/automod.js';

const DAY = 24 * 60 * 60 * 1000;
const allow = { has: () => true };
const deny = { has: () => false };

/** A fake server with a #general, a #mod-log, a bot member, and recorders for every side effect. */
function fakeServer({ scores = { scam: 0.99, nsfw: 0, spam: 0.4 }, settings = {} } = {}) {
  const log = { deleted: [], timeouts: [], dms: [], posted: [], kicked: [], banned: [], webhookPosts: [] };
  const db = openDb(':memory:');
  db.updateSettings('g', { logChannelId: 'log', ...settings });

  const channel = (id, name) => ({
    id,
    name,
    nsfw: false,
    parentId: null,
    isThread: () => false,
    toString: () => `<#${id}>`,
    permissionsFor: () => allow,
    messages: {
      delete: async (mid) => log.deleted.push(mid),
      fetch: async () => {
        throw new Error('Unknown Message');
      },
    },
    bulkDelete: async (ids) => {
      log.deleted.push(...ids);
      return new Map(ids.map((i) => [i, {}]));
    },
    fetchWebhooks: async () => new Collection(),
    createWebhook: async () => ({ send: async (m) => log.webhookPosts.push(m) }),
    send: async (m) => {
      log.posted.push(m);
      return { id: `logmsg${log.posted.length}` };
    },
  });
  const general = channel('c1', 'general');
  const random = channel('c2', 'random');
  const modLog = channel('log', 'mod-log');
  const me = { id: 'bot', permissions: allow, roles: { highest: { position: 10 } } };
  const guild = {
    id: 'g',
    name: 'Test Server',
    ownerId: 'owner',
    members: { me, fetch: async (id) => members.get(id) },
    channels: { cache: new Map([['c1', general], ['c2', random], ['log', modLog]]) },
    roles: { cache: new Map() },
  };
  const members = new Map();

  function member(id, { newAccount = false, mod = false, roles = [] } = {}) {
    const m = {
      id,
      guild,
      user: { id, tag: `${id}#0001`, createdTimestamp: Date.now() - (newAccount ? 1 : 400) * DAY },
      joinedTimestamp: Date.now() - (newAccount ? 1000 : 300 * DAY),
      permissions: mod ? allow : deny,
      roles: { cache: new Map(roles.map((r) => [r, {}])) },
      moderatable: true,
      kickable: true,
      bannable: true,
      isCommunicationDisabled: () => log.timeouts.length > 0,
      displayName: id,
      displayAvatarURL: () => 'https://cdn.discordapp.com/avatar.png',
      timeout: async (ms) => log.timeouts.push(ms),
      kick: async () => log.kicked.push(id),
      ban: async () => log.banned.push(id),
    };
    members.set(id, m);
    return m;
  }

  let n = 0;
  function message(author, content, { channelId = 'c1', everyonePing = false } = {}) {
    n += 1;
    const id = `m${n}`;
    return {
      id,
      inGuild: () => true,
      author: {
        id: author.id,
        bot: false,
        tag: author.user.tag,
        createdTimestamp: author.user.createdTimestamp,
        toString: () => `<@${author.id}>`,
        send: async (m) => log.dms.push(m),
      },
      member: author,
      guild,
      guildId: 'g',
      channel: guild.channels.cache.get(channelId),
      channelId,
      content,
      attachments: new Map(),
      embeds: [],
      messageSnapshots: new Map(),
      mentions: { everyone: false },
      delete: async () => log.deleted.push(id),
      ...(everyonePing && {}),
    };
  }

  const decide = async () => ({
    answers: Object.fromEntries(Object.entries(scores).map(([name, probability]) => [name, { type: 'predicate', name, probability }])),
  });
  const judge = createJudge({ db, decide, expand: async (h) => h, resolveInvite: async () => null });
  const raids = createRaidDetector({ croaks: 3, windowMs: 60_000, lockMs: 60_000 });
  const moderator = createModerator({
    db,
    judge,
    repeats: createRepeatTracker({ channels: 3, windowMs: 60_000 }),
    recent: createRecentMessages(),
    raids,
    automod: null,
    log: () => {},
  });
  const client = { guilds: { cache: new Map([['g', guild]]) }, users: { fetch: async () => ({ send: async (m) => log.dms.push(m) }) } };
  const interactions = createInteractions({ client, db, automod: null, log: () => {} });
  return { db, guild, member, message, moderator, interactions, log, raids };
}

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
    ['Approve', 'Block'],
  );

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
  const replies = [];
  const interaction = {
    customId: 'croak:approve:1',
    inGuild: () => true,
    guildId: 'g',
    memberPermissions: allow,
    user: { id: 'mod', tag: 'mod#0001', toString: () => '<@mod>' },
    message: { embeds: [s.log.posted[0].embeds[0].toJSON()] },
    deferUpdate: async () => {},
    editReply: async (m) => replies.push(m),
    reply: async (m) => replies.push(m),
  };
  await s.interactions.handle(interaction);

  assert.equal(s.log.webhookPosts.length, 1);
  assert.equal(s.log.webhookPosts[0].username, 'newbie');
  assert.deepEqual(s.log.webhookPosts[0].allowedMentions, { parse: [] });
  assert.equal(s.db.getVerdict('g', 'link', 'myproject.example').verdict, 'allow');
  assert.equal(s.db.getVerdict('g', 'link', 'myproject.example').source, 'mod');
  assert.match(replies[0].embeds[0].data.fields.at(-1).value, /Reposted/);

  // A second mod pressing the button gets told it's done
  await s.interactions.handle({ ...interaction, reply: async (m) => replies.push(m) });
  assert.match(replies.at(-1).content, /already handled/);
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
