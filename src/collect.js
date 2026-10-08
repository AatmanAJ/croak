// Everything in a Discord message worth checking, as plain data: its text (including forwarded
// messages), attachments, and link-preview images. Kept separate from discord.js so it's testable.

import { PermissionFlagsBits } from 'discord.js';
import { config, GIF_HOSTS, hostMatches, TRUSTED_DOMAINS } from './config.js';

const EVERYONE = /@(everyone|here)\b/i;

/**
 * @param {import('discord.js').Message} message
 * @returns {{ content: string, attachments: object[], embedImages: object[], forwarded: boolean }}
 */
export function collectMessage(message) {
  // Forwarded messages carry their content in snapshots, not in message.content
  const snapshots = [...(message.messageSnapshots?.values() ?? [])];
  const content = [message.content, ...snapshots.map((s) => s.content)].filter(Boolean).join('\n');
  const attachments = [message.attachments, ...snapshots.map((s) => s.attachments)]
    .flatMap((c) => (c ? [...c.values()] : []))
    .map((a) => ({ url: a.url, name: a.name, contentType: a.contentType, size: a.size }));
  const embeds = [message.embeds ?? [], ...snapshots.map((s) => s.embeds ?? [])].flat();
  return { content, attachments, embedImages: embedImages(embeds), forwarded: snapshots.length > 0 };
}

/**
 * Images from link previews (the picture Discord shows under a pasted link, or a pasted image
 * link). Fetched through Discord's media proxy, never from the original site. GIF pickers and
 * trusted sites (YouTube thumbnails and the like) are skipped.
 */
export function embedImages(embeds) {
  const seen = new Set();
  const out = [];
  for (const embed of embeds) {
    const data = embed.data ?? embed;
    if (data.type === 'gifv') continue;
    const host = hostOf(data.url);
    if (host && (hostMatches(host, GIF_HOSTS) || hostMatches(host, TRUSTED_DOMAINS))) continue;
    for (const asset of [data.image, data.thumbnail]) {
      const url = asset?.proxy_url ?? asset?.proxyURL ?? asset?.url;
      if (!url || seen.has(url)) continue;
      seen.add(url);
      out.push({ kind: 'image', url, name: `link preview${host ? ` from ${host}` : ''}`, size: 0 });
    }
  }
  return out.slice(0, config.imagesPerMessage);
}

/** True when someone without permission tries to ping @everyone or @here, a hacked-account tell. */
export function triedEveryonePing(message) {
  if (!EVERYONE.test(message.content ?? '') || message.mentions?.everyone) return false;
  const perms = message.channel?.permissionsFor?.(message.member);
  return !perms?.has(PermissionFlagsBits.MentionEveryone);
}

/** Age-restricted channels, including threads inside one. */
export function isNsfwChannel(channel) {
  return Boolean(channel?.nsfw ?? channel?.parent?.nsfw);
}

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}
