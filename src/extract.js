// Pulls the things worth checking out of a message: links, Discord invites and images.

import { config, GIF_HOSTS, hostMatches } from './config.js';
import { normalizeUrl } from './links.js';

const URL_PATTERN = /https?:\/\/[^\s<>()[\]"']+/gi;
// Discord shows invites even without https://, so the scheme is optional here
const INVITE_PATTERN = /(?:https?:\/\/)?(?:www\.)?(?:discord(?:app)?\.com\/invite|discord\.gg)\/([a-z0-9-]{2,32})/gi;
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

  const links = uniqueBy(
    [...content.matchAll(URL_PATTERN)]
      .map((m) => trimTrailingPunctuation(m[0]))
      .map((raw) => ({ raw, url: normalizeUrl(raw) }))
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
