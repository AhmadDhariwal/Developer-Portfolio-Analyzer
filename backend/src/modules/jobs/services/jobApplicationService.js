const { createHash } = require('node:crypto');
const Job = require('../../recruiter/models/Job');
const Application = require('../models/jobApplication');
const Resume = require('../../resume/models/resumeFile');
const Profile = require('../../public-portfolio/models/publicProfile');
const Organization = require('../../admin/models/organization');
const User = require('../../auth/models/user');
const storage = require('../../resume/services/resumeStorageService');
const { requireObjectId } = require('../../recruiter/utils/recruiterValidation');
const notifications = require('../../notifications/services/notificationService');
const persistence = require('../../notifications/services/notificationTransactionService');
const fail = (message, statusCode = 400) => Object.assign(Error(message), { statusCode });
const eligible = { published: true, status: 'open', archivedAt: null };
const applicationId = (job, applicant) =>
  createHash('sha256').update(`${job}:${applicant}`).digest('hex');
const snapshotHash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const jobFields =
  '_id title description requiredSkills preferredSkills location employmentType minExperienceYears organizationId';

// Deliberately narrow, text-only snapshot: no private analysis, contact data, assets or live URLs.
function portfolioSnapshot(profile) {
  if (!profile) return null;
  return {
    headline: String(profile.headline || '').slice(0, 300),
    summary: String(profile.summary || '').slice(0, 5000),
    skills: (profile.skills || []).slice(0, 100).map((s) => String(s.name).slice(0, 100)),
    projects:
      profile.sections?.visibility?.projects === false
        ? []
        : (profile.projects || []).slice(0, 30).map((p) => ({
            title: String(p.title).slice(0, 300),
            description: String(p.description || '').slice(0, 2000),
            tech: (p.tech || []).slice(0, 30).map((s) => String(s).slice(0, 100))
          }))
  };
}
const applicantView = (a) => ({
  _id: a._id,
  jobId: a.jobId,
  jobTitle: a.jobTitle,
  organizationName: a.organizationName,
  status: a.status,
  timeline: (a.history || [])
    .filter((event) => ['submitted', 'reviewing', 'rejected', 'withdrawn'].includes(event.to))
    .map((event) => ({ status: event.to, at: event.at })),
  resume: a.resume,
  portfolio: a.portfolio,
  consent: a.consent,
  createdAt: a.createdAt,
  updatedAt: a.updatedAt
});
async function discover() {
  return Job.aggregate([
    { $match: eligible },
    {
      $lookup: {
        from: Organization.collection.name,
        localField: 'organizationId',
        foreignField: '_id',
        as: 'organization'
      }
    },
    { $unwind: '$organization' },
    {
      $lookup: {
        from: User.collection.name,
        localField: 'recruiterId',
        foreignField: '_id',
        as: 'recruiter'
      }
    },
    { $unwind: '$recruiter' },
    {
      $match: {
        'organization.isSuspended': { $ne: true },
        'recruiter.role': 'recruiter',
        'recruiter.isActive': { $ne: false },
        $expr: { $eq: ['$recruiter.organizationId', '$organizationId'] }
      }
    },
    { $sort: { createdAt: -1, _id: -1 } },
    { $limit: 50 },
    {
      $project: {
        ...Object.fromEntries(jobFields.split(' ').map((field) => [field, 1])),
        organizationName: '$organization.name'
      }
    }
  ]);
}
async function options(applicantId) {
  const resumes = await Resume.find({
    userId: applicantId,
    mimeType: 'application/pdf',
    fileSize: { $gt: 0, $lte: 10485760 }
  })
    .select('_id fileName uploadDate')
    .sort({ uploadDate: -1 })
    .limit(100)
    .lean();
  const profile = await Profile.findOne({ userId: applicantId }).lean();
  const portfolio = portfolioSnapshot(profile);
  return { resumes, portfolio, portfolioHash: snapshotHash(portfolio) };
}
async function submit(user, jobId, payload = {}) {
  jobId = requireObjectId(jobId, 'jobId');
  if (
    !payload ||
    payload.consent !== true ||
    typeof payload.sharePortfolio !== 'boolean' ||
    Object.keys(payload).some(
      (key) => !['resumeId', 'consent', 'sharePortfolio', 'portfolioHash'].includes(key)
    )
  )
    throw fail('Explicit disclosure consent and portfolio choice are required.');
  const resumeId = requireObjectId(payload.resumeId, 'resumeId');
  const id = applicationId(jobId, user._id);
  const existing = await Application.findById(id).lean();
  if (existing) return { application: applicantView(existing), created: false };
  const resume = await Resume.findOne({
    _id: resumeId,
    userId: user._id,
    mimeType: 'application/pdf'
  }).lean();
  if (!resume || resume.fileSize <= 0 || resume.fileSize > 10485760)
    throw fail('Choose an available PDF resume.');
  const bytes = await storage.read(resume.fileUrl, user._id);
  if (
    !Buffer.isBuffer(bytes) ||
    bytes.length !== resume.fileSize ||
    !bytes.length ||
    bytes.length > 10485760 ||
    !bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))
  )
    throw fail('Resume is not a valid PDF.');
  const portfolio = payload.sharePortfolio
    ? portfolioSnapshot(await Profile.findOne({ userId: user._id }).lean())
    : null;
  if (payload.sharePortfolio && !portfolio) throw fail('Portfolio is unavailable.');
  if (payload.sharePortfolio && payload.portfolioHash !== snapshotHash(portfolio))
    throw fail('Portfolio changed. Refresh and review it before submitting.', 409);
  let saved;
  try {
    saved = await persistence.transaction(async (session) => {
      const duplicate = await Application.findById(id).session(session).lean();
      if (duplicate) return { application: duplicate, created: false };
      const applicant = await User.updateOne(
        { _id: user._id, role: { $in: ['developer', 'user', 'guest'] }, isActive: { $ne: false } },
        { $inc: { __v: 1 } },
        { session, timestamps: false }
      );
      if (!applicant.matchedCount) throw fail('Developer account is unavailable.', 403);
      // Write fence serializes submission against close, unpublish, archive and delete.
      const job = await Job.findOneAndUpdate(
        { _id: jobId, ...eligible },
        { $inc: { __v: 1 } },
        { session, returnDocument: 'after', timestamps: false }
      ).lean();
      if (!job || !job.organizationId) throw fail('This job is unavailable for applications.', 409);
      const org = await Organization.findOne({
        _id: job.organizationId,
        isSuspended: { $ne: true }
      })
        .session(session)
        .lean();
      const recruiter = await User.findOne({
        _id: job.recruiterId,
        organizationId: job.organizationId,
        role: 'recruiter',
        isActive: { $ne: false }
      })
        .session(session)
        .lean();
      if (!org || !recruiter) throw fail('This job is unavailable for applications.', 409);
      const at = new Date();
      const [application] = await Application.create(
        [
          {
            _id: id,
            jobId,
            organizationId: job.organizationId,
            organizationName: org.name,
            recruiterId: job.recruiterId,
            applicantId: user._id,
            applicantName: user.name,
            jobTitle: job.title,
            resume: {
              fileId: resume._id,
              fileName: resume.fileName,
              uploadedAt: resume.uploadDate,
              sha256: createHash('sha256').update(bytes).digest('hex')
            },
            resumeBytes: bytes,
            portfolio,
            consent: {
              version: 'direct-apply-v1',
              submittedAt: at,
              sharePortfolio: payload.sharePortfolio
            },
            history: [{ from: '', to: 'submitted', actorId: user._id, at }]
          }
        ],
        { session }
      );
      await notifyApplication(application, 'submitted', session);
      return { application: application.toObject(), created: true };
    });
  } catch (error) {
    if (error.code !== 11000) throw error;
    saved = { application: await Application.findById(id).lean(), created: false };
  }
  return { application: applicantView(saved.application), created: saved.created };
}
async function mine(applicantId) {
  return (await Application.find({ applicantId }).sort({ createdAt: -1 }).limit(100).lean()).map(
    applicantView
  );
}
async function ownedJob(scope, jobId) {
  const job = await Job.findOne({
    _id: requireObjectId(jobId, 'jobId'),
    recruiterId: scope.recruiterId,
    organizationId: scope.organizationId
  }).lean();
  if (!job) throw fail('Job not found.', 404);
  return job;
}
async function applicants(scope, jobId) {
  await ownedJob(scope, jobId);
  const applications = await Application.find({
    jobId,
    organizationId: scope.organizationId,
    recruiterId: scope.recruiterId
  })
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();
  return applications.map((application) => ({
    ...application,
    timeline: applicantView(application).timeline
  }));
}
function ownedApplication(scope, jobId, id) {
  if (!/^[a-f0-9]{64}$/.test(String(id))) throw fail('Invalid application identifier.');
  return {
    _id: id,
    jobId: requireObjectId(jobId, 'jobId'),
    organizationId: scope.organizationId,
    recruiterId: scope.recruiterId
  };
}
// Notification and application writes share one transaction. Permanent event receipts
// survive inbox deletion and transaction retries; SSE observes only committed revisions.
async function notifyApplication(application, status, session) {
  const recruiterEvent = status === 'submitted' || status === 'withdrawn';
  const userId = recruiterEvent ? application.recruiterId : application.applicantId;
  // Deleted/revoked recipients have no available inbox; lifecycle progress is retained.
  if (!(await User.exists({ _id: userId, isActive: { $ne: false } }).session(session))) return;
  await notifications.createNotification({
    userId,
    session,
    type: 'info',
    title:
      status === 'submitted'
        ? 'New job application'
        : status === 'withdrawn'
          ? 'Application withdrawn'
          : 'Application status updated',
    message:
      status === 'submitted'
        ? 'A developer submitted an application to your job.'
        : status === 'withdrawn'
          ? 'A developer withdrew an application to your job.'
          : `Your direct application is now ${status}.`,
    eventId:
      status === 'submitted'
        ? `application:${application._id}`
        : `application:${application._id}:${status}`,
    meta: { target: recruiterEvent ? '/app/recruiter/jobs' : '/app/jobs?view=internal' }
  });
}
function validateApplicationId(id) {
  if (!/^[a-f0-9]{64}$/.test(String(id))) throw fail('Invalid application identifier.');
  return id;
}
async function transition(filter, actorId, status, expectedStatus, scope) {
  const from = status === 'reviewing' ? ['submitted'] : ['submitted', 'reviewing'];
  return persistence.transaction(async (session) => {
    await persistence.fence(actorId, session);
    if (scope) {
      const locked = await Job.updateOne(
        { _id: filter.jobId, recruiterId: scope.recruiterId, organizationId: scope.organizationId },
        { $inc: { __v: 1 } },
        { session, timestamps: false }
      );
      if (!locked.matchedCount) throw fail('Job not found.', 404);
    }
    const current = await Application.findOne(filter).session(session).lean();
    if (!current) throw fail('Application not found.', 404);
    // Retried withdrawal is an idempotent acknowledgement, without another event.
    if (status === 'withdrawn' && current.status === 'withdrawn') return current;
    if (
      !from.includes(current.status) ||
      (expectedStatus !== undefined && current.status !== expectedStatus)
    )
      throw fail('Application changed. Refresh before trying again.', 409);
    const updated = await Application.findOneAndUpdate(
      { ...filter, status: current.status },
      {
        $set: { status },
        $push: { history: { from: current.status, to: status, actorId, at: new Date() } }
      },
      { session, returnDocument: 'after' }
    ).lean();
    if (!updated) throw fail('Application changed. Refresh before trying again.', 409);
    await notifyApplication(updated, status, session);
    return updated;
  });
}
async function changeStatus(scope, jobId, id, status, expectedStatus) {
  if (!['reviewing', 'rejected'].includes(status)) throw fail('Invalid application status.');
  if (expectedStatus !== undefined && !['submitted', 'reviewing'].includes(expectedStatus))
    throw fail('Invalid expected status.');
  const application = await transition(
    ownedApplication(scope, jobId, id),
    scope.recruiterId,
    status,
    expectedStatus,
    scope
  );
  return { ...application, timeline: applicantView(application).timeline };
}
async function withdraw(applicantId, id, expectedStatus) {
  validateApplicationId(id);
  if (!['submitted', 'reviewing'].includes(expectedStatus))
    throw fail('An active expected status is required.');
  return applicantView(
    await transition({ _id: id, applicantId }, applicantId, 'withdrawn', expectedStatus)
  );
}
async function submittedResume(scope, jobId, id) {
  await ownedJob(scope, jobId);
  const application = await Application.findOne(ownedApplication(scope, jobId, id))
    .select('+resumeBytes')
    .lean();
  if (!application) throw fail('Application not found.', 404);
  return application.resumeBytes;
}
module.exports = {
  discover,
  options,
  submit,
  mine,
  applicants,
  changeStatus,
  withdraw,
  submittedResume,
  portfolioSnapshot
};
