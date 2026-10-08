// Draws two placeholder images into test-set/images so the timing script has something to run on
// before real examples are collected: a fake crypto giveaway and a harmless patch-notes card.

import sharp from 'sharp';

const SCAM = `
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800">
  <rect width="1200" height="800" fill="#0b0b12"/>
  <rect x="40" y="40" width="1120" height="720" rx="32" fill="#14142b" stroke="#f7b500" stroke-width="6"/>
  <text x="600" y="170" font-family="Arial, Helvetica, sans-serif" font-size="70" font-weight="bold" fill="#f7b500" text-anchor="middle">MRBEAST CRYPTO GIVEAWAY</text>
  <text x="600" y="280" font-family="Arial, Helvetica, sans-serif" font-size="56" fill="#ffffff" text-anchor="middle">Send 0.1 BTC, get 1 BTC back instantly!</text>
  <text x="600" y="370" font-family="Arial, Helvetica, sans-serif" font-size="44" fill="#ffffff" text-anchor="middle">Only 500 spots left. Celebrate 400M subscribers with us</text>
  <rect x="380" y="430" width="440" height="110" rx="20" fill="#2ecc71"/>
  <text x="600" y="505" font-family="Arial, Helvetica, sans-serif" font-size="52" font-weight="bold" fill="#ffffff" text-anchor="middle">CLAIM NOW</text>
  <text x="600" y="640" font-family="Arial, Helvetica, sans-serif" font-size="48" fill="#4fc3f7" text-anchor="middle">mrbeast-giveaway.xyz</text>
</svg>`;

const OK = `
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800">
  <rect width="1200" height="800" fill="#f4f6fb"/>
  <text x="80" y="140" font-family="Arial, Helvetica, sans-serif" font-size="72" font-weight="bold" fill="#1f2937">Patch notes v1.4</text>
  <text x="80" y="260" font-family="Arial, Helvetica, sans-serif" font-size="44" fill="#374151">• Fixed the inventory crash on startup</text>
  <text x="80" y="340" font-family="Arial, Helvetica, sans-serif" font-size="44" fill="#374151">• New map: Frozen Harbor</text>
  <text x="80" y="420" font-family="Arial, Helvetica, sans-serif" font-size="44" fill="#374151">• Ranked season 3 starts Friday</text>
  <text x="80" y="500" font-family="Arial, Helvetica, sans-serif" font-size="44" fill="#374151">• Thanks to everyone who reported bugs!</text>
</svg>`;

await sharp(Buffer.from(SCAM)).png().toFile('test-set/images/scam-fake-giveaway.png');
await sharp(Buffer.from(OK)).png().toFile('test-set/images/ok-patch-notes.png');
console.log('Wrote test-set/images/scam-fake-giveaway.png and test-set/images/ok-patch-notes.png');
