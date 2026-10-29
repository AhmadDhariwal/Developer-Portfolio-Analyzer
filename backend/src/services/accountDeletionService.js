const persistence = require('./integrationPersistenceService');
const User = require('../models/user');

// Explicit ownership inventory. Shared catalogs, provider snapshots and organization
// audit records have separate retention policies and must never be swept by email.
const ownedModels = [
  'analysis',
  'analysisCache',
  'resumeFile',
  'resumeAnalysis',
  'resumeAnalysisCache',
  'careerSprint',
  'scenarioSimulation',
  'weeklyReport',
  'recommendation',
  'skill',
  'skillGraph',
  'stats',
  'savedPreview',
  'interviewPrepSession',
  'newsSavedItem',
  'userJobAction',
  'userCourseProgress',
  'notification',
  'otp',
  'membership',
  'workflowRun',
  'aiVersion',
  'Recruiter',
  'supportTicket',
  'supportTicketDedupe',
  'supportTicketQuota'
];
async function removeOwnedData(owner, session) {
  const Organization = require('../models/organization');
  if (await Organization.exists({ ownerId: owner }).session(session))
    throw Object.assign(
      Error('Transfer organization ownership before deleting this account.'),
      { status: 409 }
    );
  const Profile = require('../models/publicProfile');
  const profiles = await Profile.find({ userId: owner }).select('_id').session(session).lean();
  const ids = profiles.map((profile) => profile._id);
  for (const name of ['publicProfileCache', 'publicProfileView', 'publicPortfolioVisit'])
    await require(`../models/${name}`).deleteMany({ profileId: { $in: ids } }, { session });
  await Profile.deleteMany({ userId: owner }, { session });
  const files = await require('../models/resumeFile')
    .find({ userId: owner })
    .select('fileUrl')
    .session(session)
    .lean();
  await require('../models/accountDeletionCleanup').updateOne(
    { _id: owner },
    { $setOnInsert: { resumeUrls: files.map((file) => file.fileUrl), createdAt: new Date() } },
    { upsert: true, session }
  );
  for (const name of ownedModels)
    await require(`../models/${name}`).deleteMany({ userId: owner }, { session });
  await require('../models/Candidate').deleteMany({ userId: owner }, { session });
  await require('../models/repository').deleteMany({ ownerId: owner }, { session });
  for (const name of ['sprintPreference', 'sprintSchedule'])
    await require(`../models/${name}`).deleteMany({ _id: owner }, { session });
  for (const name of ['RecruiterMatch', 'RecruiterShortlist'])
    await require(`../models/${name}`).deleteMany(
      { $or: [{ recruiterId: owner }, { candidateId: owner }] },
      { session }
    );
  // Organization jobs are shared records. Disable future recruiting without erasing history.
  await require('../models/Job').updateMany(
    { recruiterId: owner },
    { $set: { status: 'closed' } },
    { session }
  );
  await require('./storedAssetService').markOwnerDeleted(owner, session);
  await User.deleteOne({ _id: owner }, { session });
}
async function deleteAccount(owner) {
  // Reuse the existing transaction and owner write fence against integration commits.
  await persistence.deleteAccount(owner, (session) => removeOwnedData(owner, session));
  await processCleanup(owner, { deferObjects: true }).catch(() =>
    console.warn('Account file cleanup pending; retained for retry.')
  );
}
async function processCleanup(owner, { deferObjects = false } = {}) {
  const Cleanup = require('../models/accountDeletionCleanup');
  const job = await Cleanup.findById(owner).lean();
  if (!job) return;
  let objectCleanupFailed = false;
  if (deferObjects)
    objectCleanupFailed = Boolean(
      await require('../models/storedAsset').exists({ ownerId: owner })
    );
  else
    await require('./storedAssetService')
      .retryCleanup(owner)
      .catch(() => {
        objectCleanupFailed = true;
      });
  const fs = require('node:fs/promises');
  const images = require('./publicImageStorageService');
  // Re-check ownership and confinement on every retry. Never follow arbitrary stored paths.
  for (const url of job.resumeUrls) {
    if (await require('../models/resumeFile').exists({ fileUrl: url })) continue;
    const file = require('./publicProfileService').resolveStoredResumePath(url);
    if (file)
      await fs.unlink(file).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
      });
  }
  for (const kind of ['avatars', 'portfolio-images']) {
    const directory = await images.directory(kind);
    const entries = await fs.opendir(directory);
    const prefix = `${owner}-`;
    for await (const entry of entries) {
      const filename = entry.name;
      if (filename.startsWith(prefix) && /^[a-z0-9._-]+\.(png|jpe?g|webp)$/i.test(filename))
        await images.remove(`/uploads/${kind}/${filename}`, { preserveLegacy: false });
    }
  }
  if (objectCleanupFailed) throw require('./b2ObjectStorageService').unavailable();
  await Cleanup.deleteOne({ _id: owner });
}
module.exports = { deleteAccount, removeOwnedData, processCleanup, ownedModels };
