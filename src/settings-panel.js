// /croak settings: every main setting on one screen, changed with dropdowns and toggles instead
// of remembering command options. Only people with Manage Server can change anything.

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
} from 'discord.js';
import { COLORS } from './embeds.js';
import { formatMinutes } from './punish.js';
import { ESCALATIONS, PRESETS } from './settings.js';

const TIMEOUTS = [0, 10, 60, 360, 1440, 10080];

export function settingsPanel(settings, note = null) {
  const preset = PRESETS[settings.preset] ?? PRESETS.standard;
  const embed = new EmbedBuilder()
    .setColor(COLORS.approved)
    .setTitle('Croak settings')
    .setDescription(
      [
        settings.logChannelId ? `Cases go to <#${settings.logChannelId}>.` : '⚠️ **Pick a mod-log channel below** so Croak can show you what it does.',
        `**Sensitivity** ${preset.label}: croaks at ${preset.deleteAt}, holds for review at ${preset.reviewAt}.`,
        `**When someone is croaked** ${settings.timeoutMinutes ? `${formatMinutes(settings.timeoutMinutes)} timeout` : 'no timeout'}, escalation ${ESCALATIONS[settings.escalation]?.label ?? 'Off'}.`,
        '',
        'More: `/croak exempt-channel`, `/croak exempt-role`, `/croak actions` (cleanup, quarantine role, raid ping), `/croak message` (your note in the DM), `/croak digest`.',
      ].join('\n'),
    );
  if (note) embed.setFooter({ text: note.slice(0, 200) });

  const toggle = (id, label, on) =>
    new ButtonBuilder()
      .setCustomId(`croak:set:${id}`)
      .setLabel(`${label} ${on ? 'on' : 'off'}`)
      .setStyle(on ? ButtonStyle.Success : ButtonStyle.Secondary);

  const components = [
    new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId('croak:set:log')
        .setPlaceholder(settings.logChannelId ? 'Change the mod-log channel' : 'Pick the mod-log channel')
        .setChannelTypes(ChannelType.GuildText)
        .setDefaultChannels(settings.logChannelId ? [settings.logChannelId] : []),
    ),
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('croak:set:preset')
        .addOptions(
          Object.entries(PRESETS).map(([value, p]) => ({ label: `Sensitivity: ${p.label}`, value, description: p.blurb.slice(0, 100), default: value === settings.preset })),
        ),
    ),
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('croak:set:timeout')
        .addOptions(
          TIMEOUTS.map((m) => ({
            label: m ? `Timeout: ${formatMinutes(m)}` : 'Timeout: none',
            value: String(m),
            default: m === settings.timeoutMinutes,
          })),
        ),
    ),
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('croak:set:escalation')
        .addOptions(
          [
            ['off', 'Repeat offenders: always the normal timeout'],
            ['standard', 'Repeat offenders: timeout, 1 day, then kick'],
            ['strict', 'Repeat offenders: timeout, kick, then ban'],
          ].map(([value, label]) => ({ label, value, default: value === settings.escalation })),
        ),
    ),
    new ActionRowBuilder().addComponents(
      toggle('cat:scam', 'Scams', settings.categories.scam),
      toggle('cat:nsfw', 'NSFW', settings.categories.nsfw),
      toggle('cat:spam', 'Spam', settings.categories.spam),
      toggle('dm', 'DMs', settings.dmMembers),
      toggle('automod', 'AutoMod', settings.automod.enabled),
    ),
  ];
  return { embeds: [embed], components };
}

export function createSettingsPanel({ db, automod }) {
  /** /croak settings */
  function open(interaction) {
    return interaction.reply({ ...settingsPanel(db.getSettings(interaction.guildId)), flags: MessageFlags.Ephemeral });
  }

  /** Any change on the panel. customId: croak:set:<what>[:<which>] */
  async function change(interaction, what, which) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ content: 'Changing Croak settings needs the Manage Server permission.', flags: MessageFlags.Ephemeral });
    }
    const guildId = interaction.guildId;
    const s = db.getSettings(guildId);
    let note = null;

    if (what === 'log') {
      const channel = interaction.channels.first();
      const me = interaction.guild.members.me;
      const ok = channel?.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks]);
      if (!ok) note = `Croak can't post in #${channel?.name ?? 'that channel'}. Add Croak to it (View Channel, Send Messages, Embed Links), then pick it again.`;
      else {
        db.updateSettings(guildId, { logChannelId: channel.id });
        note = `Cases now go to #${channel.name}.`;
      }
    } else if (what === 'preset') {
      db.updateSettings(guildId, { preset: interaction.values[0] });
    } else if (what === 'timeout') {
      db.updateSettings(guildId, { timeoutMinutes: Number(interaction.values[0]) });
    } else if (what === 'escalation') {
      db.updateSettings(guildId, { escalation: interaction.values[0] });
      if (interaction.values[0] !== 'off') note = 'Escalation needs Croak to have Kick Members (and Ban Members for Strict).';
    } else if (what === 'cat') {
      db.updateSettings(guildId, { categories: { ...s.categories, [which]: !s.categories[which] } });
    } else if (what === 'dm') {
      db.updateSettings(guildId, { dmMembers: !s.dmMembers });
    } else if (what === 'automod') {
      await interaction.deferUpdate();
      note = (await automod.setEnabled(interaction.guild, !s.automod.enabled)).replace(/\*\*/g, '');
      return interaction.editReply(settingsPanel(db.getSettings(guildId), note));
    }
    return interaction.update(settingsPanel(db.getSettings(guildId), note ?? '✓ Saved.'));
  }

  return { open, change };
}
