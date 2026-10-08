// Mirrors confirmed scam domains into a Discord AutoMod rule. AutoMod blocks a message before
// it's sent, so nobody gets a notification for it, which deleting afterwards can't undo.
// Opt-in per server (/croak automod), and needs the Manage Server permission.

import { AutoModerationActionType, AutoModerationRuleEventType, AutoModerationRuleTriggerType, PermissionFlagsBits } from 'discord.js';
import { parse } from 'tldts';

export const RULE_NAME = 'Croak: known scam links';
const MAX_KEYWORDS = 1000; // Discord's limit per keyword rule
const MAX_KEYWORD_LENGTH = 60;
const CONFIDENT = 0.95;

// Sites many people share: blocking the whole site would block innocent links. A subdomain of one
// (scam.pages.dev) is fine to block on its own.
const SHARED_HOSTS = new Set([
  't.me', 'telegram.me', 'bit.ly', 'tinyurl.com', 't.co', 'is.gd', 'cutt.ly', 'rb.gy', 'shorturl.at', 'goo.su', 'ow.ly', 'tiny.cc',
  'rebrand.ly', 'linktr.ee', 'x.com', 'twitter.com', 'instagram.com', 'facebook.com', 'tiktok.com', 'reddit.com', 'medium.com',
  'docs.google.com', 'drive.google.com', 'forms.gle', 'sites.google.com', 'github.io', 'pages.dev', 'vercel.app', 'netlify.app',
  'web.app', 'firebaseapp.com', 'glitch.me', 'replit.app', 'blogspot.com', 'wixsite.com', 'weebly.com', 'notion.site', 'imgur.com',
  'dropbox.com', 'mega.nz', 'mediafire.com', 'gofile.io', 'discord.com', 'discord.gg', 'base44.app',
]);

/** The keyword to block for a host, or null if blocking it would hit innocent links. */
export function keywordFor(host) {
  const { domain } = parse(host);
  if (!domain || SHARED_HOSTS.has(host) || (SHARED_HOSTS.has(domain) && host === domain)) return null;
  const keyword = `*${host}*`;
  return keyword.length <= MAX_KEYWORD_LENGTH ? keyword : null;
}

/** Should this judged link go into AutoMod? Mods' blocks always; the AI's only when it's very sure. */
export function shouldMirror(result) {
  if (result.item?.kind !== 'link' || result.verdict !== 'block') return false;
  if (result.source === 'mod' || result.source === 'network') return true;
  const s = result.scores ?? {};
  return Math.max(s.scam ?? 0, s.nsfw ?? 0) >= CONFIDENT;
}

/** Newest keywords last, unique, within Discord's limit. */
export function mergeKeywords(existing, added) {
  const merged = [...existing.filter((k) => !added.includes(k)), ...added];
  return merged.slice(-MAX_KEYWORDS);
}

export function createAutomodSync({ client, db, log = console.log, flushMs = 30_000 }) {
  const pending = new Map(); // guildId -> Set(keyword)
  const timer = setInterval(() => flush().catch((err) => log('AutoMod sync failed:', err.message)), flushMs);
  timer.unref();

  async function ruleFor(guild, settings) {
    if (settings.automod.ruleId) {
      const existing = await guild.autoModerationRules.fetch({ autoModerationRule: settings.automod.ruleId, force: true }).catch(() => null);
      if (existing) return existing;
    }
    const rule = await guild.autoModerationRules.create({
      name: RULE_NAME,
      eventType: AutoModerationRuleEventType.MessageSend,
      triggerType: AutoModerationRuleTriggerType.Keyword,
      triggerMetadata: { keywordFilter: [] },
      actions: [{ type: AutoModerationActionType.BlockMessage, metadata: { customMessage: 'Croak blocked this link: it was flagged as a scam.' } }],
      enabled: true,
      exemptRoles: settings.exemptRoles,
      exemptChannels: settings.exemptChannels,
      reason: 'Croak AutoMod sync turned on',
    });
    db.updateSettings(guild.id, { automod: { ...settings.automod, ruleId: rule.id } });
    return rule;
  }

  async function flush() {
    for (const [guildId, keywords] of pending) {
      pending.delete(guildId);
      const guild = client.guilds.cache.get(guildId);
      const settings = db.getSettings(guildId);
      if (!guild || !settings.automod.enabled || !guild.members.me?.permissions.has(PermissionFlagsBits.ManageGuild)) continue;
      try {
        const rule = await ruleFor(guild, settings);
        const current = rule.triggerMetadata.keywordFilter ?? [];
        const next = mergeKeywords(current, [...keywords]);
        if (next.length !== current.length || next.some((k, i) => k !== current[i])) {
          await rule.edit({ triggerMetadata: { keywordFilter: next }, reason: 'Croak: new scam domains' });
        }
      } catch (err) {
        log(`AutoMod sync failed in ${guild.name}: ${err.message}`);
      }
    }
  }

  return {
    /** Queue a judged result's domain for the server's AutoMod rule, if it qualifies. */
    consider(guildId, result) {
      if (!shouldMirror(result) || !db.getSettings(guildId).automod.enabled) return;
      const keyword = keywordFor(result.item.host ?? result.host);
      if (!keyword) return;
      if (!pending.has(guildId)) pending.set(guildId, new Set());
      pending.get(guildId).add(keyword);
    },

    /** Queue a host directly (a mod's /croak block). */
    addHost(guildId, host) {
      const keyword = keywordFor(host);
      if (!keyword || !db.getSettings(guildId).automod.enabled) return;
      if (!pending.has(guildId)) pending.set(guildId, new Set());
      pending.get(guildId).add(keyword);
    },

    /** Turn the rule on (creating it) or off (deleting it). Returns a message for the mod. */
    async setEnabled(guild, enabled) {
      const settings = db.getSettings(guild.id);
      if (!guild.members.me.permissions.has(PermissionFlagsBits.ManageGuild)) {
        return 'Croak needs the **Manage Server** permission to manage AutoMod rules.';
      }
      if (enabled) {
        db.updateSettings(guild.id, { automod: { ...settings.automod, enabled: true } });
        try {
          await ruleFor(guild, db.getSettings(guild.id));
        } catch (err) {
          db.updateSettings(guild.id, { automod: { ...settings.automod, enabled: false } });
          return `Couldn't create the AutoMod rule: ${err.message}`;
        }
        return `AutoMod sync is on. Scam sites Croak is sure about go into the **${RULE_NAME}** rule, so the next post is blocked before anyone is pinged.`;
      }
      if (settings.automod.ruleId) {
        const rule = await guild.autoModerationRules.fetch({ autoModerationRule: settings.automod.ruleId }).catch(() => null);
        await rule?.delete('Croak AutoMod sync turned off').catch(() => {});
      }
      db.updateSettings(guild.id, { automod: { enabled: false, ruleId: null } });
      return 'AutoMod sync is off and the Croak rule has been removed.';
    },

    flush,
    stop() {
      clearInterval(timer);
    },
  };
}
