// Every message Croak posts, in its colours and voice (see brand/BRAND.md): plain and scannable,
// with the frog flavour limited to the word "croaked". Links are shown in code formatting so mods
// can read a scam without it being clickable.

import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { formatMinutes } from './punish.js';
import { ESCALATIONS, PRESETS } from './settings.js';

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
 */
export function caseEmbed({ caseId, action, reason, message, results, notes = [], signals = [] }) {
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
    .setTitle(TITLES[action](reason))
    .setDescription(lines.join('\n').slice(0, 4000))
    .setFooter({ text: `Case #${caseId} · checked in ${Math.max(0, ...results.map((r) => r.ms ?? 0))}ms` })
    .setTimestamp();

  for (const r of results.filter((r) => r.verdict !== 'allow').slice(0, 10)) {
    embed.addFields({ name: `${r.reason} · ${r.verdict}`.slice(0, 256), value: `\`${r.label.slice(0, 200)}\`\n${scoreLine(r)}`.slice(0, 1024) });
  }
  return embed;
}

/** Buttons under a case. Deletes get "Not spam"; reviews get Approve and Block. */
export function caseButtons(caseId, action) {
  const approve = new ButtonBuilder()
    .setCustomId(`croak:approve:${caseId}`)
    .setLabel(action === 'delete' ? 'Not spam' : 'Approve')
    .setStyle(ButtonStyle.Secondary);
  const block = new ButtonBuilder().setCustomId(`croak:block:${caseId}`).setLabel('Block').setStyle(ButtonStyle.Danger);
  return [new ActionRowBuilder().addComponents(action === 'delete' ? [approve] : [approve, block])];
}

/** The same embed, marked as resolved by a mod. */
export function resolvedEmbed(original, { resolution, by, note }) {
  return EmbedBuilder.from(original)
    .setColor(resolution === 'approved' ? COLORS.approved : COLORS.croaked)
    .addFields({ name: resolution === 'approved' ? 'Approved' : 'Blocked', value: `by ${by}${note ? `. ${note}` : ''}`.slice(0, 1024) });
}

/** The DM to a member whose message was deleted. Kind: many of them were hacked. */
export function memberNotice({ guildName, channelName, reason, caseId }) {
  const content =
    `Your message in #${channelName} (${guildName}) was removed because Croak flagged it as a ${reason}. ` +
    "If you didn't send it, your account may be compromised: change your password and turn on two-factor authentication.\n" +
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
    ),
  ];
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
        '**Lists**',
        cmd('check', 'See what Croak would do with a link or invite.'),
        cmd('allow', 'Always allow a link, site or server invite here.'),
        cmd('block', 'Always croak it here.'),
        cmd('unlist', 'Remove one of your allow or block entries.'),
        cmd('lists', "This server's allow and block entries."),
        '',
        'Age-restricted channels skip the NSFW check automatically. Mods, admins and the owner are never checked.',
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
