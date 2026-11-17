const persistence = require('../../integrations/services/integrationPersistenceService');
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
  'notificationReceipt',
  'otp',
  'membership',
  'workflowRun',
  'aiVersion',
  'Recruiter',
  'supportTicket',
  'supportTicketDedupe',
  'supportTicketQuota'
];
const MODEL_LOADERS = {
  analysis: () => require('../../skill-gap/models/analysis'),
  analysisCache: () => require('../../skill-gap/models/analysisCache'),
  resumeFile: () => require('../../resume/models/resumeFile'),
  resumeAnalysis: () => require('../../resume/models/resumeAnalysis'),
  resumeAnalysisCache: () => require('../../resume/models/resumeAnalysisCache'),
  careerSprint: () => require('../../career-sprint/models/careerSprint'),
  scenarioSimulation: () => require('../../scenario-simulator/models/scenarioSimulation'),
  weeklyReport: () => require('../../weekly-reports/models/weeklyReport'),
  recommendation: () => require('../../recommendations/models/recommendation'),
  skill: () => require('../../skill-gap/models/skill'),
  skillGraph: () => require('../../skill-gap/models/skillGraph'),
  stats: () => require('../../dashboard/models/stats'),
  savedPreview: () => require('../../../core/ai/models/savedPreview'),
  interviewPrepSession: () => require('../../interview-prep/models/interviewPrepSession'),
  newsSavedItem: () => require('../../news/models/newsSavedItem'),
  userJobAction: () => require('../../jobs/models/userJobAction'),
  userCourseProgress: () => require('../../courses/models/userCourseProgress'),
  notification: () => require('../../notifications/models/notification'),
  notificationReceipt: () => require('../../notifications/models/notificationReceipt'),
  notificationState: () => require('../../notifications/models/notificationState'),
  otp: () => require('../models/otp'),
  membership: () => require('../../admin/models/membership'),
  workflowRun: () => require('../../workflows/models/workflowRun'),
  aiVersion: () => require('../../super-admin/models/aiVersion'),
  Recruiter: () => require('../../recruiter/models/Recruiter'),
  supportTicket: () => require('../../support/models/supportTicket'),
  supportTicketDedupe: () => require('../../support/models/supportTicketDedupe'),
  supportTicketQuota: () => require('../../support/models/supportTicketQuota'),
  publicProfileCache: () => require('../../public-portfolio/models/publicProfileCache'),
  publicProfileView: () => require('../../public-portfolio/models/publicProfileView'),
  publicPortfolioVisit: () => require('../../public-portfolio/models/publicPortfolioVisit'),
  sprintPreference: () => require('../../career-sprint/models/sprintPreference'),
  sprintSchedule: () => require('../../career-sprint/models/sprintSchedule'),
  RecruiterMatch: () => require('../../recruiter/models/RecruiterMatch'),
  RecruiterShortlist: () => require('../../recruiter/models/RecruiterShortlist'),
  storedAsset: () => require('../../../core/storage/models/storedAsset'),
  user: () => User,
  organization: () => require('../../admin/models/organization'),
  publicProfile: () => require('../../public-portfolio/models/publicProfile'),
  Candidate: () => require('../../recruiter/models/Candidate'),
  repository: () => require('../../github/models/repository'),
  Job: () => require('../../recruiter/models/Job'),
  integrationConnection: () => require('../../integrations/models/integrationConnection'),
  integrationInsight: () => require('../../integrations/models/integrationInsight'),
  integrationSyncLog: () => require('../../integrations/models/integrationSyncLog'),
  integrationLinkedProfile: () => require('../../integrations/models/integrationLinkedProfile'),
  accountDeletionCleanup: () => require('../models/accountDeletionCleanup')
};
const resolveOwnedModel = (name) => {
  const loadModel = MODEL_LOADERS[name];
  if (!loadModel) throw new Error(`Unknown owned model: ${name}`);
  return loadModel();
};
async function removeOwnedData(owner, session) {
  const Organization = require('../../admin/models/organization');
  if (await Organization.exists({ ownerId: owner }).session(session))
    throw Object.assign(Error('Transfer organization ownership before deleting this account.'), {
      status: 409
    });
  const Profile = require('../../public-portfolio/models/publicProfile');
  const profiles = await Profile.find({ userId: owner }).select('_id').session(session).lean();
  const ids = profiles.map((profile) => profile._id);
  for (const name of ['publicProfileCache', 'publicProfileView', 'publicPortfolioVisit'])
    await resolveOwnedModel(name).deleteMany({ profileId: { $in: ids } }, { session });
  await Profile.deleteMany({ userId: owner }, { session });
  const files = await require('../../resume/models/resumeFile')
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
    await resolveOwnedModel(name).deleteMany({ userId: owner }, { session });
  await require('../../recruiter/models/Candidate').deleteMany({ userId: owner }, { session });
  await require('../../github/models/repository').deleteMany({ ownerId: owner }, { session });
  for (const name of ['sprintPreference', 'sprintSchedule', 'notificationState'])
    await resolveOwnedModel(name).deleteMany({ _id: owner }, { session });
  for (const name of ['RecruiterMatch', 'RecruiterShortlist'])
    await resolveOwnedModel(name).deleteMany(
      { $or: [{ recruiterId: owner }, { candidateId: owner }] },
      { session }
    );
  // Organization jobs are shared records. Disable future recruiting without erasing history.
  await require('../../recruiter/models/Job').updateMany(
    { recruiterId: owner },
    { $set: { status: 'closed' } },
    { session }
  );
  await require('../../../core/storage/storedAssetService').markOwnerDeleted(owner, session);
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
      await require('../../../core/storage/models/storedAsset').exists({ ownerId: owner })
    );
  else
    await require('../../../core/storage/storedAssetService')
      .retryCleanup(owner)
      .catch(() => {
        objectCleanupFailed = true;
      });
  const fs = require('node:fs/promises');
  const images = require('../../../core/storage/publicImageStorageService');
  // Re-check ownership and confinement on every retry. Never follow arbitrary stored paths.
  for (const url of job.resumeUrls) {
    if (await require('../../resume/models/resumeFile').exists({ fileUrl: url })) continue;
    const file = require('../../public-portfolio/services/publicProfileService').resolveStoredResumePath(url);
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
  if (objectCleanupFailed) throw require('../../../core/storage/b2ObjectStorageService').unavailable();
  await Cleanup.deleteOne({ _id: owner });
}
module.exports = { deleteAccount, removeOwnedData, processCleanup, ownedModels, resolveOwnedModel };
