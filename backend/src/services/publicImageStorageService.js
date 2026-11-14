const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

// A shared persistent filesystem is deliberately sufficient; no new provider or credentials.
function root() {
  const configured = String(process.env.PUBLIC_IMAGE_STORAGE_ROOT || '').trim();
  if (configured && !path.isAbsolute(configured))
    throw Error('PUBLIC_IMAGE_STORAGE_ROOT must be absolute.');
  if (
    process.env.NODE_ENV === 'production' &&
    process.env.STORAGE_DRIVER !== 'b2' &&
    !configured
  )
    throw Error('Production requires PUBLIC_IMAGE_STORAGE_ROOT on a shared persistent volume.');
  return configured || path.resolve(__dirname, '../../uploads');
}
async function directory(kind) {
  if (!['avatars', 'portfolio-images'].includes(kind)) throw Error('Invalid image directory.');
  const base = root();
  const target = path.join(base, kind);
  await fs.mkdir(target, { recursive: true });
  const actual = await fs.realpath(target);
  if (path.relative(await fs.realpath(base), actual) !== kind)
    throw Error('Unsafe image directory.');
  return actual;
}
async function put(kind, owner, buffer, extension) {
  if (!/^[a-f0-9]{24}$/i.test(String(owner)) || !['png', 'jpg', 'webp'].includes(extension))
    throw Error('Invalid image identity.');
  if (process.env.STORAGE_DRIVER === 'b2')
    return require('./storedAssetService').put(kind, owner, buffer, extension);
  const filename = `${owner}-${randomUUID()}.${extension}`;
  await fs.writeFile(path.join(await directory(kind), filename), buffer, {
    flag: 'wx',
    mode: 0o600
  });
  return `/uploads/${kind}/${filename}`;
}
async function remove(value, { preserveLegacy = process.env.STORAGE_DRIVER === 'b2' } = {}) {
  if (require('./storedAssetService').parse(value))
    return require('./storedAssetService').remove(value);
  if (preserveLegacy) return;
  const match =
    /^\/uploads\/(avatars|portfolio-images)\/([a-z0-9._-]+\.(?:png|jpe?g|webp))$/i.exec(
      String(value || '')
    );
  if (!match) return;
  const target = path.join(await directory(match[1]), match[2]);
  try {
    await fs.unlink(target);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}
module.exports = { root, directory, put, remove };
