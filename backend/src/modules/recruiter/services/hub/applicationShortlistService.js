const Shortlist = require('../../models/RecruiterShortlist');
const Job = require('../../models/Job');
const Candidate = require('../../models/Candidate');
const Application = require('../../../jobs/models/jobApplication');
const User = require('../../../auth/models/user');
const Settings = require('../../../super-admin/models/platformSettings');
const access = require('../../utils/hub/recruiterEvaluationAccess');
const { pagination, buildPipeline } = require('../../utils/hub/applicationShortlistQuery');
const { permittedRecruiterStatuses } = require('../../../jobs/services/jobApplicationService');
const {
  verifyApplicationIdentities,
  remainingBudget,
  genuine,
  canonicalRow
} = require('../../utils/hub/applicationIdentityValidation');
const { requireObjectId, invalidInput } = require('../../utils/recruiterValidation');
const workflowBudget = require('../../utils/hub/applicationWorkflowBudget');

const ACTIVE = new Set(['submitted', 'reviewing']);
const STAGES = new Set(Shortlist.schema.path('status').enumValues);
const id = (value) => String(value || '');
const unavailable = () => access.denied('Application evaluation not found.', 404);

function applicationId(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value))
    throw invalidInput('Invalid application identifier.');
  return value;
}
async function withPrivateAccess(scope, work, mutation = false) {
  const deadline = scope.deadline ?? workflowBudget.deadline();
  await Promise.all([Shortlist, Application, Settings, Candidate].map((model) => model.init()));
  try {
    return await access.withAccess(
      scope,
      async (ctx) => {
        const settings = await access.readWithFence(Settings, { scope: 'global' }, ctx.session, {
          'recruiter.enableRecruiterAccess': 1
        });
        if (!settings) throw access.denied('Platform settings unavailable.', 503);
        if (settings.recruiter?.enableRecruiterAccess === false)
          throw access.denied('Recruiter access is disabled.');
        return work(ctx);
      },
      { deadline }
    );
  } catch (error) {
    throw workflowBudget.failure(error, mutation);
  }
}
async function ownerApplication(ctx, jobId, value) {
  const job = await Job.findOne({
    _id: requireObjectId(jobId, 'jobId'),
    organizationId: ctx.organizationId,
    recruiterId: ctx.recruiterId
  })
    .session(ctx.session)
    .lean();
  if (!job) throw unavailable();
  const application = await Application.findOne({
    _id: applicationId(value),
    jobId: job._id,
    organizationId: ctx.organizationId,
    recruiterId: ctx.recruiterId
  })
    .session(ctx.session)
    .lean();
  if (!genuine(application, job)) throw unavailable();
  await access.fence(
    Job,
    job,
    { recruiterId: job.recruiterId, organizationId: job.organizationId },
    ctx.session
  );
  // A write fence conflicts with withdrawal/status writes; it changes neither
  // lifecycle history, timestamps, consent nor submitted evidence, and notifies nobody.
  const locked = await Application.updateOne(
    {
      _id: application._id,
      status: application.status,
      recruiterId: ctx.recruiterId,
      jobId: job._id,
      organizationId: ctx.organizationId
    },
    { $inc: { __v: 1 } },
    { session: ctx.session, timestamps: false }
  );
  if (!locked.matchedCount)
    throw access.denied('Application changed. Refresh before retrying.', 409);
  return { application, job };
}
function view(row, application, job) {
  return {
    _id: row._id,
    origin: 'application',
    applicationId: application._id,
    recruiterId: row.recruiterId,
    organizationId: row.organizationId,
    candidateId: id(application.applicantId),
    jobId: id(job._id),
    teamId: null,
    notes: row.notes,
    status: row.status,
    version: Number(row.__v || 0),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    candidate: { name: application.applicantName },
    job: { _id: job._id, title: job.title },
    application: {
      _id: application._id,
      status: application.status,
      jobTitle: application.jobTitle,
      permittedStatuses: permittedRecruiterStatuses(application.status),
      submittedAt: application.createdAt
    },
    access: {
      view: true,
      manage: true,
      isOwner: true,
      manageStages: ACTIVE.has(application.status),
      manageApplicationStatus: true
    }
  };
}
async function linkApplication({ jobId, applicationId: value, payload = {}, ...scope }) {
  if (
    !payload ||
    Object.keys(payload).some((key) => key !== 'expectedStatus') ||
    !ACTIVE.has(payload.expectedStatus)
  )
    throw invalidInput('An active expectedStatus is required.');
  return withPrivateAccess(
    scope,
    async (ctx) => {
      const { application, job } = await ownerApplication(ctx, jobId, value);
      if (!ACTIVE.has(application.status) || application.status !== payload.expectedStatus)
        throw access.denied(
          'Application changed or is terminal. Refresh before trying again.',
          409
        );
      const applicant = await User.findOne({
        _id: application.applicantId,
        role: { $in: ['developer', 'user', 'guest'] },
        isActive: { $ne: false }
      })
        .session(ctx.session)
        .select('_id')
        .lean();
      if (!applicant)
        throw access.denied('Applicant account is unavailable for new evaluation.', 409);
      await access.fence(
        User,
        applicant,
        { isActive: { $ne: false }, role: { $in: ['developer', 'user', 'guest'] } },
        ctx.session
      );
      const aliases = await Candidate.find({ userId: application.applicantId })
        .select('_id')
        .session(ctx.session)
        .setOptions(workflowBudget.cursorOptions(ctx.session))
        .lean();
      const existing = await Shortlist.find({
        recruiterId: ctx.recruiterId,
        jobId: job._id,
        candidateId: { $in: [application.applicantId, ...aliases.map((alias) => alias._id)] }
      })
        .session(ctx.session)
        .setOptions(workflowBudget.cursorOptions(ctx.session))
        .lean();
      if (existing.length) {
        if (existing.length === 1 && canonicalRow(existing[0], application, job))
          return { shortlist: view(existing[0], application, job), created: false };
        throw access.denied(
          'An existing evaluation conflicts with this link. Its notes and stage were preserved.',
          409
        );
      }
      const [row] = await Shortlist.create(
        [
          {
            recruiterId: ctx.recruiterId,
            organizationId: ctx.organizationId,
            teamId: null,
            candidateId: application.applicantId,
            jobId: job._id,
            applicationId: application._id,
            notes: '',
            status: 'shortlisted'
          }
        ],
        { session: ctx.session }
      );
      return { shortlist: view(row.toObject(), application, job), created: true };
    },
    true
  );
}

async function listApplicationShortlists({ query, ...scope }) {
  const { page, limit } = pagination(query);
  return withPrivateAccess(scope, async (ctx) => {
    const identities = await verifyApplicationIdentities(ctx);
    const [result] = await Shortlist.aggregate(buildPipeline(ctx, { page, limit }, identities.ids))
      .session(ctx.session)
      .option({ maxTimeMS: remainingBudget(identities.deadline) });
    const valid = result.rows;
    const total = result.count[0]?.total || 0;
    remainingBudget(identities.deadline);
    const jobs = await Job.find({
      _id: { $in: valid.map((row) => row.jobId) },
      recruiterId: ctx.recruiterId,
      organizationId: ctx.organizationId
    })
      .select('_id title')
      .session(ctx.session)
      .setOptions(workflowBudget.cursorOptions(ctx.session))
      .maxTimeMS(remainingBudget(identities.deadline))
      .lean();
    const applications = await Application.find({
      _id: { $in: valid.map((row) => row.applicationId) },
      recruiterId: ctx.recruiterId,
      organizationId: ctx.organizationId
    })
      .select('_id applicantId applicantName status jobTitle createdAt')
      .session(ctx.session)
      .setOptions(workflowBudget.cursorOptions(ctx.session))
      .maxTimeMS(remainingBudget(identities.deadline))
      .lean();
    const jobMap = new Map(jobs.map((job) => [id(job._id), job]));
    const appMap = new Map(applications.map((application) => [application._id, application]));
    if (
      jobs.length !== new Set(valid.map((row) => id(row.jobId))).size ||
      applications.length !== valid.length
    )
      throw access.denied('Application access changed. Refresh before retrying.', 409);
    if (valid.length) {
      const lockedJobs = await Job.collection.updateMany(
        {
          _id: { $in: valid.map((row) => row.jobId) },
          organizationId: ctx.actor.organizationId,
          recruiterId: ctx.actor._id
        },
        { $inc: { recruiterJobAccessRevision: 1 } },
        { session: ctx.session }
      );
      const lockedApplications = await Application.updateMany(
        {
          _id: { $in: valid.map((row) => row.applicationId) },
          organizationId: ctx.organizationId,
          recruiterId: ctx.recruiterId
        },
        { $inc: { __v: 1 } },
        { session: ctx.session, timestamps: false }
      );
      if (
        lockedJobs.matchedCount !== new Set(valid.map((row) => id(row.jobId))).size ||
        lockedApplications.matchedCount !== new Set(valid.map((row) => row.applicationId)).size
      )
        throw access.denied('Application access changed. Refresh before retrying.', 409);
    }
    return {
      shortlists: valid.map((row) =>
        view(row, appMap.get(row.applicationId), jobMap.get(id(row.jobId)))
      ),
      meta: {
        scope: 'owner-only-applications',
        limit,
        page,
        total,
        pages: Math.ceil(total / limit)
      }
    };
  });
}

async function updateApplicationShortlist({ shortlistId, payload = {}, ...scope }) {
  if (
    !payload ||
    Object.keys(payload).some((key) => !['notes', 'status', 'expectedVersion'].includes(key)) ||
    !Number.isSafeInteger(payload.expectedVersion) ||
    payload.expectedVersion < 0 ||
    (payload.notes === undefined && payload.status === undefined)
  )
    throw invalidInput('Notes or stage and an expectedVersion are required.');
  if (
    payload.notes !== undefined &&
    (typeof payload.notes !== 'string' || payload.notes.length > 5000)
  )
    throw invalidInput('Notes must be at most 5000 characters.');
  if (payload.status !== undefined && !STAGES.has(payload.status))
    throw invalidInput('Shortlist stage is invalid.');
  return withPrivateAccess(
    scope,
    async (ctx) => {
      const row = await Shortlist.findOne({
        _id: requireObjectId(shortlistId, 'shortlistId'),
        recruiterId: ctx.recruiterId,
        organizationId: ctx.organizationId,
        applicationId: { $ne: null }
      })
        .session(ctx.session)
        .setOptions(workflowBudget.cursorOptions(ctx.session))
        .lean();
      if (!row) throw unavailable();
      const { application, job } = await ownerApplication(ctx, row.jobId, row.applicationId);
      if (!canonicalRow(row, application, job)) throw unavailable();
      access.version(row, payload.expectedVersion);
      if (
        payload.status !== undefined &&
        payload.status !== row.status &&
        !ACTIVE.has(application.status)
      )
        throw access.denied(
          'Application is terminal. Its internal stage is retained; notes may still be updated.',
          409
        );
      const patch = {};
      if (payload.notes !== undefined) patch.notes = payload.notes.trim();
      if (payload.status !== undefined) patch.status = payload.status;
      const updated = await Shortlist.findOneAndUpdate(
        {
          _id: row._id,
          recruiterId: ctx.recruiterId,
          organizationId: ctx.organizationId,
          applicationId: application._id,
          __v: payload.expectedVersion
        },
        { $set: patch, $inc: { __v: 1 } },
        { session: ctx.session, returnDocument: 'after', runValidators: true }
      ).lean();
      if (!updated) throw access.denied('Evaluation changed. Refresh before retrying.', 409);
      return view(updated, application, job);
    },
    true
  );
}

async function applicationDetails({ jobId, applicationId: value, ...scope }) {
  return withPrivateAccess(scope, async (ctx) => {
    const { application, job } = await ownerApplication(ctx, jobId, value);
    const row = await Shortlist.findOne({
      recruiterId: ctx.recruiterId,
      organizationId: ctx.organizationId,
      jobId: job._id,
      candidateId: application.applicantId,
      applicationId: application._id
    })
      .session(ctx.session)
      .lean();
    return {
      _id: application._id,
      jobId: application.jobId,
      jobTitle: application.jobTitle,
      organizationName: application.organizationName,
      applicantName: application.applicantName,
      status: application.status,
      resume: application.resume,
      portfolio: application.consent.sharePortfolio ? application.portfolio : null,
      consent: application.consent,
      createdAt: application.createdAt,
      updatedAt: application.updatedAt,
      timeline: (application.history || []).map((event) => ({ status: event.to, at: event.at })),
      shortlist: row ? { id: id(row._id), status: row.status, version: Number(row.__v || 0) } : null
    };
  });
}

module.exports = {
  linkApplication,
  listApplicationShortlists,
  updateApplicationShortlist,
  applicationDetails
};
