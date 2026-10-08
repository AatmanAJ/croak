// Buttons and forms: a mod's Approve / Not spam / Block on a case, a member's appeal from the DM,
// a mod accepting or rejecting that appeal, and the welcome message's "create a log channel".

import {
  ActionRowBuilder,
  ChannelType,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { appealButtons, appealEmbed, resolvedEmbed } from './embeds.js';
import { saveModDecision } from './overrides.js';
import { pardon, punish } from './punish.js';

const ephemeral = (content) => ({ content, flags: MessageFlags.Ephemeral });

export function createInteractions({ client, db, automod, log = console.log }) {
  /** The mod log for a case's server, if it's set up and reachable. */
  function logChannelFor(guildId) {
    const guild = client.guilds.cache.get(guildId);
    const id = guild && db.getSettings(guildId).logChannelId;
    return id ? guild.channels.cache.get(id) : null;
  }

  /** Save the mod's decision on every flagged item in the case, and undo or apply punishment. */
  async function applyDecision(found, resolution, moderator) {
    const guild = client.guilds.cache.get(found.guild_id);
    const settings = db.getSettings(found.guild_id);
    const verdict = resolution === 'approved' ? 'allow' : 'block';
    const notes = [];

    // Items that were fine (say, a YouTube link next to the scam) are left alone
    for (const item of found.items.filter((i) => i.verdict !== 'allow' && i.cacheKind && i.cacheKey)) {
      const network = saveModDecision(db, { guildId: found.guild_id, kind: item.cacheKind, key: item.cacheKey, verdict, scores: item.scores });
      if (network) notes.push(`\`${item.label.slice(0, 60)}\` is now blocked across every Croak server.`);
      if (verdict === 'block' && item.kind === 'link' && item.host) automod?.addHost(found.guild_id, item.host);
    }

    const member = await guild?.members.fetch(found.author_id).catch(() => null);
    if (resolution === 'approved') {
      await pardon(member, { settings, by: moderator.tag });
      if (found.action === 'hold' && found.content) notes.push(await repost(guild, found, member));
    } else {
      if (found.action === 'flag') {
        await guild?.channels.cache.get(found.channel_id)?.messages.delete(found.message_id).catch(() => {});
      }
      notes.push(await punish(member, { settings, strikes: db.strikes(found.guild_id, found.author_id), reason: `blocked by ${moderator.tag}` }));
    }
    return notes.filter(Boolean).join(' ');
  }

  /** Repost a held message once approved, under the member's name, via a channel webhook. */
  async function repost(guild, found, member) {
    const channel = guild?.channels.cache.get(found.channel_id);
    if (!channel) return '';
    const original = await channel.messages.fetch(found.message_id).catch(() => null);
    if (original) return ''; // it was never removed
    const target = channel.isThread() ? channel.parent : channel;
    const me = guild.members.me;
    if (!target?.permissionsFor(me)?.has(PermissionFlagsBits.ManageWebhooks)) {
      return 'Could not repost it (Croak needs Manage Webhooks); they can post it again.';
    }
    try {
      const hooks = await target.fetchWebhooks();
      const hook =
        hooks.find((h) => h.owner?.id === me.id && h.name === 'Croak') ??
        (await target.createWebhook({ name: 'Croak', reason: 'Reposting messages approved by mods' }));
      const send = (username) =>
        hook.send({
          content: found.content.slice(0, 2000),
          username,
          avatarURL: member?.displayAvatarURL(),
          allowedMentions: { parse: [] },
          threadId: channel.isThread() ? channel.id : undefined,
        });
      // Webhook names can't contain some words (like "discord"); fall back to a plain label
      await send(member?.displayName ?? 'Member').catch(() => send('Approved message'));
      return 'Reposted their message.';
    } catch (err) {
      return `Could not repost it: ${err.message}.`;
    }
  }

  async function editLogMessage(found, update) {
    if (!found.log_message_id) return;
    const channel = logChannelFor(found.guild_id);
    const message = await channel?.messages.fetch(found.log_message_id).catch(() => null);
    if (message) await message.edit(update(message)).catch(() => {});
  }

  async function onCaseButton(interaction, verb, found) {
    if (!interaction.inGuild() || found.guild_id !== interaction.guildId) return interaction.reply(ephemeral('That case belongs to another server.'));
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) {
      return interaction.reply(ephemeral('You need the Manage Messages permission to do that.'));
    }
    const resolution = verb === 'approve' || verb === 'accept' ? 'approved' : 'blocked';

    if (verb === 'reject') {
      db.setAppeal(found.id, 'rejected');
      await interaction.update({ embeds: [resolvedEmbed(interaction.message.embeds[0], { resolution: 'blocked', by: interaction.user, note: 'Appeal rejected' })], components: [] });
      await notifyMember(found, 'The mods looked at your appeal and kept the message removed.');
      return;
    }

    if (!db.resolveCase(found.id, interaction.user.id, resolution)) {
      return interaction.reply(ephemeral('Another mod already handled this case.'));
    }
    await interaction.deferUpdate();
    const note = await applyDecision(found, resolution, interaction.user);
    await interaction.editReply({ embeds: [resolvedEmbed(interaction.message.embeds[0], { resolution, by: interaction.user, note })], components: [] });

    if (verb === 'accept') {
      db.setAppeal(found.id, 'accepted');
      // Also close the original case entry
      await editLogMessage(found, (m) => ({ embeds: [resolvedEmbed(m.embeds[0], { resolution, by: interaction.user, note: 'via appeal' })], components: [] }));
      await notifyMember(found, "The mods accepted your appeal. Croak won't flag that again in this server.");
    }
  }

  async function notifyMember(found, text) {
    const user = await client.users.fetch(found.author_id).catch(() => null);
    const guild = client.guilds.cache.get(found.guild_id);
    await user?.send(`${guild ? `**${guild.name}:** ` : ''}${text}`).catch(() => {});
  }

  /** A member pressed "This was a mistake" in their DM: ask them what happened. */
  async function onAppealButton(interaction, found) {
    if (interaction.user.id !== found.author_id) return interaction.reply(ephemeral('Only the person whose message was removed can appeal.'));
    if (found.appeal) return interaction.reply(ephemeral('You already appealed this one. The mods will take a look.'));
    if (found.resolution === 'approved') return interaction.reply(ephemeral('A mod already marked this as not spam.'));
    const modal = new ModalBuilder()
      .setCustomId(`croak:appealform:${found.id}`)
      .setTitle('Tell the mods what happened')
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('text')
            .setLabel('Why was this a mistake?')
            .setStyle(TextInputStyle.Paragraph)
            .setMaxLength(800)
            .setRequired(false)
            .setPlaceholder("e.g. It's a link to my own project, or my account was hacked and I've fixed it."),
        ),
      );
    return interaction.showModal(modal);
  }

  async function onAppealForm(interaction, found) {
    if (interaction.user.id !== found.author_id || found.appeal) return interaction.reply(ephemeral('This appeal was already sent.'));
    const channel = logChannelFor(found.guild_id);
    if (!channel) return interaction.reply(ephemeral("That server's mods haven't set up a place for appeals yet. Message them directly."));
    const text = interaction.fields.getTextInputValue('text');
    db.setAppeal(found.id, 'open');
    await channel.send({ embeds: [appealEmbed({ caseId: found.id, user: interaction.user, text, reason: found.reason })], components: appealButtons(found.id) });
    return interaction.reply(ephemeral("Sent to the mods. You'll get a message here when they decide."));
  }

  /** The welcome message's button: create a private #croak-log only Croak and mods can see. */
  async function onMakeLog(interaction) {
    if (!interaction.inGuild() || !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply(ephemeral('Setting up Croak needs the Manage Server permission.'));
    }
    const guild = interaction.guild;
    const me = guild.members.me;
    if (!me.permissions.has(PermissionFlagsBits.ManageChannels)) {
      return interaction.reply(ephemeral("Croak can't create channels here. Make a private channel yourself, add Croak to it, then run `/croak setup channel:#that-channel`."));
    }
    const modRoles = guild.roles.cache.filter(
      (r) => !r.managed && r.id !== guild.id && r.permissions.has(PermissionFlagsBits.ManageMessages),
    );
    try {
      const channel = await guild.channels.create({
        name: 'croak-log',
        type: ChannelType.GuildText,
        topic: 'What Croak croaks, holds and flags. Only mods can see this.',
        permissionOverwrites: [
          { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
          {
            id: me.id,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.ReadMessageHistory],
          },
          ...modRoles.map((r) => ({ id: r.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory] })),
        ],
        reason: `Croak mod log, created by ${interaction.user.tag}`,
      });
      db.updateSettings(guild.id, { logChannelId: channel.id });
      return interaction.reply(ephemeral(`Done. Croak will post to ${channel}. Next: \`/croak status\` to check everything else.`));
    } catch (err) {
      return interaction.reply(ephemeral(`Couldn't create the channel: ${err.message}`));
    }
  }

  return {
    /** Handles every croak:* button and form. */
    async handle(interaction) {
      const [, verb, id] = interaction.customId.split(':');
      if (verb === 'makelog') return onMakeLog(interaction);

      const found = db.getCase(Number(id));
      if (!found) return interaction.reply(ephemeral('That case no longer exists.'));
      if (verb === 'appeal') return onAppealButton(interaction, found);
      if (verb === 'appealform') return onAppealForm(interaction, found);
      if (['approve', 'block', 'accept', 'reject'].includes(verb)) return onCaseButton(interaction, verb, found);
      log(`Unknown button ${interaction.customId}`);
    },
  };
}
