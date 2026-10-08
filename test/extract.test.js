import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractItems } from '../src/extract.js';
import { normalizeUrl } from '../src/links.js';

test('finds links and drops trailing punctuation', () => {
  const { links } = extractItems({ content: 'look: https://Example.com/page. and (https://foo.io/x)!' });
  assert.deepEqual(
    links.map((l) => l.key),
    ['example.com/page', 'foo.io/x'],
  );
});

test('finds invites with or without https, and keeps them out of links', () => {
  const { links, invites } = extractItems({
    content: 'join discord.gg/abc123 or https://discord.com/invite/XyZ-9 now',
  });
  assert.deepEqual(
    invites.map((i) => i.code),
    ['abc123', 'XyZ-9'],
  );
  assert.equal(links.length, 0);
});

test('skips GIF pickers by host, but not .gif files elsewhere', () => {
  const { links } = extractItems({
    content: 'https://tenor.com/view/frog-123 https://media.giphy.com/x.gif https://scam.example/free.gif',
  });
  assert.deepEqual(
    links.map((l) => l.host),
    ['scam.example'],
  );
});

test('masked links and <suppressed> links are found', () => {
  const { links } = extractItems({ content: '[free nitro](https://dlscord-gift.com/n) <https://evil.example/a>' });
  assert.deepEqual(
    links.map((l) => l.key),
    ['dlscord-gift.com/n', 'evil.example/a'],
  );
});

test('the same link twice is checked once', () => {
  const { links } = extractItems({ content: 'https://a.example/x https://www.A.example/x/ https://a.example/x?utm_source=d' });
  assert.equal(links.length, 1);
});

test('only image attachments under the size limit are checked, GIF files included', () => {
  const { images } = extractItems({
    content: '',
    attachments: [
      { url: 'u1', name: 'a.png', contentType: 'image/png', size: 1000 },
      { url: 'u2', name: 'b.gif', contentType: 'image/gif', size: 1000 },
      { url: 'u3', name: 'c.pdf', contentType: 'application/pdf', size: 1000 },
      { url: 'u4', name: 'd.png', contentType: 'image/png', size: 50 * 1024 * 1024 },
    ],
  });
  assert.deepEqual(
    images.map((i) => i.name),
    ['a.png', 'b.gif'],
  );
});

test('normalizeUrl: case, www, tracking params, fragments, trailing slash', () => {
  assert.equal(normalizeUrl('https://WWW.Example.com/A/?utm_campaign=x&id=5#top').key, 'example.com/A?id=5');
  assert.equal(normalizeUrl('http://example.com/').key, 'example.com');
  assert.equal(normalizeUrl('javascript:alert(1)'), null);
});

test('normalizeUrl turns lookalike unicode domains into punycode the AI can spot', () => {
  const host = normalizeUrl('https://dіscord.com/gift').host; // Cyrillic і, looks like discord.com
  assert.match(host, /^xn--/);
  assert.notEqual(host, 'discord.com');
});
