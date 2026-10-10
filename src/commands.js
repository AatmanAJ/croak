// The /croak slash command. Everything needs Manage Messages; changing settings needs Manage Server.

import { ChannelType, InteractionContextType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { config } from './config.js';
import { caseEmbed, caseSummaryView, checkEmbed, helpEmbed, statsEmbed, statusEmbed } from './embeds.js';
import { memberPanel } from './member-panel.js';
import { extractItems } from './extract.js';
import { normalizeUrl } from './links.js';
import { clearModDecision, saveModDecision } from './overrides.js';
import { diagnose, fixRow, problemLines } from './health.js';
import { formatMinutes } from './punish.js';
import { ESCALATIONS, PRESETS, policyFor, toggleInList } from './settings.js';

const P = PermissionFlagsBits;
const target = (o) => o.setName('target').setDescription('A link, a site, or a discord.gg invite').setRequired(true);
const wholeSite = (o) => o.setName('whole_site').setDescription('Every link on this site, not just this one (default: just this link)');

export const croakCommand = new SlashCommandBuilder()
  .setName('croak')
  .setDescription('Croak settings and tools')
  .setDefaultMemberPermissions(P.ManageMessages)
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((s) =>
    s
      .setName('setup')
      .setDescription('Choose the mod-log channel and the timeout length')
      .addChannelOption((o) =>
        o.setName('channel').setDescription('Where Croak posts what it croaks or holds').addChannelTypes(ChannelType.GuildText).setRequired(true),
      )
      .addIntegerOption((o) =>
        o
          .setName('timeout_minutes')
          .setDescription(`Timeout for someone whose message is croaked. 0 = none (default ${config.defaultTimeoutMinutes})`)
          .setMinValue(0)
          .setMaxValue(40_320),
      ),
  )
  .addSubcommand((s) => s.setName('status').setDescription('Check permissions and see every setting'))
  .addSubcommand((s) =>
    s
      .setName('stats')
      .setDescription('What Croak caught recently')
      .addIntegerOption((o) => o.setName('days').setDescription('How far back (default 7)').setMinValue(1).setMaxValue(30)),
  )
  .addSubcommand((s) =>
    s
      .setName('check')
      .setDescription('See what Croak would do with a link or invite, without posting it')
      .addStringOption((o) => o.setName('link').setDescription('A link or a discord.gg invite').setRequired(true)),
  )
  .addSubcommand((s) => s.setName('allow').setDescription('Always allow this in this server').addStringOption(target).addBooleanOption(wholeSite))
  .addSubcommand((s) => s.setName('block').setDescription('Always croak this in this server').addStringOption(target).addBooleanOption(wholeSite))
  .addSubcommand((s) =>
    s.setName('unlist').setDescription('Remove one of your allow or block entries').addStringOption(target).addBooleanOption(wholeSite),
  )
  .addSubcommand((s) => s.setName('lists').setDescription("This server's allow and block entries"))
  .addSubcommand((s) =>
    s
      .setName('sensitivity')
      .setDescription('How sure Croak must be before acting')
      .addStringOption((o) =>
        o
          .setName('level')
          .setDescription('Relaxed, Standard or Strict')
          .setRequired(true)
          .addChoices(...Object.entries(PRESETS).map(([value, p]) => ({ name: `${p.label}: ${p.blurb}`.slice(0, 100), value }))),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName('category')
      .setDescription('Turn a kind of check on or off')
      .addStringOption((o) =>
        o
          .setName('name')
          .setDescription('Which check')
          .setRequired(true)
          .addChoices({ name: 'Scams and phishing', value: 'scam' }, { name: 'NSFW', value: 'nsfw' }, { name: 'Spam and unwanted promotion', value: 'spam' }),
      )
      .addBooleanOption((o) => o.setName('enabled').setDescription('On or off').setRequired(true)),
  )
  .addSubcommand((s) =>
    s
      .setName('exempt-channel')
      .setDescription('Skip a channel (and its threads)')
      .addChannelOption((o) =>
        o
          .setName('channel')
          .setDescription('The channel')
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum, ChannelType.GuildVoice)
          .setRequired(true),
      )
      .addBooleanOption((o) => o.setName('exempt').setDescription('Skip it (default) or check it again')),
  )
  .addSubcommand((s) =>
    s
      .setName('exempt-role')
      .setDescription('Skip members with a role')
      .addRoleOption((o) => o.setName('role').setDescription('The role').setRequired(true))
      .addBooleanOption((o) => o.setName('exempt').setDescription('Skip it (default) or check it again')),
  )
  .addSubcommand((s) =>
    s
      .setName('actions')
      .setDescription('What happens to someone who is croaked')
      .addIntegerOption((o) => o.setName('timeout_minutes').setDescription('Timeout length, 0 = none').setMinValue(0).setMaxValue(40_320))
      .addIntegerOption((o) =>
        o.setName('cleanup_minutes').setDescription('Also delete their messages from the last N minutes, 0 = off').setMinValue(0).setMaxValue(60),
      )
      .addStringOption((o) =>
        o
          .setName('escalation')
          .setDescription('Repeat offenders in 30 days')
          .addChoices(
            { name: 'Off: always the normal timeout', value: 'off' },
            { name: 'Standard: timeout, then 1 day, then kick', value: 'standard' },
            { name: 'Strict: timeout, then kick, then ban', value: 'strict' },
          ),
      )
      .addRoleOption((o) => o.setName('quarantine_role').setDescription('Give this role instead of a timeout'))
      .addBooleanOption((o) => o.setName('clear_quarantine_role').setDescription('Go back to timeouts'))
      .addRoleOption((o) => o.setName('alert_role').setDescription('Ping this role when a raid is detected'))
      .addBooleanOption((o) => o.setName('clear_alert_role').setDescription('Stop pinging for raids'))
      .addBooleanOption((o) => o.setName('dm_members').setDescription('DM people when their message is croaked')),
  )
  .addSubcommand((s) =>
    s
      .setName('automod')
      .setDescription("Mirror confirmed scam sites into Discord's AutoMod, so they're blocked before anyone is pinged")
      .addBooleanOption((o) => o.setName('enabled').setDescription('On or off').setRequired(true)),
  )
  .addSubcommand((s) => s.setName('settings').setDescription('Every main setting on one screen'))
  .addSubcommand((s) =>
    s
      .setName('member')
      .setDescription("A member's cases and strikes, with watch, trust, purge, timeout and ban buttons")
      .addUserOption((o) => o.setName('user').setDescription('The member').setRequired(true)),
  )
  .addSubcommand((s) =>
    s
      .setName('case')
      .setDescription('Look up a case by number')
      .addIntegerOption((o) => o.setName('number').setDescription('The case number, e.g. 142').setRequired(true).setMinValue(1)),
  )
  .addSubcommand((s) =>
    s
      .setName('lockdown')
      .setDescription('Slowmode every channel and pause invites, for a set time (raids)')
      .addStringOption((o) => o.setName('action').setDescription('Start or end').setRequired(true).addChoices({ name: 'Start', value: 'on' }, { name: 'End', value: 'off' }))
      .addIntegerOption((o) => o.setName('minutes').setDescription('How long (default 30)').setMinValue(5).setMaxValue(1440))
      .addIntegerOption((o) => o.setName('slowmode_seconds').setDescription('Slowmode per channel (default 30)').setMinValue(5).setMaxValue(21_600)),
  )
  .addSubcommand((s) =>
    s
      .setName('message')
      .setDescription('Add your own line to the DM members get when Croak removes their message')
      .addStringOption((o) => o.setName('note').setDescription('e.g. "Questions? Ask in #support"').setMaxLength(300))
      .addBooleanOption((o) => o.setName('clear').setDescription('Remove your note')),
  )
  .addSubcommand((s) =>
    s
      .setName('digest')
      .setDescription('A weekly summary of what Croak did, posted in your mod log')
      .addStringOption((o) => o.setName('schedule').setDescription('Weekly or off').setRequired(true).addChoices({ name: 'Weekly', value: 'weekly' }, { name: 'Off', value: 'off' })),
  )
  .addSubcommand((s) => s.setName('test').setDescription('Post a sample case in the mod log, to see what one looks like'))
  .addSubcommand((s) => s.setName('help').setDescription('Every Croak command'));

const SETTINGS_COMMANDS = new Set(['setup', 'sensitivity', 'category', 'exempt-channel', 'exempt-role', 'actions', 'automod', 'lockdown', 'message', 'digest']);

export function createCommands({ db, judge, resolveInvite, automod, lockdown, interactions }) {
  const reply = (interaction, content) => interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });

  async function setup(interaction) {
    const picked = interaction.options.getChannel('channel', true);
    // Look the channel up ourselves: the copy attached to the command may not carry permission info
    const channel = await interaction.guild.channels.fetch(picked.id).catch(() => null);
    const timeoutMinutes = interaction.options.getInteger('timeout_minutes');
    const me = interaction.guild.members.me;

    const needed = [
      [P.ViewChannel, 'View Channel'],
      [P.SendMessages, 'Send Messages'],
      [P.EmbedLinks, 'Embed Links'],
    ];
    const lacking = needed.filter(([flag]) => !channel?.permissionsFor(me)?.has(flag)).map(([, name]) => name);
    if (lacking.length) {
      return reply(
        interaction,
        `Croak can't post in ${picked} yet. It's missing: ${lacking.join(', ')}.\n` +
          'If the channel is private, open its settings → Permissions, add Croak, allow those, then run this again.',
      );
    }

    const settings = db.updateSettings(interaction.guildId, { logChannelId: channel.id, ...(timeoutMinutes != null && { timeoutMinutes }) });
    // Say straight away if something will stop Croak working, rather than letting actions fail later
    const health = diagnose(interaction.guild, settings);
    return interaction.reply({
      content: [
        `Done. Croak will post to ${channel}.`,
        settings.timeoutMinutes > 0
          ? `Anyone whose message is croaked gets a ${formatMinutes(settings.timeoutMinutes)} timeout.`
          : 'Croak will not time anyone out.',
        ...(health.ok
          ? ['Every permission is in place, so every feature works. `/croak status` shows every setting.']
          : ['', '⚠️ **Before it can do everything, fix this:**', ...problemLines(interaction.guild, health)]),
      ].join('\n'),
      components: health.ok ? [] : [fixRow(interaction.guild)],
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
  }

  function healthChecks(guild, settings) {
    const me = guild.members.me;
    const has = (flag) => me.permissions.has(flag);
    const logChannel = settings.logChannelId ? guild.channels.cache.get(settings.logChannelId) : null;
    const canLog = logChannel?.permissionsFor(me)?.has([P.ViewChannel, P.SendMessages, P.EmbedLinks]);
    const checks = [
      { ok: Boolean(canLog), label: canLog ? `Mod log: ${logChannel}` : 'Mod log: not set up, or Croak can\'t post there. Run `/croak setup`.' },
      { ok: has(P.ManageMessages), label: 'Manage Messages (delete spam)' },
      settings.quarantineRoleId
        ? { ok: has(P.ManageRoles), label: 'Manage Roles (give the quarantine role)' }
        : { ok: has(P.ModerateMembers), label: 'Moderate Members (timeouts)' },
      { ok: has(P.ManageWebhooks), label: 'Manage Webhooks (repost approved messages) · optional' },
    ];
    if (settings.escalation === 'standard') checks.push({ ok: has(P.KickMembers), label: 'Kick Members (escalation)' });
    if (settings.escalation === 'strict') {
      checks.push({ ok: has(P.KickMembers), label: 'Kick Members (escalation)' }, { ok: has(P.BanMembers), label: 'Ban Members (escalation)' });
    }
    if (settings.automod.enabled) checks.push({ ok: has(P.ManageGuild), label: 'Manage Server (AutoMod sync)' });

    // Roles above Croak's can't be timed out; mod roles don't matter since mods are never checked
    const above = guild.roles.cache.filter(
      (r) => r.position > me.roles.highest.position && !r.managed && !r.permissions.has(P.ManageMessages),
    );
    checks.push(
      above.size
        ? { ok: false, label: `Croak's role is below ${[...above.values()].slice(0, 5).join(', ')}: members with those roles can't be timed out` }
        : { ok: true, label: "Croak's role is above every member role" },
    );
    return checks;
  }

  async function status(interaction) {
    const settings = db.getSettings(interaction.guildId);
    const today = db.statsSince(interaction.guildId, 1);
    const checks = healthChecks(interaction.guild, settings);
    return interaction.reply({
      embeds: [statusEmbed({ guild: interaction.guild, settings, checks, today, limits: config.ai })],
      components: checks.every((c) => c.ok) ? [] : [fixRow(interaction.guild)],
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
  }

  async function stats(interaction) {
    const days = interaction.options.getInteger('days') ?? 7;
    return interaction.reply({
      embeds: [statsEmbed({ guild: interaction.guild, days, usage: db.statsSince(interaction.guildId, days), summary: db.caseSummary(interaction.guildId, days) })],
      flags: MessageFlags.Ephemeral,
    });
  }

  async function check(interaction) {
    const input = interaction.options.getString('link', true).trim();
    const { links, invites } = extractItems({ content: input.includes('://') || /discord\.gg\//i.test(input) ? input : `https://${input}` });
    const item = invites[0] ?? links[0];
    if (!item) return reply(interaction, "That doesn't look like a link or an invite.");

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const policy = policyFor(db.getSettings(interaction.guildId));
    const [result] = await judge.judgeAll([item], { guildId: interaction.guildId, text: input, policy });
    return interaction.editReply({ embeds: [checkEmbed(result)] });
  }

  /** Turn a /croak allow|block|unlist target into what's stored: a link, a whole site, or a server. */
  async function resolveTarget(interaction) {
    const input = interaction.options.getString('target', true).trim();
    const whole = interaction.options.getBoolean('whole_site') ?? false;
    const { invites } = extractItems({ content: input });
    if (invites.length) {
      const server = await resolveInvite(invites[0].code).catch(() => null);
      if (!server?.guildId) return { error: 'That invite is invalid or has expired.' };
      return { kind: 'server', key: server.guildId, label: `invites to **${server.name}**` };
    }
    const url = normalizeUrl(input.includes('://') ? input : `https://${input}`);
    if (!url) return { error: "That doesn't look like a link, a site or an invite." };
    return whole
      ? { kind: 'domain', key: url.host, label: `every link on **${url.host}**`, host: url.host }
      : { kind: 'link', key: url.key, label: `\`${url.key}\``, host: url.host };
  }

  async function override(interaction, verdict) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const t = await resolveTarget(interaction);
    if (t.error) return interaction.editReply(t.error);
    const network = saveModDecision(db, { guildId: interaction.guildId, kind: t.kind, key: t.key, verdict });
    if (verdict === 'block' && t.host) automod?.addHost(interaction.guildId, t.host);
    return interaction.editReply(
      `Croak will ${verdict === 'allow' ? 'allow' : 'croak'} ${t.label} in this server.` +
        (network ? '\nMods in several servers have now blocked this, so it is blocked across every Croak server.' : ''),
    );
  }

  async function unlist(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const t = await resolveTarget(interaction);
    if (t.error) return interaction.editReply(t.error);
    const removed = clearModDecision(db, { guildId: interaction.guildId, kind: t.kind, key: t.key });
    return interaction.editReply(removed ? `Removed ${t.label} from this server's list.` : `${t.label} isn't on this server's list.`);
  }

  async function lists(interaction) {
    const rows = db.guildVerdicts(interaction.guildId, 40);
    if (rows.length === 0) return reply(interaction, 'This server has no allow or block entries yet. Add one with `/croak allow` or `/croak block`.');
    const show = (r) => {
      const what = r.kind === 'server' ? `server \`${r.key}\`` : r.kind === 'domain' ? `site \`${r.key}\`` : r.kind === 'image' ? `image \`${r.key.slice(0, 8)}…\`` : `\`${r.key.slice(0, 80)}\``;
      return `${what} · <t:${Math.floor(r.created_at / 1000)}:R>`;
    };
    const allowed = rows.filter((r) => r.verdict === 'allow').map(show);
    const blocked = rows.filter((r) => r.verdict === 'block').map(show);
    const text = [
      `**Allowed** (${allowed.length})`,
      ...(allowed.length ? allowed : ['nothing']),
      '',
      `**Blocked** (${blocked.length})`,
      ...(blocked.length ? blocked : ['nothing']),
    ].join('\n');
    return reply(interaction, text.slice(0, 1900));
  }

  async function sensitivity(interaction) {
    const level = interaction.options.getString('level', true);
    db.updateSettings(interaction.guildId, { preset: level });
    const p = PRESETS[level];
    return reply(interaction, `Sensitivity is now **${p.label}**: croak at ${p.deleteAt}, send to review at ${p.reviewAt}. ${p.blurb}`);
  }

  async function category(interaction) {
    const name = interaction.options.getString('name', true);
    const enabled = interaction.options.getBoolean('enabled', true);
    const settings = db.getSettings(interaction.guildId);
    db.updateSettings(interaction.guildId, { categories: { ...settings.categories, [name]: enabled } });
    const label = { scam: 'Scam and phishing', nsfw: 'NSFW', spam: 'Spam' }[name];
    return reply(interaction, `${label} checks are now **${enabled ? 'on' : 'off'}**.${name === 'nsfw' && enabled ? ' Age-restricted channels still skip them.' : ''}`);
  }

  async function exempt(interaction, kind) {
    const settings = db.getSettings(interaction.guildId);
    const on = interaction.options.getBoolean('exempt') ?? true;
    if (kind === 'channel') {
      const channel = interaction.options.getChannel('channel', true);
      db.updateSettings(interaction.guildId, { exemptChannels: toggleInList(settings.exemptChannels, channel.id, on) });
      return reply(interaction, on ? `Croak will skip ${channel} and its threads.` : `Croak will check ${channel} again.`);
    }
    const role = interaction.options.getRole('role', true);
    db.updateSettings(interaction.guildId, { exemptRoles: toggleInList(settings.exemptRoles, role.id, on) });
    return reply(interaction, on ? `Croak will skip members with ${role}.` : `Croak will check members with ${role} again.`);
  }

  async function actions(interaction) {
    const o = interaction.options;
    const patch = {};
    const timeout = o.getInteger('timeout_minutes');
    if (timeout != null) patch.timeoutMinutes = timeout;
    const cleanup = o.getInteger('cleanup_minutes');
    if (cleanup != null) patch.cleanupMinutes = cleanup;
    const escalation = o.getString('escalation');
    if (escalation) patch.escalation = escalation;
    const quarantine = o.getRole('quarantine_role');
    if (quarantine) patch.quarantineRoleId = quarantine.id;
    if (o.getBoolean('clear_quarantine_role')) patch.quarantineRoleId = null;
    const alert = o.getRole('alert_role');
    if (alert) patch.alertRoleId = alert.id;
    if (o.getBoolean('clear_alert_role')) patch.alertRoleId = null;
    const dm = o.getBoolean('dm_members');
    if (dm != null) patch.dmMembers = dm;

    const s = Object.keys(patch).length ? db.updateSettings(interaction.guildId, patch) : db.getSettings(interaction.guildId);
    const punishment = s.quarantineRoleId
      ? `they get <@&${s.quarantineRoleId}>`
      : s.timeoutMinutes > 0
        ? `they're timed out for ${formatMinutes(s.timeoutMinutes)}`
        : "they aren't timed out";
    const lines = [
      `When someone is croaked, ${punishment}${s.cleanupMinutes ? `, and their messages from the last ${s.cleanupMinutes} min are deleted` : ''}.`,
      `Escalation: **${ESCALATIONS[s.escalation].label}**${s.escalation === 'off' ? '' : ` (${ESCALATIONS[s.escalation].steps.join(' → ')})`}.`,
      `Member DMs: **${s.dmMembers ? 'on' : 'off'}** · Raid alerts: ${s.alertRoleId ? `ping <@&${s.alertRoleId}>` : 'no ping'}.`,
    ];
    if (quarantine && quarantine.position >= interaction.guild.members.me.roles.highest.position) {
      lines.push(`⚠️ ${quarantine} is above Croak's role, so Croak can't give it. Move Croak's role higher.`);
    }
    return reply(interaction, lines.join('\n'));
  }

  async function automodToggle(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const message = await automod.setEnabled(interaction.guild, interaction.options.getBoolean('enabled', true));
    return interaction.editReply(message);
  }

  async function member(interaction) {
    const user = interaction.options.getUser('user', true);
    return interaction.reply({ ...(await memberPanel({ db, guild: interaction.guild, userId: user.id })), flags: MessageFlags.Ephemeral });
  }

  async function caseLookup(interaction) {
    const found = db.getCase(interaction.options.getInteger('number', true));
    if (!found || found.guild_id !== interaction.guildId) return reply(interaction, "There's no case with that number in this server.");
    return interaction.reply({ ...caseSummaryView(found, db.caseEvents(found.id), db.getSettings(interaction.guildId).logChannelId), flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
  }

  async function lockdownCmd(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (interaction.options.getString('action', true) === 'off') return interaction.editReply(await lockdown.end(interaction.guild, interaction.user));
    const { summary, blocked } = await lockdown.start(interaction.guild, {
      minutes: interaction.options.getInteger('minutes') ?? 30,
      slowmode: interaction.options.getInteger('slowmode_seconds') ?? 30,
      by: interaction.user,
    });
    return interaction.editReply({ content: summary, components: blocked ? [fixRow(interaction.guild)] : [] });
  }

  async function dmNote(interaction) {
    const note = interaction.options.getString('note');
    if (interaction.options.getBoolean('clear')) {
      db.updateSettings(interaction.guildId, { dmNote: null });
      return reply(interaction, 'Removed your note from the DM.');
    }
    if (!note) {
      const current = db.getSettings(interaction.guildId).dmNote;
      return reply(interaction, current ? `Your note: “${current}”\nChange it with \`/croak message note:…\`, or remove it with \`clear:true\`.` : 'No note yet. Add one with `/croak message note:…`');
    }
    db.updateSettings(interaction.guildId, { dmNote: note.trim() });
    return reply(interaction, `Done. Members whose message is removed will also see:\n> **From the ${interaction.guild.name} mods:** ${note.trim()}`);
  }

  async function digest(interaction) {
    const schedule = interaction.options.getString('schedule', true);
    db.updateSettings(interaction.guildId, { digest: schedule, lastDigestAt: schedule === 'weekly' ? Date.now() : null });
    return reply(interaction, schedule === 'weekly' ? 'Weekly digest on. The first one arrives in your mod log in 7 days.' : 'Weekly digest off.');
  }

  async function test(interaction) {
    const settings = db.getSettings(interaction.guildId);
    const channel = settings.logChannelId ? interaction.guild.channels.cache.get(settings.logChannelId) : null;
    if (!channel) return reply(interaction, 'Pick a mod-log channel first: `/croak setup` or `/croak settings`.');
    const sample = {
      author: interaction.user,
      channel: interaction.channel,
      content: 'Free Nitro for 3 months, claim fast https://dlscord-gift.com/nitro',
    };
    const results = [
      { item: { kind: 'link' }, label: 'https://dlscord-gift.com/nitro', reason: 'scam link', verdict: 'block', scores: { scam: 0.99, nsfw: 0, spam: 0.91 }, source: 'ai', hint: { note: 'the domain dlscord-gift.com looks like a misspelling of discord' }, ms: 190 },
    ];
    const embed = caseEmbed({ caseId: 0, action: 'delete', reason: 'scam link', message: sample, results, notes: ['(Test: nothing was deleted and nobody was timed out.)'] }).setTitle('Test case: this is what a croak looks like');
    try {
      await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
      return reply(interaction, `Posted a sample case in ${channel}. Real ones come with buttons: Not spam, and a More actions menu.`);
    } catch (err) {
      return reply(interaction, `Croak couldn't post in ${channel}: ${err.message}`);
    }
  }

  const handlers = {
    setup,
    status,
    stats,
    check,
    allow: (i) => override(i, 'allow'),
    block: (i) => override(i, 'block'),
    unlist,
    lists,
    sensitivity,
    category,
    'exempt-channel': (i) => exempt(i, 'channel'),
    'exempt-role': (i) => exempt(i, 'role'),
    actions,
    automod: automodToggle,
    settings: (i) => interactions.openSettings(i),
    member,
    case: caseLookup,
    lockdown: lockdownCmd,
    message: dmNote,
    digest,
    test,
    help: (i) => i.reply({ embeds: [helpEmbed()], flags: MessageFlags.Ephemeral }),
  };

  return {
    async handle(interaction) {
      const sub = interaction.options.getSubcommand();
      if (SETTINGS_COMMANDS.has(sub) && !interaction.memberPermissions.has(P.ManageGuild)) {
        return reply(interaction, 'Changing Croak settings needs the Manage Server permission.');
      }
      return handlers[sub]?.(interaction);
    },
  };
}
