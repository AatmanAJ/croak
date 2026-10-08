// The /croak slash command: setup, check, allow, block.

import { ChannelType, InteractionContextType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { config } from './config.js';
import { checkEmbed } from './embeds.js';
import { extractItems } from './extract.js';
import { normalizeUrl } from './links.js';

const MOD_ALLOW_TTL = 90 * 24 * 60 * 60 * 1000;

const target = (o) => o.setName('target').setDescription('A link, a site, or a discord.gg invite').setRequired(true);
const wholeSite = (o) => o.setName('whole_site').setDescription('Every link on this site, not just this one (default: just this link)');

export const croakCommand = new SlashCommandBuilder()
  .setName('croak')
  .setDescription('Croak settings and tools')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
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
  .addSubcommand((s) =>
    s
      .setName('check')
      .setDescription('See what Croak would do with a link or invite, without posting it')
      .addStringOption((o) => o.setName('link').setDescription('A link or a discord.gg invite').setRequired(true)),
  )
  .addSubcommand((s) => s.setName('allow').setDescription('Always allow this in this server').addStringOption(target).addBooleanOption(wholeSite))
  .addSubcommand((s) => s.setName('block').setDescription('Always croak this in this server').addStringOption(target).addBooleanOption(wholeSite));

export function createCommands({ db, judge, resolveInvite }) {
  const reply = (interaction, content) => interaction.reply({ content, flags: MessageFlags.Ephemeral });

  async function setup(interaction) {
    if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
      return reply(interaction, 'Setting up Croak needs the Manage Server permission.');
    }
    const picked = interaction.options.getChannel('channel', true);
    // Look the channel up ourselves: the copy attached to the command may not carry permission info
    const channel = await interaction.guild.channels.fetch(picked.id).catch(() => null);
    const timeoutMinutes = interaction.options.getInteger('timeout_minutes') ?? db.getGuild(interaction.guildId)?.timeout_minutes ?? null;
    const me = interaction.guild.members.me;

    const needed = [
      [PermissionFlagsBits.ViewChannel, 'View Channel'],
      [PermissionFlagsBits.SendMessages, 'Send Messages'],
      [PermissionFlagsBits.EmbedLinks, 'Embed Links'],
    ];
    const lacking = channel ? needed.filter(([flag]) => !channel.permissionsFor(me)?.has(flag)).map(([, name]) => name) : needed.map(([, name]) => name);
    if (lacking.length) {
      return reply(
        interaction,
        `Croak can't post in ${picked} yet. It's missing: ${lacking.join(', ')}.\n` +
          'If the channel is private, open its settings → Permissions, add Croak, allow those, then run this again.',
      );
    }

    db.setGuild(interaction.guildId, { logChannelId: channel.id, timeoutMinutes });

    const missing = [
      [PermissionFlagsBits.ManageMessages, 'Manage Messages (to delete spam)'],
      [PermissionFlagsBits.ModerateMembers, 'Moderate Members (to time people out)'],
    ]
      .filter(([flag]) => !me.permissions.has(flag))
      .map(([, label]) => `- ${label}`);
    const minutes = timeoutMinutes ?? config.defaultTimeoutMinutes;

    return reply(
      interaction,
      [
        `Done. Croak will post to ${channel}.`,
        minutes > 0 ? `Anyone whose message is croaked gets a ${minutes}-minute timeout.` : 'Croak will not time anyone out.',
        missing.length ? `\nCroak is still missing these server permissions:\n${missing.join('\n')}` : '',
      ].join('\n'),
    );
  }

  async function check(interaction) {
    const input = interaction.options.getString('link', true);
    const { links, invites } = extractItems({ content: input.includes('://') || /discord\.gg\//i.test(input) ? input : `https://${input}` });
    const item = invites[0] ?? links[0];
    if (!item) return reply(interaction, "That doesn't look like a link or an invite.");

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const [result] = await judge.judgeAll([item], { guildId: interaction.guildId, text: input });
    return interaction.editReply({ embeds: [checkEmbed(result)] });
  }

  async function override(interaction, verdict) {
    const input = interaction.options.getString('target', true).trim();
    const whole = interaction.options.getBoolean('whole_site') ?? false;
    const save = (kind, key) =>
      db.putVerdict({ guildId: interaction.guildId, kind, key, verdict, source: 'mod', ttlMs: verdict === 'allow' ? MOD_ALLOW_TTL : null });
    const verb = verdict === 'allow' ? 'allow' : 'croak';

    const { invites } = extractItems({ content: input });
    if (invites.length) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const server = await resolveInvite(invites[0].code).catch(() => null);
      if (!server?.guildId) return interaction.editReply('That invite is invalid or has expired.');
      save('server', server.guildId);
      return interaction.editReply(`Croak will ${verb} invites to **${server.name}** in this server.`);
    }

    const url = normalizeUrl(input.includes('://') ? input : `https://${input}`);
    if (!url) return reply(interaction, "That doesn't look like a link, a site or an invite.");
    if (whole) {
      save('domain', url.host);
      return reply(interaction, `Croak will ${verb} every link on **${url.host}** in this server.`);
    }
    save('link', url.key);
    return reply(interaction, `Croak will ${verb} \`${url.key}\` in this server.`);
  }

  return {
    async handle(interaction) {
      const sub = interaction.options.getSubcommand();
      if (sub === 'setup') return setup(interaction);
      if (sub === 'check') return check(interaction);
      if (sub === 'allow') return override(interaction, 'allow');
      if (sub === 'block') return override(interaction, 'block');
    },
  };
}
