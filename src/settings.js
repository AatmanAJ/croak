// Per-server settings: defaults, sensitivity presets, and the policy a check runs under.

import { config } from './config.js';

export const CATEGORIES = ['scam', 'nsfw', 'spam'];

export const PRESETS = {
  relaxed: { deleteAt: 0.95, reviewAt: 0.75, label: 'Relaxed', blurb: 'Only acts when very sure. Fewer holds, more slips through.' },
  standard: { deleteAt: config.deleteAt, reviewAt: config.reviewAt, label: 'Standard', blurb: 'The default balance.' },
  strict: { deleteAt: 0.8, reviewAt: 0.5, label: 'Strict', blurb: 'Acts sooner. Best for servers under attack or with young members.' },
};

export const ESCALATIONS = {
  off: { label: 'Off', steps: ['timeout'] },
  standard: { label: 'Standard', steps: ['timeout', 'long-timeout', 'kick'] },
  strict: { label: 'Strict', steps: ['timeout', 'kick', 'ban'] },
};

export const DEFAULT_SETTINGS = Object.freeze({
  logChannelId: null,
  timeoutMinutes: config.defaultTimeoutMinutes,
  preset: 'standard',
  categories: { scam: true, nsfw: true, spam: true },
  exemptChannels: [],
  exemptRoles: [],
  cleanupMinutes: 5, // when someone is croaked, also delete what they posted in the last N minutes
  escalation: 'off',
  quarantineRoleId: null, // if set, this role is given instead of a timeout
  alertRoleId: null, // pinged when a raid is detected
  dmMembers: true,
  dmNote: null, // the server's own line added to the DM, e.g. "Questions? Ask in #support"
  digest: 'off', // 'weekly' posts a summary in the mod log
  lastDigestAt: null,
  automod: { enabled: false, ruleId: null },
});

const MAX_EXEMPTIONS = 50;

/** Defaults with a server's saved values on top (nested objects merged one level deep). */
export function withDefaults(saved = {}) {
  return {
    ...DEFAULT_SETTINGS,
    ...saved,
    categories: { ...DEFAULT_SETTINGS.categories, ...saved.categories },
    automod: { ...DEFAULT_SETTINGS.automod, ...saved.automod },
    exemptChannels: (saved.exemptChannels ?? []).slice(0, MAX_EXEMPTIONS),
    exemptRoles: (saved.exemptRoles ?? []).slice(0, MAX_EXEMPTIONS),
  };
}

/** Add or remove an ID from a list setting, keeping it unique and bounded. */
export function toggleInList(list, id, on) {
  const without = list.filter((x) => x !== id);
  return on ? [...without, id].slice(-MAX_EXEMPTIONS) : without;
}

/**
 * How strict a check is in one place: the server's thresholds, plus which categories to ignore.
 * NSFW is ignored in age-restricted channels, and anything a server switched off is ignored everywhere.
 */
export function policyFor(settings, { nsfwChannel = false } = {}) {
  const preset = PRESETS[settings.preset] ?? PRESETS.standard;
  const ignore = CATEGORIES.filter((c) => !settings.categories[c]);
  if (nsfwChannel && !ignore.includes('nsfw')) ignore.push('nsfw');
  return { deleteAt: preset.deleteAt, reviewAt: preset.reviewAt, ignore };
}
