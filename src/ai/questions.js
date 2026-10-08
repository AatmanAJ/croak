// The questions the bot asks about every new link, invite or image.
// Separate predicates (rather than one choice) so each gets its own probability and threshold.

export const MODERATION_QUESTIONS = [
  {
    type: 'predicate',
    name: 'scam',
    instructions:
      'Is this a scam, phishing or fraud attempt? Examples: fake giveaways (including fake celebrity or ' +
      'MrBeast giveaways), crypto or investment schemes promising returns, "free Nitro" or gift links, ' +
      'fake login or verification pages, or anything asking people to send money, crypto or account ' +
      'details. Ordinary links to well-known sites, games or communities are not scams.',
  },
  {
    type: 'predicate',
    name: 'nsfw',
    instructions:
      'Does this show, link to or advertise sexual or pornographic content, nudity, or an 18+/NSFW ' +
      'community? Swearing, memes or suggestive jokes without nudity do not count.',
  },
  {
    type: 'predicate',
    name: 'spam',
    instructions:
      'Is this unsolicited advertising or mass-posted promotion, such as invites to unrelated servers, ' +
      'selling followers or accounts, or "DM me to earn money" offers? A member sharing a relevant link ' +
      'in conversation is not spam.',
  },
];

export const QUESTION_NAMES = MODERATION_QUESTIONS.map((q) => q.name);

const MAX_MESSAGE_CHARS = 1000;

/**
 * Turn a message (and what we learned about its link or invite, if any) into text evidence.
 * @param {object} msg
 * @param {string} msg.message the message text
 * @param {string} [msg.link] the link being judged
 * @param {string} [msg.expandedFrom] the short link that redirected to `link`
 * @param {object} [msg.invite] details of the server a discord.gg invite points to
 * @param {string[]} [msg.notes] facts found by Croak's own checks, e.g. a look-alike domain
 */
export function describeMessage({ message, link, expandedFrom, invite, notes = [] }) {
  const lines = ['A member posted this message in a Discord server.', '', `Message: ${truncate(message)}`];
  if (link) {
    lines.push('', `The link being checked: ${link}`);
    if (expandedFrom) lines.push(`It was posted as the short link ${expandedFrom}, which redirects there.`);
  }
  for (const note of notes) lines.push(`Note: ${note}.`);
  if (invite) {
    lines.push('', 'The Discord invite in the message points to this server:');
    lines.push(`- Name: ${invite.name}`);
    if (invite.description) lines.push(`- Description: ${invite.description}`);
    if (invite.nsfwLevel) lines.push(`- Discord's NSFW level: ${invite.nsfwLevel}`);
    if (invite.memberCount != null) lines.push(`- Members: ${invite.memberCount}`);
  }
  return lines.join('\n');
}

/** The text that goes alongside an image. */
export function describeImage(message, { qr } = {}) {
  const lines = [
    message
      ? `A member posted this image in a Discord server, with this message: ${truncate(message)}`
      : 'A member posted this image in a Discord server.',
  ];
  if (qr) lines.push(`The image contains a QR code that opens: ${qr.slice(0, 300)}`);
  return lines.join('\n');
}

function truncate(text) {
  return text.length > MAX_MESSAGE_CHARS ? `${text.slice(0, MAX_MESSAGE_CHARS)}…` : text;
}
