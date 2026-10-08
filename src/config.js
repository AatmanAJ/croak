// Tunable numbers in one place. Thresholds come from the planning doc and should be re-tuned
// once real spam examples have been scored with `npm run try`.

const DAY = 24 * 60 * 60 * 1000;

export const config = {
  // AI scores (0 to 1) at or above which a message is deleted, or held for mod review
  deleteAt: 0.9,
  reviewAt: 0.6,

  // Give up on the AI after this long and fall back (see decideAction in moderate.js)
  aiTimeoutMs: 2000,

  // Who counts as "new": their posts are held when the bot isn't sure
  newAccountDays: 7,
  newMemberHours: 24,

  // The same message in this many channels within the window is treated as spam without asking the AI
  repeat: { channels: 3, windowMs: 60_000 },

  // How long cached verdicts last. Approvals expire sooner because a safe site can turn bad.
  ttl: {
    allowLink: 7 * DAY,
    allowServer: 7 * DAY,
    allowImage: 30 * DAY,
    review: 1 * DAY,
    block: 90 * DAY,
  },

  defaultTimeoutMinutes: 60,
  imageMaxBytes: 10 * 1024 * 1024,
  imagesPerMessage: 4,
  linksPerMessage: 5,

  // Two images whose perceptual hashes differ by at most this many bits (of 64) count as the same
  nearDuplicateBits: 6,
};

// Whole-domain approvals are only for hand-picked sites like these; everything else is judged per link.
// No image hosts here: an approved domain would wave through any image posted from it.
export const TRUSTED_DOMAINS = [
  'discord.com',
  'discord.gift',
  'youtube.com',
  'youtu.be',
  'github.com',
  'wikipedia.org',
  'google.com',
  'reddit.com',
  'twitter.com',
  'x.com',
  'twitch.tv',
  'spotify.com',
  'store.steampowered.com',
  'steamcommunity.com',
];

// GIF pickers. Skipped by host, never by a .gif extension (a scam image can be a .gif).
export const GIF_HOSTS = ['tenor.com', 'giphy.com'];

// Link shorteners worth expanding so the AI sees the real destination
export const SHORTENERS = [
  'bit.ly',
  'tinyurl.com',
  't.co',
  'is.gd',
  'cutt.ly',
  'rb.gy',
  'shorturl.at',
  'goo.su',
  'ow.ly',
  'tiny.cc',
  'rebrand.ly',
];

/** True when host is the domain itself or one of its subdomains. */
export function hostMatches(host, domains) {
  return domains.some((d) => host === d || host.endsWith(`.${d}`));
}
