// Short-term memory kept in RAM: who posted what recently (for cleanup after a croak) and
// whether a server is being raided.

/**
 * Remembers each member's recent messages so that, when one is croaked, their other posts from
 * the last few minutes can be cleaned up too (hacked accounts post in several channels).
 */
export function createRecentMessages({ keepMs = 30 * 60_000, perUser = 50 } = {}) {
  const recent = new Map(); // "guild:user" -> [{ channelId, messageId, at }]
  return {
    record({ guildId, userId, channelId, messageId, now = Date.now() }) {
      const key = `${guildId}:${userId}`;
      const list = (recent.get(key) ?? []).filter((m) => now - m.at < keepMs && m.messageId !== messageId);
      list.push({ channelId, messageId, at: now });
      recent.set(key, list.slice(-perUser));
    },

    /** Their messages from the last `withinMs`, optionally leaving some out. */
    since({ guildId, userId, withinMs, exclude = [], now = Date.now() }) {
      const skip = new Set(exclude);
      return (recent.get(`${guildId}:${userId}`) ?? []).filter((m) => now - m.at <= withinMs && !skip.has(m.messageId));
    },

    forget({ guildId, userId }) {
      recent.delete(`${guildId}:${userId}`);
    },

    sweep(now = Date.now()) {
      for (const [key, list] of recent) {
        const fresh = list.filter((m) => now - m.at < keepMs);
        if (fresh.length) recent.set(key, fresh);
        else recent.delete(key);
      }
    },
  };
}

/**
 * A burst of croaks against new members within a short window means a raid. While a raid is on,
 * new members' links and images are held for review whatever the AI says.
 */
export function createRaidDetector({ croaks, windowMs, lockMs }) {
  const hits = new Map(); // guildId -> timestamps
  const activeUntil = new Map(); // guildId -> time

  return {
    /** Record a croak or hold against a new member. Returns true if this starts a raid. */
    record(guildId, now = Date.now()) {
      const list = (hits.get(guildId) ?? []).filter((t) => now - t < windowMs);
      list.push(now);
      hits.set(guildId, list);
      if (list.length >= croaks && !this.isActive(guildId, now)) {
        activeUntil.set(guildId, now + lockMs);
        return true;
      }
      if (this.isActive(guildId, now)) activeUntil.set(guildId, now + lockMs); // keep it on while it continues
      return false;
    },

    isActive(guildId, now = Date.now()) {
      return (activeUntil.get(guildId) ?? 0) > now;
    },

    end(guildId) {
      activeUntil.delete(guildId);
      hits.delete(guildId);
    },
  };
}
