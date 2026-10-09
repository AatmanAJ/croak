// The message pipeline: who's checked, what's checked, and what happens. Free checks run first
// (exemptions, repeats across channels), then each link, invite and image is judged, then the
// server's settings decide between delete, hold, flag or nothing.

import { PermissionFlagsBits } from 'discord.js';
import { collectMessage, isNsfwChannel, triedEveryonePing } from './collect.js';
import { config } from './config.js';
import { caseButtons, caseEmbed, memberNotice, raidButtons, raidEmbed } from './embeds.js';
import { extractItems } from './extract.js';
import { worse } from './judge.js';
import { saveModDecision } from './overrides.js';
import { cleanUp, punish } from './punish.js';
import { fingerprint } from './repeats.js';
import { policyFor } from './settings.js';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const SEVERITY = { block: 3, review: 2, unknown: 1, allow: 0 };
const MAX_ITEMS = 10;

/**
 * delete: a check scored at or above the server's croak threshold, or a borderline one from
 *         someone who also tried to ping @everyone without permission
 * hold:   borderline from a new member, so remove it until a mod decides. During a raid, or when
 *         the AI is down, new members' links and images are held too.
 * flag:   borderline from an established member, so leave it up and tell the mods
 * allow:  nothing to do
 */
export function decideAction(results, { isNew, everyone = false, raid = false, watched = false }) {
  const worst = results.reduce((w, r) => worse(w, r.verdict), 'allow');
  if (worst === 'block') return 'delete';
  if (worst === 'review') return everyone ? 'delete' : isNew || watched ? 'hold' : 'flag';
  if (watched) return 'hold'; // a mod asked to see everything this member posts
  if (isNew && (raid || everyone || worst === 'unknown')) return 'hold';
  return 'allow';
}

export function isNewMember(member, now = Date.now()) {
  const accountAge = now - member.user.createdTimestamp;
  const memberAge = member.joinedTimestamp ? now - member.joinedTimestamp : Infinity;
  return accountAge < config.newAccountDays * DAY || memberAge < config.newMemberHours * HOUR;
}

/** The most severe result, which names the case. */
export function headline(results) {
  return [...results].sort((a, b) => SEVERITY[b.verdict] - SEVERITY[a.verdict])[0];
}

/** Channels and roles a server told Croak to skip. Threads follow their parent channel. */
export function isExempt({ channelId, parentId, roleIds }, settings) {
  if (settings.exemptChannels.includes(channelId) || (parentId && settings.exemptChannels.includes(parentId))) return true;
  return roleIds.some((id) => settings.exemptRoles.includes(id));
}

/** What the case buttons need to know about a message: where it is, and what's in it. */
export function caseContext(message, results) {
  return {
    guildId: message.guildId,
    channelId: message.channelId,
    messageId: message.id,
    hasLinks: results.some((r) => r.item?.kind === 'link' && r.verdict !== 'allow'),
    hasContent: Boolean(message.content),
  };
}

/** What a case remembers about each checked item, enough for a mod's decision to be cached. */
export function caseItem(r) {
  const fallback = r.item.kind === 'link' ? { cacheKind: 'link', cacheKey: r.item.key } : {};
  return {
    kind: r.item.kind,
    label: r.label,
    reason: r.reason,
    verdict: r.verdict,
    scores: r.scores ?? null,
    source: r.source,
    host: r.item.host ?? null,
    cacheKind: r.cacheKind ?? fallback.cacheKind,
    cacheKey: r.cacheKey ?? fallback.cacheKey,
  };
}

export function createModerator({ db, judge, repeats, recent, raids, automod, log = console.log }) {
  const handledRepeats = new Set(); // message IDs already deleted as repeats
  const checkedEmbeds = new Map(); // message ID -> image URLs already checked (previews load after the message)

  /** Link previews arrive in a later edit; only check images not seen before for this message. */
  function freshEmbedImages(messageId, images) {
    const seen = checkedEmbeds.get(messageId) ?? new Set();
    const fresh = images.filter((i) => !seen.has(i.url));
    for (const i of fresh) seen.add(i.url);
    checkedEmbeds.set(messageId, seen);
    if (checkedEmbeds.size > 5000) checkedEmbeds.clear();
    return fresh;
  }

  /**
   * @param {import('discord.js').Message} message
   * @param {{ embedsOnly?: boolean }} [opts] embedsOnly: just the link previews that arrived in an edit
   */
  async function handleMessage(message, { embedsOnly = false } = {}) {
    if (!message.inGuild() || message.author?.bot || message.webhookId || message.system) return;
    const member = message.member;
    if (!member || member.id === message.guild.ownerId) return;
    if (member.permissions.has(PermissionFlagsBits.ManageMessages)) return; // mods and admins are trusted

    const settings = db.getSettings(message.guildId);
    const where = { channelId: message.channelId, parentId: message.channel?.parentId, roleIds: [...member.roles.cache.keys()] };
    if (isExempt(where, settings)) return;
    const flags = db.memberFlags(message.guildId, member.id);
    if (flags.trusted) return; // a mod said this member is never checked

    const collected = collectMessage(message);
    const ids = { guildId: message.guildId, userId: member.id, channelId: message.channelId, messageId: message.id };

    if (!embedsOnly) {
      recent.record(ids);
      // Free and instant: the same post in several channels
      const copies = repeats.record({ ...ids, print: fingerprint(collected) });
      if (copies) return croakRepeats(message, copies, collected, settings);
    }

    const { links, invites, images } = embedsOnly ? { links: [], invites: [], images: [] } : extractItems(collected);
    const items = [...invites, ...links, ...images, ...freshEmbedImages(message.id, collected.embedImages)].slice(0, MAX_ITEMS);
    if (items.length === 0) return;

    const isNew = isNewMember(member);
    const everyone = !embedsOnly && triedEveryonePing(message);
    const raid = raids.isActive(message.guildId);
    const policy = policyFor(settings, { nsfwChannel: isNsfwChannel(message.channel) });

    const results = await judge.judgeAll(items, { guildId: message.guildId, text: collected.content, policy });
    const watched = Boolean(flags.watching);
    const action = decideAction(results, { isNew, everyone, raid, watched });

    const signals = [];
    if (watched) signals.push(`on the watchlist until <t:${Math.floor(flags.watching / 1000)}:R>`);
    if (everyone) signals.push('tried to ping @everyone without permission');
    if (collected.forwarded) signals.push('forwarded message');
    if (raid && isNew) signals.push('posted during a raid');
    if (policy.ignore.length) signals.push(`not checked here: ${policy.ignore.join(', ')}`);

    log(
      `${message.guild.name} #${message.channel.name} ${member.user.tag}: ${action} ` +
        `[${results.map((r) => `${r.item.kind} ${r.verdict}/${r.source} ${r.ms}ms${r.aiMs !== undefined ? ` (AI ${r.aiMs}ms)` : ''}${r.kb ? ` ${r.kb}KB` : ''}`).join(', ')}]`,
    );
    for (const r of results) automod?.consider(message.guildId, r);
    // Nothing looked wrong; it's held only because a mod is watching this member
    const watchOnly = watched && results.every((r) => r.verdict === 'allow');
    if (action !== 'allow') await act(message, { action, results, settings, signals, isNew, watchOnly });
  }

  async function act(message, { action, results, settings, signals, isNew, watchOnly = false }) {
    const guild = message.guild;
    const logChannel = settings.logChannelId ? guild.channels.cache.get(settings.logChannelId) : null;
    // Holding or flagging only makes sense if a mod will see it
    if (action !== 'delete' && !logChannel) return;

    const top = headline(results);
    const reason = watchOnly ? 'watched member' : top.reason;
    const notes = [];
    const me = guild.members.me;

    if (action === 'delete' || action === 'hold') {
      // Check first: a refused delete (403) counts towards Discord's invalid-request limit
      if (message.channel.permissionsFor(me)?.has(PermissionFlagsBits.ManageMessages)) {
        await message.delete().catch((err) => notes.push(`Delete failed: ${err.message}.`));
      } else {
        notes.push('Could not delete it: Croak needs Manage Messages in that channel.');
      }
    }

    const caseId = db.addCase({
      guildId: guild.id,
      channelId: message.channelId,
      messageId: message.id,
      authorId: message.author.id,
      action,
      reason,
      content: message.content || null,
      ms: Math.max(0, ...results.map((r) => r.ms ?? 0)),
      items: results.map(caseItem),
    });

    if (action === 'delete') {
      notes.push(...(await afterCroak(message, { settings, reason: top.reason, caseId })));
    }
    if (isNew && action !== 'flag' && raids.record(guild.id, message.author.id)) await announceRaid(guild, settings, logChannel);

    await postCase(logChannel, caseId, {
      embeds: [caseEmbed({ caseId, action, reason, message, results, notes, signals, title: watchOnly ? 'Held for review: watched member' : null })],
      action,
      ctx: caseContext(message, results),
    });
  }

  /** Timeout/escalation, cleanup of their other recent posts, and the DM. Returns notes for the log. */
  async function afterCroak(message, { settings, reason, caseId, alsoDeleted = [] }) {
    const guild = message.guild;
    const notes = [];
    const strikes = db.strikes(guild.id, message.author.id);
    notes.push(await punish(message.member, { settings, strikes, reason }));

    if (settings.cleanupMinutes > 0) {
      const others = recent.since({
        guildId: guild.id,
        userId: message.author.id,
        withinMs: settings.cleanupMinutes * 60_000,
        exclude: [message.id, ...alsoDeleted],
      });
      const removed = await cleanUp(guild, others);
      if (removed) notes.push(`Removed ${removed} of their other recent message${removed === 1 ? '' : 's'}.`);
    }
    recent.forget({ guildId: guild.id, userId: message.author.id });

    if (settings.dmMembers) {
      await message.author
        .send(memberNotice({ guildName: guild.name, channelName: message.channel.name, reason, caseId, note: settings.dmNote }))
        .catch(() => {}); // DMs closed
    }
    return notes;
  }

  async function postCase(logChannel, caseId, { embeds, action, ctx = {} }) {
    if (!logChannel) return;
    try {
      const posted = await logChannel.send({ embeds, components: caseButtons(caseId, action, ctx) });
      db.setCaseLog(caseId, posted.id);
    } catch (err) {
      log(`Could not post case #${caseId}: ${err.message}`);
    }
  }

  async function announceRaid(guild, settings, logChannel) {
    log(`${guild.name}: raid detected`);
    if (!logChannel) return;
    await logChannel
      .send({
        content: settings.alertRoleId ? `<@&${settings.alertRoleId}>` : undefined,
        embeds: [raidEmbed({ count: config.raid.croaks, minutes: Math.round(config.raid.lockMs / 60_000) })],
        components: raidButtons(),
        allowedMentions: { roles: settings.alertRoleId ? [settings.alertRoleId] : [] },
      })
      .catch(() => {});
  }

  async function croakRepeats(message, copies, collected, settings) {
    const fresh = copies.filter((c) => !handledRepeats.has(c.messageId));
    const firstTime = fresh.length === copies.length;
    const me = message.guild.members.me;
    for (const copy of fresh) {
      handledRepeats.add(copy.messageId);
      const channel = message.guild.channels.cache.get(copy.channelId);
      if (channel?.permissionsFor(me)?.has(PermissionFlagsBits.ManageMessages)) {
        await channel.messages.delete(copy.messageId).catch(() => {});
      }
    }
    if (handledRepeats.size > 10_000) handledRepeats.clear();
    if (!firstTime) return; // later copies in the same burst are deleted quietly

    // Block its links in this server for a day, so other accounts in the same raid are caught instantly
    for (const link of extractItems(collected).links) {
      db.putVerdict({ guildId: message.guildId, kind: 'link', key: link.key, verdict: 'block', source: 'rule', ttlMs: config.ttl.review });
    }

    const channels = new Set(copies.map((c) => c.channelId)).size;
    const reason = `same message in ${channels} channels`;
    const results = [{ item: { kind: 'repeat' }, label: collected.content.slice(0, 200) || 'attachments', reason, verdict: 'block', source: 'rule', ms: 0 }];
    log(`${message.guild.name}: repeat spam from ${message.author.tag}, ${copies.length} copies deleted`);

    const caseId = db.addCase({
      guildId: message.guildId,
      channelId: message.channelId,
      messageId: message.id,
      authorId: message.author.id,
      action: 'delete',
      reason,
      content: message.content || null,
      ms: 0,
      items: results.map(caseItem),
    });
    const notes = [`Deleted ${copies.length} copies.`, ...(await afterCroak(message, { settings, reason, caseId, alsoDeleted: copies.map((c) => c.messageId) }))];
    if (isNewMember(message.member) && raids.record(message.guildId, message.author.id)) {
      await announceRaid(message.guild, settings, settings.logChannelId ? message.guild.channels.cache.get(settings.logChannelId) : null);
    }
    const logChannel = settings.logChannelId ? message.guild.channels.cache.get(settings.logChannelId) : null;
    await postCase(logChannel, caseId, {
      embeds: [caseEmbed({ caseId, action: 'delete', reason, message, results, notes })],
      action: 'delete',
      ctx: caseContext(message, []),
    });
  }

  /**
   * A mod croaks a message by hand (right-click → Apps → Croak this message): delete it, block
   * what's in it for this server, apply the usual timeout/cleanup/DM, and post a case.
   * Returns a short summary for the mod.
   */
  async function croakManually(message, { by, reason = '' }) {
    const guild = message.guild;
    const member = message.member ?? (await guild.members.fetch(message.author.id).catch(() => null));
    if (member && (member.id === guild.ownerId || member.permissions.has(PermissionFlagsBits.ManageMessages))) {
      return "Croak doesn't act on the owner or other mods.";
    }
    const settings = db.getSettings(guild.id);
    const collected = collectMessage(message);
    const { links, invites, images } = extractItems(collected);
    const items = [...invites, ...links, ...images, ...collected.embedImages].slice(0, MAX_ITEMS);
    // Judged only to learn each item's cache key; the mod has already decided the verdict
    const judged = items.length ? await judge.judgeAll(items, { guildId: guild.id, text: collected.content }) : [];
    const results = judged.map((r) => ({ ...r, verdict: 'block', reason: r.reason }));
    const why = `croaked by ${by.tag}${reason ? `: ${reason}` : ''}`;

    const notes = [];
    if (message.channel.permissionsFor(guild.members.me)?.has(PermissionFlagsBits.ManageMessages)) {
      await message.delete().catch((err) => notes.push(`Delete failed: ${err.message}.`));
    } else {
      notes.push('Could not delete it: Croak needs Manage Messages in that channel.');
    }
    const caseId = db.addCase({
      guildId: guild.id,
      channelId: message.channelId,
      messageId: message.id,
      authorId: message.author.id,
      action: 'delete',
      reason: why,
      content: message.content || null,
      ms: 0,
      items: results.map(caseItem),
    });
    for (const r of results.filter((r) => r.cacheKind && r.cacheKey)) {
      if (saveModDecision(db, { guildId: guild.id, kind: r.cacheKind, key: r.cacheKey, verdict: 'block', scores: r.scores ?? null })) {
        notes.push(`\`${r.label.slice(0, 60)}\` is now blocked across every Croak server.`);
      }
      if (r.item.kind === 'link' && r.item.host) automod?.addHost(guild.id, r.item.host);
    }
    db.addCaseEvent(caseId, { actorId: by.id, kind: 'action', text: why });
    if (member) notes.push(...(await afterCroak(Object.assign(message, { member }), { settings, reason: 'message removed by a mod', caseId })));

    const logChannel = settings.logChannelId ? guild.channels.cache.get(settings.logChannelId) : null;
    await postCase(logChannel, caseId, {
      embeds: [caseEmbed({ caseId, action: 'delete', reason: why, message, results, notes })],
      action: 'delete',
      ctx: caseContext(message, results),
    });
    return [`Croaked. Case #${caseId}.`, ...notes].filter(Boolean).join(' ');
  }

  return { handleMessage, croakManually };
}
