// A fake Discord server for tests: a #general, a #random, a #mod-log, a bot member, recorders for
// every side effect, and helpers to press buttons and submit forms as a mod or a member.
// The AI is a fake that returns fixed scores.

import { ChannelType, Collection } from 'discord.js';
import { openDb } from '../src/db.js';
import { createInteractions } from '../src/interactions.js';
import { createJudge } from '../src/judge.js';
import { createLockdown } from '../src/lockdown.js';
import { createModerator } from '../src/moderate.js';
import { createRepeatTracker } from '../src/repeats.js';
import { createToolkit } from '../src/toolkit.js';
import { createRaidDetector, createRecentMessages } from '../src/trackers.js';

export const DAY = 24 * 60 * 60 * 1000;
export const allow = { has: () => true };
export const deny = { has: () => false };

export function fakeServer({ scores = { scam: 0.99, nsfw: 0, spam: 0.4 }, settings = {} } = {}) {
  const log = {
    deleted: [],
    timeouts: [],
    dms: [],
    posted: [],
    edits: [],
    kicked: [],
    banned: [],
    webhookPosts: [],
    slowmodes: [],
    invites: [],
  };
  const db = openDb(':memory:');
  db.updateSettings('g', { logChannelId: 'log', ...settings });

  const channel = (id, name) => {
    const live = new Map(); // messages that exist in this channel
    const c = {
      id,
      name,
      type: ChannelType.GuildText,
      nsfw: false,
      parentId: null,
      rateLimitPerUser: 0,
      live,
      isThread: () => false,
      toString: () => `<#${id}>`,
      permissionsFor: () => allow,
      setRateLimitPerUser: async (seconds) => {
        c.rateLimitPerUser = seconds;
        log.slowmodes.push([id, seconds]);
      },
      messages: {
        delete: async (mid) => {
          live.delete(mid);
          log.deleted.push(mid);
        },
        fetch: async (mid) => {
          if (!live.has(mid)) throw new Error('Unknown Message');
          return live.get(mid);
        },
      },
      bulkDelete: async (ids) => {
        for (const i of ids) live.delete(i);
        log.deleted.push(...ids);
        return new Map(ids.map((i) => [i, {}]));
      },
      fetchWebhooks: async () => new Collection(),
      createWebhook: async () => ({ send: async (m) => log.webhookPosts.push(m) }),
      send: async (m) => {
        log.posted.push(m);
        const sent = {
          id: `logmsg${log.posted.length}`,
          channelId: id,
          embeds: (m.embeds ?? []).map((e) => e.toJSON?.() ?? e),
          components: [],
          edit: async (update) => {
            log.edits.push(update);
            if (update.embeds) sent.embeds = update.embeds.map((e) => e.toJSON?.() ?? e);
          },
        };
        live.set(sent.id, sent);
        return sent;
      },
    };
    return c;
  };
  const general = channel('c1', 'general');
  const random = channel('c2', 'random');
  const modLog = channel('log', 'mod-log');
  const me = { id: 'bot', permissions: allow, roles: { highest: { position: 10 } } };
  const members = new Map();
  const guild = {
    id: 'g',
    name: 'Test Server',
    ownerId: 'owner',
    features: [],
    members: {
      me,
      fetch: async (id) => {
        if (!members.has(id)) throw new Error('Unknown Member');
        return members.get(id);
      },
      ban: async (id) => log.banned.push(id),
    },
    channels: { cache: new Map([['c1', general], ['c2', random], ['log', modLog]]) },
    roles: { cache: new Map() },
    disableInvites: async (off) => log.invites.push(off ? 'paused' : 'resumed'),
  };
  const users = new Map();
  const client = {
    guilds: { cache: new Map([['g', guild]]) },
    users: { fetch: async (id) => users.get(id) ?? { id, send: async (m) => log.dms.push(m) } },
  };
  guild.client = client;

  function member(id, { newAccount = false, mod = false, roles = [] } = {}) {
    const user = {
      id,
      tag: `${id}#0001`,
      createdTimestamp: Date.now() - (newAccount ? 1 : 400) * DAY,
      toString: () => `<@${id}>`,
      displayAvatarURL: () => 'https://cdn.discordapp.com/avatar.png',
      send: async (m) => log.dms.push(m),
    };
    users.set(id, user);
    const m = {
      id,
      guild,
      user,
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
  function message(author, content, { channelId = 'c1' } = {}) {
    n += 1;
    const id = `m${n}`;
    const where = guild.channels.cache.get(channelId);
    const msg = {
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
      channel: where,
      channelId,
      content,
      attachments: new Map(),
      embeds: [],
      messageSnapshots: new Map(),
      mentions: { everyone: false },
      delete: async () => {
        where.live.delete(id);
        log.deleted.push(id);
      },
    };
    where.live.set(id, msg);
    return msg;
  }

  const decide = async () => ({
    answers: Object.fromEntries(Object.entries(scores).map(([name, probability]) => [name, { type: 'predicate', name, probability }])),
  });
  const judge = createJudge({ db, decide, expand: async (h) => h, resolveInvite: async () => null });
  const raids = createRaidDetector({ croaks: 3, windowMs: 60_000, lockMs: 60_000 });
  const recent = createRecentMessages();
  const quiet = () => {};
  const moderator = createModerator({ db, judge, repeats: createRepeatTracker({ channels: 3, windowMs: 60_000 }), recent, raids, automod: null, log: quiet });
  const kit = createToolkit({ client, db, automod: null, log: quiet });
  const lockdown = createLockdown({ client, db, kit, log: quiet });
  const interactions = createInteractions({ client, db, automod: null, kit, judge, moderator, recent, raids, lockdown, log: quiet });

  /**
   * Press a button, pick from a menu or submit a form, as `by` (a member). Returns everything
   * Croak replied with: { replies, updates, modals }.
   */
  async function press(customId, { by = member('mod', { mod: true }), values, text, message: on, perms = allow, inGuild = true, channelId = 'log' } = {}) {
    const out = { replies: [], updates: [], modals: [] };
    const interaction = {
      customId,
      values,
      inGuild: () => inGuild,
      guildId: inGuild ? 'g' : null,
      guild: inGuild ? guild : null,
      channel: guild.channels.cache.get(channelId),
      memberPermissions: inGuild ? perms : null,
      user: by.user,
      message: on ?? { id: 'logmsg1', embeds: [log.posted[0]?.embeds?.[0]?.toJSON?.() ?? {}], components: [] },
      fields: { getTextInputValue: () => text ?? '' },
      deferred: false,
      replied: false,
      reply: async (m) => out.replies.push(m),
      update: async (m) => out.updates.push(m),
      deferUpdate: async () => {},
      deferReply: async () => {},
      editReply: async (m) => out.replies.push(m),
      followUp: async (m) => out.replies.push(m),
      showModal: async (m) => out.modals.push(m),
    };
    await interactions.handle(interaction);
    return out;
  }

  return { db, guild, client, member, message, moderator, interactions, kit, lockdown, log, raids, recent, press, judge };
}
