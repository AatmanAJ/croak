// SQLite storage: the verdict cache, per-server settings, and mod cases.
// Uses Node's built-in node:sqlite, so there's no native module to compile.

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { hamming } from './hash.js';

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS verdicts (
    guild_id   TEXT NOT NULL DEFAULT '',  -- '' = shared by every server (AI verdicts); otherwise a mod's override
    kind       TEXT NOT NULL,             -- link | domain | server | image
    key        TEXT NOT NULL,             -- normalised URL, domain, Discord server ID, or image hash
    verdict    TEXT NOT NULL,             -- allow | review | block
    scores     TEXT,                      -- JSON of AI probabilities, when there are any
    source     TEXT NOT NULL,             -- ai | mod | rule
    created_at INTEGER NOT NULL,
    expires_at INTEGER,                   -- NULL = never
    PRIMARY KEY (guild_id, kind, key)
  );
  CREATE INDEX IF NOT EXISTS verdicts_by_verdict ON verdicts (kind, verdict);

  CREATE TABLE IF NOT EXISTS guilds (
    guild_id        TEXT PRIMARY KEY,
    log_channel_id  TEXT,
    timeout_minutes INTEGER
  );

  CREATE TABLE IF NOT EXISTS cases (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id    TEXT NOT NULL,
    channel_id  TEXT NOT NULL,
    message_id  TEXT NOT NULL,
    author_id   TEXT NOT NULL,
    action      TEXT NOT NULL,            -- delete | review
    items       TEXT NOT NULL,            -- JSON: what was checked and the verdict for each
    created_at  INTEGER NOT NULL,
    resolved_by TEXT,
    resolution  TEXT                      -- approved | blocked
  );
`;

export function openDb(path = process.env.DB_PATH ?? 'data/croak.db') {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);

  const q = {
    getVerdict: db.prepare(`
      SELECT * FROM verdicts
      WHERE kind = ? AND key = ? AND guild_id IN ('', ?) AND (expires_at IS NULL OR expires_at > ?)
      ORDER BY guild_id = '' ASC  -- a server's own override wins over the shared verdict
      LIMIT 1`),
    putVerdict: db.prepare(`
      INSERT INTO verdicts (guild_id, kind, key, verdict, scores, source, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (guild_id, kind, key) DO UPDATE SET
        verdict = excluded.verdict, scores = excluded.scores, source = excluded.source,
        created_at = excluded.created_at, expires_at = excluded.expires_at`),
    blockedImages: db.prepare(`
      SELECT key, guild_id, scores, source FROM verdicts
      WHERE kind = 'image' AND verdict = 'block' AND guild_id IN ('', ?) AND (expires_at IS NULL OR expires_at > ?)`),
    getGuild: db.prepare('SELECT * FROM guilds WHERE guild_id = ?'),
    putGuild: db.prepare(`
      INSERT INTO guilds (guild_id, log_channel_id, timeout_minutes) VALUES (?, ?, ?)
      ON CONFLICT (guild_id) DO UPDATE SET
        log_channel_id = excluded.log_channel_id, timeout_minutes = excluded.timeout_minutes`),
    addCase: db.prepare(`
      INSERT INTO cases (guild_id, channel_id, message_id, author_id, action, items, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`),
    getCase: db.prepare('SELECT * FROM cases WHERE id = ?'),
    resolveCase: db.prepare('UPDATE cases SET resolved_by = ?, resolution = ? WHERE id = ? AND resolution IS NULL'),
  };

  const parse = (row) => row && { ...row, scores: row.scores ? JSON.parse(row.scores) : null };

  return {
    /** Cached verdict for one item, or undefined. A server's own override beats the shared verdict. */
    getVerdict(guildId, kind, key, now = Date.now()) {
      return parse(q.getVerdict.get(kind, key, guildId, now));
    },

    putVerdict({ guildId = '', kind, key, verdict, scores = null, source, ttlMs = null, now = Date.now() }) {
      q.putVerdict.run(guildId, kind, key, verdict, scores && JSON.stringify(scores), source, now, ttlMs ? now + ttlMs : null);
    },

    /** A blocked image whose hash is within maxBits of this one, if any. */
    findBlockedImage(guildId, hash, maxBits, now = Date.now()) {
      for (const row of q.blockedImages.all(guildId, now)) {
        if (hamming(row.key, hash) <= maxBits) return parse(row);
      }
      return undefined;
    },

    getGuild(guildId) {
      return q.getGuild.get(guildId);
    },

    setGuild(guildId, { logChannelId, timeoutMinutes }) {
      q.putGuild.run(guildId, logChannelId ?? null, timeoutMinutes ?? null);
    },

    addCase({ guildId, channelId, messageId, authorId, action, items, now = Date.now() }) {
      return Number(q.addCase.run(guildId, channelId, messageId, authorId, action, JSON.stringify(items), now).lastInsertRowid);
    },

    getCase(id) {
      const row = q.getCase.get(id);
      return row && { ...row, items: JSON.parse(row.items) };
    },

    /** Marks a case resolved. Returns false if someone already resolved it. */
    resolveCase(id, userId, resolution) {
      return q.resolveCase.run(userId, resolution, id).changes > 0;
    },

    close() {
      db.close();
    },
  };
}
