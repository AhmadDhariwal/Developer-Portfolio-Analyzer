'use strict';
const sharp = require('sharp');
const { imageType } = require('../utils/imageType');
const MAX_BYTES = 2 * 1024 * 1024;
let active = 0;
const error = (status, message) => Object.assign(Error(message), { status });
function setting(name, fallback, maximum) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value >= 1 && value <= maximum ? value : fallback;
}
async function optimize(buffer, kind) {
  if (!Buffer.isBuffer(buffer) || buffer.length > MAX_BYTES)
    throw error(413, 'One image up to 2 MiB is required.');
  if (!imageType(buffer)) throw error(400, 'A valid PNG, JPG or WebP image is required.');
  if (active >= 2) throw error(503, 'Image processing is busy. Please retry.');
  active++;
  try {
    const pipeline = sharp(buffer, {
      limitInputPixels: 16000000,
      failOn: 'warning',
      sequentialRead: true
    });
    const metadata = await pipeline.metadata();
    if (!['png', 'jpeg', 'webp'].includes(metadata.format) || (metadata.pages || 1) > 1)
      throw error(400, 'A single-frame PNG, JPG or WebP image is required.');
    const side =
      kind === 'avatars'
        ? setting('PROFILE_AVATAR_MAX_DIMENSION', 512, 1024)
        : setting('PROFILE_PORTFOLIO_MAX_DIMENSION', 1600, 2048);
    const { data, info } = await pipeline
      .rotate()
      .resize({ width: side, height: side, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: setting('PROFILE_IMAGE_WEBP_QUALITY', 82, 95), effort: 3 })
      .timeout({ seconds: 3 })
      .toBuffer({ resolveWithObject: true });
    if (data.length > MAX_BYTES) throw error(413, 'Processed image exceeds 2 MiB.');
    return {
      buffer: data,
      extension: 'webp',
      mimeType: 'image/webp',
      size: data.length,
      width: info.width,
      height: info.height
    };
  } catch (failure) {
    if (failure.status) throw failure;
    throw error(400, 'Image could not be safely decoded.');
  } finally {
    active--;
  }
}
module.exports = { optimize };
