// Background chores: privacy housekeeping, the uptime heartbeat, and the welcome message when
// Croak joins a server (plus forgetting a server when it's removed).

import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { config } from './config.js';
import { welcomeButtons, welcomeEmbed } from './embeds.js';

const HOUR = 60 * 60 * 1000;

/**
 * Hourly: wipe message text from cases older than 30 days, drop old stats and expired verdicts.
 * Every minute, if HEARTBEAT_URL is set: ping it, so an uptime monitor notices if Croak stops.
 */
export function startJobs({ db, log = console.log, heartbeatUrl = process.env.HEARTBEAT_URL }) {
  const timers = [];

  const housekeeping = () => {
    try {
      const { wiped, expired } = db.housekeeping({ contentDays: config.caseContentDays });
      if (wiped || expired) log(`Housekeeping: wiped text from ${wiped} old case(s), removed ${expired} expired verdict(s)`);
    } catch (err) {
      log('Housekeeping failed:', err.message);
    }
  };
  housekeeping();
  timers.push(setInterval(housekeeping, HOUR));

  if (heartbeatUrl) {
    const beat = () => fetch(heartbeatUrl, { signal: AbortSignal.timeout(10_000) }).catch(() => {});
    beat();
    timers.push(setInterval(beat, 60_000));
  }

  for (const t of timers) t.unref();
  return () => timers.forEach(clearInterval);
}

/** The first channel Croak can post a welcome in: the server's system channel if possible. */
export function welcomeChannel(guild) {
  const me = guild.members.me;
  const canPost = (c) => c?.type === ChannelType.GuildText && c.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks]);
  if (canPost(guild.systemChannel)) return guild.systemChannel;
  return [...guild.channels.cache.values()].filter(canPost).sort((a, b) => a.rawPosition - b.rawPosition)[0] ?? null;
}

export async function welcome(guild, log = console.log) {
  const channel = welcomeChannel(guild);
  if (!channel) return log(`Joined ${guild.name}, but there's no channel Croak can post a welcome in`);
  await channel.send({ embeds: [welcomeEmbed()], components: welcomeButtons() }).catch((err) => log(`Welcome failed in ${guild.name}: ${err.message}`));
}
