// Lockdown for raids: slowmode on every text channel and server invites paused, for a set time.
// Everything Croak changes is remembered and put back exactly as it was when the lockdown ends,
// including after a restart.

import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { COLORS } from './embeds.js';

const P = PermissionFlagsBits;
const MAX_TIMER_MS = 2 ** 31 - 1;

export function lockdownEmbed({ on, by, endsAt, notes = [] }) {
  return new EmbedBuilder()
    .setColor(on ? COLORS.croaked : COLORS.approved)
    .setTitle(on ? 'Lockdown on' : 'Lockdown over')
    .setDescription(
      [
        on ? `Started by ${by}. Ends <t:${Math.floor(endsAt / 1000)}:R>, or press End lockdown.` : `Ended${by ? ` by ${by}` : ''}. Everything Croak changed is back to how it was.`,
        ...notes,
      ].join('\n'),
    )
    .setTimestamp();
}

export function lockdownButtons() {
  return [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('croak:unlock').setLabel('End lockdown').setStyle(ButtonStyle.Success))];
}

export function createLockdown({ client, db, kit, log = console.log }) {
  const timers = new Map();

  function schedule(guildId, endsAt) {
    clearTimeout(timers.get(guildId));
    const timer = setTimeout(() => {
      const guild = client.guilds.cache.get(guildId);
      if (guild) end(guild, null).catch((err) => log(`Could not end lockdown in ${guild.name}: ${err.message}`));
    }, Math.min(MAX_TIMER_MS, Math.max(0, endsAt - Date.now())));
    timer.unref?.();
    timers.set(guildId, timer);
  }

  /**
   * Slow every text channel down and pause invites. Returns a summary. If a lockdown is already
   * on, it's extended instead.
   */
  async function start(guild, { minutes = 30, slowmode = 30, by }) {
    const endsAt = Date.now() + minutes * 60_000;
    const existing = db.getLockdown(guild.id);
    if (existing) {
      db.putLockdown(guild.id, { ...existing, startedAt: existing.started_at, endsAt, by: existing.by, state: existing.state });
      schedule(guild.id, endsAt);
      return { summary: `Lockdown extended: it now ends <t:${Math.floor(endsAt / 1000)}:R>.`, endsAt };
    }

    const me = guild.members.me;
    const state = { slowmodes: {}, invitesPaused: false };
    const notes = [];
    let slowed = 0;
    for (const channel of guild.channels.cache.values()) {
      if (channel.type !== ChannelType.GuildText) continue;
      if (!channel.permissionsFor(me)?.has([P.ViewChannel, P.ManageChannels])) continue;
      if ((channel.rateLimitPerUser ?? 0) >= slowmode) continue;
      try {
        state.slowmodes[channel.id] = channel.rateLimitPerUser ?? 0;
        await channel.setRateLimitPerUser(slowmode, `Croak lockdown by ${by?.tag ?? 'Croak'}`);
        slowed += 1;
      } catch {
        delete state.slowmodes[channel.id];
      }
    }
    if (me.permissions.has(P.ManageGuild) && !guild.features.includes('INVITES_DISABLED')) {
      try {
        await guild.disableInvites(true);
        state.invitesPaused = true;
      } catch (err) {
        notes.push(`Couldn't pause invites: ${err.message}.`);
      }
    } else if (!me.permissions.has(P.ManageGuild)) {
      notes.push('Invites not paused: Croak needs Manage Server for that.');
    }
    if (!slowed && !me.permissions.has(P.ManageChannels)) notes.push('No slowmode: Croak needs Manage Channels for that.');

    db.putLockdown(guild.id, { endsAt, by: by?.id ?? null, state });
    schedule(guild.id, endsAt);
    const summary = [`🔒 ${slowed} channel${slowed === 1 ? '' : 's'} on ${slowmode}s slowmode${state.invitesPaused ? ', invites paused' : ''}.`, ...notes].join(' ');
    log(`${guild.name}: lockdown on (${summary})`);
    await kit.logChannelFor(guild.id)?.send({ embeds: [lockdownEmbed({ on: true, by: by ?? 'Croak', endsAt, notes: [summary] })], components: lockdownButtons() }).catch(() => {});
    return { summary, endsAt };
  }

  /** Undo a lockdown: each channel's slowmode back to what it was, invites back on if Croak paused them. */
  async function end(guild, by) {
    const lockdown = db.getLockdown(guild.id);
    clearTimeout(timers.get(guild.id));
    timers.delete(guild.id);
    if (!lockdown) return 'There is no lockdown on.';
    for (const [channelId, previous] of Object.entries(lockdown.state.slowmodes ?? {})) {
      await guild.channels.cache.get(channelId)?.setRateLimitPerUser(previous, 'Croak lockdown over').catch(() => {});
    }
    if (lockdown.state.invitesPaused) await guild.disableInvites(false).catch(() => {});
    db.clearLockdown(guild.id);
    log(`${guild.name}: lockdown over`);
    await kit.logChannelFor(guild.id)?.send({ embeds: [lockdownEmbed({ on: false, by })] }).catch(() => {});
    return 'Lockdown over: slowmode and invites are back to how they were.';
  }

  /** After a restart: end lockdowns that ran out, and re-arm the rest. */
  function resume() {
    for (const lockdown of db.allLockdowns()) {
      const guild = client.guilds.cache.get(lockdown.guild_id);
      if (!guild) continue;
      if ((lockdown.ends_at ?? 0) <= Date.now()) end(guild, null).catch(() => {});
      else schedule(guild.id, lockdown.ends_at);
    }
  }

  return { start, end, resume, isOn: (guildId) => Boolean(db.getLockdown(guildId)) };
}
