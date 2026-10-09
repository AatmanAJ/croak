// The weekly digest: a summary of what Croak did, posted in the mod log once a week for servers
// that turn it on with /croak digest.

import { statsEmbed } from './embeds.js';

const WEEK = 7 * 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

/** True when a server's weekly digest is due. */
export function digestDue(settings, now = Date.now()) {
  return settings.digest === 'weekly' && Boolean(settings.logChannelId) && now - (settings.lastDigestAt ?? 0) >= WEEK;
}

export function startDigests({ client, db, kit, log = console.log }) {
  const run = async () => {
    for (const guild of client.guilds.cache.values()) {
      const settings = db.getSettings(guild.id);
      if (!digestDue(settings)) continue;
      const channel = kit.logChannelFor(guild.id);
      if (!channel) continue;
      try {
        const embed = statsEmbed({ guild, days: 7, usage: db.statsSince(guild.id, 7), summary: db.caseSummary(guild.id, 7) }).setTitle(`Your week with Croak in ${guild.name}`);
        await channel.send({ embeds: [embed] });
        db.updateSettings(guild.id, { lastDigestAt: Date.now() });
      } catch (err) {
        log(`Digest failed in ${guild.name}: ${err.message}`);
      }
    }
  };
  const timer = setInterval(() => run().catch(() => {}), HOUR);
  timer.unref();
  return () => clearInterval(timer);
}
