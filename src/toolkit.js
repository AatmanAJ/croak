// Helpers every mod tool shares: finding the mod log, messaging members, reposting, recording
// what happened on a case, and checking that whoever pressed a button is allowed to.

import { EmbedBuilder, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { saveModDecision } from './overrides.js';

export const ephemeral = (content, extra = {}) => ({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] }, ...extra });

const MAX_HISTORY_LINES = 12;

export function createToolkit({ client, db, automod, log = console.log }) {
  const kit = {
    /** The mod log for a server, if it's set up and Croak can see it. */
    logChannelFor(guildId) {
      const guild = client.guilds.cache.get(guildId);
      const id = guild && db.getSettings(guildId).logChannelId;
      return id ? guild.channels.cache.get(id) ?? null : null;
    },

    async memberOf(guildId, userId) {
      const guild = client.guilds.cache.get(guildId);
      return (await guild?.members.fetch(userId).catch(() => null)) ?? null;
    },

    /**
     * Refuses (with an ephemeral reply) unless the person who pressed has the permission in this
     * server. Returns true if they're allowed.
     */
    async allowed(interaction, permission = PermissionFlagsBits.ManageMessages, label = 'Manage Messages') {
      if (interaction.inGuild() && interaction.memberPermissions?.has(permission)) return true;
      await interaction.reply(ephemeral(`You need the ${label} permission to do that.`)).catch(() => {});
      return false;
    },

    /** DM a member. Returns true if it was delivered. */
    async dm(userId, payload) {
      const user = await client.users.fetch(userId).catch(() => null);
      if (!user) return false;
      return user
        .send(typeof payload === 'string' ? { content: payload, allowedMentions: { parse: [] } } : { allowedMentions: { parse: [] }, ...payload })
        .then(() => true)
        .catch(() => false);
    },

    /** Fetch the mod-log message for a case, if it still exists. */
    async caseLogMessage(found) {
      if (!found.log_message_id) return null;
      return (await kit.logChannelFor(found.guild_id)?.messages.fetch(found.log_message_id).catch(() => null)) ?? null;
    },

    /** Edit a case's mod-log message. */
    async editCaseLog(found, update) {
      const message = await kit.caseLogMessage(found);
      if (message) await message.edit(update(message)).catch((err) => log(`Could not update case #${found.id}: ${err.message}`));
    },

    /**
     * Add a line to the case's "History" field (who did what, when) and record it. Keeps the
     * newest lines if it gets long.
     */
    async addHistory(found, line, { actorId = null, kind = 'action', text = null } = {}) {
      db.addCaseEvent(found.id, { actorId, kind, text: text ?? line });
      await kit.editCaseLog(found, (message) => {
        const embed = EmbedBuilder.from(message.embeds[0]);
        const fields = embed.data.fields ?? [];
        const index = fields.findIndex((f) => f.name === 'History');
        const stamp = `<t:${Math.floor(Date.now() / 1000)}:t>`;
        const lines = index >= 0 ? fields[index].value.split('\n') : [];
        lines.push(`${stamp} ${line}`);
        const value = lines.slice(-MAX_HISTORY_LINES).join('\n').slice(-1024);
        if (index >= 0) fields[index] = { name: 'History', value };
        else fields.push({ name: 'History', value });
        embed.setFields(fields.slice(0, 25));
        return { embeds: [embed] };
      });
    },

    /**
     * Save a mod's allow/block on every flagged item in a case for this server (and into AutoMod
     * for blocked links). Returns notes about anything that became a network-wide block.
     */
    saveCaseDecision(found, verdict, { wholeSite = false } = {}) {
      const notes = [];
      for (const item of found.items.filter((i) => i.verdict !== 'allow' && i.cacheKind && i.cacheKey)) {
        const kind = wholeSite && item.kind === 'link' && item.host ? 'domain' : item.cacheKind;
        const key = kind === 'domain' ? item.host : item.cacheKey;
        if (saveModDecision(db, { guildId: found.guild_id, kind, key, verdict, scores: item.scores })) {
          notes.push(`\`${(kind === 'domain' ? key : item.label).slice(0, 60)}\` is now blocked across every Croak server.`);
        }
        if (verdict === 'block' && item.kind === 'link' && item.host) automod?.addHost(found.guild_id, item.host);
      }
      return notes;
    },

    /** Repost a removed message under the member's name, via a channel webhook, with pings off. */
    async repost(found, member) {
      const guild = client.guilds.cache.get(found.guild_id);
      const channel = guild?.channels.cache.get(found.channel_id);
      if (!channel || !found.content) return '';
      const original = await channel.messages.fetch(found.message_id).catch(() => null);
      if (original) return ''; // it was never removed
      const target = channel.isThread() ? channel.parent : channel;
      const me = guild.members.me;
      if (!target?.permissionsFor(me)?.has(PermissionFlagsBits.ManageWebhooks)) {
        return "Could not repost it: Croak doesn't have the Manage Webhooks permission (press Fix permissions in `/croak status`). They can post it again.";
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
    },
  };
  return kit;
}
