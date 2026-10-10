// Every message Croak posts, in its colours and voice (see brand/BRAND.md): plain and scannable,
// with the frog flavour limited to the word "croaked". Links are shown in code formatting so mods
// can read a scam without it being clickable.

import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, messageLink, StringSelectMenuBuilder } from 'discord.js';
import { formatMinutes } from './punish.js';
import { ESCALATIONS, PRESETS } from './settings.js';

// Where the docs live. Forks can point this at their own site with SITE_URL in .env.
export const SITE_URL = (process.env.SITE_URL || 'https://croakbot.base44.app').replace(/\/$/, '');

export const COLORS = {
  croaked: 0xff5c8a,
  review: 0xffb547,
  approved: 0x8fe04e,
  info: 0x9db3a6,
  pond: 0x18342a,
};

const SOURCE_LABELS = {
  cache: 'remembered',
  ai: 'AI',
  mod: 'mod decision',
  rule: 'rule',
  trusted: 'trusted site',
  network: 'blocked by mods in several servers',
  refused: 'AI declined',
  error: 'check failed',
};

const TITLES = {
  delete: (reason) => `Croaked: ${reason}`,
  hold: (reason) => `Held for review: possible ${reason}`,
  flag: (reason) => `Flagged for review: possible ${reason}`,
};

/**
 * The mod-log entry for a case.
 * @param {object} c
 * @param {number} c.caseId
 * @param {'delete'|'hold'|'flag'} c.action
 * @param {string} c.reason headline reason, e.g. "scam link"
 * @param {import('discord.js').Message} c.message
 * @param {object[]} c.results judged items (from judge.judgeAll)
 * @param {string[]} [c.notes] what else happened: timeouts, cleanup, failures
 * @param {string[]} [c.signals] why it looked suspicious beyond the scores
 * @param {string|null} [c.title] replaces the usual title
 */
export function caseEmbed({ caseId, action, reason, message, results, notes = [], signals = [], title = null }) {
  const author = message.author;
  const accountDays = Math.floor((Date.now() - author.createdTimestamp) / 86_400_000);
  const what = {
    delete: 'Message deleted.',
    hold: 'Message removed until a mod decides.',
    flag: 'Message is still up.',
  }[action];

  const lines = [
    `**Author** ${author} · \`${author.id}\` · account ${accountDays} day${accountDays === 1 ? '' : 's'} old`,
    `**Channel** ${message.channel}`,
    [what, ...notes.filter(Boolean)].join(' '),
  ];
  if (signals.length) lines.push(`**Also noticed** ${signals.join(' · ')}`);
  if (message.content) lines.push(codeBlock(message.content));

  const embed = new EmbedBuilder()
    .setColor(action === 'delete' ? COLORS.croaked : COLORS.review)
    .setTitle((title ?? TITLES[action](reason)).slice(0, 256))
    .setDescription(lines.join('\n').slice(0, 4000))
    .setFooter({ text: `Case #${caseId} · checked in ${Math.max(0, ...results.map((r) => r.ms ?? 0))}ms` })
    .setTimestamp();

  for (const r of results.filter((r) => r.verdict !== 'allow').slice(0, 10)) {
    embed.addFields({ name: `${r.reason} · ${r.verdict}`.slice(0, 256), value: `\`${r.label.slice(0, 200)}\`\n${scoreLine(r)}`.slice(0, 1024) });
  }
  return embed;
}

/**
 * Buttons under a case, plus a "More actions" menu. Deletes get "Not spam"; reviews get Approve and
 * Block; a flagged message that's still up gets a link to jump to it.
 * @param {number} caseId
 * @param {'delete'|'hold'|'flag'|'report'} action
 * @param {{ guildId?: string, channelId?: string, messageId?: string, hasLinks?: boolean, hasContent?: boolean }} [ctx]
 */
export function caseButtons(caseId, action, ctx = {}) {
  const buttons = [];
  if (action === 'delete') {
    buttons.push(new ButtonBuilder().setCustomId(`croak:approve:${caseId}`).setLabel('Not spam').setStyle(ButtonStyle.Secondary));
  } else if (action === 'report') {
    buttons.push(
      new ButtonBuilder().setCustomId(`croak:block:${caseId}`).setLabel('Croak it').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`croak:dismiss:${caseId}`).setLabel('Dismiss').setStyle(ButtonStyle.Secondary),
    );
  } else {
    buttons.push(
      new ButtonBuilder().setCustomId(`croak:approve:${caseId}`).setLabel('Approve').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`croak:block:${caseId}`).setLabel('Block').setStyle(ButtonStyle.Danger),
    );
  }
  if ((action === 'flag' || action === 'report') && ctx.guildId && ctx.channelId && ctx.messageId) {
    buttons.push(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Jump to message').setURL(messageLink(ctx.channelId, ctx.messageId, ctx.guildId)));
  }
  return [new ActionRowBuilder().addComponents(buttons), new ActionRowBuilder().addComponents(caseMenu(caseId, ctx))];
}

/** The "More actions…" menu on a case. */
export function caseMenu(caseId, { hasLinks = false, hasContent = false } = {}) {
  const options = [
    { label: 'Message the member…', value: 'dm', description: 'Send them a DM from Croak', emoji: '✉️' },
    { label: 'Add a note…', value: 'note', description: 'Only mods see it, on this case', emoji: '📝' },
    { label: 'Their history', value: 'history', description: 'Past cases, strikes, watch and trust', emoji: '🗂️' },
    { label: 'Watch them for 7 days', value: 'watch', description: 'Hold every link and image they post', emoji: '👀' },
    { label: 'Time out for 1 day', value: 'timeout', emoji: '⏳' },
    { label: 'Remove their timeout', value: 'untimeout', emoji: '🔓' },
    { label: 'Kick', value: 'kick', emoji: '👢' },
    { label: 'Ban…', value: 'ban', description: 'Asks you to confirm', emoji: '🔨' },
  ];
  if (hasLinks) options.splice(3, 0, { label: 'Block the whole site', value: 'blocksite', description: 'Every link on these sites, in this server', emoji: '🚫' });
  if (hasContent) options.splice(1, 0, { label: 'Repost the message', value: 'repost', description: 'Under their name, with pings off', emoji: '↩️' });
  return new StringSelectMenuBuilder().setCustomId(`croak:more:${caseId}`).setPlaceholder('More actions…').addOptions(options);
}

/** The same embed, marked as resolved by a mod. */
export function resolvedEmbed(original, { resolution, by, note }) {
  const look = {
    approved: [COLORS.approved, 'Approved'],
    blocked: [COLORS.croaked, 'Blocked'],
    dismissed: [COLORS.info, 'Dismissed'],
  }[resolution] ?? [COLORS.info, resolution];
  return EmbedBuilder.from(original)
    .setColor(look[0])
    .addFields({ name: look[1], value: `by ${by}${note ? `. ${note}` : ''}`.slice(0, 1024) });
}

/** The DM to a member whose message was deleted. Kind: many of them were hacked. */
export function memberNotice({ guildName, channelName, reason, caseId, note = null }) {
  const content =
    `Your message in #${channelName} (${guildName}) was removed because Croak flagged it as a ${reason}. ` +
    "If you didn't send it, your account may be compromised: change your password and turn on two-factor authentication.\n" +
    (note ? `\n**From the ${guildName} mods:** ${note}\n\n` : '') +
    'If this was a mistake, tell the mods with the button below.';
  const appeal = new ButtonBuilder().setCustomId(`croak:appeal:${caseId}`).setLabel('This was a mistake').setStyle(ButtonStyle.Secondary);
  return { content, components: [new ActionRowBuilder().addComponents(appeal)] };
}

/** An appeal from a member, posted in the mod log. */
export function appealEmbed({ caseId, user, text, reason }) {
  return new EmbedBuilder()
    .setColor(COLORS.review)
    .setTitle(`Appeal for case #${caseId}`)
    .setDescription(
      [`**From** ${user} · \`${user.id}\``, `**Croaked for** ${reason ?? 'unknown reason'}`, text ? codeBlock(text) : '_No message given._'].join('\n'),
    )
    .setTimestamp();
}

export function appealButtons(caseId) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`croak:accept:${caseId}`).setLabel('Accept: not spam').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`croak:reject:${caseId}`).setLabel('Keep it removed').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`croak:reply:${caseId}`).setLabel('Reply…').setStyle(ButtonStyle.Primary),
    ),
  ];
}

/** A mod's reply to a member, as the member sees it in their DMs. */
export function modReplyDM({ guildName, text, caseId, canReply = true }) {
  const content = `**The ${guildName} mods replied about your removed message:**\n>>> ${text}`;
  const components = canReply
    ? [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`croak:mreply:${caseId}`).setLabel('Reply to the mods').setStyle(ButtonStyle.Secondary))]
    : [];
  return { content, components };
}

/** One message in an appeal conversation, as posted in the mod log. */
export function conversationEmbed({ caseId, from, to, text, fromMember }) {
  return new EmbedBuilder()
    .setColor(fromMember ? COLORS.review : COLORS.info)
    .setAuthor({ name: `${fromMember ? 'Member' : 'Mod'} reply · case #${caseId}` })
    .setDescription(`${from} → ${to}\n${codeBlock(text)}`)
    .setTimestamp();
}

/** Buttons for the next step in an appeal conversation, shown to mods. */
export function replyButton(caseId) {
  return [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`croak:reply:${caseId}`).setLabel('Reply…').setStyle(ButtonStyle.Primary))];
}

/** A member's report of someone else's message. */
export function reportEmbed({ caseId, reporter, message, results, reason }) {
  const lines = [
    `**Reported by** ${reporter} · **Author** ${message.author} · \`${message.author.id}\``,
    `**Channel** ${message.channel}`,
    reason ? `**Why** ${reason}` : null,
    message.content ? codeBlock(message.content) : '_No text: attachments only._',
  ].filter(Boolean);
  const embed = new EmbedBuilder()
    .setColor(COLORS.review)
    .setTitle('Reported by a member')
    .setDescription(lines.join('\n').slice(0, 4000))
    .setFooter({ text: `Case #${caseId} · the message is still up` })
    .setTimestamp();
  const checked = results.filter((r) => r.item);
  embed.addFields({
    name: 'Croak’s check',
    value: checked.length ? checked.slice(0, 8).map((r) => `\`${r.label.slice(0, 80)}\` · ${r.verdict} · ${scoreLine(r)}`).join('\n').slice(0, 1024) : 'No links, invites or images to check.',
  });
  return embed;
}

/** Raid alert. */
export function raidEmbed({ count, minutes }) {
  return new EmbedBuilder()
    .setColor(COLORS.croaked)
    .setTitle('Possible raid')
    .setDescription(
      `${count} new accounts were croaked in the last few minutes. For the next ${minutes} minutes, Croak holds every link, invite and image from new members until a mod reviews it.`,
    )
    .setTimestamp();
}

/** Raid alert actions. */
export function raidButtons() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('croak:lock:30').setLabel('Lock down for 30 min').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('croak:banraid:ask').setLabel('Ban the raiders…').setStyle(ButtonStyle.Secondary),
    ),
  ];
}

/** For /croak check. */
export function checkEmbed(result) {
  const color = { allow: COLORS.approved, review: COLORS.review, block: COLORS.croaked }[result.verdict] ?? COLORS.info;
  const verb = { block: 'Would croak', review: 'Would hold for review', allow: 'Would allow' }[result.verdict] ?? "Couldn't check";
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(`${verb}: ${result.reason}`)
    .setDescription(`\`${result.label.slice(0, 300)}\`\n${scoreLine(result)}`)
    .setFooter({ text: `${result.ms}ms` });
}

/** The welcome message when Croak joins a server. */
export function welcomeEmbed() {
  return new EmbedBuilder()
    .setColor(COLORS.approved)
    .setTitle('Croak is here. Spam croaks here.')
    .setDescription(
      [
        'Croak checks every link, server invite and image posted here, and removes scams, phishing and NSFW spam in about a fifth of a second.',
        '',
        '**Two steps to finish setup** (needs Manage Server):',
        '1. Pick a private mod channel for Croak\'s log: `/croak setup channel:#mod-log`, or press the button below.',
        "2. In Server Settings → Roles, drag Croak's role **above** your members' roles, so it can time out spammers.",
        '',
        'Then `/croak status` checks everything is working, and `/croak help` lists every setting.',
        '',
        `Docs: ${SITE_URL}/docs`,
      ].join('\n'),
    );
}

export function welcomeButtons() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('croak:makelog').setLabel('Create a private #croak-log').setStyle(ButtonStyle.Primary),
    ),
  ];
}

/** /croak status */
export function statusEmbed({ guild, settings, checks, today, limits }) {
  const ok = (cond) => (cond ? '✅' : '⚠️');
  const preset = PRESETS[settings.preset] ?? PRESETS.standard;
  const punishment = settings.quarantineRoleId
    ? `give <@&${settings.quarantineRoleId}>`
    : settings.timeoutMinutes > 0
      ? `${formatMinutes(settings.timeoutMinutes)} timeout`
      : 'no timeout';
  const categories = Object.entries(settings.categories)
    .map(([name, on]) => `${on ? '✅' : '⬜'} ${name === 'nsfw' ? 'NSFW' : name}`)
    .join('  ');

  return new EmbedBuilder()
    .setColor(checks.every((c) => c.ok) ? COLORS.approved : COLORS.review)
    .setTitle(`Croak status in ${guild.name}`)
    .addFields(
      { name: 'Setup', value: checks.map((c) => `${ok(c.ok)} ${c.label}`).join('\n').slice(0, 1024) },
      {
        name: 'Settings',
        value: [
          `**Sensitivity** ${preset.label} (croak at ${preset.deleteAt}, review at ${preset.reviewAt})`,
          `**Checks** ${categories}`,
          `**On croak** ${punishment} · clean up last ${settings.cleanupMinutes} min · escalation ${ESCALATIONS[settings.escalation]?.label ?? 'Off'}`,
          `**AutoMod sync** ${settings.automod.enabled ? 'on' : 'off'} · **DM members** ${settings.dmMembers ? 'on' : 'off'}`,
          `**Exempt** ${[...settings.exemptChannels.map((id) => `<#${id}>`), ...settings.exemptRoles.map((id) => `<@&${id}>`)].join(' ') || 'nothing'}`,
          settings.alertRoleId ? `**Raid alerts ping** <@&${settings.alertRoleId}>` : '**Raid alerts** posted without a ping',
        ].join('\n'),
      },
      { name: 'Today', value: `${today.checks} checks · ${today.aiCalls} AI calls (limit ${limits.dailyLimitPerServer}) · ${today.cacheHits} answered from memory` },
    );
}

/** /croak stats */
export function statsEmbed({ guild, days, usage, summary }) {
  const hitRate = usage.checks ? Math.round((usage.cacheHits / usage.checks) * 100) : 0;
  const avgAi = usage.aiCalls ? Math.round(usage.aiMs / usage.aiCalls) : 0;
  const { counts } = summary;
  return new EmbedBuilder()
    .setColor(COLORS.approved)
    .setTitle(`Croak in ${guild.name}, last ${days} days`)
    .addFields(
      { name: 'Croaked', value: String(counts.delete), inline: true },
      { name: 'Held / flagged', value: String(counts.hold + counts.flag), inline: true },
      { name: 'Overturned by mods', value: String(counts.approved), inline: true },
      { name: 'Checks', value: `${usage.checks} total · ${hitRate}% from memory · ${usage.aiCalls} AI calls${avgAi ? ` · ${avgAi}ms average` : ''}` },
      { name: 'Top reasons', value: summary.reasons.map((r) => `${r.reason} · ${r.n}`).join('\n') || 'Nothing yet.', inline: true },
      { name: 'Top blocked sites', value: summary.topSites.map(([host, n]) => `\`${host}\` · ${n}`).join('\n') || 'Nothing yet.', inline: true },
    );
}

const EVENT_WORDS = {
  note: '📝 note',
  mod_reply: '💬 mods replied',
  member_reply: '💬 member replied',
  action: '⚡',
  report: '🚩 reported',
};

/** /croak case: one case at a glance, with its history and a link to the log entry. */
export function caseSummaryView(found, events = [], logChannelId = null) {
  const ts = (ms) => `<t:${Math.floor(ms / 1000)}:R>`;
  const word = { delete: 'Croaked', hold: 'Held', flag: 'Flagged', report: 'Reported' }[found.action] ?? found.action;
  const lines = [
    `**Member** <@${found.author_id}> · \`${found.author_id}\``,
    `**Channel** <#${found.channel_id}> · ${ts(found.created_at)}`,
    found.resolution ? `**Outcome** ${found.resolution}${found.resolved_by ? ` by <@${found.resolved_by}>` : ''}` : '**Outcome** open',
    found.appeal ? `**Appeal** ${found.appeal}` : null,
    found.content ? codeBlock(found.content) : null,
  ].filter(Boolean);
  const embed = new EmbedBuilder()
    .setColor(found.resolution === 'approved' ? COLORS.approved : found.action === 'delete' ? COLORS.croaked : COLORS.review)
    .setTitle(`Case #${found.id}: ${word}${found.reason ? `, ${found.reason}` : ''}`.slice(0, 256))
    .setDescription(lines.join('\n').slice(0, 4000));
  const items = (found.items ?? []).filter((i) => i.verdict !== 'allow').slice(0, 5);
  if (items.length) embed.addFields({ name: 'What Croak saw', value: items.map((i) => `\`${String(i.label ?? i.key ?? '').slice(0, 120)}\` · ${i.reason ?? i.verdict}`).join('\n').slice(0, 1024) });
  if (events.length) {
    embed.addFields({
      name: 'History',
      value: events
        .slice(-10)
        .map((e) => `${ts(e.at)} ${EVENT_WORDS[e.kind] ?? e.kind}${e.actor_id ? ` <@${e.actor_id}>` : ''}${e.text ? `: ${e.text.slice(0, 120)}` : ''}`)
        .join('\n')
        .slice(0, 1024),
    });
  }
  const components = [];
  const buttons = [];
  if (found.log_message_id && logChannelId) {
    buttons.push(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Open in mod log').setURL(messageLink(logChannelId, found.log_message_id, found.guild_id)));
  }
  if (found.action === 'flag' || found.action === 'report') {
    buttons.push(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Jump to message').setURL(messageLink(found.channel_id, found.message_id, found.guild_id)));
  }
  if (buttons.length) components.push(new ActionRowBuilder().addComponents(buttons));
  components.push(new ActionRowBuilder().addComponents(caseMenu(found.id, { hasLinks: (found.items ?? []).some((i) => i.kind === 'link'), hasContent: Boolean(found.content) })));
  return { embeds: [embed], components };
}

/** /croak help */
export function helpEmbed() {
  const cmd = (name, text) => `\`/croak ${name}\` ${text}`;
  return new EmbedBuilder()
    .setColor(COLORS.approved)
    .setTitle('Croak commands')
    .setDescription(
      [
        '**Setup**',
        cmd('setup', 'Pick the mod-log channel (and timeout length).'),
        cmd('status', 'Check permissions and see every setting.'),
        cmd('stats', 'What Croak caught recently.'),
        '',
        '**Tuning**',
        cmd('sensitivity', 'Relaxed, Standard or Strict.'),
        cmd('category', 'Turn scam, NSFW or spam checks on or off.'),
        cmd('actions', 'Timeout length, cleanup, escalation, quarantine role, raid alert role, member DMs.'),
        cmd('exempt-channel', 'Skip a channel.'),
        cmd('exempt-role', 'Skip members with a role.'),
        cmd('automod', "Mirror confirmed scam sites into Discord's AutoMod."),
        '',
        '**Mod tools**',
        cmd('settings', 'Every main setting on one screen, with menus and toggles.'),
        cmd('member', "Someone's cases and strikes, plus watch, trust, purge, timeout and ban."),
        cmd('case', 'Look up a case by number.'),
        cmd('lockdown', 'Slowmode everywhere and pause invites, for a set time.'),
        cmd('message', 'Add your own line to the DM members get.'),
        cmd('digest', 'A weekly summary in your mod log.'),
        cmd('test', 'Post a sample case, to see what one looks like.'),
        'Every case has buttons and a **More actions** menu: message the member, add a note, watch them, block the whole site, repost, timeout, kick or ban.',
        'Right-click a message → **Apps**: *Report to mods* (everyone), *Croak this message*, *Check with Croak*. Right-click a member → *Croak: member*.',
        '',
        '**Lists**',
        cmd('check', 'See what Croak would do with a link or invite.'),
        cmd('allow', 'Always allow a link, site or server invite here.'),
        cmd('block', 'Always croak it here.'),
        cmd('unlist', 'Remove one of your allow or block entries.'),
        cmd('lists', "This server's allow and block entries."),
        '',
        'Age-restricted channels skip the NSFW check automatically. Mods, admins and the owner are never checked.',
        '',
        `Full docs: ${SITE_URL}/docs`,
      ].join('\n'),
    );
}

export function scoreLine(r) {
  const scores = r.scores
    ? Object.entries(r.scores)
        .filter(([, p]) => p != null)
        .map(([name, p]) => `${name} ${p.toFixed(2)}`)
        .join(' · ')
    : '';
  return [scores, SOURCE_LABELS[r.source] ?? r.source, r.hint?.note, r.note].filter(Boolean).join(' · ');
}

// Links inside a code block aren't clickable, so mods can read a scam safely
function codeBlock(text) {
  const clean = text.replace(/```/g, '`​``').slice(0, 900);
  return `\`\`\`\n${clean}${text.length > 900 ? '…' : ''}\n\`\`\``;
}
