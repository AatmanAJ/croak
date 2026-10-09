// Reads QR codes in images. "Scan this to verify" QR codes are a common way to steal Discord
// accounts: the code opens Discord's QR login page, and scanning it logs the scammer in.

import jsQR from 'jsqr';
import sharp from 'sharp';

const MAX_SIDE = 800; // big enough for any QR code worth reading, small enough to decode in ~40ms
// Discord's remote-auth (QR login) links
const DISCORD_LOGIN = /^https?:\/\/(?:www\.|ptb\.|canary\.)?discord(?:app)?\.com\/ra\//i;

/** The text inside a QR code in the image, or null if there isn't one. */
export async function readQr(buffer) {
  try {
    const { data, info } = await sharp(buffer, { animated: false })
      .resize(MAX_SIDE, MAX_SIDE, { fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const code = jsQR(new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), info.width, info.height);
    return code?.data || null;
  } catch {
    return null;
  }
}

export function isDiscordLoginLink(text) {
  return DISCORD_LOGIN.test(text ?? '');
}
