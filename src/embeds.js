// Mod-log messages, in Croak's colours and voice (see brand/BRAND.md): plain and scannable,
// with the frog flavour limited to the word "croaked".

import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';

export const COLORS = {
  croaked: 0xff5c8a,
  review: 0xffb547,
  approved: 0x8fe04e,
  info: 0x9db3a6,
};

const TITLES = {
  delete: (reason) => `Croaked: ${reason}`,
  hold: (reason) => `Held for review: possible ${reason}`,
  flag: (reason) => `Flagged for review: possible ${reason}`,
};

/**
 * @param {object} c
 * @param {number} c.caseId
 * @param {'delete'|'hold'|'flag'} c.action
 * @param {string} c.reason headline reason, e.g. "scam link"
 * @param {import('discord.js').Message} c.message
 * @param {object[]} c.results judged items (from judge.judgeAll)
 * @param {string} [c.extra] an extra line, e.g. what else was done
 */
export function caseEmbed({ caseId, action, reason, message, results, extra }) {
  const author = message.author;
  const accountDays = Math.floor((Date.now() - author.createdTimestamp) / 86_400_000);
  const what = {
    delete: 'Message deleted.',
    hold: 'Message removed until a mod decides (new account).',
    flag: 'Message is still up.',
  }[action];

  const lines = [
    `**Author** ${author} · \`${author.id}\` · account ${accountDays} day${accountDays === 1 ? '' : 's'} old`,
    `**Channel** ${message.channel}`,
    what + (extra ? ` ${extra}` : ''),
  ];
  if (message.content) lines.push(codeBlock(message.content));

  const embed = new EmbedBuilder()
    .setColor(action === 'delete' ? COLORS.croaked : COLORS.review)
    .setTitle(TITLES[action](reason))
    .setDescription(lines.join('\n'))
    .setFooter({ text: `Case #${caseId} · checked in ${Math.max(0, ...results.map((r) => r.ms))}ms` })
    .setTimestamp();

  for (const r of results.filter((r) => r.verdict !== 'allow').slice(0, 10)) {
    embed.addFields({ name: `${r.reason} · ${r.verdict}`, value: `\`${r.label.slice(0, 200)}\`\n${scoreLine(r)}` });
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
export function resolvedEmbed(original, { resolution, by }) {
  return EmbedBuilder.from(original)
    .setColor(resolution === 'approved' ? COLORS.approved : COLORS.croaked)
    .addFields({ name: resolution === 'approved' ? 'Approved' : 'Blocked', value: `by ${by}` });
}

/** For /croak check. */
export function checkEmbed(result) {
  const color = { allow: COLORS.approved, review: COLORS.review, block: COLORS.croaked }[result.verdict] ?? COLORS.info;
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(`${result.verdict === 'block' ? 'Would croak' : result.verdict === 'review' ? 'Would hold for review' : result.verdict === 'allow' ? 'Would allow' : 'Couldn\'t check'}: ${result.reason}`)
    .setDescription(`\`${result.label.slice(0, 300)}\`\n${scoreLine(result)}`)
    .setFooter({ text: `${result.ms}ms` });
}

/** The DM sent to a member whose message was deleted. Kind: many of them were hacked. */
export function memberNotice({ guildName, channelName, reason }) {
  return (
    `Your message in #${channelName} (${guildName}) was removed because Croak flagged it as a ${reason}. ` +
    'If you didn\'t send it, your account may be compromised: change your password and turn on two-factor authentication.'
  );
}

function scoreLine(r) {
  const scores = r.scores
    ? Object.entries(r.scores)
        .filter(([, p]) => p != null)
        .map(([name, p]) => `${name} ${p.toFixed(2)}`)
        .join(' · ')
    : '';
  const source = { cache: 'cached', ai: 'AI', mod: 'mod decision', rule: 'rule', trusted: 'trusted site', refused: 'AI refused', error: 'check failed' }[r.source] ?? r.source;
  return [scores, source, r.note].filter(Boolean).join(' · ');
}

// Links inside a code block aren't clickable, so mods can read a scam safely
function codeBlock(text) {
  const clean = text.replace(/```/g, '`​``').slice(0, 900);
  return `\`\`\`\n${clean}${text.length > 900 ? '…' : ''}\n\`\`\``;
}
