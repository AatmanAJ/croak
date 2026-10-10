// Why Croak can or can't do something in a server, in plain words, with the fix. Used by every
// action that can fail on permissions, by /croak setup and /croak status, and by the watcher
// that posts a "Croak needs a fix" card in the mod log as soon as something breaks.

import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, PermissionFlagsBits as P, PermissionsBitField } from 'discord.js';

const DOCS_URL = 'https://croakbot.base44.app/docs#permissions';

/** Every permission a Croak feature uses: [flag, name as Discord shows it, what it's for]. */
export const PERMISSIONS = [
  [P.ViewChannel, 'View Channels', 'see messages'],
  [P.SendMessages, 'Send Messages', 'post in the mod log'],
  [P.EmbedLinks, 'Embed Links', 'post case cards'],
  [P.ReadMessageHistory, 'Read Message History', "clean up a hacked account's recent messages"],
  [P.ManageMessages, 'Manage Messages', 'delete spam'],
  [P.ModerateMembers, 'Timeout Members', 'time people out'],
  [P.ManageWebhooks, 'Manage Webhooks', 'repost messages the mods approve'],
  [P.ManageChannels, 'Manage Channels', 'slowmode during a lockdown'],
  [P.ManageGuild, 'Manage Server', 'pause invites in a lockdown and sync AutoMod'],
  [P.KickMembers, 'Kick Members', 'kick from a case'],
  [P.BanMembers, 'Ban Members', 'ban from a case'],
  [P.ManageRoles, 'Manage Roles', 'give a quarantine role'],
];

export const ALL_PERMISSIONS = PERMISSIONS.map(([flag]) => flag);

const nameOf = (flag) => PERMISSIONS.find(([f]) => f === flag)?.[1] ?? 'that permission';

/** The invite link with every permission. Opened for a server Croak is already in, it updates Croak's permissions there. */
export function inviteUrl(appId, guildId) {
  const perms = PermissionsBitField.resolve(ALL_PERMISSIONS);
  const target = guildId ? `&guild_id=${guildId}&disable_guild_select=true` : '';
  return `https://discord.com/oauth2/authorize?client_id=${appId}&scope=bot+applications.commands&permissions=${perms}${target}`;
}

/** Buttons that fix it: re-authorize with every permission, and the guide. */
export function fixRow(guild) {
  const appId = guild.client?.application?.id ?? guild.client?.user?.id;
  const row = new ActionRowBuilder();
  if (appId) row.addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Fix permissions').setURL(inviteUrl(appId, guild.id)));
  row.addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('How to fix it').setURL(DOCS_URL));
  return row;
}

/** True if role a sits above role b in the server's role list. */
function above(guild, a, b) {
  if (!a || !b) return false;
  if (typeof guild.roles?.comparePositions === 'function') return guild.roles.comparePositions(a, b) > 0;
  return a.position > b.position;
}

/** Croak's own role: the one Discord made for it, or else its highest. */
const ownRole = (me) => me.roles?.botRole ?? me.roles?.highest;

/**
 * What's stopping Croak in this server: missing permissions, member roles that sit above
 * Croak's (so it can't act on anyone holding them), and a mod log it can't post in.
 */
export function diagnose(guild, settings = {}) {
  const me = guild.members.me;
  const missing = PERMISSIONS.filter(([flag]) => !me.permissions.has(flag)).map(([flag, name, use]) => ({ flag, name, use }));
  const top = me.roles?.highest;
  // mod roles and other bots' roles don't matter: Croak never acts on mods
  const blockedBy = [...(guild.roles?.cache?.values() ?? [])]
    .filter((r) => r.id !== guild.id && !r.managed && !r.permissions?.has(P.ManageMessages) && above(guild, r, top))
    .sort((a, b) => b.position - a.position);
  let log = null;
  if (settings.logChannelId) {
    const channel = guild.channels.cache.get(settings.logChannelId);
    const lacking = [
      [P.ViewChannel, 'View Channel'],
      [P.SendMessages, 'Send Messages'],
      [P.EmbedLinks, 'Embed Links'],
    ].filter(([flag]) => !channel?.permissionsFor(me)?.has(flag));
    if (!channel) log = 'The mod log channel was deleted. Run `/croak setup` with a new one.';
    else if (lacking.length) log = `Croak can't post in ${channel}: it's missing ${lacking.map(([, n]) => n).join(', ')} there. Open the channel's settings → Permissions, add Croak and allow them.`;
  }
  return { missing, blockedBy, log, ok: !missing.length && !blockedBy.length && !log };
}

/** A short fingerprint of the problems, so the watcher only speaks up when something changes. */
export function signature(d) {
  return [d.missing.map((m) => m.name).join(','), d.blockedBy.map((r) => r.id).join(','), d.log ? 'log' : ''].join('|').replace(/^\|+$/, '');
}

/** Plain-words lines describing the problems, for setup, status and the watcher's card. */
export function problemLines(guild, d) {
  const me = guild.members.me;
  const lines = [];
  if (d.missing.length) {
    lines.push(
      `**Missing permissions:** ${d.missing.map((m) => m.name).join(', ')}. Without them Croak can't ${d.missing.map((m) => m.use).join(', ')}.`,
      'Press **Fix permissions**, pick this server and press Authorize. Croak stays in the server; this only updates what it may do.',
    );
  }
  if (d.blockedBy.length) {
    const roles = d.blockedBy.slice(0, 6).join(', ') + (d.blockedBy.length > 6 ? ` and ${d.blockedBy.length - 6} more` : '');
    lines.push(
      `**Croak's role is too low.** Discord won't let it time out or ban anyone whose top role is above its own, and ${roles} ${d.blockedBy.length === 1 ? 'is' : 'are'} above it.`,
      `In **Server Settings → Roles**, drag **${ownRole(me) ?? 'Croak'}** up above those roles. Anywhere under your mod roles is fine.`,
    );
  }
  if (d.log) lines.push(`**Mod log:** ${d.log}`);
  return lines;
}

/** Why Croak can't do `action` (timeout, kick or ban) to this member, with the fix. '' if it can. */
export function whyNot(member, action) {
  const guild = member.guild;
  const me = guild.members.me;
  const flag = { timeout: P.ModerateMembers, kick: P.KickMembers, ban: P.BanMembers }[action];
  if (flag && !me.permissions.has(flag)) return `Croak doesn't have the **${nameOf(flag)}** permission here. Press **Fix permissions** to grant it.`;
  if (member.id === guild.ownerId) return "They own the server, and nobody can do that to the owner.";
  if (action === 'timeout' && member.permissions?.has?.(P.Administrator)) return "They're an administrator, and Discord doesn't let anyone time out administrators.";
  const theirs = member.roles?.highest;
  if (theirs && !above(guild, me.roles?.highest, theirs)) {
    return `Their top role, ${theirs}, is above Croak's. In **Server Settings → Roles**, drag **${ownRole(me) ?? 'Croak'}** above ${theirs}.`;
  }
  return `Discord refused. Check that Croak's role is above theirs and that it has ${flag ? nameOf(flag) : 'the permission'}.`;
}

/** Why Croak can't do something that needs one server-wide permission. '' if it can. */
export function lacks(guild, flag) {
  return guild.members.me.permissions.has(flag) ? '' : `Croak doesn't have the **${nameOf(flag)}** permission here. Press **Fix permissions** to grant it.`;
}

/** The card the watcher posts in the mod log when something breaks, or once it's all fixed. */
export function healthEmbed(guild, d) {
  if (d.ok) {
    return new EmbedBuilder()
      .setColor(0xdaf36b)
      .setTitle('Croak is fully set up')
      .setDescription('Every permission is in place and Croak\'s role is above your member roles, so every feature works.');
  }
  return new EmbedBuilder()
    .setColor(0xf2b13b)
    .setTitle('Croak needs a fix in this server')
    .setDescription(problemLines(guild, d).join('\n\n'))
    .setFooter({ text: 'Croak checks again by itself when roles change. /croak status shows this any time.' });
}

/**
 * Watches every server Croak is in. When its permissions or role position change, it checks
 * again and posts in the mod log if something new broke (or once everything is fixed).
 */
export function createHealthWatch({ client, db, kit, log = console.log }) {
  const timers = new Map();

  async function check(guild) {
    if (!guild?.members?.me) return;
    const settings = db.getSettings(guild.id);
    const d = diagnose(guild, settings);
    const sig = d.ok ? '' : signature(d);
    const last = settings.healthSig ?? '';
    if (sig === last) return;
    if (!d.ok) log(`${guild.name}: Croak needs a fix (${sig})`);
    // Fine from the start: nothing to announce
    if (d.ok && !last) return;
    const channel = kit.logChannelFor(guild.id);
    const canPost = channel?.type === ChannelType.GuildText && channel.permissionsFor(guild.members.me)?.has([P.ViewChannel, P.SendMessages, P.EmbedLinks]);
    // No mod log yet: say nothing and remember nothing, so the card goes out once there is one
    if (!canPost) return;
    await channel.send({ embeds: [healthEmbed(guild, d)], components: d.ok ? [] : [fixRow(guild)], allowedMentions: { parse: [] } });
    db.updateSettings(guild.id, { healthSig: sig });
  }

  return {
    /** Check a server a few seconds from now (role edits arrive in bursts). */
    schedule(guild, delay = 4000) {
      if (!guild) return;
      clearTimeout(timers.get(guild.id));
      const timer = setTimeout(() => {
        timers.delete(guild.id);
        check(guild).catch((err) => log(`Health check failed in ${guild.name}: ${err.message}`));
      }, delay);
      timer.unref?.();
      timers.set(guild.id, timer);
    },
    check,
  };
}
