const fs = require('node:fs/promises');
const assets = require('./storedAssetService');
async function persist(file, owner) {
  if (process.env.STORAGE_DRIVER !== 'b2') return file.path;
  if (file.buffer) {
    if (file.buffer.length !== file.size)
      throw Object.assign(Error('Invalid resume file.'), { status: 400 });
    return assets.put('resumes', owner, file.buffer, 'pdf');
  }
  const stat = await fs.stat(file.path);
  if (stat.size > 10485760 || stat.size !== file.size)
    throw Object.assign(Error('Invalid resume file.'), { status: 400 });
  return assets.put('resumes', owner, await fs.readFile(file.path), 'pdf');
}
async function read(reference, owner) {
  if (assets.parse(reference)?.kind === 'resumes') return assets.read(reference, owner);
  if (!(await require('../models/resumeFile').exists({ userId: owner, fileUrl: reference })))
    throw Object.assign(Error('Resume not available.'), { status: 404 });
  const file = require('./publicProfileService').resolveStoredResumePath(reference);
  if (!file) throw Object.assign(Error('Resume not available.'), { status: 404 });
  if ((await fs.stat(file)).size > 10485760)
    throw Object.assign(Error('Resume too large.'), { status: 413 });
  return fs.readFile(file);
}
module.exports = { persist, read };
