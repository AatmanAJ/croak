// Croak: starts the Discord client and wires its events to the moderator, the /croak command and
// the buttons.
//
//   npm start
//
// Needs DISCORD_TOKEN and OPENAI_API_KEY in .env. Set DEV_GUILD_ID to a test server's ID to
// register /croak there instantly instead of globally.

import './env.js';
import { Client, Events, GatewayIntentBits, GuildNSFWLevel, MessageFlags, Options, PermissionFlagsBits, PermissionsBitField } from 'discord.js';
import { decide } from './ai/decisions.js';
import { MODERATION_QUESTIONS } from './ai/questions.js';
import { createAutomodSync } from './automod.js';
import { createCommands, croakCommand } from './commands.js';
import { config } from './config.js';
import { openDb } from './db.js';
import { createInteractions } from './interactions.js';
import { startJobs, welcome } from './jobs.js';
import { createJudge } from './judge.js';
import { createModerator } from './moderate.js';
import { createRepeatTracker } from './repeats.js';
import { createRaidDetector, createRecentMessages } from './trackers.js';

const P = PermissionFlagsBits;
// What Croak needs to do its job, and the extras that unlock optional features
const CORE_PERMISSIONS = [P.ViewChannel, P.SendMessages, P.EmbedLinks, P.ReadMessageHistory, P.ManageMessages, P.ModerateMembers, P.ManageWebhooks];
const FULL_PERMISSIONS = [...CORE_PERMISSIONS, P.ManageGuild, P.ManageChannels, P.ManageRoles, P.KickMembers, P.BanMembers];
const INVITE_CACHE_MS = 10 * 60 * 1000;

for (const name of ['DISCORD_TOKEN', 'OPENAI_API_KEY']) {
  if (!process.env[name]) {
    console.error(`${name} is missing. Add it to the .env file in this folder.`);
    process.exit(1);
  }
}

const log = (...args) => console.log(new Date().toISOString(), ...args);

const client = new Client({
  // MessageContent is a privileged intent: it must be switched on in the Developer Portal
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  // Keep memory small: Croak only needs recent messages (for edits) and its own member object
  makeCache: Options.cacheWithLimits({
    ...Options.DefaultMakeCacheSettings,
    MessageManager: 25,
    GuildMemberManager: { maxSize: 100, keepOverLimit: (m) => m.id === m.client.user.id },
  }),
  sweepers: { ...Options.DefaultSweeperSettings, messages: { interval: 600, lifetime: 1800 } },
});

// Invite lookups are cached briefly so a raid posting one invite 50 times makes one API call
const inviteCache = new Map();
function resolveInvite(code) {
  const key = code.toLowerCase();
  const hit = inviteCache.get(key);
  if (hit && hit.expires > Date.now()) return hit.promise;
  const promise = client
    .fetchInvite(code)
    .then((invite) => ({
      guildId: invite.guild?.id ?? null,
      name: invite.guild?.name,
      description: invite.guild?.description,
      nsfwLevel: invite.guild ? GuildNSFWLevel[invite.guild.nsfwLevel] : undefined,
      memberCount: invite.memberCount,
    }))
    .catch((err) => {
      if (err.code === 10006) return null; // Unknown Invite: expired or never existed
      inviteCache.delete(key);
      throw err;
    });
  inviteCache.set(key, { promise, expires: Date.now() + INVITE_CACHE_MS });
  if (inviteCache.size > 5000) inviteCache.clear();
  return promise;
}

const db = openDb();
const judge = createJudge({ db, resolveInvite });
const repeats = createRepeatTracker(config.repeat);
const recent = createRecentMessages();
const raids = createRaidDetector(config.raid);
const automod = createAutomodSync({ client, db, log });
const moderator = createModerator({ db, judge, repeats, recent, raids, automod, log });
const commands = createCommands({ db, judge, resolveInvite, automod });
const interactions = createInteractions({ client, db, automod, log });
const stopJobs = startJobs({ db, log });
setInterval(() => {
  repeats.sweep();
  recent.sweep();
}, 60_000).unref();

client.once(Events.ClientReady, async (c) => {
  // One tiny AI call now, so the first real message doesn't wait for the connection to open.
  // It also shows straight away if the OpenAI key is wrong.
  decide({ input: 'Hello everyone!', questions: [MODERATION_QUESTIONS[0]] })
    .then(() => log('OpenAI Decisions API reachable'))
    .catch((err) => log('OpenAI Decisions API check failed:', err.message));

  const invite = (perms) =>
    `https://discord.com/oauth2/authorize?client_id=${c.application.id}&scope=bot+applications.commands&permissions=${PermissionsBitField.resolve(perms)}`;
  log(`Logged in as ${c.user.tag}, in ${c.guilds.cache.size} server(s): ${c.guilds.cache.map((g) => `${g.name} (${g.id})`).join(', ')}`);
  log(`Invite link: ${invite(CORE_PERMISSIONS)}`);
  log(`Invite link with every optional feature: ${invite(FULL_PERMISSIONS)}`);
  try {
    const devGuild = process.env.DEV_GUILD_ID && c.guilds.cache.get(process.env.DEV_GUILD_ID);
    if (devGuild) {
      // Server commands show up instantly. Clear the global copy so /croak isn't listed twice.
      await devGuild.commands.set([croakCommand]);
      await c.application.commands.set([]);
      log(`Registered /croak in ${devGuild.name} (dev mode)`);
    } else {
      await c.application.commands.set([croakCommand]);
      log('Registered /croak globally');
    }
  } catch (err) {
    log('Could not register /croak:', err.message);
  }
});

client.on(Events.MessageCreate, (message) => {
  moderator.handleMessage(message).catch((err) => log('Error handling message:', err));
});

client.on(Events.MessageUpdate, (before, after) => {
  if (after.partial) return;
  // Scammers sometimes post something harmless, then edit the link in
  if (before.partial || before.content !== after.content) {
    moderator.handleMessage(after).catch((err) => log('Error handling edit:', err));
    return;
  }
  // Link previews load a moment after the message: check their images when they arrive
  if ((after.embeds?.length ?? 0) > (before.embeds?.length ?? 0)) {
    moderator.handleMessage(after, { embedsOnly: true }).catch((err) => log('Error checking link previews:', err));
  }
});

client.on(Events.InteractionCreate, (interaction) => {
  const run = async () => {
    if (interaction.isChatInputCommand() && interaction.commandName === 'croak') return commands.handle(interaction);
    if ((interaction.isButton() || interaction.isModalSubmit()) && interaction.customId.startsWith('croak:')) {
      return interactions.handle(interaction);
    }
  };
  run().catch((err) => {
    log('Error handling interaction:', err);
    const reply = { content: 'Something went wrong. Try again in a moment.', flags: MessageFlags.Ephemeral };
    (interaction.deferred || interaction.replied ? interaction.followUp(reply) : interaction.reply(reply)).catch(() => {});
  });
});

client.on(Events.GuildCreate, (guild) => {
  log(`Joined ${guild.name} (${guild.id})`);
  welcome(guild, log);
});

// Only fires when Croak is removed (an outage fires GuildUnavailable instead): forget the server
client.on(Events.GuildDelete, (guild) => {
  log(`Removed from ${guild.name ?? guild.id}; deleting its data`);
  try {
    db.forgetGuild(guild.id);
  } catch (err) {
    log('Could not delete server data:', err.message);
  }
});

client.on(Events.Error, (err) => log('Discord client error:', err));
process.on('unhandledRejection', (err) => log('Unhandled rejection:', err));

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    log(`${signal} received, shutting down`);
    stopJobs();
    automod.stop();
    await automod.flush().catch(() => {});
    await client.destroy();
    db.close();
    process.exit(0);
  });
}

try {
  await client.login(process.env.DISCORD_TOKEN);
} catch (err) {
  const hints = {
    'Used disallowed intents':
      'Turn on Message Content Intent in the Discord Developer Portal (Bot tab), click Save Changes, then start Croak again.',
    TokenInvalid: 'Discord rejected DISCORD_TOKEN. Reset the token in the Developer Portal (Bot tab) and paste the new one into .env.',
  };
  console.error(hints[err.message] ?? hints[err.code] ?? `Could not log in to Discord: ${err.message}`);
  db.close();
  process.exit(1);
}
