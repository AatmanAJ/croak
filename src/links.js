import { SHORTENERS, hostMatches } from './config.js';

// Query parameters that only track clicks; dropping them lets the same page share one cache entry
const TRACKING_PARAMS = /^(utm_\w+|fbclid|gclid|igshid|si|ref_src|mc_eid)$/i;

/**
 * Turn a URL into its cache key: lowercase host without "www.", no scheme, no fragment,
 * no tracking parameters, no trailing slash. Returns null for anything that isn't http(s).
 */
export function normalizeUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

  const host = url.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
  for (const name of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.test(name)) url.searchParams.delete(name);
  }
  const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : '';
  const search = url.searchParams.size ? `?${url.searchParams}` : '';
  return { host, key: `${host}${path}${search}`, href: url.href };
}

/**
 * Follow a link shortener's redirects (without visiting the final site) so the AI judges the
 * real destination. Only known shortener hosts are contacted. Returns the final URL, or the
 * original if it isn't a shortener or the lookup fails.
 */
export async function expandShortLink(href, { maxHops = 3, timeoutMs = 1500 } = {}) {
  let current = href;
  for (let hop = 0; hop < maxHops; hop++) {
    const host = new URL(current).hostname.toLowerCase().replace(/^www\./, '');
    if (!hostMatches(host, SHORTENERS)) break;
    try {
      const res = await fetch(current, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
      const location = res.headers.get('location');
      if (!location) break;
      current = new URL(location, current).href;
    } catch {
      break;
    }
  }
  return current;
}
