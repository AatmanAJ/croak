import assert from 'node:assert/strict';
import { test } from 'node:test';
import QRCode from 'qrcode';
import { collectMessage, embedImages, isNsfwChannel, triedEveryonePing } from '../src/collect.js';
import { checkDomain } from '../src/lookalike.js';
import { isDiscordLoginLink, readQr } from '../src/qr.js';

test('look-alike domains: typos and unicode are caught, real sites and plain words are not', () => {
  for (const host of ['dlscord-gift.com', 'steamcommunlty.com', 'discrod.com', 'rob1ox.com', 'paypa1.com', 'metamsak.io', '5team.ru']) {
    assert.equal(checkDomain(host)?.kind, 'typo', host);
  }
  assert.equal(checkDomain('xn--dscord-pvf.com').kind, 'unicode');
  for (const host of ['discord.com', 'cdn.discordapp.com', 'steamcommunity.com', 'store.steampowered.com', 'github.com', 'stream-hub.com', 'yahoo-finance.com', 'example.com']) {
    assert.equal(checkDomain(host), null, host);
  }
  assert.equal(checkDomain('discord-gift.com').kind, 'brand'); // weaker: just a hint for the AI
});

test('QR codes: a Discord login QR is recognised, a normal one is read', async () => {
  const login = await QRCode.toBuffer('https://discord.com/ra/abc123def456', { width: 300 });
  const normal = await QRCode.toBuffer('https://example.com/menu', { width: 300 });
  assert.equal(isDiscordLoginLink(await readQr(login)), true);
  assert.equal(await readQr(normal), 'https://example.com/menu');
  assert.equal(isDiscordLoginLink('https://discord.com/channels/1/2'), false);
});

test('forwarded messages: their text and attachments are checked too', () => {
  const att = (name) => ({ url: `https://cdn.discordapp.com/${name}`, name, contentType: 'image/png', size: 10 });
  const collection = (items) => new Map(items.map((x, i) => [String(i), x]));
  const message = {
    content: '',
    attachments: collection([]),
    embeds: [],
    messageSnapshots: collection([{ content: 'free nitro https://scam.example', attachments: collection([att('giveaway.png')]), embeds: [] }]),
  };
  const collected = collectMessage(message);
  assert.equal(collected.forwarded, true);
  assert.match(collected.content, /scam\.example/);
  assert.equal(collected.attachments[0].name, 'giveaway.png');
});

test('link previews: images are taken through Discord’s proxy; GIF pickers and trusted sites skipped', () => {
  const images = embedImages([
    { data: { url: 'https://scam.example/page', image: { url: 'https://scam.example/og.png', proxy_url: 'https://images-ext-1.discordapp.net/og.png' } } },
    { data: { url: 'https://tenor.com/view/frog', type: 'gifv', thumbnail: { proxy_url: 'https://media.discordapp.net/frog.gif' } } },
    { data: { url: 'https://www.youtube.com/watch?v=x', thumbnail: { proxy_url: 'https://images-ext-2.discordapp.net/yt.jpg' } } },
  ]);
  assert.equal(images.length, 1);
  assert.equal(images[0].url, 'https://images-ext-1.discordapp.net/og.png');
  assert.match(images[0].name, /scam\.example/);
});

test('@everyone without permission is a signal; a real ping or a mod is not', () => {
  const withPerm = (allowed) => ({ permissionsFor: () => ({ has: () => allowed }) });
  assert.equal(triedEveryonePing({ content: '@everyone free nitro', mentions: { everyone: false }, channel: withPerm(false), member: {} }), true);
  assert.equal(triedEveryonePing({ content: '@everyone meeting now', mentions: { everyone: true }, channel: withPerm(true), member: {} }), false);
  assert.equal(triedEveryonePing({ content: 'hello there', mentions: { everyone: false }, channel: withPerm(false), member: {} }), false);
});

test('age-restricted: a channel, or a thread inside one', () => {
  assert.equal(isNsfwChannel({ nsfw: true }), true);
  assert.equal(isNsfwChannel({ parent: { nsfw: true } }), true);
  assert.equal(isNsfwChannel({ nsfw: false }), false);
});
