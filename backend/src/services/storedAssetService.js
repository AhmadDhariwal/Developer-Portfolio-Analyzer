const crypto = require('node:crypto');
const Asset = require('../models/storedAsset');
const User = require('../models/user');
const Profile = require('../models/publicProfile');
const Resume = require('../models/resumeFile');
const persistence = require('./integrationPersistenceService');
const b2 = require('./b2ObjectStorageService');
const IMAGE =
  /^\/uploads\/(avatars|portfolio-images)\/([a-f0-9]{24})-b2-([a-f0-9-]{36})\.(png|jpg|webp)$/;
const PDF = /^b2:\/\/resumes\/([a-f0-9]{24})\/([a-f0-9-]{36})\.pdf$/;
function canonical(value) {
  const raw = String(value || '');
  if (/^https?:\/\//.test(raw)) {
    try {
      return new URL(raw).pathname;
    } catch {
      return '';
    }
  }
  return raw;
}
function parse(value) {
  const reference = canonical(value);
  const image = IMAGE.exec(reference);
  const pdf = PDF.exec(reference);
  return image
    ? { reference, ownerId: image[2], kind: image[1] }
    : pdf
      ? { reference, ownerId: pdf[1], kind: 'resumes' }
      : null;
}
function references(value, result = new Set(), depth = 0) {
  if (depth > 20) throw Error('Invalid asset content.');
  if (typeof value === 'string') {
    const ref = parse(value);
    if (ref) result.add(ref.reference);
  } else if (value && typeof value === 'object')
    for (const item of Object.values(value)) references(item, result, depth + 1);
  return result;
}
async function put(kind, owner, buffer, extension) {
  if (
    !/^[a-f0-9]{24}$/.test(String(owner)) ||
    !Buffer.isBuffer(buffer) ||
    !buffer.length ||
    !['avatars', 'portfolio-images', 'resumes'].includes(kind) ||
    (kind === 'resumes'
      ? extension !== 'pdf' || buffer.length > 10485760
      : !['png', 'jpg', 'webp'].includes(extension) || buffer.length > 2097152)
  )
    throw Object.assign(Error('Invalid storage upload.'), { status: 400 });
  const adapter = b2.getAdapter();
  const id = crypto.randomUUID();
  const bucketAlias = kind === 'resumes' ? 'resumes' : 'images';
  const reference =
    kind === 'resumes'
      ? `b2://resumes/${owner}/${id}.pdf`
      : `/uploads/${kind}/${owner}-b2-${id}.${extension}`;
  const data = {
    reference,
    ownerId: owner,
    kind,
    bucketAlias,
    bucket: adapter.config.buckets[bucketAlias].bucket,
    key: `v1/${kind}/${owner}/${id}.${extension}`,
    size: buffer.length,
    mimeType:
      kind === 'resumes'
        ? 'application/pdf'
        : { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' }[extension],
    sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
    state: 'uploading',
    expiresAt: new Date(Date.now() + 120000)
  };
  await persistence.transaction(async (session) => {
    await persistence.ownerFence(owner, session);
    await Asset.create([data], { session });
  });
  try {
    const uploaded = await adapter.put(data, buffer);
    await persistence.transaction(async (session) => {
      await persistence.ownerFence(owner, session);
      const result = await Asset.updateOne(
        { reference, ownerId: owner, state: 'uploading' },
        {
          $set: {
            versionId: uploaded.versionId,
            state: 'staged',
            expiresAt: new Date(Date.now() + 86400000)
          }
        },
        { session }
      );
      if (!result.matchedCount) throw b2.unavailable();
    });
    return reference;
  } catch {
    await Asset.updateOne(
      { reference, state: { $in: ['uploading', 'staged'] } },
      { $set: { state: 'deleting' } }
    ).catch(() => {});
    throw b2.unavailable();
  }
}
async function get(value, owner) {
  const ref = parse(value);
  if (!ref || String(ref.ownerId) !== String(owner))
    throw Object.assign(Error('Asset not found.'), { status: 404 });
  const asset = await Asset.findOne({
    reference: ref.reference,
    ownerId: owner,
    state: { $in: ['staged', 'ready'] }
  }).lean();
  if (!asset || !asset.versionId)
    throw Object.assign(Error('Asset not found.'), { status: 404 });
  return asset;
}
async function read(value, owner) {
  return b2.getAdapter().read(await get(value, owner));
}
async function activate(values, owner, session) {
  for (const value of values) {
    const ref = parse(value);
    if (!ref || String(ref.ownerId) !== String(owner))
      throw Object.assign(Error('Invalid owned asset.'), { status: 400 });
    const result = await Asset.updateOne(
      { reference: ref.reference, ownerId: owner, state: { $in: ['staged', 'ready'] } },
      { $set: { state: 'ready' } },
      { session }
    );
    if (!result.matchedCount)
      throw Object.assign(Error('Invalid owned asset.'), { status: 400 });
  }
}
async function commitAvatar(owner, next) {
  let previous;
  await persistence.transaction(async (session) => {
    await persistence.ownerFence(owner, session);
    if (parse(next)) await activate([next], owner, session);
    else if (
      !String(next).startsWith(`/uploads/avatars/${owner}-`) ||
      !/^\/uploads\/avatars\/[a-z0-9-]+\.(png|jpg|webp)$/.test(next)
    )
      throw Object.assign(Error('Invalid owned avatar.'), { status: 400 });
    previous = await User.findOneAndUpdate(
      { _id: owner },
      { $set: { avatar: next } },
      { session, returnDocument: 'before' }
    ).lean();
    if (!previous) throw Object.assign(Error('Account unavailable.'), { status: 404 });
    const old = parse(previous.avatar);
    if (old && old.reference !== next)
      await Asset.updateOne(
        { reference: old.reference, ownerId: owner },
        { $set: { state: 'deleting' } },
        { session }
      );
  });
  return previous;
}
async function commitPortfolio(profile, previous) {
  const next = references(profile.toObject());
  await persistence.transaction(async (session) => {
    await persistence.ownerFence(profile.userId, session);
    await activate(next, profile.userId, session);
    await profile.save({ session });
    for (const reference of previous)
      if (!next.has(reference))
        await Asset.updateOne(
          { reference, ownerId: profile.userId },
          { $set: { state: 'deleting' } },
          { session }
        );
  });
}
async function commitResume(file) {
  await persistence.transaction(async (session) => {
    await persistence.ownerFence(file.userId, session);
    await activate([file.fileUrl], file.userId, session);
    await file.save({ session });
    await User.updateOne(
      { _id: file.userId },
      { $set: { activeResumeFileId: file._id } },
      { session }
    );
  });
}
async function isReferenced(asset, session) {
  if (await User.exists({ _id: asset.ownerId, avatar: asset.reference }).session(session))
    return true;
  if (await Resume.exists({ userId: asset.ownerId, fileUrl: asset.reference }).session(session))
    return true;
  const profiles = await Profile.find({ userId: asset.ownerId })
    .limit(101)
    .session(session)
    .lean();
  if (profiles.length > 100) throw b2.unavailable();
  return profiles.some((profile) => references(profile).has(asset.reference));
}
async function cleanup(asset) {
  let claimed;
  // Reference attachment, account deletion and restoring a referenced receipt
  // share the same owner fence. A delayed cleanup cannot resurrect a receipt
  // as ready after the account's deletion transaction has committed.
  await persistence.transaction(async (session) => {
    if (await User.exists({ _id: asset.ownerId }).session(session))
      await persistence.ownerFence(asset.ownerId, session);
    if (await isReferenced(asset, session)) {
      await Asset.updateOne({ _id: asset._id }, { $set: { state: 'ready' } }, { session });
      claimed = null;
      return;
    }
    claimed = await Asset.findOneAndUpdate(
      { _id: asset._id, state: { $in: ['deleting', 'uploading', 'staged'] } },
      { $set: { state: 'deleting' } },
      { session, returnDocument: 'after' }
    ).lean();
  });
  if (!claimed) return;
  // A deleting asset cannot acquire new references; activation rejects that state.
  const deleted = await b2.getAdapter().remove(claimed);
  // An uncertain PUT can still complete after a timeout or process death. Keep
  // its receipt until a concrete version is observed and deleted or an operator
  // verifies absence; never lose the only recovery record on an empty listing.
  if (!deleted && !claimed.versionId) throw b2.unavailable();
  await Asset.deleteOne({ _id: claimed._id, state: 'deleting' });
}
async function remove(value) {
  const ref = parse(value);
  if (!ref) return;
  const asset = await Asset.findOne({ reference: ref.reference, ownerId: ref.ownerId }).lean();
  if (!asset) return;
  await Asset.updateOne({ _id: asset._id }, { $set: { state: 'deleting' } });
  await cleanup({ ...asset, state: 'deleting' });
}
async function markOwnerDeleted(owner, session) {
  await Asset.updateMany({ ownerId: owner }, { $set: { state: 'deleting' } }, { session });
}
async function retryCleanup(owner) {
  const filter = {
    $and: [
      { $or: [{ retryAfter: { $lte: new Date() } }, { retryAfter: { $exists: false } }] },
      {
        $or: [
          { state: 'deleting' },
          { state: { $in: ['uploading', 'staged'] }, expiresAt: { $lte: new Date() } }
        ]
      }
    ]
  };
  if (owner) filter.ownerId = owner;
  const batch = await Asset.find(filter).sort({ retryAfter: 1, createdAt: 1 }).limit(50).lean();
  let failed = false;
  for (const asset of batch) {
    try {
      await cleanup(asset);
    } catch {
      failed = true;
      await Asset.updateOne(
        { _id: asset._id },
        { $set: { retryAfter: new Date(Date.now() + 60000) }, $inc: { cleanupAttempts: 1 } }
      ).catch(() => {});
    }
  }
  if (failed) throw b2.unavailable();
  if (owner && (await Asset.exists({ ownerId: owner }))) throw b2.unavailable();
  return batch.length;
}
module.exports = {
  parse,
  references,
  put,
  get,
  read,
  activate,
  commitAvatar,
  commitPortfolio,
  commitResume,
  remove,
  markOwnerDeleted,
  retryCleanup
};
