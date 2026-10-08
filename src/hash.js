import sharp from 'sharp';

/**
 * 64-bit difference hash (dHash) as 16 hex characters. Resized, recompressed or slightly
 * edited copies of an image land within a few bits of each other, unlike a file checksum.
 * @param {Buffer} buffer
 */
export async function dHash(buffer) {
  const pixels = await sharp(buffer, { animated: false })
    .grayscale()
    .resize(9, 8, { fit: 'fill' })
    .raw()
    .toBuffer();
  let hash = 0n;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      hash = (hash << 1n) | (pixels[y * 9 + x] > pixels[y * 9 + x + 1] ? 1n : 0n);
    }
  }
  return hash.toString(16).padStart(16, '0');
}

/** Number of differing bits between two hex hashes. */
export function hamming(a, b) {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let bits = 0;
  while (x) {
    x &= x - 1n;
    bits++;
  }
  return bits;
}
