// Decides on one link, invite or image. Cheapest first: trusted sites and rules, then the cache,
// then the AI. Every AI answer is cached (shared across servers) so a repeat costs nothing.
// Each server's own policy (sensitivity, switched-off categories, age-restricted channels) is
// applied on top of the stored scores, so one cache serves every server.

import { decide as askDecisions, imageInput } from './ai/decisions.js';
import { moderateImage } from './ai/moderation.js';
import { describeImage, describeMessage, MODERATION_QUESTIONS } from './ai/questions.js';
import { config, hostMatches, IMAGE_HOSTS, isAdultHost, TRUSTED_DOMAINS } from './config.js';
import { dHash } from './hash.js';
import { toDataUrl } from './images.js';
import { extractItems } from './extract.js';
import { expandShortLink, normalizeUrl } from './links.js';
import { checkDomain } from './lookalike.js';
import { isDiscordLoginLink, readQr } from './qr.js';
import { PRESETS } from './settings.js';

const LABELS = { scam: 'scam', nsfw: 'NSFW', spam: 'spam' };
const RANK = { allow: 0, unknown: 1, review: 2, block: 3 };
const STANDARD = { deleteAt: PRESETS.standard.deleteAt, reviewAt: PRESETS.standard.reviewAt, ignore: [] };
// Answers whose verdict is fixed: a mod's decision, a trusted site, a cross-server block, or no usable scores
const FIXED_SOURCES = new Set(['mod', 'trusted', 'network', 'refused', 'error']);

/** allow | review | block from AI probabilities. Refused questions (null) and ignored categories don't count. */
export function verdictFromScores(scores, { deleteAt, reviewAt, ignore = [] } = STANDARD) {
  const counted = Object.entries(scores ?? {}).filter(([name, p]) => p != null && !ignore.includes(name));
  const top = Math.max(0, ...counted.map(([, p]) => p));
  return top >= deleteAt ? 'block' : top >= reviewAt ? 'review' : 'allow';
}

/** The name of the highest-scoring question, e.g. 'scam'. */
export function topCategory(scores, ignore = []) {
  return Object.entries(scores ?? {})
    .filter(([name, p]) => p != null && !ignore.includes(name))
    .sort((a, b) => b[1] - a[1])[0]?.[0];
}

/** The more severe of two verdicts. */
export function worse(a, b) {
  return RANK[a] >= RANK[b] ? a : b;
}

export class AiUnavailableError extends Error {
  name = 'AiUnavailableError';
}

/**
 * Daily spending caps and a circuit breaker: after repeated AI failures, stop calling it for a
 * minute instead of hammering a service that's down.
 */
export function createAiGuard({ db, limits = config.ai, now = Date.now }) {
  let failures = 0;
  let pausedUntil = 0;
  return {
    /** Why the AI can't be called right now, or null if it can. */
    blocked(guildId) {
      if (now() < pausedUntil) return 'AI paused after repeated errors';
      if (db.aiCallsToday() >= limits.dailyLimitTotal) return 'daily AI limit reached';
      if (guildId && db.guildAiCallsToday(guildId) >= limits.dailyLimitPerServer) return "this server's daily AI limit reached";
      return null;
    },
    success() {
      failures = 0;
    },
    failure() {
      failures += 1;
      if (failures >= limits.failuresBeforePause) {
        pausedUntil = now() + limits.pauseMs;
        failures = 0;
      }
    },
  };
}

/**
 * @param {object} deps
 * @param {ReturnType<import('./db.js').openDb>} deps.db
 * @param {(code: string) => Promise<object|null>} deps.resolveInvite server details for an invite, null if invalid
 * @param {Function} [deps.decide] Decisions API call (swappable for tests)
 * @param {Function} [deps.moderate] moderation API call for images
 * @param {Function} [deps.fetchImage] downloads an image item to a Buffer
 * @param {Function} [deps.expand] follows short-link redirects
 * @param {ReturnType<typeof createAiGuard>} [deps.guard]
 */
export function createJudge({
  db,
  resolveInvite,
  decide = askDecisions,
  moderate = moderateImage,
  fetchImage = downloadImage,
  expand = expandShortLink,
  guard = createAiGuard({ db }),
}) {
  // If a raid posts the same link 50 times at once, only the first one asks the AI
  const inFlight = new Map();
  function once(key, fn) {
    if (!inFlight.has(key)) inFlight.set(key, fn().finally(() => inFlight.delete(key)));
    return inFlight.get(key);
  }

  /** Ask the three moderation questions. Returns the probabilities and how long the AI took. */
  async function ask(input, guildId) {
    const reason = guard.blocked(guildId);
    if (reason) throw new AiUnavailableError(reason);
    const started = performance.now();
    let answers;
    try {
      ({ answers } = await decide({ input, questions: MODERATION_QUESTIONS, timeoutMs: config.aiTimeoutMs }));
      guard.success();
    } catch (err) {
      guard.failure();
      throw err;
    }
    const scores = Object.fromEntries(
      MODERATION_QUESTIONS.map(({ name }) => [name, answers[name]?.type === 'predicate' ? answers[name].probability : null]),
    );
    return { scores, aiMs: Math.round(performance.now() - started) };
  }

  /** Save an AI verdict for every server (judged at standard sensitivity), then describe it. */
  function remember(kind, key, scores, ttlAllow) {
    const verdict = verdictFromScores(scores);
    const ttlMs = verdict === 'allow' ? ttlAllow : verdict === 'review' ? config.ttl.review : config.ttl.block;
    db.putVerdict({ kind, key, verdict, scores, source: 'ai', ttlMs });
    return { verdict, scores, source: 'ai' };
  }

  function fromCache(row) {
    return row && { verdict: row.verdict, scores: row.scores, source: row.source === 'ai' ? 'cache' : row.source };
  }

  const allRefused = (scores) => Object.values(scores).every((p) => p == null);

  async function judgeLink(item, { guildId, text }) {
    const cached = (host, key) =>
      fromCache(db.getVerdict(guildId, 'domain', host)) ?? fromCache(db.getVerdict(guildId, 'link', key));
    const where = { cacheKind: 'link', cacheKey: item.key, host: item.host };

    // Known adult sites need no AI. Scored as NSFW so age-restricted channels still allow them.
    const adult = (host, note) => ({ verdict: 'block', scores: { scam: null, nsfw: 1, spam: null }, source: 'rule', note, ...where });

    if (hostMatches(item.host, TRUSTED_DOMAINS)) return { verdict: 'allow', source: 'trusted', ...where };
    const hit = cached(item.host, item.key);
    if (hit) return { ...hit, hint: checkDomain(item.host), ...where };
    if (isAdultHost(item.host)) return adult(item.host, 'known adult site');

    return once(`link:${item.key}`, async () => {
      const finalHref = await expand(item.href);
      const expanded = finalHref === item.href ? null : normalizeUrl(finalHref);
      const final = expanded ? { ...expanded, href: finalHref } : item;
      const hint = checkDomain(final.host);
      if (expanded) {
        if (hostMatches(final.host, TRUSTED_DOMAINS)) return { verdict: 'allow', source: 'trusted', note: `redirects to ${final.host}`, ...where };
        if (isAdultHost(final.host)) return adult(final.host, `redirects to the adult site ${final.host}`);
        const finalHit = cached(final.host, final.key);
        if (finalHit) return { ...finalHit, hint, note: `redirects to ${final.host}`, ...where };
      }
      const { scores, aiMs } = await ask(
        describeMessage({ message: text, link: final.href, expandedFrom: expanded ? item.href : undefined, notes: hint ? [hint.note] : [] }),
        guildId,
      );
      if (allRefused(scores)) return { verdict: 'review', scores, source: 'refused', aiMs, hint, ...where };
      // Cache both the short link and where it leads, so either one is caught next time
      if (expanded) remember('link', final.key, scores, config.ttl.allowLink);
      const note = expanded ? `redirects to ${final.host}` : undefined;
      return { ...remember('link', item.key, scores, config.ttl.allowLink), aiMs, hint, note, ...where };
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
      const { scores, aiMs } = await ask(describeMessage({ message: text, invite: server }), guildId);
      if (allRefused(scores)) return { verdict: 'review', scores, source: 'refused', aiMs, ...where };
      return { ...remember('server', server.guildId, scores, config.ttl.allowServer), aiMs, ...where };
    });
  }

  async function judgeImage(item, ctx) {
    const { guildId, text } = ctx;
    const buffer = await fetchImage(item);
    const hash = await dHash(buffer);
    const where = { cacheKind: 'image', cacheKey: hash, kb: Math.round(buffer.length / 1024) };

    const hit = fromCache(db.getVerdict(guildId, 'image', hash));
    if (hit) return { ...hit, ...where };
    const nearBlock = db.findBlockedImage(guildId, hash, config.nearDuplicateBits);
    if (nearBlock) return { ...fromCache(nearBlock), note: 'near copy of a blocked image', ...where };

    return once(`image:${hash}`, async () => {
      // The image is already small, so reading the QR code first costs ~40ms. That keeps the
      // Discord-login shortcut free of AI calls and lets the AI see where a QR code points.
      const [qr, dataUrl] = await Promise.all([readQr(buffer), toDataUrl(buffer)]);
      if (isDiscordLoginLink(qr)) {
        const scores = { scam: 1, nsfw: null, spam: null };
        db.putVerdict({ kind: 'image', key: hash, verdict: 'block', scores, source: 'rule', ttlMs: config.ttl.block });
        return { verdict: 'block', scores, source: 'rule', note: 'QR code opens a Discord login page', ...where };
      }

      // A QR code that opens a link: run the link through the link checks while the AI looks at the image
      const qrLink = qr ? extractItems({ content: qr }).links[0] : null;
      const qrCheck = qrLink ? judgeLink(qrLink, ctx).catch(() => null) : null;

      const { scores, aiMs } = await ask(imageInput(describeImage(text, { qr }), dataUrl), guildId);
      if (scores.nsfw == null) {
        // Decisions refused the NSFW question: fall back to the free moderation endpoint
        const mod = await moderate(dataUrl, undefined, { timeoutMs: config.aiTimeoutMs });
        scores.nsfw = Math.max(mod.category_scores?.sexual ?? 0, mod.category_scores?.['sexual/minors'] ?? 0);
      }

      const linked = await qrCheck;
      if (linked?.verdict === 'block') {
        const merged = maxScores(scores, linked.scores ?? { scam: 1 });
        db.putVerdict({ kind: 'image', key: hash, verdict: 'block', scores: merged, source: 'rule', ttlMs: config.ttl.block });
        return { verdict: 'block', scores: merged, source: 'rule', aiMs, note: `QR code opens ${qrLink.host}, which is blocked`, ...where };
      }
      const note = qr ? `contains a QR code (${qr.slice(0, 80)})` : undefined;
      return { ...remember('image', hash, scores, config.ttl.allowImage), aiMs, note, ...where };
    });
  }

  /**
   * Judge every item in a message in parallel and apply the server's policy. Never throws: a
   * failed check comes back as verdict 'unknown' so the caller decides what happens when the AI
   * is down, slow or over budget.
   * @param {object[]} items
   * @param {{ guildId: string, text: string, policy?: object }} ctx
   */
  async function judgeAll(items, ctx) {
    const policy = ctx.policy ?? STANDARD;
    const judges = { link: judgeLink, invite: judgeInvite, image: judgeImage };
    const results = await Promise.all(
      items.map(async (item) => {
        const started = performance.now();
        let result;
        try {
          result = await judges[item.kind](item, ctx);
        } catch (err) {
          const note =
            err.name === 'TimeoutError' ? 'AI timed out' : err.name === 'AiUnavailableError' ? err.message : err.message.slice(0, 120);
          result = { verdict: 'unknown', source: 'error', note };
        }
        const verdict = applyPolicy(result, policy);
        return {
          item,
          ...result,
          baseVerdict: result.verdict,
          verdict,
          label: labelOf(item, result),
          reason: reasonOf(item, result, policy),
          ms: Math.round(performance.now() - started),
        };
      }),
    );

    if (results.length) {
      db.bumpStats(ctx.guildId, {
        checks: results.length,
        cacheHits: results.filter((r) => ['cache', 'mod', 'network'].includes(r.source)).length,
        aiCalls: results.filter((r) => r.aiMs !== undefined).length,
        aiMs: results.reduce((sum, r) => sum + (r.aiMs ?? 0), 0),
      });
    }
    return results;
  }

  return { judgeAll, judgeLink, judgeInvite, judgeImage };
}

/** Highest score per question across two sets of scores (null means not asked or refused). */
function maxScores(a, b) {
  const out = { ...a };
  for (const [name, p] of Object.entries(b)) {
    if (p != null) out[name] = Math.max(out[name] ?? 0, p);
  }
  return out;
}

/** The server's verdict: stored scores re-read at its sensitivity, and look-alike domains always seen by a mod. */
function applyPolicy(result, policy) {
  let verdict = result.verdict;
  const hasScores = Object.values(result.scores ?? {}).some((p) => p != null);
  if (hasScores && !FIXED_SOURCES.has(result.source)) verdict = verdictFromScores(result.scores, policy);
  if ((result.hint?.kind === 'typo' || result.hint?.kind === 'unicode') && !['mod', 'trusted'].includes(result.source)) {
    verdict = worse(verdict, 'review');
  }
  return verdict;
}

function labelOf(item, result) {
  if (item.kind === 'link') return item.raw;
  if (item.kind === 'invite') return result.server ? `discord.gg/${item.code} → ${result.server.name}` : `discord.gg/${item.code}`;
  return item.name;
}

/** Short human reason, e.g. "scam link" or "NSFW server invite". */
function reasonOf(item, result, policy) {
  const noun = { link: 'link', invite: 'server invite', image: 'image' }[item.kind];
  if (result.hint && (result.hint.kind === 'typo' || result.hint.kind === 'unicode') && verdictFromScores(result.scores ?? {}, policy) === 'allow') {
    return `look-alike ${noun}`;
  }
  const category = topCategory(result.scores, policy.ignore);
  return category ? `${LABELS[category]} ${noun}` : noun;
}

/**
 * A smaller copy of a Discord-hosted image, resized by Discord's media proxy (longest side
 * maxSide), or null if the image is already small or isn't on the proxy. A 6 MB phone photo
 * comes back as ~100 KB, which is faster to download, fingerprint, read and send to the AI.
 */
export function resizedUrl({ url, proxyURL, width, height }, maxSide = 1024) {
  if (!width || !height || Math.max(width, height) <= maxSide) return null;
  let u;
  try {
    u = new URL(proxyURL ?? url);
  } catch {
    return null;
  }
  if (!hostMatches(u.hostname, ['discordapp.net'])) return null; // only the media proxy resizes
  const scale = maxSide / Math.max(width, height);
  u.searchParams.set('width', String(Math.round(width * scale)));
  u.searchParams.set('height', String(Math.round(height * scale)));
  return u.href;
}

/** The image to check: the small copy if Discord can make one, otherwise the original. */
async function downloadImage(item) {
  const small = resizedUrl(item);
  if (small) {
    try {
      return await fetchBuffer(small);
    } catch {
      // fall back to the original below
    }
  }
  return fetchBuffer(item.url);
}

async function fetchBuffer(url) {
  const { hostname } = new URL(url);
  if (!hostMatches(hostname, IMAGE_HOSTS)) throw new Error(`not downloading images from ${hostname}`);
  const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
  if (!res.ok) throw new Error(`image download failed (HTTP ${res.status})`);
  if (Number(res.headers.get('content-length') ?? 0) > config.imageMaxBytes) throw new Error('image too large');
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length > config.imageMaxBytes) throw new Error('image too large');
  return buffer;
}
