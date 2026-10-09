// Right-click tools (Apps menu). Members: "Report to mods". Mods: "Croak this message",
// "Check with Croak", and "Croak: member" on a user.

import { ApplicationCommandType, ContextMenuCommandBuilder, InteractionContextType, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { textModal } from './case-actions.js';
import { collectMessage, isNsfwChannel } from './collect.js';
import { caseButtons, checkEmbed, reportEmbed } from './embeds.js';
import { extractItems } from './extract.js';
import { memberPanel } from './member-panel.js';
import { caseContext, caseItem } from './moderate.js';
import { policyFor } from './settings.js';
import { ephemeral } from './toolkit.js';

const P = PermissionFlagsBits;
const REPORT_COOLDOWN_MS = 60_000;

export const NAMES = {
  report: 'Report to mods',
  croak: 'Croak this message',
  check: 'Check with Croak',
  member: 'Croak: member',
};

export const contextCommands = [
  new ContextMenuCommandBuilder().setName(NAMES.report).setType(ApplicationCommandType.Message).setContexts(InteractionContextType.Guild),
  new ContextMenuCommandBuilder().setName(NAMES.croak).setType(ApplicationCommandType.Message).setContexts(InteractionContextType.Guild).setDefaultMemberPermissions(P.ManageMessages),
  new ContextMenuCommandBuilder().setName(NAMES.check).setType(ApplicationCommandType.Message).setContexts(InteractionContextType.Guild).setDefaultMemberPermissions(P.ManageMessages),
  new ContextMenuCommandBuilder().setName(NAMES.member).setType(ApplicationCommandType.User).setContexts(InteractionContextType.Guild).setDefaultMemberPermissions(P.ManageMessages),
];

export function createReports({ db, judge, kit, moderator, log = console.log }) {
  const lastReport = new Map(); // userId -> time, to stop report spam

  /** Run Croak's checks on a message without acting on it. */
  async function check(message) {
    const collected = collectMessage(message);
    const { links, invites, images } = extractItems(collected);
    const items = [...invites, ...links, ...images, ...collected.embedImages].slice(0, 10);
    if (!items.length) return [];
    const policy = policyFor(db.getSettings(message.guildId), { nsfwChannel: isNsfwChannel(message.channel) });
    return judge.judgeAll(items, { guildId: message.guildId, text: collected.content, policy });
  }

  async function fetchTarget(interaction, channelId, messageId) {
    const channel = interaction.guild.channels.cache.get(channelId);
    return (await channel?.messages.fetch(messageId).catch(() => null)) ?? null;
  }

  /** A right-click command was used. */
  async function command(interaction) {
    const name = interaction.commandName;
    if (name === NAMES.member) {
      return interaction.reply({ ...(await memberPanel({ db, guild: interaction.guild, userId: interaction.targetUser.id })), flags: MessageFlags.Ephemeral });
    }
    const target = interaction.targetMessage;

    if (name === NAMES.report) {
      if (target.author.id === interaction.user.id) return interaction.reply(ephemeral("You can't report your own message."));
      if (target.author.bot) return interaction.reply(ephemeral("Bots' messages can't be reported here. Tell a mod directly."));
      if (!kit.logChannelFor(interaction.guildId)) return interaction.reply(ephemeral("This server hasn't set up Croak's mod log yet, so reports can't be sent."));
      const wait = (lastReport.get(interaction.user.id) ?? 0) + REPORT_COOLDOWN_MS - Date.now();
      if (wait > 0) return interaction.reply(ephemeral(`You can send another report in ${Math.ceil(wait / 1000)} seconds.`));
      return interaction.showModal(
        textModal(`croak:reportform:${target.channelId}:${target.id}`, 'Report to the mods', "What's wrong with it? (optional)", {
          required: false,
          max: 300,
          placeholder: 'e.g. scam link, NSFW, harassment',
        }),
      );
    }

    if (name === NAMES.croak) {
      return interaction.showModal(
        textModal(`croak:croakform:${target.channelId}:${target.id}`, 'Croak this message', 'Reason (optional, shown in the mod log)', { required: false, max: 200 }),
      );
    }

    if (name === NAMES.check) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const results = await check(target);
      if (!results.length) return interaction.editReply('Nothing to check: that message has no links, invites or images.');
      return interaction.editReply({ embeds: results.slice(0, 10).map(checkEmbed) });
    }
  }

  /** A member sent a report. */
  async function submitReport(interaction, channelId, messageId) {
    const message = await fetchTarget(interaction, channelId, messageId);
    if (!message) return interaction.reply(ephemeral('That message is gone already.'));
    const logChannel = kit.logChannelFor(interaction.guildId);
    if (!logChannel) return interaction.reply(ephemeral("This server hasn't set up Croak's mod log yet."));
    lastReport.set(interaction.user.id, Date.now());
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const reason = interaction.fields.getTextInputValue('text').trim();
    const results = await check(message);
    const caseId = db.addCase({
      guildId: interaction.guildId,
      channelId,
      messageId,
      authorId: message.author.id,
      action: 'report',
      reason: reason ? `reported: ${reason.slice(0, 80)}` : 'reported by a member',
      content: message.content || null,
      items: results.map(caseItem),
    });
    db.addCaseEvent(caseId, { actorId: interaction.user.id, kind: 'report', text: reason || null });
    const posted = await logChannel
      .send({
        embeds: [reportEmbed({ caseId, reporter: interaction.user, message, results, reason })],
        components: caseButtons(caseId, 'report', caseContext(message, results)),
        allowedMentions: { parse: [] },
      })
      .catch((err) => log(`Could not post report #${caseId}: ${err.message}`));
    if (posted) db.setCaseLog(caseId, posted.id);
    return interaction.editReply('Thanks. The mods have it.');
  }

  /** A mod croaked a message by hand. */
  async function submitCroak(interaction, channelId, messageId) {
    if (!interaction.memberPermissions?.has(P.ManageMessages)) return interaction.reply(ephemeral('You need the Manage Messages permission to do that.'));
    const message = await fetchTarget(interaction, channelId, messageId);
    if (!message) return interaction.reply(ephemeral('That message is gone already.'));
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const summary = await moderator.croakManually(message, { by: interaction.user, reason: interaction.fields.getTextInputValue('text').trim() });
    return interaction.editReply(summary);
  }

  return { command, submitReport, submitCroak };
}
