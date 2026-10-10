import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ChannelType, PermissionFlagsBits as P, PermissionsBitField } from 'discord.js';
import { ALL_PERMISSIONS, createHealthWatch, diagnose, inviteUrl, whyNot } from '../src/health.js';

const perms = (...flags) => new PermissionsBitField(flags);
const role = (id, name, position, { managed = false, flags = [] } = {}) => ({ id, name, position, managed, permissions: perms(...flags), toString: () => `@${name}` });

/** A server shaped like the one that broke: Croak's role at the bottom, missing half its permissions. */
function server({ myFlags = [P.ViewChannel, P.SendMessages, P.EmbedLinks, P.ManageMessages, P.ModerateMembers], croakAt = 1 } = {}) {
  const croak = role('croak', 'Croak', croakAt, { managed: true });
  const roles = [role('g', '@everyone', 0), croak, role('member', 'Member', 2), role('client', 'Client', 5), role('mod', 'Mod', 9, { flags: [P.ManageMessages] }), role('otherbot', 'Sapphire', 7, { managed: true })];
  const me = { id: 'bot', permissions: perms(...myFlags), roles: { highest: croak, botRole: croak } };
  const sent = [];
  const modLog = { id: 'log', type: ChannelType.GuildText, toString: () => '#mod-chat', permissionsFor: () => perms(P.ViewChannel, P.SendMessages, P.EmbedLinks), send: async (m) => sent.push(m) };
  const guild = {
    id: 'g',
    name: 'Test',
    ownerId: 'owner',
    client: { application: { id: 'app' } },
    members: { me },
    roles: { cache: new Map(roles.map((r) => [r.id, r])) },
    channels: { cache: new Map([['log', modLog]]) },
  };
  return { guild, me, croak, sent, roles: Object.fromEntries(roles.map((r) => [r.id, r])) };
}

test('diagnose names the missing permissions and the member roles sitting above Croak', () => {
  const { guild } = server();
  const d = diagnose(guild, { logChannelId: 'log' });
  assert.equal(d.ok, false);
  assert.deepEqual(
    d.missing.map((m) => m.name),
    ['Read Message History', 'Manage Webhooks', 'Manage Channels', 'Manage Server', 'Kick Members', 'Ban Members', 'Manage Roles'],
  );
  // mod roles and other bots' roles don't count: Croak never acts on them
  assert.deepEqual(d.blockedBy.map((r) => r.name), ['Client', 'Member']);
  assert.equal(d.log, null);
});

test('with every permission and its role above the members, nothing is wrong', () => {
  const { guild } = server({ myFlags: ALL_PERMISSIONS, croakAt: 6 });
  assert.equal(diagnose(guild, { logChannelId: 'log' }).ok, true);
});

test('whyNot says exactly what blocks a timeout', () => {
  const { guild, roles } = server({ myFlags: ALL_PERMISSIONS });
  const member = { id: 'u', guild, permissions: perms(), roles: { highest: roles.member } };
  assert.match(whyNot(member, 'timeout'), /Their top role, @Member, is above Croak's.*drag \*\*@Croak\*\* above @Member/);
  assert.match(whyNot({ ...member, id: 'owner' }, 'ban'), /own the server/);
  const noPerm = server({ myFlags: [P.ViewChannel] });
  assert.match(whyNot({ ...member, guild: noPerm.guild }, 'ban'), /doesn't have the \*\*Ban Members\*\* permission/);
});

test('the fix link asks for every permission and goes straight to the server', () => {
  const url = inviteUrl('app', 'g');
  assert.match(url, new RegExp(`permissions=${PermissionsBitField.resolve(ALL_PERMISSIONS)}`));
  assert.match(url, /guild_id=g&disable_guild_select=true/);
});

test('the watcher posts once per new problem, then once when it is all fixed', async () => {
  const s = server();
  let settings = { logChannelId: 'log' };
  const db = { getSettings: () => settings, updateSettings: (_, patch) => (settings = { ...settings, ...patch }) };
  const kit = { logChannelFor: () => s.guild.channels.cache.get('log') };
  const watch = createHealthWatch({ client: {}, db, kit, log: () => {} });

  await watch.check(s.guild);
  await watch.check(s.guild);
  assert.equal(s.sent.length, 1, 'same problems, no repeat');
  assert.match(s.sent[0].embeds[0].data.title, /needs a fix/);
  assert.equal(s.sent[0].components[0].components[0].data.label, 'Fix permissions');

  // the mods re-authorize and drag the role up
  s.me.permissions = perms(...ALL_PERMISSIONS);
  s.croak.position = 6;
  await watch.check(s.guild);
  assert.equal(s.sent.length, 2);
  assert.match(s.sent[1].embeds[0].data.title, /fully set up/);
  await watch.check(s.guild);
  assert.equal(s.sent.length, 2);
});

test('with no mod log yet, the watcher waits and posts once there is one', async () => {
  const s = server();
  let settings = {};
  const db = { getSettings: () => settings, updateSettings: (_, patch) => (settings = { ...settings, ...patch }) };
  let logChannel = null;
  const watch = createHealthWatch({ client: {}, db, kit: { logChannelFor: () => logChannel }, log: () => {} });
  await watch.check(s.guild);
  assert.equal(s.sent.length, 0);
  settings.logChannelId = 'log';
  logChannel = s.guild.channels.cache.get('log');
  await watch.check(s.guild);
  assert.equal(s.sent.length, 1);
});
