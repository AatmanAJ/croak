// Pulls the things worth checking out of a message: links, Discord invites and images.

import { parse } from 'tldts';
import { config, GIF_HOSTS, hostMatches } from './config.js';
import { normalizeUrl } from './links.js';

const URL_PATTERN = /https?:\/\/[^\s<>()[\]"']+/gi;
// Discord shows invites even without https://, so the scheme is optional here
const INVITE_PATTERN = /(?:https?:\/\/)?(?:www\.)?(?:discord(?:app)?\.com\/invite|discord\.gg)\/([a-z0-9-]{2,32})/gi;
// Domains typed without https:// ("dlscord-gift.com/nitro"). Not part of an email address or a
// longer word, and the last label must start with a letter (so "v1.2.3" isn't a domain).
const BARE_DOMAIN = /(?<![@\w.\/-])((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,23})(\/[^\s<>()[\]"']*)?/gi;
// Ways people write a dot to dodge filters: beeg[.]com, beeg(dot)com, beeg {.} com
const DEFANGED_DOT = /\s*[[({]\s*(?:\.|dot)\s*[\])}]\s*/gi;
// Real top-level domains that are far more often file names: "script.py", "notes.md"
const FILE_LIKE_TLDS = new Set(['py', 'md', 'rs', 'sh', 'pl', 'ps']);
const IMAGE_TYPE = /^image\//i;

/**
 * @param {object} msg
 * @param {string} msg.content
 * @param {{url: string, name: string, contentType?: string|null, size: number}[]} [msg.attachments]
 * @returns {{links: object[], invites: object[], images: object[]}}
 */
export function extractItems({ content = '', attachments = [] }) {
  const invites = uniqueBy(
    [...content.matchAll(INVITE_PATTERN)].map((m) => ({ kind: 'invite', code: m[1] })),
    (i) => i.code.toLowerCase(),
  );

  const withScheme = [...content.matchAll(URL_PATTERN)].map((m) => {
    const raw = trimTrailingPunctuation(m[0]);
    return { raw, href: raw };
  });
  const links = uniqueBy(
    [...withScheme, ...bareDomains(content)]
      .map(({ raw, href }) => ({ raw, url: normalizeUrl(href) }))
      .filter(({ url }) => url && !isInviteHost(url) && !hostMatches(url.host, GIF_HOSTS))
      .map(({ raw, url }) => ({ kind: 'link', raw, href: url.href, host: url.host, key: url.key })),
    (l) => l.key,
  ).slice(0, config.linksPerMessage);

  const images = attachments
    .filter((a) => IMAGE_TYPE.test(a.contentType ?? '') && a.size <= config.imageMaxBytes)
    .slice(0, config.imagesPerMessage)
    .map((a) => ({ kind: 'image', url: a.url, name: a.name, size: a.size }));

  return { links, invites, images };
}

/**
 * Domains written without http(s)://, including defanged ones. Only real public domains count
 * (checked against the public suffix list), so "node.js" or "Mr.Beast" aren't treated as links.
 */
export function bareDomains(content) {
  const text = content.replace(URL_PATTERN, ' ').replace(INVITE_PATTERN, ' ').replace(DEFANGED_DOT, '.');
  const found = [];
  for (const m of text.matchAll(BARE_DOMAIN)) {
    const info = parse(m[1].toLowerCase());
    if (!info.isIcann || !info.domain || info.isIp) continue;
    if (FILE_LIKE_TLDS.has(info.publicSuffix) && !m[2]) continue;
    const raw = trimTrailingPunctuation(m[0]);
    found.push({ raw, href: `https://${raw}` });
  }
  return found;
}

function isInviteHost({ host, key }) {
  return host === 'discord.gg' || ((host === 'discord.com' || host === 'discordapp.com') && key.includes('/invite/'));
}

// "check this out: https://example.com/page." should not include the full stop
function trimTrailingPunctuation(url) {
  return url.replace(/[.,!?:;*_~|>]+$/, '');
}

function uniqueBy(items, keyOf) {
  const seen = new Set();
  return items.filter((item) => {
    const key = keyOf(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
