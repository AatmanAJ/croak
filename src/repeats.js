// Spots the same message posted across several channels in a short time, a classic sign of a
// hacked account or a spam bot. It's free and instant, so it runs before any AI check.

import { createHash } from 'node:crypto';

const MIN_TEXT_LENGTH = 15; // "gm" in three channels isn't spam

/** A fingerprint of a message's text and attachments, or null if it's too small to judge. */
export function fingerprint({ content = '', attachments = [] }) {
  const text = content.toLowerCase().replace(/\s+/g, ' ').trim();
  if (text.length < MIN_TEXT_LENGTH && attachments.length === 0) return null;
  const files = attachments.map((a) => `${a.name}:${a.size}`).join('|');
  return createHash('sha1').update(`${text}\n${files}`).digest('hex');
}

export function createRepeatTracker({ channels, windowMs }) {
  const recent = new Map(); // "guild:user" -> [{ print, channelId, messageId, at }]

  return {
    /**
     * Record a message. Returns every copy (including this one) once the same fingerprint has
     * appeared in `channels` different channels within the window, otherwise null.
     */
    record({ guildId, userId, channelId, messageId, print, now = Date.now() }) {
      if (!print) return null;
      const key = `${guildId}:${userId}`;
      const entries = (recent.get(key) ?? []).filter((e) => now - e.at < windowMs);
      entries.push({ print, channelId, messageId, at: now });
      recent.set(key, entries);

      const copies = entries.filter((e) => e.print === print);
      return new Set(copies.map((c) => c.channelId)).size >= channels ? copies : null;
    },

    /** Drop entries older than the window. Call now and then so idle users don't pile up. */
    sweep(now = Date.now()) {
      for (const [key, entries] of recent) {
        const fresh = entries.filter((e) => now - e.at < windowMs);
        if (fresh.length) recent.set(key, fresh);
        else recent.delete(key);
      }
    },

    get size() {
      return recent.size;
    },
  };
}
