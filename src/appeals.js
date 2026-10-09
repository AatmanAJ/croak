// Appeals as a conversation. A member presses "This was a mistake" in the DM and explains; mods
// can Accept, Keep it removed, or Reply with their own message; the member can reply back. Every
// message is posted in the mod log, threaded under the case.

import { MessageFlags } from 'discord.js';
import { textModal } from './case-actions.js';
import { appealButtons, appealEmbed, conversationEmbed, modReplyDM, replyButton } from './embeds.js';
import { ephemeral } from './toolkit.js';

const MAX_REPLIES_EACH = 6; // per side, per case: keeps it a conversation, not a chat room

export function createAppeals({ client, db, kit }) {
  /** The member pressed "This was a mistake" in their DM. */
  async function start(interaction, found) {
    if (interaction.user.id !== found.author_id) return interaction.reply(ephemeral('Only the person whose message was removed can appeal.'));
    if (found.appeal) return interaction.reply(ephemeral('You already appealed this one. The mods will take a look.'));
    if (found.resolution === 'approved') return interaction.reply(ephemeral('A mod already marked this as not spam.'));
    return interaction.showModal(
      textModal(`croak:appealform:${found.id}`, 'Tell the mods what happened', 'Why was this a mistake?', {
        required: false,
        placeholder: "e.g. It's a link to my own project, or my account was hacked and I've fixed it.",
      }),
    );
  }

  async function submit(interaction, found) {
    if (interaction.user.id !== found.author_id || found.appeal) return interaction.reply(ephemeral('This appeal was already sent.'));
    const channel = kit.logChannelFor(found.guild_id);
    if (!channel) return interaction.reply(ephemeral("That server's mods haven't set up a place for appeals yet. Message them directly."));
    const text = interaction.fields.getTextInputValue('text');
    db.setAppeal(found.id, 'open');
    db.addCaseEvent(found.id, { actorId: interaction.user.id, kind: 'member_reply', text: text || '(no message)' });
    const caseLog = await kit.caseLogMessage(found);
    await channel.send({
      embeds: [appealEmbed({ caseId: found.id, user: interaction.user, text, reason: found.reason })],
      components: appealButtons(found.id),
      reply: caseLog ? { messageReference: caseLog.id, failIfNotExists: false } : undefined,
      allowedMentions: { parse: [] },
    });
    await kit.addHistory(found, `Appeal received from ${interaction.user}`, { actorId: interaction.user.id, kind: 'action', text: 'appealed' });
    return interaction.reply(ephemeral("Sent to the mods. You'll get a message here when they decide or reply."));
  }

  /** A mod pressed Reply… under an appeal or a member's reply. */
  async function askModReply(interaction, found) {
    if (!(await kit.allowed(interaction))) return;
    if (db.countCaseEvents(found.id, 'mod_reply') >= MAX_REPLIES_EACH) {
      return interaction.reply(ephemeral(`That's ${MAX_REPLIES_EACH} replies on this case already. Message them directly, or decide the appeal.`));
    }
    return interaction.showModal(textModal(`croak:replyform:${found.id}`, `Reply to the member (case #${found.id})`, 'Your message', { placeholder: 'Sent as a DM from Croak, on behalf of the mods.' }));
  }

  async function sendModReply(interaction, found) {
    if (!(await kit.allowed(interaction))) return;
    const text = interaction.fields.getTextInputValue('text').trim();
    const sent = await kit.dm(found.author_id, modReplyDM({ guildName: interaction.guild.name, text, caseId: found.id }));
    db.addCaseEvent(found.id, { actorId: interaction.user.id, kind: 'mod_reply', text });
    await interaction.channel.send({
      embeds: [conversationEmbed({ caseId: found.id, from: interaction.user, to: `<@${found.author_id}>`, text, fromMember: false })],
      reply: interaction.message ? { messageReference: interaction.message.id, failIfNotExists: false } : undefined,
      allowedMentions: { parse: [] },
    });
    return interaction.reply(ephemeral(sent ? 'Sent. Their reply will show up here.' : "Couldn't deliver it: their DMs are closed."));
  }

  /** The member pressed "Reply to the mods" in a DM. */
  async function askMemberReply(interaction, found) {
    if (interaction.user.id !== found.author_id) return interaction.reply(ephemeral('This conversation belongs to someone else.'));
    if (db.countCaseEvents(found.id, 'member_reply') >= MAX_REPLIES_EACH + 1) {
      return interaction.reply(ephemeral("You've sent the mods several replies already. They'll get back to you."));
    }
    return interaction.showModal(textModal(`croak:mreplyform:${found.id}`, 'Reply to the mods', 'Your message'));
  }

  async function sendMemberReply(interaction, found) {
    if (interaction.user.id !== found.author_id) return interaction.reply(ephemeral('This conversation belongs to someone else.'));
    const channel = kit.logChannelFor(found.guild_id);
    if (!channel) return interaction.reply(ephemeral("The mods' channel isn't reachable right now. Try messaging them directly."));
    const text = interaction.fields.getTextInputValue('text').trim();
    db.addCaseEvent(found.id, { actorId: interaction.user.id, kind: 'member_reply', text });
    await channel.send({
      embeds: [conversationEmbed({ caseId: found.id, from: interaction.user, to: 'the mods', text, fromMember: true })],
      components: replyButton(found.id),
      allowedMentions: { parse: [] },
    });
    return interaction.reply({ content: 'Sent to the mods.', flags: MessageFlags.Ephemeral });
  }

  return { start, submit, askModReply, sendModReply, askMemberReply, sendMemberReply };
}
