// SQLite storage: the verdict cache, per-server settings, mod cases, and usage stats.
// Uses Node's built-in node:sqlite, so there's no native module to compile.
// Schema changes are numbered migrations tracked in PRAGMA user_version.

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { hamming } from './hash.js';
import { withDefaults } from './settings.js';

const DAY = 24 * 60 * 60 * 1000;

const MIGRATIONS = [
  // 1: the first version
  `CREATE TABLE IF NOT EXISTS verdicts (
     guild_id   TEXT NOT NULL DEFAULT '',  -- '' = shared by every server; otherwise one server's own decision
     kind       TEXT NOT NULL,             -- link | domain | server | image
     key        TEXT NOT NULL,             -- normalised URL, domain, Discord server ID, or image hash
     verdict    TEXT NOT NULL,             -- allow | review | block
     scores     TEXT,                      -- JSON of AI probabilities, when there are any
     source     TEXT NOT NULL,             -- ai | mod | rule | network
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
     action      TEXT NOT NULL,            -- delete | hold | flag
     items       TEXT NOT NULL,            -- JSON: what was checked and the verdict for each
     created_at  INTEGER NOT NULL,
     resolved_by TEXT,
     resolution  TEXT                      -- approved | blocked
   );`,

  // 2: settings as JSON, richer cases, stats
  `ALTER TABLE guilds ADD COLUMN settings TEXT;
   ALTER TABLE cases ADD COLUMN reason TEXT;
   ALTER TABLE cases ADD COLUMN content TEXT;         -- kept so an approved message can be reposted; wiped after 30 days
   ALTER TABLE cases ADD COLUMN ms INTEGER;
   ALTER TABLE cases ADD COLUMN log_message_id TEXT;
   ALTER TABLE cases ADD COLUMN appeal TEXT;          -- NULL | open | accepted | rejected
   CREATE INDEX IF NOT EXISTS cases_by_author ON cases (guild_id, author_id, created_at);
   CREATE INDEX IF NOT EXISTS cases_by_time ON cases (guild_id, created_at);
   CREATE TABLE IF NOT EXISTS daily_stats (
     guild_id   TEXT NOT NULL,
     day        TEXT NOT NULL,             -- YYYY-MM-DD (UTC)
     checks     INTEGER NOT NULL DEFAULT 0,
     cache_hits INTEGER NOT NULL DEFAULT 0,
     ai_calls   INTEGER NOT NULL DEFAULT 0,
     ai_ms      INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (guild_id, day)
   );`,

  // 3: mod tools: case conversations and notes, watched and trusted members, lockdowns
  `CREATE TABLE IF NOT EXISTS case_events (
     id       INTEGER PRIMARY KEY AUTOINCREMENT,
     case_id  INTEGER NOT NULL,
     at       INTEGER NOT NULL,
     actor_id TEXT,
     kind     TEXT NOT NULL,                -- note | mod_reply | member_reply | action | report
     text     TEXT                          -- wiped after 30 days with case content
   );
   CREATE INDEX IF NOT EXISTS case_events_by_case ON case_events (case_id);
   CREATE TABLE IF NOT EXISTS members (
     guild_id    TEXT NOT NULL,
     user_id     TEXT NOT NULL,
     watch_until INTEGER,                   -- while in the future, their links and images are held
     watch_by    TEXT,
     trusted     INTEGER NOT NULL DEFAULT 0, -- never checked
     PRIMARY KEY (guild_id, user_id)
   );
   CREATE TABLE IF NOT EXISTS lockdowns (
     guild_id   TEXT PRIMARY KEY,
     started_at INTEGER NOT NULL,
     ends_at    INTEGER,
     by         TEXT,
     state      TEXT NOT NULL               -- JSON: previous slowmodes, whether invites were paused
   );`,
];

export function openDb(path = process.env.DB_PATH ?? 'data/croak.db') {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL;');
  migrate(db);

  const q = {
    getVerdict: db.prepare(`
      SELECT * FROM verdicts
      WHERE kind = ? AND key = ? AND guild_id IN ('', ?) AND (expires_at IS NULL OR expires_at > ?)
      ORDER BY guild_id = '' ASC  -- a server's own decision wins over the shared verdict
      LIMIT 1`),
    putVerdict: db.prepare(`
      INSERT INTO verdicts (guild_id, kind, key, verdict, scores, source, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (guild_id, kind, key) DO UPDATE SET
        verdict = excluded.verdict, scores = excluded.scores, source = excluded.source,
        created_at = excluded.created_at, expires_at = excluded.expires_at`),
    deleteVerdict: db.prepare('DELETE FROM verdicts WHERE guild_id = ? AND kind = ? AND key = ?'),
    guildVerdicts: db.prepare(`
      SELECT kind, key, verdict, created_at FROM verdicts
      WHERE guild_id = ? AND (expires_at IS NULL OR expires_at > ?)
      ORDER BY created_at DESC LIMIT ?`),
    modBlockCount: db.prepare(`
      SELECT COUNT(*) AS n FROM verdicts
      WHERE guild_id != '' AND kind = ? AND key = ? AND verdict = 'block' AND source = 'mod'`),
    blockedImages: db.prepare(`
      SELECT key, guild_id, verdict, scores, source FROM verdicts
      WHERE kind = 'image' AND verdict = 'block' AND guild_id IN ('', ?) AND (expires_at IS NULL OR expires_at > ?)`),

    getGuild: db.prepare('SELECT * FROM guilds WHERE guild_id = ?'),
    putSettings: db.prepare(`
      INSERT INTO guilds (guild_id, settings) VALUES (?, ?)
      ON CONFLICT (guild_id) DO UPDATE SET settings = excluded.settings`),

    addCase: db.prepare(`
      INSERT INTO cases (guild_id, channel_id, message_id, author_id, action, items, created_at, reason, content, ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    getCase: db.prepare('SELECT * FROM cases WHERE id = ?'),
    setCaseLog: db.prepare('UPDATE cases SET log_message_id = ? WHERE id = ?'),
    setAppeal: db.prepare('UPDATE cases SET appeal = ? WHERE id = ?'),
    resolveCase: db.prepare('UPDATE cases SET resolved_by = ?, resolution = ? WHERE id = ? AND resolution IS NULL'),
    strikes: db.prepare(`
      SELECT COUNT(*) AS n FROM cases
      WHERE guild_id = ? AND author_id = ? AND created_at > ?
        AND (action = 'delete' OR resolution = 'blocked')
        AND (resolution IS NULL OR resolution != 'approved')`),
    caseCounts: db.prepare(`
      SELECT action, resolution, COUNT(*) AS n FROM cases
      WHERE guild_id = ? AND created_at > ? GROUP BY action, resolution`),
    caseReasons: db.prepare(`
      SELECT reason, COUNT(*) AS n FROM cases
      WHERE guild_id = ? AND created_at > ? AND reason IS NOT NULL
      GROUP BY reason ORDER BY n DESC LIMIT 5`),
    caseItemsSince: db.prepare('SELECT items FROM cases WHERE guild_id = ? AND created_at > ?'),

    bumpStats: db.prepare(`
      INSERT INTO daily_stats (guild_id, day, checks, cache_hits, ai_calls, ai_ms) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (guild_id, day) DO UPDATE SET
        checks = checks + excluded.checks, cache_hits = cache_hits + excluded.cache_hits,
        ai_calls = ai_calls + excluded.ai_calls, ai_ms = ai_ms + excluded.ai_ms`),
    statsSince: db.prepare(`
      SELECT COALESCE(SUM(checks), 0) AS checks, COALESCE(SUM(cache_hits), 0) AS cacheHits,
             COALESCE(SUM(ai_calls), 0) AS aiCalls, COALESCE(SUM(ai_ms), 0) AS aiMs
      FROM daily_stats WHERE guild_id = ? AND day >= ?`),
    aiCallsToday: db.prepare('SELECT COALESCE(SUM(ai_calls), 0) AS n FROM daily_stats WHERE day = ?'),
    guildAiCallsToday: db.prepare('SELECT COALESCE(ai_calls, 0) AS n FROM daily_stats WHERE guild_id = ? AND day = ?'),

    addEvent: db.prepare('INSERT INTO case_events (case_id, at, actor_id, kind, text) VALUES (?, ?, ?, ?, ?)'),
    events: db.prepare('SELECT * FROM case_events WHERE case_id = ? ORDER BY id'),
    countEvents: db.prepare('SELECT COUNT(*) AS n FROM case_events WHERE case_id = ? AND kind = ?'),
    casesFor: db.prepare('SELECT * FROM cases WHERE guild_id = ? AND author_id = ? ORDER BY id DESC LIMIT ?'),
    getMember: db.prepare('SELECT * FROM members WHERE guild_id = ? AND user_id = ?'),
    setWatch: db.prepare(`
      INSERT INTO members (guild_id, user_id, watch_until, watch_by) VALUES (?, ?, ?, ?)
      ON CONFLICT (guild_id, user_id) DO UPDATE SET watch_until = excluded.watch_until, watch_by = excluded.watch_by`),
    setTrusted: db.prepare(`
      INSERT INTO members (guild_id, user_id, trusted) VALUES (?, ?, ?)
      ON CONFLICT (guild_id, user_id) DO UPDATE SET trusted = excluded.trusted`),
    getLockdown: db.prepare('SELECT * FROM lockdowns WHERE guild_id = ?'),
    putLockdown: db.prepare(`
      INSERT INTO lockdowns (guild_id, started_at, ends_at, by, state) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (guild_id) DO UPDATE SET ends_at = excluded.ends_at, by = excluded.by, state = excluded.state`),
    deleteLockdown: db.prepare('DELETE FROM lockdowns WHERE guild_id = ?'),
    allLockdowns: db.prepare('SELECT * FROM lockdowns'),
    wipeOldEvents: db.prepare('UPDATE case_events SET text = NULL WHERE text IS NOT NULL AND at < ?'),
    wipeOldContent: db.prepare('UPDATE cases SET content = NULL WHERE content IS NOT NULL AND created_at < ?'),
    deleteOldStats: db.prepare('DELETE FROM daily_stats WHERE day < ?'),
    deleteExpired: db.prepare('DELETE FROM verdicts WHERE expires_at IS NOT NULL AND expires_at < ?'),
  };

  const parseVerdict = (row) => row && { ...row, scores: row.scores ? JSON.parse(row.scores) : null };
  const parseCase = (row) => row && { ...row, items: JSON.parse(row.items) };

  return {
    // --- verdict cache ---------------------------------------------------------

    /** Cached verdict for one item, or undefined. A server's own decision beats the shared verdict. */
    getVerdict(guildId, kind, key, now = Date.now()) {
      return parseVerdict(q.getVerdict.get(kind, key, guildId ?? '', now));
    },

    putVerdict({ guildId = '', kind, key, verdict, scores = null, source, ttlMs = null, now = Date.now() }) {
      q.putVerdict.run(guildId, kind, key, verdict, scores && JSON.stringify(scores), source, now, ttlMs ? now + ttlMs : null);
    },

    deleteVerdict(guildId, kind, key) {
      return q.deleteVerdict.run(guildId, kind, key).changes > 0;
    },

    /** A server's own allow/block decisions, newest first. */
    guildVerdicts(guildId, limit = 50, now = Date.now()) {
      return q.guildVerdicts.all(guildId, now, limit);
    },

    /** How many servers' mods have blocked this item. */
    modBlockCount(kind, key) {
      return q.modBlockCount.get(kind, key).n;
    },

    /** A blocked image whose hash is within maxBits of this one, if any. */
    findBlockedImage(guildId, hash, maxBits, now = Date.now()) {
      for (const row of q.blockedImages.all(guildId ?? '', now)) {
        if (hamming(row.key, hash) <= maxBits) return parseVerdict(row);
      }
      return undefined;
    },

    // --- settings ----------------------------------------------------------------

    /** A server's settings with defaults filled in. Reads the first version's columns too. */
    getSettings(guildId) {
      const row = q.getGuild.get(guildId);
      const saved = row?.settings ? JSON.parse(row.settings) : {};
      if (row && !row.settings) {
        if (row.log_channel_id) saved.logChannelId = row.log_channel_id;
        if (row.timeout_minutes != null) saved.timeoutMinutes = row.timeout_minutes;
      }
      return withDefaults(saved);
    },

    /** Merge changes into a server's settings and return the result. */
    updateSettings(guildId, patch) {
      const next = withDefaults({ ...this.getSettings(guildId), ...patch });
      q.putSettings.run(guildId, JSON.stringify(next));
      return next;
    },

    // --- cases -------------------------------------------------------------------

    addCase({ guildId, channelId, messageId, authorId, action, items, reason = null, content = null, ms = null, now = Date.now() }) {
      return Number(
        q.addCase.run(guildId, channelId, messageId, authorId, action, JSON.stringify(items), now, reason, content, ms).lastInsertRowid,
      );
    },

    getCase(id) {
      return parseCase(q.getCase.get(id));
    },

    setCaseLog(id, logMessageId) {
      q.setCaseLog.run(logMessageId, id);
    },

    setAppeal(id, status) {
      q.setAppeal.run(status, id);
    },

    /** Marks a case resolved. Returns false if someone already resolved it. */
    resolveCase(id, userId, resolution) {
      return q.resolveCase.run(userId, resolution, id).changes > 0;
    },

    /** Croaks against someone in this server in the last `days` days, not counting ones mods overturned. */
    strikes(guildId, userId, days = 30, now = Date.now()) {
      return q.strikes.get(guildId, userId, now - days * DAY).n;
    },

    /** Case counts, top reasons and top blocked sites for /croak stats. */
    caseSummary(guildId, days = 7, now = Date.now()) {
      const since = now - days * DAY;
      const counts = { delete: 0, hold: 0, flag: 0, approved: 0 };
      for (const row of q.caseCounts.all(guildId, since)) {
        counts[row.action] = (counts[row.action] ?? 0) + row.n;
        if (row.resolution === 'approved') counts.approved += row.n;
      }
      const sites = new Map();
      for (const { items } of q.caseItemsSince.all(guildId, since)) {
        for (const item of JSON.parse(items)) {
          if (item.kind === 'link' && item.verdict === 'block' && item.host) sites.set(item.host, (sites.get(item.host) ?? 0) + 1);
        }
      }
      const topSites = [...sites].sort((a, b) => b[1] - a[1]).slice(0, 5);
      return { counts, reasons: q.caseReasons.all(guildId, since).map((r) => ({ ...r })), topSites };
    },

    /** Recent cases against one member in a server, newest first. */
    casesFor(guildId, userId, limit = 10) {
      return q.casesFor.all(guildId, userId, limit).map(parseCase);
    },

    // --- case conversations and notes --------------------------------------------

    addCaseEvent(caseId, { actorId = null, kind, text = null, now = Date.now() }) {
      q.addEvent.run(caseId, now, actorId, kind, text);
    },

    caseEvents(caseId) {
      return q.events.all(caseId).map((e) => ({ ...e }));
    },

    countCaseEvents(caseId, kind) {
      return q.countEvents.get(caseId, kind).n;
    },

    // --- watched and trusted members ----------------------------------------------

    /** { watching: until-timestamp or null, trusted: boolean } for a member. */
    memberFlags(guildId, userId, now = Date.now()) {
      const row = q.getMember.get(guildId, userId);
      return {
        watching: row?.watch_until && row.watch_until > now ? row.watch_until : null,
        watchBy: row?.watch_by ?? null,
        trusted: Boolean(row?.trusted),
      };
    },

    setWatch(guildId, userId, until, by = null) {
      q.setWatch.run(guildId, userId, until, by);
    },

    setTrusted(guildId, userId, trusted) {
      q.setTrusted.run(guildId, userId, trusted ? 1 : 0);
    },

    // --- lockdowns -------------------------------------------------------------------

    getLockdown(guildId) {
      const row = q.getLockdown.get(guildId);
      return row && { ...row, state: JSON.parse(row.state) };
    },

    putLockdown(guildId, { startedAt = Date.now(), endsAt = null, by = null, state }) {
      q.putLockdown.run(guildId, startedAt, endsAt, by, JSON.stringify(state));
    },

    clearLockdown(guildId) {
      q.deleteLockdown.run(guildId);
    },

    allLockdowns() {
      return q.allLockdowns.all().map((row) => ({ ...row, state: JSON.parse(row.state) }));
    },

    // --- usage stats -------------------------------------------------------------

    bumpStats(guildId, { checks = 0, cacheHits = 0, aiCalls = 0, aiMs = 0 }, now = Date.now()) {
      q.bumpStats.run(guildId ?? '', dayOf(now), checks, cacheHits, aiCalls, aiMs);
    },

    statsSince(guildId, days = 7, now = Date.now()) {
      return { ...q.statsSince.get(guildId, dayOf(now - (days - 1) * DAY)) };
    },

    aiCallsToday(now = Date.now()) {
      return q.aiCallsToday.get(dayOf(now)).n;
    },

    guildAiCallsToday(guildId, now = Date.now()) {
      return q.guildAiCallsToday.get(guildId, dayOf(now))?.n ?? 0;
    },

    // --- housekeeping ------------------------------------------------------------

    /** Privacy: drop message text from old cases, old stats, and expired verdicts. */
    housekeeping({ contentDays = 30, statsDays = 90, now = Date.now() } = {}) {
      q.wipeOldEvents.run(now - contentDays * DAY);
      return {
        wiped: q.wipeOldContent.run(now - contentDays * DAY).changes,
        stats: q.deleteOldStats.run(dayOf(now - statsDays * DAY)).changes,
        expired: q.deleteExpired.run(now).changes,
      };
    },

    /** Everything stored about a server, for when Croak is removed from it. */
    forgetGuild(guildId) {
      db.exec('BEGIN');
      try {
        for (const sql of [
          'DELETE FROM case_events WHERE case_id IN (SELECT id FROM cases WHERE guild_id = ?)',
          'DELETE FROM members WHERE guild_id = ?',
          'DELETE FROM lockdowns WHERE guild_id = ?',
          'DELETE FROM guilds WHERE guild_id = ?',
          'DELETE FROM cases WHERE guild_id = ?',
          'DELETE FROM daily_stats WHERE guild_id = ?',
          'DELETE FROM verdicts WHERE guild_id = ?',
        ]) {
          db.prepare(sql).run(guildId);
        }
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },

    raw: db,

    close() {
      db.close();
    },
  };
}

function migrate(db) {
  const version = db.prepare('PRAGMA user_version').get().user_version;
  for (let v = version; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw new Error(`Database migration ${v + 1} failed: ${err.message}`);
    }
  }
}

function dayOf(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}
