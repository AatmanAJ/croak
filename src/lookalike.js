// Cheap, instant checks on a link's domain before the AI sees it: misspellings of big brands
// (dlscord, steamcommunlty) and look-alike unicode letters. These don't delete anything on their
// own; they make sure a mod sees the link and tell the AI what looks off.

import { parse } from 'tldts';

// Brand name -> its real domains
const BRANDS = {
  discord: ['discord.com', 'discord.gg', 'discord.gift', 'discordapp.com', 'discordapp.net', 'discord.media', 'discord.new', 'discord.dev', 'discordstatus.com'],
  steamcommunity: ['steamcommunity.com'],
  steampowered: ['steampowered.com'],
  steam: ['steampowered.com', 'steamcommunity.com', 'steamstatic.com', 'steamgames.com', 'steamdeck.com'],
  roblox: ['roblox.com'],
  epicgames: ['epicgames.com'],
  youtube: ['youtube.com', 'youtu.be'],
  twitch: ['twitch.tv'],
  github: ['github.com', 'github.io'],
  paypal: ['paypal.com', 'paypal.me'],
  binance: ['binance.com'],
  coinbase: ['coinbase.com'],
  metamask: ['metamask.io'],
  opensea: ['opensea.io'],
  instagram: ['instagram.com'],
  minecraft: ['minecraft.net'],
  microsoft: ['microsoft.com'],
  riotgames: ['riotgames.com'],
  spotify: ['spotify.com'],
};

// Characters scammers swap in for letters, mapped back
const CONFUSABLES = [
  [/0/g, 'o'],
  [/1/g, 'l'],
  [/3/g, 'e'],
  [/4/g, 'a'],
  [/5/g, 's'],
  [/7/g, 't'],
  [/rn/g, 'm'],
  [/vv/g, 'w'],
];

/**
 * @returns {{ kind: 'typo' | 'unicode' | 'brand', brand?: string, note: string } | null}
 *   typo: a near-miss of a brand (dlscord). unicode: look-alike letters (xn--).
 *   brand: contains a brand name on a domain that isn't the brand's (discord-gift.com); weaker.
 */
export function checkDomain(host) {
  const parsed = parse(host);
  const domain = parsed.domain;
  const label = parsed.domainWithoutSuffix;
  if (!domain || !label) return null;

  const official = (brand) => BRANDS[brand].some((d) => domain === d || host.endsWith(`.${d}`));

  if (host.split('.').some((part) => part.startsWith('xn--'))) {
    return { kind: 'unicode', note: `the domain ${host} uses look-alike non-Latin letters` };
  }

  const tokens = [...new Set([label, ...label.split(/[-_.]/)])].filter((t) => t.length >= 4);
  for (const token of tokens) {
    if (COMMON_WORDS.has(token)) continue;
    const plain = CONFUSABLES.reduce((s, [from, to]) => s.replace(from, to), token);
    for (const brand of Object.keys(BRANDS)) {
      if (official(brand) || token === brand) continue; // an exact brand name is the weaker 'brand' signal below
      if (plain === brand || (Math.abs(plain.length - brand.length) <= editsAllowed(brand) && distance(plain, brand) <= editsAllowed(brand))) {
        return { kind: 'typo', brand, note: `the domain ${host} looks like a misspelling of ${brand}` };
      }
    }
  }
  for (const token of tokens) {
    const brand = Object.keys(BRANDS).find(
      (b) => !official(b) && (token === b || (b.length >= 6 && token.includes(b))),
    );
    if (brand) return { kind: 'brand', brand, note: `the domain ${host} uses the name ${brand} but isn't ${brand}'s own site` };
  }
  return null;
}

// Short brand names only match exact look-alike swaps (5team); longer ones allow small typos.
// Typos of short names collide with real words ("stream" is one letter from "steam").
function editsAllowed(brand) {
  if (brand.length < 7) return 0;
  return brand.length >= 10 ? 2 : 1;
}

// Real words one edit away from a brand ("finance" vs "binance")
const COMMON_WORDS = new Set(['finance', 'finances', 'stream', 'streams', 'youtuber', 'youtubers', 'discover', 'spotted', 'instagrams']);

/** Damerau-Levenshtein distance (adjacent swaps count as one edit). */
export function distance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}
