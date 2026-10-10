// What mods can do from a case in the log: the decision buttons (Not spam / Approve / Block /
// Dismiss, and Accept / Keep removed on appeals) and the "More actions…" menu.

import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, ModalBuilder, PermissionFlagsBits, TextInputBuilder, TextInputStyle } from 'discord.js';
import { modReplyDM, resolvedEmbed } from './embeds.js';
import { fixRow, lacks, whyNot } from './health.js';
import { memberPanel } from './member-panel.js';
import { pardon, punish } from './punish.js';
import { ephemeral } from './toolkit.js';

const P = PermissionFlagsBits;
const DAY = 24 * 60 * 60 * 1000;

/** A one-field form. */
export function textModal(customId, title, label, { placeholder = '', max = 800, required = true, style = TextInputStyle.Paragraph } = {}) {
  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle(title)
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('text').setLabel(label).setStyle(style).setMaxLength(max).setRequired(required).setPlaceholder(placeholder),
      ),
    );
}

export function createCaseActions({ client, db, kit, log = console.log }) {
  /** Undo or apply punishment, and remember the decision for this server. Returns a note. */
  async function applyDecision(found, resolution, moderator) {
    const settings = db.getSettings(found.guild_id);
    const notes = kit.saveCaseDecision(found, resolution === 'approved' ? 'allow' : 'block');
    const member = await kit.memberOf(found.guild_id, found.author_id);
    if (resolution === 'approved') {
      await pardon(member, { settings, by: moderator.tag });
      // Removed by mistake: put it back under their name
      if (['hold', 'delete'].includes(found.action) && found.content) notes.push(await kit.repost(found, member));
    } else {
      if (found.action === 'flag' || found.action === 'report') {
        const guild = client.guilds.cache.get(found.guild_id);
        await guild?.channels.cache.get(found.channel_id)?.messages.delete(found.message_id).catch(() => {});
      }
      notes.push(await punish(member, { settings, strikes: db.strikes(found.guild_id, found.author_id), reason: `blocked by ${moderator.tag}` }));
    }
    return notes.filter(Boolean).join(' ');
  }

  /** Not spam / Approve / Block / Dismiss on a case; Accept / Keep removed on an appeal. */
  async function decide(interaction, verb, found) {
    if (!interaction.inGuild() || found.guild_id !== interaction.guildId) return interaction.reply(ephemeral('That case belongs to another server.'));
    if (!(await kit.allowed(interaction))) return;

    if (verb === 'reject') {
      db.setAppeal(found.id, 'rejected');
      await interaction.update({ embeds: [resolvedEmbed(interaction.message.embeds[0], { resolution: 'blocked', by: interaction.user, note: 'Appeal rejected' })], components: [] });
      await kit.dm(found.author_id, `**${interaction.guild.name}:** The mods looked at your appeal and kept the message removed.`);
      await kit.addHistory(found, `Appeal rejected by ${interaction.user}`, { actorId: interaction.user.id, text: 'appeal rejected' });
      return;
    }

    if (verb === 'dismiss') {
      if (!db.resolveCase(found.id, interaction.user.id, 'dismissed')) return interaction.reply(ephemeral('Another mod already handled this case.'));
      return interaction.update({ embeds: [resolvedEmbed(interaction.message.embeds[0], { resolution: 'dismissed', by: interaction.user })], components: [] });
    }

    const resolution = verb === 'approve' || verb === 'accept' ? 'approved' : 'blocked';
    if (!db.resolveCase(found.id, interaction.user.id, resolution)) {
      return interaction.reply(ephemeral('Another mod already handled this case.'));
    }
    await interaction.deferUpdate();
    const note = await applyDecision(found, resolution, interaction.user);
    // Keep the "More actions" menu; drop the decision buttons
    const menuRow = interaction.message.components.find((row) => row.components.some((c) => c.customId?.startsWith('croak:more:')));
    await interaction.editReply({ embeds: [resolvedEmbed(interaction.message.embeds[0], { resolution, by: interaction.user, note })], components: menuRow ? [menuRow] : [] });

    if (verb === 'accept') {
      db.setAppeal(found.id, 'accepted');
      await kit.editCaseLog(found, (m) => ({ embeds: [resolvedEmbed(m.embeds[0], { resolution, by: interaction.user, note: 'via appeal' })] }));
      await kit.dm(found.author_id, `**${interaction.guild.name}:** The mods accepted your appeal. Croak won't flag that again in this server.`);
    }
  }

  /** The "More actions…" menu. */
  async function menu(interaction, found) {
    if (!interaction.inGuild() || found.guild_id !== interaction.guildId) return interaction.reply(ephemeral('That case belongs to another server.'));
    const choice = interaction.values[0];
    const mod = interaction.user;
    const guild = interaction.guild;
    const need = { timeout: [P.ModerateMembers, 'Timeout Members'], untimeout: [P.ModerateMembers, 'Timeout Members'], kick: [P.KickMembers, 'Kick Members'], ban: [P.BanMembers, 'Ban Members'] }[choice];
    if (!(await kit.allowed(interaction, ...(need ?? [P.ManageMessages, 'Manage Messages'])))) return;

    if (choice === 'dm') return interaction.showModal(textModal(`croak:dmform:${found.id}`, 'Message the member', 'What should Croak send them?', { placeholder: 'This is sent as a DM from Croak, on behalf of the mods.' }));
    if (choice === 'note') return interaction.showModal(textModal(`croak:noteform:${found.id}`, `Note on case #${found.id}`, 'Note (only mods see it)', { max: 400 }));
    if (choice === 'history') return interaction.reply({ ...(await memberPanel({ db, guild, userId: found.author_id })), flags: MessageFlags.Ephemeral });
    if (choice === 'ban') {
      return interaction.reply(
        ephemeral(`Ban <@${found.author_id}>? Their last hour of messages is deleted too.`, {
          components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`croak:banok:${found.id}`).setLabel('Yes, ban them').setStyle(ButtonStyle.Danger))],
        }),
      );
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const member = await kit.memberOf(found.guild_id, found.author_id);
    let done;
    switch (choice) {
      case 'repost':
        done = (await kit.repost(found, member)) || 'The message is still up, so there was nothing to repost.';
        break;
      case 'watch':
        db.setWatch(guild.id, found.author_id, Date.now() + 7 * DAY, mod.id);
        done = `Watching <@${found.author_id}> for 7 days: every link and image they post is held for review.`;
        break;
      case 'blocksite': {
        const hosts = [...new Set(found.items.filter((i) => i.kind === 'link' && i.host && i.verdict !== 'allow').map((i) => i.host))];
        const network = kit.saveCaseDecision(found, 'block', { wholeSite: true });
        done = hosts.length ? `Every link on ${hosts.map((h) => `\`${h}\``).join(', ')} is now croaked in this server. ${network.join(' ')}` : 'There were no flagged links on this case.';
        break;
      }
      case 'timeout':
        done = !member ? 'They have left the server.' : !member.moderatable ? `Couldn't time them out. ${whyNot(member, 'timeout')}` : await member.timeout(DAY, `Croak: by ${mod.tag} from case #${found.id}`).then(() => 'Timed out for 1 day.', (e) => `Timeout failed: ${e.message}`);
        break;
      case 'untimeout':
        if (member) await pardon(member, { settings: db.getSettings(guild.id), by: mod.tag });
        done = member ? 'Timeout and quarantine role removed.' : 'They have left the server.';
        break;
      case 'kick':
        done = !member ? 'They have left the server.' : !member.kickable ? `Couldn't kick them. ${whyNot(member, 'kick')}` : await member.kick(`Croak: by ${mod.tag} from case #${found.id}`).then(() => 'Kicked.', (e) => `Kick failed: ${e.message}`);
        break;
      default:
        done = 'Unknown action.';
    }
    await kit.addHistory(found, `${mod}: ${done}`, { actorId: mod.id, text: done });
    return interaction.editReply(/^Couldn't/.test(done) ? { content: done, components: [fixRow(guild)] } : done);
  }

  async function confirmBan(interaction, found) {
    if (!(await kit.allowed(interaction, P.BanMembers, 'Ban Members'))) return;
    const missing = lacks(interaction.guild, P.BanMembers);
    if (missing) return interaction.update({ content: `Couldn't ban them. ${missing}`, components: [fixRow(interaction.guild)] });
    const member = await kit.memberOf(found.guild_id, found.author_id);
    if (member && !member.bannable) return interaction.update({ content: `Couldn't ban them. ${whyNot(member, 'ban')}`, components: [fixRow(interaction.guild)] });
    const result = await interaction.guild.members
      .ban(found.author_id, { reason: `Croak: by ${interaction.user.tag} from case #${found.id}`, deleteMessageSeconds: 3600 })
      .then(() => 'Banned. Their last hour of messages was deleted.', (e) => `Ban failed: ${e.message}`);
    await kit.addHistory(found, `${interaction.user}: ${result}`, { actorId: interaction.user.id, text: result });
    return interaction.update({ content: result, components: [] });
  }

  /** Note and DM forms from the menu. */
  async function form(interaction, kind, found) {
    if (!(await kit.allowed(interaction))) return;
    const text = interaction.fields.getTextInputValue('text').trim();
    if (kind === 'noteform') {
      await kit.addHistory(found, `📝 ${interaction.user}: ${text.slice(0, 300)}`, { actorId: interaction.user.id, kind: 'note', text });
      return interaction.reply(ephemeral('Note added to the case.'));
    }
    // dmform: a message to the member, which they can reply to
    const sent = await kit.dm(found.author_id, modReplyDM({ guildName: interaction.guild.name, text, caseId: found.id }));
    await kit.addHistory(found, `✉️ ${interaction.user} messaged them${sent ? '' : ' (not delivered: DMs closed)'}: ${text.slice(0, 200)}`, { actorId: interaction.user.id, kind: 'mod_reply', text });
    return interaction.reply(ephemeral(sent ? 'Sent. If they reply, it shows up in the mod log.' : "Couldn't deliver it: their DMs are closed."));
  }

  return { decide, menu, confirmBan, form };
}
