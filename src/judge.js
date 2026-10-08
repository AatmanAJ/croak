// Decides on one link, invite or image: trusted list and rules first, then the cache, then the AI.
// Every AI verdict is cached (shared across servers) so a repeat costs nothing.

import { decide as askDecisions, imageInput } from './ai/decisions.js';
import { moderateImage } from './ai/moderation.js';
import { describeImage, describeMessage, MODERATION_QUESTIONS } from './ai/questions.js';
import { config, hostMatches, TRUSTED_DOMAINS } from './config.js';
import { dHash } from './hash.js';
import { toDataUrl } from './images.js';
import { expandShortLink, normalizeUrl } from './links.js';

const LABELS = { scam: 'scam', nsfw: 'NSFW', spam: 'spam' };

/** allow | review | block from AI probabilities. Refused questions (null) are ignored. */
export function verdictFromScores(scores) {
  const top = Math.max(0, ...Object.values(scores).filter((p) => p != null));
  return top >= config.deleteAt ? 'block' : top >= config.reviewAt ? 'review' : 'allow';
}

/** The name of the highest-scoring question, e.g. 'scam'. */
export function topCategory(scores) {
  return Object.entries(scores ?? {})
    .filter(([, p]) => p != null)
    .sort((a, b) => b[1] - a[1])[0]?.[0];
}

/**
 * @param {object} deps
 * @param {ReturnType<import('./db.js').openDb>} deps.db
 * @param {(code: string) => Promise<object|null>} deps.resolveInvite server details for an invite, null if invalid
 * @param {Function} [deps.decide] Decisions API call (swappable for tests)
 * @param {Function} [deps.moderate] moderation API call for images
 * @param {Function} [deps.fetchImage] downloads an image to a Buffer
 * @param {Function} [deps.expand] follows short-link redirects
 */
export function createJudge({
  db,
  resolveInvite,
  decide = askDecisions,
  moderate = moderateImage,
  fetchImage = downloadImage,
  expand = expandShortLink,
}) {
  // If a raid posts the same link 50 times at once, only the first one asks the AI
  const inFlight = new Map();
  function once(key, fn) {
    if (!inFlight.has(key)) inFlight.set(key, fn().finally(() => inFlight.delete(key)));
    return inFlight.get(key);
  }

  /** Ask the three moderation questions. Returns the probabilities and how long the AI took. */
  async function ask(input) {
    const started = performance.now();
    const { answers } = await decide({ input, questions: MODERATION_QUESTIONS, timeoutMs: config.aiTimeoutMs });
    const scores = Object.fromEntries(
      MODERATION_QUESTIONS.map(({ name }) => [name, answers[name]?.type === 'predicate' ? answers[name].probability : null]),
    );
    return { scores, aiMs: Math.round(performance.now() - started) };
  }

  /** Save an AI verdict for every server, then describe it. */
  function remember(kind, key, scores, ttlAllow) {
    const verdict = verdictFromScores(scores);
    const ttlMs = verdict === 'allow' ? ttlAllow : verdict === 'review' ? config.ttl.review : config.ttl.block;
    db.putVerdict({ kind, key, verdict, scores, source: 'ai', ttlMs });
    return { verdict, scores, source: 'ai' };
  }

  function fromCache(row) {
    return row && { verdict: row.verdict, scores: row.scores, source: row.source === 'ai' ? 'cache' : row.source };
  }

  async function judgeLink(item, { guildId, text }) {
    const cached = (host, key) =>
      fromCache(db.getVerdict(guildId, 'domain', host)) ?? fromCache(db.getVerdict(guildId, 'link', key));

    if (hostMatches(item.host, TRUSTED_DOMAINS)) return { verdict: 'allow', source: 'trusted' };
    const hit = cached(item.host, item.key);
    if (hit) return { ...hit, cacheKind: 'link', cacheKey: item.key };

    return once(`link:${item.key}`, async () => {
      const finalHref = await expand(item.href);
      const expanded = finalHref === item.href ? null : normalizeUrl(finalHref);
      const final = expanded ? { ...expanded, href: finalHref } : item;
      if (expanded) {
        if (hostMatches(final.host, TRUSTED_DOMAINS)) return { verdict: 'allow', source: 'trusted' };
        const finalHit = cached(final.host, final.key);
        if (finalHit) return { ...finalHit, cacheKind: 'link', cacheKey: item.key };
      }
      const { scores, aiMs } = await ask(describeMessage({ message: text, link: final.href, expandedFrom: expanded ? item.href : undefined }));
      if (Object.values(scores).every((p) => p == null)) return { verdict: 'review', scores, source: 'refused', aiMs };
      // Cache both the short link and where it leads, so either one is caught next time
      if (expanded) remember('link', final.key, scores, config.ttl.allowLink);
      return { ...remember('link', item.key, scores, config.ttl.allowLink), cacheKind: 'link', cacheKey: item.key, aiMs };
    });
  }

  async function judgeInvite(item, { guildId, text }) {
    const server = await resolveInvite(item.code);
    if (!server) return { verdict: 'allow', source: 'rule', note: 'invite is invalid or expired' };
    if (!server.guildId) return { verdict: 'allow', source: 'rule', note: 'not a server invite' };
    if (server.guildId === guildId) return { verdict: 'allow', source: 'rule', note: 'invite to this server' };

    const where = { cacheKind: 'server', cacheKey: server.guildId, server };
    const hit = fromCache(db.getVerdict(guildId, 'server', server.guildId));
    if (hit) return { ...hit, ...where };

    // Discord's own NSFW rating is enough on its own
    if (server.nsfwLevel === 'Explicit' || server.nsfwLevel === 'AgeRestricted') {
      const scores = { scam: null, nsfw: 1, spam: null };
      db.putVerdict({ kind: 'server', key: server.guildId, verdict: 'block', scores, source: 'rule', ttlMs: config.ttl.block });
      return { verdict: 'block', scores, source: 'rule', note: `Discord rates this server ${server.nsfwLevel}`, ...where };
    }

    return once(`server:${server.guildId}`, async () => {
      const { scores, aiMs } = await ask(describeMessage({ message: text, invite: server }));
      if (Object.values(scores).every((p) => p == null)) return { verdict: 'review', scores, source: 'refused', aiMs, ...where };
      return { ...remember('server', server.guildId, scores, config.ttl.allowServer), aiMs, ...where };
    });
  }

  async function judgeImage(item, { guildId, text }) {
    const buffer = await fetchImage(item.url);
    const hash = await dHash(buffer);
    const where = { cacheKind: 'image', cacheKey: hash };

    const hit = fromCache(db.getVerdict(guildId, 'image', hash));
    if (hit) return { ...hit, ...where };
    const nearBlock = db.findBlockedImage(guildId, hash, config.nearDuplicateBits);
    if (nearBlock) return { ...fromCache(nearBlock), note: 'near copy of a blocked image', ...where };

    return once(`image:${hash}`, async () => {
      const dataUrl = await toDataUrl(buffer);
      const { scores, aiMs } = await ask(imageInput(describeImage(text), dataUrl));
      if (scores.nsfw == null) {
        // Decisions refused the NSFW question: fall back to the free moderation endpoint
        const mod = await moderate(dataUrl, undefined, { timeoutMs: config.aiTimeoutMs });
        scores.nsfw = Math.max(mod.category_scores?.sexual ?? 0, mod.category_scores?.['sexual/minors'] ?? 0);
      }
      return { ...remember('image', hash, scores, config.ttl.allowImage), aiMs, ...where };
    });
  }

  /**
   * Judge every item in a message in parallel. Never throws: a failed check comes back as
   * verdict 'unknown' so the caller can decide what to do when the AI is down or slow.
   */
  async function judgeAll(items, ctx) {
    const judges = { link: judgeLink, invite: judgeInvite, image: judgeImage };
    return Promise.all(
      items.map(async (item) => {
        const started = performance.now();
        let result;
        try {
          result = await judges[item.kind](item, ctx);
        } catch (err) {
          result = { verdict: 'unknown', source: 'error', note: err.name === 'TimeoutError' ? 'AI timed out' : err.message };
        }
        return { item, label: labelOf(item, result), reason: reasonOf(item, result), ms: Math.round(performance.now() - started), ...result };
      }),
    );
  }

  return { judgeAll, judgeLink, judgeInvite, judgeImage };
}

function labelOf(item, result) {
  if (item.kind === 'link') return item.raw;
  if (item.kind === 'invite') return result.server ? `discord.gg/${item.code} → ${result.server.name}` : `discord.gg/${item.code}`;
  return item.name;
}

/** Short human reason, e.g. "scam link" or "NSFW server invite". */
function reasonOf(item, result) {
  const noun = { link: 'link', invite: 'server invite', image: 'image' }[item.kind];
  const category = topCategory(result.scores);
  return category ? `${LABELS[category]} ${noun}` : noun;
}

async function downloadImage(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
  if (!res.ok) throw new Error(`image download failed (HTTP ${res.status})`);
  if (Number(res.headers.get('content-length') ?? 0) > config.imageMaxBytes) throw new Error('image too large');
  return Buffer.from(await res.arrayBuffer());
}
