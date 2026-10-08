// What happens to a message: the checks in order, then delete / hold / flag, the mod-log case,
// and the mod's Approve / Block buttons afterwards.

import { MessageFlags, PermissionFlagsBits } from 'discord.js';
import { config } from './config.js';
import { caseButtons, caseEmbed, memberNotice, resolvedEmbed } from './embeds.js';
import { extractItems } from './extract.js';
import { fingerprint } from './repeats.js';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const MOD_ALLOW_TTL = 90 * DAY; // a mod's "allow" still expires; a mod's "block" doesn't
const SEVERITY = { block: 3, review: 2, unknown: 1, allow: 0 };

/**
 * delete: a check scored at or above the delete threshold
 * hold:   unsure, and the author is new, so remove it until a mod decides
 * flag:   unsure, but the author is established, so leave it up and tell the mods
 * allow:  nothing to do
 * When the AI is down or slow ('unknown'), new members are held and everyone else is let through.
 */
export function decideAction(results, { isNew }) {
  if (results.some((r) => r.verdict === 'block')) return 'delete';
  if (results.some((r) => r.verdict === 'review')) return isNew ? 'hold' : 'flag';
  if (results.some((r) => r.verdict === 'unknown')) return isNew ? 'hold' : 'allow';
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

export function createModerator({ db, judge, repeats, log = console.log }) {
  const handled = new Set(); // message IDs already deleted for repeating, so later copies don't redo it

  async function handleMessage(message) {
    if (!message.inGuild() || message.author.bot || message.webhookId || message.system) return;
    const member = message.member;
    if (!member || member.id === message.guild.ownerId) return;
    if (member.permissions.has(PermissionFlagsBits.ManageMessages)) return; // mods are trusted

    const plain = {
      content: message.content,
      attachments: [...message.attachments.values()].map((a) => ({ url: a.url, name: a.name, contentType: a.contentType, size: a.size })),
    };

    // 1. Free and instant: the same post in several channels
    const copies = repeats.record({
      guildId: message.guildId,
      userId: member.id,
      channelId: message.channelId,
      messageId: message.id,
      print: fingerprint(plain),
    });
    if (copies) return croakRepeats(message, copies, plain);

    // 2. Links, invites and images: cache first, AI if needed
    const { links, invites, images } = extractItems(plain);
    const items = [...invites, ...links, ...images];
    if (items.length === 0) return;

    const results = await judge.judgeAll(items, { guildId: message.guildId, text: message.content });
    const action = decideAction(results, { isNew: isNewMember(member) });
    log(`${message.guild.name} #${message.channel.name} ${member.user.tag}: ${action} [${results.map((r) => `${r.item.kind} ${r.verdict}/${r.source} ${r.ms}ms${r.aiMs ? ` (AI ${r.aiMs}ms)` : ''}`).join(', ')}]`);
    if (action !== 'allow') await act(message, action, results);
  }

  async function act(message, action, results) {
    const guild = message.guild;
    const settings = db.getGuild(guild.id) ?? {};
    const logChannel = settings.log_channel_id ? guild.channels.cache.get(settings.log_channel_id) : null;
    // Holding or flagging only makes sense if a mod will see it
    if (action !== 'delete' && !logChannel) return;

    const top = headline(results);
    const notes = [];

    if (action === 'delete' || action === 'hold') {
      // Check first: a refused delete (403) counts towards Discord's invalid-request limit
      if (message.channel.permissionsFor(guild.members.me)?.has(PermissionFlagsBits.ManageMessages)) {
        await message.delete().catch((err) => notes.push(`Delete failed: ${err.message}.`));
      } else {
        notes.push('Could not delete it: Croak needs Manage Messages in that channel.');
      }
    }
    if (action === 'delete') {
      notes.push(await timeout(message.member, settings, top.reason));
      await message.author
        .send(memberNotice({ guildName: guild.name, channelName: message.channel.name, reason: top.reason }))
        .catch(() => {}); // DMs closed
    }

    const caseId = db.addCase({
      guildId: guild.id,
      channelId: message.channelId,
      messageId: message.id,
      authorId: message.author.id,
      action,
      items: results.map(caseItem),
    });
    if (logChannel) {
      await logChannel
        .send({
          embeds: [caseEmbed({ caseId, action, reason: top.reason, message, results, extra: notes.filter(Boolean).join(' ') })],
          components: caseButtons(caseId, action),
        })
        .catch((err) => log(`Could not post case #${caseId} in ${guild.name}: ${err.message}`));
    }
  }

  async function croakRepeats(message, copies, plain) {
    const fresh = copies.filter((c) => !handled.has(c.messageId));
    const firstTime = fresh.length === copies.length;
    for (const copy of fresh) {
      handled.add(copy.messageId);
      const channel = message.guild.channels.cache.get(copy.channelId);
      if (channel?.permissionsFor(message.guild.members.me)?.has(PermissionFlagsBits.ManageMessages)) {
        await channel.messages.delete(copy.messageId).catch(() => {});
      }
    }
    if (handled.size > 10_000) handled.clear();
    if (!firstTime) return; // later copies in the same burst are deleted quietly

    // Block its links in this server for a day, so other accounts in the same raid are caught instantly
    for (const link of extractItems(plain).links) {
      db.putVerdict({ guildId: message.guildId, kind: 'link', key: link.key, verdict: 'block', source: 'rule', ttlMs: config.ttl.review });
    }

    const reason = `same message in ${new Set(copies.map((c) => c.channelId)).size} channels`;
    const results = [{ item: { kind: 'repeat' }, label: plain.content.slice(0, 200) || 'attachments', reason, verdict: 'block', source: 'rule', ms: 0 }];
    const settings = db.getGuild(message.guildId) ?? {};
    const timeoutNote = await timeout(message.member, settings, reason);
    log(`${message.guild.name}: repeat spam from ${message.author.tag}, ${copies.length} copies deleted`);

    const logChannel = settings.log_channel_id ? message.guild.channels.cache.get(settings.log_channel_id) : null;
    const caseId = db.addCase({
      guildId: message.guildId,
      channelId: message.channelId,
      messageId: message.id,
      authorId: message.author.id,
      action: 'delete',
      items: results.map(caseItem),
    });
    await logChannel
      ?.send({
        embeds: [caseEmbed({ caseId, action: 'delete', reason, message, results, extra: `Deleted ${copies.length} copies. ${timeoutNote}` })],
        components: caseButtons(caseId, 'delete'),
      })
      .catch(() => {});
  }

  async function timeout(member, settings, reason) {
    const minutes = settings.timeout_minutes ?? config.defaultTimeoutMinutes;
    if (!member || minutes <= 0) return '';
    if (!member.moderatable) return 'Could not time them out: their role is above Croak\'s, or Croak lacks Moderate Members.';
    try {
      await member.timeout(minutes * 60_000, `Croak: ${reason}`);
      return `Timed out for ${minutes} min.`;
    } catch (err) {
      return `Timeout failed: ${err.message}.`;
    }
  }

  /** The Approve / Not spam / Block buttons under a case. */
  async function handleButton(interaction) {
    const [, verb, id] = interaction.customId.split(':');
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) {
      return interaction.reply({ content: 'You need the Manage Messages permission to do that.', flags: MessageFlags.Ephemeral });
    }
    const found = db.getCase(Number(id));
    if (!found || found.guild_id !== interaction.guildId) {
      return interaction.reply({ content: 'That case no longer exists.', flags: MessageFlags.Ephemeral });
    }
    const resolution = verb === 'approve' ? 'approved' : 'blocked';
    if (!db.resolveCase(found.id, interaction.user.id, resolution)) {
      return interaction.reply({ content: 'Another mod already handled this case.', flags: MessageFlags.Ephemeral });
    }

    // The decision sticks for this server: the same link, server or image is treated the same way next time.
    // Items that were fine (say, a YouTube link next to the scam) are left alone.
    for (const item of found.items.filter((i) => i.verdict !== 'allow' && i.cacheKind && i.cacheKey)) {
      db.putVerdict({
        guildId: found.guild_id,
        kind: item.cacheKind,
        key: item.cacheKey,
        verdict: resolution === 'approved' ? 'allow' : 'block',
        scores: item.scores,
        source: 'mod',
        ttlMs: resolution === 'approved' ? MOD_ALLOW_TTL : null,
      });
    }

    const guild = interaction.guild;
    const member = await guild.members.fetch(found.author_id).catch(() => null);
    if (resolution === 'approved' && found.action === 'delete' && member?.isCommunicationDisabled() && member.moderatable) {
      await member.timeout(null, `Croak: approved by ${interaction.user.tag}`).catch(() => {});
    }
    if (resolution === 'blocked') {
      if (found.action === 'flag') {
        const channel = guild.channels.cache.get(found.channel_id);
        await channel?.messages.delete(found.message_id).catch(() => {});
      }
      await timeout(member, db.getGuild(guild.id) ?? {}, `blocked by ${interaction.user.tag}`);
    }

    await interaction.update({
      embeds: [resolvedEmbed(interaction.message.embeds[0], { resolution, by: interaction.user })],
      components: [],
    });
  }

  return { handleMessage, handleButton };
}

/** What a case remembers about each checked item, enough for a mod's decision to be cached. */
function caseItem(r) {
  const fallback = r.item.kind === 'link' ? { cacheKind: 'link', cacheKey: r.item.key } : {};
  return {
    kind: r.item.kind,
    label: r.label,
    reason: r.reason,
    verdict: r.verdict,
    scores: r.scores ?? null,
    source: r.source,
    cacheKind: r.cacheKind ?? fallback.cacheKind,
    cacheKey: r.cacheKey ?? fallback.cacheKey,
  };
}
