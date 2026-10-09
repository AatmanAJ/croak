// Every button, menu and form Croak puts in front of people, routed by custom ID
// ("croak:<verb>:<args>"), plus the right-click commands.

import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits } from 'discord.js';
import { createAppeals } from './appeals.js';
import { createCaseActions } from './case-actions.js';
import { createMemberActions } from './member-panel.js';
import { createReports } from './reports.js';
import { createSettingsPanel } from './settings-panel.js';
import { ephemeral } from './toolkit.js';

const P = PermissionFlagsBits;

export function createInteractions({ client, db, automod, kit, judge, moderator, recent, raids, lockdown, log = console.log }) {
  const cases = createCaseActions({ client, db, kit, log });
  const appeals = createAppeals({ client, db, kit });
  const memberActions = createMemberActions({ db, kit, recent });
  const settingsPanel = createSettingsPanel({ db, automod });
  const reports = createReports({ db, judge, kit, moderator, log });

  /** The welcome message's button: create a private #croak-log only Croak and mods can see. */
  async function makeLog(interaction) {
    if (!interaction.inGuild() || !interaction.memberPermissions?.has(P.ManageGuild)) {
      return interaction.reply(ephemeral('Setting up Croak needs the Manage Server permission.'));
    }
    const guild = interaction.guild;
    const me = guild.members.me;
    if (!me.permissions.has(P.ManageChannels)) {
      return interaction.reply(ephemeral("Croak can't create channels here. Make a private channel yourself, add Croak to it, then run `/croak setup channel:#that-channel`."));
    }
    const modRoles = guild.roles.cache.filter((r) => !r.managed && r.id !== guild.id && r.permissions.has(P.ManageMessages));
    try {
      const channel = await guild.channels.create({
        name: 'croak-log',
        type: ChannelType.GuildText,
        topic: 'What Croak croaks, holds and flags. Only mods can see this.',
        permissionOverwrites: [
          { id: guild.id, deny: [P.ViewChannel] },
          { id: me.id, allow: [P.ViewChannel, P.SendMessages, P.EmbedLinks, P.ReadMessageHistory] },
          ...modRoles.map((r) => ({ id: r.id, allow: [P.ViewChannel, P.ReadMessageHistory] })),
        ],
        reason: `Croak mod log, created by ${interaction.user.tag}`,
      });
      db.updateSettings(guild.id, { logChannelId: channel.id });
      return interaction.reply(ephemeral(`Done. Croak will post to ${channel}. Next: \`/croak status\` to check everything else.`));
    } catch (err) {
      return interaction.reply(ephemeral(`Couldn't create the channel: ${err.message}`));
    }
  }

  /** Raid alert and lockdown buttons. */
  async function raidButton(interaction, verb, arg) {
    if (!(await kit.allowed(interaction, P.ManageChannels, 'Manage Channels'))) return;
    const guild = interaction.guild;
    if (verb === 'lock') {
      await interaction.deferReply();
      const { summary } = await lockdown.start(guild, { minutes: Number(arg) || 30, by: interaction.user });
      return interaction.editReply({ content: `${interaction.user} started a lockdown. ${summary}`, allowedMentions: { parse: [] } });
    }
    if (verb === 'unlock') {
      await interaction.deferReply();
      return interaction.editReply({ content: `${interaction.user}: ${await lockdown.end(guild, interaction.user)}`, allowedMentions: { parse: [] } });
    }
    // banraid
    if (!(await kit.allowed(interaction, P.BanMembers, 'Ban Members'))) return;
    const raiders = raids.raiders(guild.id);
    if (!raiders.length) return interaction.reply(ephemeral('Croak has no raiders on record for this server right now.'));
    if (arg === 'ask') {
      return interaction.reply(
        ephemeral(`Ban these ${raiders.length} accounts? ${raiders.slice(0, 20).map((id) => `<@${id}>`).join(' ')}`, {
          components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('croak:banraid:ok').setLabel(`Ban ${raiders.length}`).setStyle(ButtonStyle.Danger))],
        }),
      );
    }
    await interaction.deferUpdate();
    let banned = 0;
    for (const id of raiders) {
      const ok = await guild.members.ban(id, { reason: `Croak: raid, banned by ${interaction.user.tag}`, deleteMessageSeconds: 3600 }).then(() => true, () => false);
      if (ok) banned += 1;
    }
    raids.end(guild.id);
    await kit.logChannelFor(guild.id)?.send({ content: `🔨 ${interaction.user} banned ${banned} raider${banned === 1 ? '' : 's'}.`, allowedMentions: { parse: [] } }).catch(() => {});
    return interaction.editReply({ content: `Banned ${banned} of ${raiders.length}.`, components: [] });
  }

  return {
    /** Buttons, menus and forms whose custom ID starts with "croak:". */
    async handle(interaction) {
      const [, verb, ...args] = interaction.customId.split(':');

      if (verb === 'makelog') return makeLog(interaction);
      if (verb === 'set') return settingsPanel.change(interaction, args[0], args[1]);
      if (verb === 'member') return memberActions(interaction, args[0], args[1]);
      if (verb === 'lock' || verb === 'unlock' || verb === 'banraid') return raidButton(interaction, verb, args[0]);
      if (verb === 'reportform') return reports.submitReport(interaction, args[0], args[1]);
      if (verb === 'croakform') return reports.submitCroak(interaction, args[0], args[1]);

      const found = db.getCase(Number(args[0]));
      if (!found) return interaction.reply(ephemeral('That case no longer exists.'));
      switch (verb) {
        case 'approve':
        case 'block':
        case 'dismiss':
        case 'accept':
        case 'reject':
          return cases.decide(interaction, verb, found);
        case 'more':
          return cases.menu(interaction, found);
        case 'banok':
          return cases.confirmBan(interaction, found);
        case 'noteform':
        case 'dmform':
          return cases.form(interaction, verb, found);
        case 'appeal':
          return appeals.start(interaction, found);
        case 'appealform':
          return appeals.submit(interaction, found);
        case 'reply':
          return appeals.askModReply(interaction, found);
        case 'replyform':
          return appeals.sendModReply(interaction, found);
        case 'mreply':
          return appeals.askMemberReply(interaction, found);
        case 'mreplyform':
          return appeals.sendMemberReply(interaction, found);
        default:
          log(`Unknown interaction ${interaction.customId}`);
      }
    },

    /** Right-click commands. */
    contextCommand: (interaction) => reports.command(interaction),
    openSettings: (interaction) => settingsPanel.open(interaction),
  };
}
