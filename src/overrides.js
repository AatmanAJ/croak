// A mod's allow / block decision, and the cross-server network built from them: when mods in
// several servers independently block the same thing, it's blocked for every server.

import { config } from './config.js';

const MOD_ALLOW_TTL = 90 * 24 * 60 * 60 * 1000; // a mod's "allow" still expires; a mod's "block" doesn't
const NETWORK_TTL = 90 * 24 * 60 * 60 * 1000;

/**
 * Save a mod's decision for their server. Returns true if this block tipped the item into a
 * network-wide block.
 */
export function saveModDecision(db, { guildId, kind, key, verdict, scores = null }) {
  db.putVerdict({ guildId, kind, key, verdict, scores, source: 'mod', ttlMs: verdict === 'allow' ? MOD_ALLOW_TTL : null });
  if (verdict !== 'block') return false;
  const servers = db.modBlockCount(kind, key);
  if (servers < config.networkBlockServers) return false;
  const shared = db.getVerdict('', kind, key);
  if (shared?.verdict === 'block') return false;
  db.putVerdict({ kind, key, verdict: 'block', scores, source: 'network', ttlMs: NETWORK_TTL });
  return true;
}

/** Remove a server's own decision, falling back to the shared verdict. */
export function clearModDecision(db, { guildId, kind, key }) {
  return db.deleteVerdict(guildId, kind, key);
}
