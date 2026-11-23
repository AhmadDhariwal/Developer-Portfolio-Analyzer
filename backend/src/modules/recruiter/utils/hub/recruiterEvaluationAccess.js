const Job = require('../../models/Job');
const User = require('../../../auth/models/user');
const Candidate = require('../../models/Candidate');
const PublicProfile = require('../../../public-portfolio/models/publicProfile');
const Settings = require('../../../super-admin/models/platformSettings');
const policy = require('./recruiterJobAccess');
const { requireObjectId, invalidInput } = require('../recruiterValidation');
const { getCandidatesByIds } = require('../../services/matching/matchingService');
const { toCandidateDetails } = require('../../services/hub/candidateService');

async function jobs(ctx, jobId) {
  const filter = {
    organizationId: ctx.organizationId,
    $or: [
      { recruiterId: ctx.recruiterId },
      { teamShared: true, evaluationShared: true, teamId: { $in: [...ctx.grants.keys()] } }
    ]
  };
  if (jobId) filter._id = requireObjectId(jobId, 'jobId');
  const records = await Job.find(filter).session(ctx.session).lean();
  const result = new Map();
  for (const record of records) {
    const view = await policy.jobView(record, ctx);
    result.set(String(record._id), view);
  }
  if (jobId && !result.size) throw policy.denied('Job not found.', 404);
  return result;
}

function authorize(job, ctx, manage = false) {
  const access = policy.permissions(job, ctx);
  if (!access.evaluationView) throw policy.denied('Evaluation not found.', 404);
  if (manage && !access.evaluationManage) throw policy.denied('Evaluation is read-only.');
  return { view: true, manage: access.evaluationManage, isOwner: access.isOwner };
}

function ownsRecord(row, job, ctx) {
  return (
    !row.applicationId &&
    String(row.organizationId) === ctx.organizationId &&
    (job
      ? String(row.recruiterId) === String(job.recruiterId)
      : !row.jobId && String(row.recruiterId) === ctx.recruiterId)
  );
}

// Fence eligibility documents in the same transaction as disclosure/mutation.
// User.isPublic is existing recruiter discovery consent, never application consent.
async function fenceRecords(model, records, filter, ctx) {
  if (!records.length) return;
  const result = await model.collection.updateMany(
    { _id: { $in: records.map((record) => record._id) }, ...filter },
    { $inc: { recruiterJobAccessRevision: 1 } },
    { session: ctx.session }
  );
  if (result.matchedCount !== records.length)
    throw policy.denied('Candidate access changed. Refresh before retrying.');
}

async function candidates(ctx, ids, raw = false) {
  // Request/transaction-local only: these records stay locked until commit. A
  // transaction retry receives a fresh ctx and rechecks every consent document.
  const memo = (ctx.evaluationCandidates ||= new Map());
  const missing = [...new Set(ids.map(String))].filter((id) => !memo.has(id));
  if (missing.length) {
    const settings = await Settings.findOne({ scope: 'global' }).session(ctx.session).lean();
    if (!settings) throw policy.denied('Platform settings unavailable.', 503);
    await policy.fence(Settings, settings, {}, ctx.session);
    const mode = String(settings.recruiter?.candidateVisibility || 'public').toLowerCase();
    missing.forEach((id) => memo.set(id, null));
    if (!['private', 'disabled', 'none', 'off'].includes(mode)) {
      const found = await getCandidatesByIds(missing, {
        organizationId: ctx.organizationId,
        session: ctx.session
      });
      const filter = {
        role: { $in: ['developer', 'user'] },
        isPublic: true,
        isActive: { $ne: false },
        ...(mode === 'organization' ? { organizationId: ctx.actor.organizationId } : {})
      };
      const users = await User.find({
        ...filter,
        _id: { $in: [...found.values()].filter(Boolean).map((value) => value.userId) }
      })
        .session(ctx.session)
        .lean();
      const profiles = await PublicProfile.find({ userId: { $in: users.map((user) => user._id) } })
        .session(ctx.session)
        .lean();
      const revoked = new Set(
        profiles
          .filter(
            (profile) =>
              profile.isPublic !== true || profile.sections?.visibility?.projects === false
          )
          .map((profile) => String(profile.userId))
      );
      const eligible = users.filter((user) => !revoked.has(String(user._id)));
      const eligibleIds = new Set(eligible.map((user) => String(user._id)));
      const aliases = await Candidate.find({ userId: { $in: [...eligibleIds] }, isActive: true })
        .session(ctx.session)
        .lean();
      await fenceRecords(User, eligible, filter, ctx);
      await fenceRecords(
        PublicProfile,
        profiles.filter((profile) => eligibleIds.has(String(profile.userId))),
        { isPublic: true },
        ctx
      );
      await fenceRecords(Candidate, aliases, { isActive: true }, ctx);
      for (const [id, value] of found)
        if (value && eligibleIds.has(String(value.userId))) memo.set(String(id), value);
    }
  }
  return new Map(
    ids
      .map(String)
      .filter((id) => memo.get(id))
      .map((id) => [id, raw ? memo.get(id) : toCandidateDetails(memo.get(id))])
  );
}

function version(row, expectedVersion) {
  if (expectedVersion === undefined) return;
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0)
    throw invalidInput('expectedVersion must be a non-negative integer.');
  if (expectedVersion !== Number(row.__v || 0))
    throw policy.denied('Evaluation changed. Refresh before retrying.', 409);
}

function rowView(row, job, candidate, ctx) {
  const metadata = { ...row };
  delete metadata.recruiterJobAccessRevision;
  return {
    ...metadata,
    candidateId: String(row.candidateId),
    jobId: row.jobId ? String(row.jobId) : null,
    candidate,
    teamId: job ? job.teamId || null : row.teamId,
    job: job || null,
    version: Number(row.__v || 0),
    access: job ? authorize(job, ctx) : { view: true, manage: true, isOwner: true }
  };
}

module.exports = { ...policy, jobs, authorize, ownsRecord, candidates, version, rowView };
