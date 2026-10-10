// What happens to the person: timeout or quarantine role, the escalation ladder for repeat
// offenders, cleanup of their other recent posts, and undoing it all when a mod says "Not spam".
// Every step checks Croak's permissions first and reports what it couldn't do, never throws.

import { PermissionFlagsBits } from 'discord.js';
import { whyNot } from './health.js';
import { ESCALATIONS } from './settings.js';

const LONG_TIMEOUT_MINUTES = 24 * 60;
const FOURTEEN_DAYS = 14 * 24 * 60 * 60 * 1000;

/** Which step of the ladder this croak is: the first, second, third... (strikes includes this one). */
export function stepFor(escalation, strikes) {
  const steps = (ESCALATIONS[escalation] ?? ESCALATIONS.off).steps;
  return steps[Math.min(Math.max(strikes, 1), steps.length) - 1];
}

/**
 * Apply the server's punishment for a croak. Returns a short note for the mod log.
 * @param {import('discord.js').GuildMember} member
 */
export async function punish(member, { settings, strikes, reason }) {
  if (!member) return '';
  const step = stepFor(settings.escalation, strikes);
  const tag = `Croak: ${reason}`;
  const me = member.guild.members.me;

  if (step === 'kick') {
    if (!member.kickable) return `Could not kick them. ${whyNot(member, 'kick')}`;
    return member
      .kick(tag)
      .then(() => `Kicked (croak #${strikes} in 30 days).`)
      .catch((err) => `Kick failed: ${err.message}.`);
  }
  if (step === 'ban') {
    if (!member.bannable) return `Could not ban them. ${whyNot(member, 'ban')}`;
    return member
      .ban({ reason: tag, deleteMessageSeconds: 3600 })
      .then(() => `Banned (croak #${strikes} in 30 days). Their last hour of messages was deleted.`)
      .catch((err) => `Ban failed: ${err.message}.`);
  }

  const minutes = step === 'long-timeout' ? LONG_TIMEOUT_MINUTES : settings.timeoutMinutes;
  if (minutes <= 0) return '';

  if (settings.quarantineRoleId) {
    const role = member.guild.roles.cache.get(settings.quarantineRoleId);
    if (!role) return 'Could not quarantine them: the quarantine role no longer exists.';
    if (!me.permissions.has(PermissionFlagsBits.ManageRoles) || role.position >= me.roles.highest.position) {
      return `Could not give ${role}: Croak needs Manage Roles and its role above ${role}.`;
    }
    return member.roles
      .add(role, tag)
      .then(() => `Given ${role}.`)
      .catch((err) => `Quarantine failed: ${err.message}.`);
  }

  if (!member.moderatable) return `Could not time them out. ${whyNot(member, 'timeout')}`;
  return member
    .timeout(minutes * 60_000, tag)
    .then(() => `Timed out for ${formatMinutes(minutes)}${strikes > 1 ? ` (croak #${strikes} in 30 days)` : ''}.`)
    .catch((err) => `Timeout failed: ${err.message}.`);
}

/** Undo a timeout or quarantine after a mod approves. */
export async function pardon(member, { settings, by }) {
  if (!member) return;
  const tag = `Croak: approved by ${by}`;
  if (settings.quarantineRoleId && member.roles.cache.has(settings.quarantineRoleId)) {
    await member.roles.remove(settings.quarantineRoleId, tag).catch(() => {});
  }
  if (member.isCommunicationDisabled() && member.moderatable) await member.timeout(null, tag).catch(() => {});
}

/**
 * Delete someone's other recent messages across the server (a hacked account rarely posts once).
 * Uses one bulk delete per channel where it can. Returns how many were removed.
 */
export async function cleanUp(guild, messages) {
  const me = guild.members.me;
  const byChannel = new Map();
  for (const m of messages) {
    if (!byChannel.has(m.channelId)) byChannel.set(m.channelId, []);
    byChannel.get(m.channelId).push(m);
  }
  let removed = 0;
  for (const [channelId, list] of byChannel) {
    const channel = guild.channels.cache.get(channelId);
    if (!channel?.permissionsFor(me)?.has(PermissionFlagsBits.ManageMessages)) continue;
    const ids = list.filter((m) => Date.now() - m.at < FOURTEEN_DAYS).map((m) => m.messageId);
    try {
      if (ids.length >= 2) {
        const deleted = await channel.bulkDelete(ids, true);
        removed += deleted.size;
      } else if (ids.length === 1) {
        await channel.messages.delete(ids[0]);
        removed += 1;
      }
    } catch {
      // already gone, or the channel changed; nothing to report
    }
  }
  return removed;
}

export function formatMinutes(minutes) {
  if (minutes % (24 * 60) === 0) return `${minutes / (24 * 60)} day${minutes === 1440 ? '' : 's'}`;
  if (minutes % 60 === 0) return `${minutes / 60} hour${minutes === 60 ? '' : 's'}`;
  return `${minutes} min`;
}
