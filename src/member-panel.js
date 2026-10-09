// One member at a glance, for mods: their cases and strikes, whether they're watched or trusted,
// and buttons to act. Opened with /croak member, the "Croak: member" right-click, or a case's
// "Their history".

import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { COLORS } from './embeds.js';
import { cleanUp, pardon } from './punish.js';
import { ephemeral } from './toolkit.js';

const P = PermissionFlagsBits;
const DAY = 24 * 60 * 60 * 1000;
const ACTION_WORDS = { delete: 'croaked', hold: 'held', flag: 'flagged', report: 'reported' };

/** The panel for one member: { embeds, components }. */
export async function memberPanel({ db, guild, userId, note = null }) {
  const member = await guild.members.fetch(userId).catch(() => null);
  const user = member?.user ?? (await guild.client.users.fetch(userId).catch(() => null));
  const flags = db.memberFlags(guild.id, userId);
  const cases = db.casesFor(guild.id, userId, 6);
  const strikes = db.strikes(guild.id, userId);
  const ts = (ms, style = 'R') => `<t:${Math.floor(ms / 1000)}:${style}>`;

  const status = [];
  if (!member) status.push('Not in the server');
  if (member?.isCommunicationDisabled()) status.push(`Timed out until ${ts(member.communicationDisabledUntilTimestamp)}`);
  if (flags.watching) status.push(`👀 Watched until ${ts(flags.watching)}${flags.watchBy ? ` (by <@${flags.watchBy}>)` : ''}`);
  if (flags.trusted) status.push('🤝 Trusted: never checked');

  const embed = new EmbedBuilder()
    .setColor(flags.trusted ? COLORS.approved : flags.watching || strikes ? COLORS.review : COLORS.info)
    .setAuthor({ name: user ? `${user.tag}` : `User ${userId}`, iconURL: user?.displayAvatarURL() })
    .setDescription(
      [
        `<@${userId}> · \`${userId}\``,
        user ? `Account created ${ts(user.createdTimestamp)}` : null,
        member?.joinedTimestamp ? `Joined ${ts(member.joinedTimestamp)}` : null,
        `**Strikes (30 days):** ${strikes}`,
        status.length ? status.join('\n') : null,
      ]
        .filter(Boolean)
        .join('\n'),
    )
    .addFields({
      name: 'Recent cases',
      value: cases.length
        ? cases
            .map((c) => `#${c.id} · ${ACTION_WORDS[c.action] ?? c.action} · ${c.reason ?? 'no reason'}${c.resolution ? ` · ${c.resolution}` : ''} · ${ts(c.created_at)}`)
            .join('\n')
            .slice(0, 1024)
        : 'None. Clean record.',
    });
  if (note) embed.setFooter({ text: note.slice(0, 200) });

  const id = (action) => `croak:member:${action}:${userId}`;
  const components = [
    new ActionRowBuilder().addComponents(
      flags.watching
        ? new ButtonBuilder().setCustomId(id('unwatch')).setLabel('Stop watching').setStyle(ButtonStyle.Secondary)
        : new ButtonBuilder().setCustomId(id('watch')).setLabel('Watch 7 days').setEmoji('👀').setStyle(ButtonStyle.Secondary),
      flags.trusted
        ? new ButtonBuilder().setCustomId(id('untrust')).setLabel('Stop trusting').setStyle(ButtonStyle.Secondary)
        : new ButtonBuilder().setCustomId(id('trust')).setLabel('Trust').setEmoji('🤝').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(id('purge')).setLabel('Delete their last 30 min').setEmoji('🧹').setStyle(ButtonStyle.Secondary).setDisabled(!member),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(id('timeout')).setLabel('Time out 1 hour').setStyle(ButtonStyle.Secondary).setDisabled(!member),
      new ButtonBuilder().setCustomId(id('untimeout')).setLabel('Remove timeout').setStyle(ButtonStyle.Secondary).setDisabled(!member?.isCommunicationDisabled()),
      new ButtonBuilder().setCustomId(id('ban')).setLabel('Ban…').setStyle(ButtonStyle.Danger),
    ),
  ];
  return { embeds: [embed], components };
}

export function createMemberActions({ db, kit, recent }) {
  /** Buttons on the member panel. customId: croak:member:<action>:<userId> */
  return async function handle(interaction, action, userId) {
    const need = {
      timeout: [P.ModerateMembers, 'Timeout Members'],
      untimeout: [P.ModerateMembers, 'Timeout Members'],
      ban: [P.BanMembers, 'Ban Members'],
      banok: [P.BanMembers, 'Ban Members'],
    }[action] ?? [P.ManageMessages, 'Manage Messages'];
    if (!(await kit.allowed(interaction, ...need))) return;
    const guild = interaction.guild;
    const mod = interaction.user;
    const member = await guild.members.fetch(userId).catch(() => null);

    if (action === 'ban') {
      return interaction.reply(
        ephemeral(`Ban <@${userId}>? Their last hour of messages is deleted too.`, {
          components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`croak:member:banok:${userId}`).setLabel('Yes, ban them').setStyle(ButtonStyle.Danger))],
        }),
      );
    }
    if (action === 'banok') {
      if (member && !member.bannable) return interaction.update({ content: "Croak can't ban them: their role is above Croak's, or it lacks Ban Members.", components: [] });
      const result = await guild.members
        .ban(userId, { reason: `Croak: by ${mod.tag}`, deleteMessageSeconds: 3600 })
        .then(() => 'Banned. Their last hour of messages was deleted.', (e) => `Ban failed: ${e.message}`);
      return interaction.update({ content: result, components: [] });
    }

    let note;
    switch (action) {
      case 'watch':
        db.setWatch(guild.id, userId, Date.now() + 7 * DAY, mod.id);
        note = 'Watching for 7 days: every link and image they post is held for review.';
        break;
      case 'unwatch':
        db.setWatch(guild.id, userId, null, null);
        note = 'No longer watched.';
        break;
      case 'trust':
        db.setTrusted(guild.id, userId, true);
        note = 'Trusted: Croak will never check their messages.';
        break;
      case 'untrust':
        db.setTrusted(guild.id, userId, false);
        note = 'No longer trusted: their messages are checked again.';
        break;
      case 'purge': {
        const removed = await cleanUp(guild, recent.since({ guildId: guild.id, userId, withinMs: 30 * 60_000 }));
        recent.forget({ guildId: guild.id, userId });
        note = removed ? `Deleted ${removed} message${removed === 1 ? '' : 's'} from the last 30 minutes.` : 'Croak found nothing of theirs from the last 30 minutes.';
        break;
      }
      case 'timeout':
        note = !member?.moderatable ? "Croak can't time them out (role too high, or missing Timeout Members)." : await member.timeout(60 * 60_000, `Croak: by ${mod.tag}`).then(() => 'Timed out for 1 hour.', (e) => `Timeout failed: ${e.message}`);
        break;
      case 'untimeout':
        await pardon(member, { settings: db.getSettings(guild.id), by: mod.tag });
        note = 'Timeout and quarantine role removed.';
        break;
      default:
        note = 'Unknown action.';
    }
    return interaction.update(await memberPanel({ db, guild, userId, note: `✓ ${note}` }));
  };
}
