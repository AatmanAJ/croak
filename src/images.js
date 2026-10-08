import sharp from 'sharp';

/**
 * Shrink an image to fit in maxSize x maxSize and return it as a JPEG data URL.
 * Smaller images mean fewer tokens and faster uploads. Animated images use their first frame.
 * @param {Buffer} buffer
 */
export async function toDataUrl(buffer, maxSize = 512) {
  const jpeg = await sharp(buffer, { animated: false })
    .rotate() // apply EXIF orientation before the metadata is stripped
    .resize(maxSize, maxSize, { fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 80 })
    .toBuffer();
  return `data:image/jpeg;base64,${jpeg.toString('base64')}`;
}
