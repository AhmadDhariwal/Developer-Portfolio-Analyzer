const RecruiterMatch = require('../../models/RecruiterMatch');
const RecruiterShortlist = require('../../models/RecruiterShortlist');
const {
  requireObjectId,
  validateCandidateIds,
  invalidInput
} = require('../../utils/recruiterValidation');
const { listCandidates } = require('../matching/matchingService');
const { generateMatches } = require('../../utils/hub/matchCalculator');
const access = require('../../utils/hub/recruiterEvaluationAccess');

const MATCH_STATUSES = new Set(['generated', 'shortlisted', 'rejected']);

async function hydrate(ctx, rows, jobs) {
  rows = rows.filter((row) => {
    const job = jobs.get(String(row.jobId));
    return job && access.ownsRecord(row, job, ctx);
  });
  const visible = await access.candidates(
    ctx,
    rows.map((row) => row.candidateId)
  );
  return rows
    .filter((row) => {
      const job = jobs.get(String(row.jobId));
      return job && access.ownsRecord(row, job, ctx) && visible.get(String(row.candidateId));
    })
    .map((row) =>
      access.rowView(row, jobs.get(String(row.jobId)), visible.get(String(row.candidateId)), ctx)
    );
}

const generateRecruiterMatches = async ({ payload = {}, ...scope }) => {
  const jobId = requireObjectId(payload.jobId, 'jobId');
  const requestedIds = validateCandidateIds(payload.candidateIds ?? [], 300);
  await Promise.all([RecruiterMatch.init(), RecruiterShortlist.init()]);
  return access.withAccess(scope, async (ctx) => {
    const jobs = await access.jobs(ctx, jobId);
    const job = jobs.get(jobId);
    access.authorize(job, ctx, true);
    const ids = requestedIds.length
      ? requestedIds
      : (
          await listCandidates({
            organizationId: ctx.organizationId,
            limit: 300,
            session: ctx.session
          })
        ).map((row) => row.userId);
    const visible = await access.candidates(ctx, ids, true);
    const candidates = [
      ...new Map([...visible.values()].map((candidate) => [candidate.userId, candidate])).values()
    ];
    const result = generateMatches({ job, candidates });
    const recruiterId = job.recruiterId;
    const organizationId = ctx.organizationId;
    const shortlisted = await RecruiterShortlist.find({
      recruiterId,
      organizationId,
      jobId,
      applicationId: null
    })
      .session(ctx.session)
      .lean();
    const statusByCandidate = new Map(
      shortlisted.map((row) => [
        String(row.candidateId),
        row.status === 'rejected' ? 'rejected' : 'shortlisted'
      ])
    );
    if (result.records.length)
      await RecruiterMatch.bulkWrite(
        result.records.map((record) => ({
          updateOne: {
            filter: { recruiterId, organizationId, jobId, candidateId: record.candidateId },
            update: {
              $set: { ...record, teamId: job.teamId || null },
              $setOnInsert: { status: statusByCandidate.get(record.candidateId) || 'generated' }
            },
            upsert: true
          }
        })),
        { session: ctx.session }
      );
    const rows = await RecruiterMatch.find({
      recruiterId,
      organizationId,
      jobId,
      candidateId: { $in: result.records.map((record) => record.candidateId) }
    })
      .session(ctx.session)
      .lean();
    const hydrated = await hydrate(ctx, rows, jobs);
    const byCandidate = new Map(hydrated.map((row) => [String(row.candidateId), row]));
    return {
      job,
      matches: result.records
        .map((record, index) => ({
          ...byCandidate.get(record.candidateId),
          rank: index + 1,
          shortlisted: statusByCandidate.has(record.candidateId)
        }))
        .filter((row) => row._id),
      meta: result.meta
    };
  });
};

const listRecruiterMatches = async ({ query = {}, ...scope }) =>
  access.withAccess(scope, async (ctx) => {
    const jobs = await access.jobs(ctx, query.jobId);
    const filter = { organizationId: ctx.organizationId, jobId: { $in: [...jobs.keys()] } };
    if (query.candidateId) filter.candidateId = requireObjectId(query.candidateId, 'candidateId');
    if (query.status) {
      if (!MATCH_STATUSES.has(String(query.status))) throw invalidInput('Match status is invalid.');
      filter.status = String(query.status);
    }
    const rows = await RecruiterMatch.find(filter)
      .sort({ updatedAt: -1 })
      .session(ctx.session)
      .lean();
    return hydrate(ctx, rows, jobs);
  });

async function selected(ctx, matchId, manage) {
  const row = await RecruiterMatch.findOne({
    _id: requireObjectId(matchId, 'matchId'),
    organizationId: ctx.organizationId
  })
    .session(ctx.session)
    .lean();
  if (!row) return null;
  const jobs = await access.jobs(ctx, row.jobId);
  const job = jobs.get(String(row.jobId));
  if (!access.ownsRecord(row, job, ctx)) return null;
  access.authorize(job, ctx, manage);
  const [visible] = await hydrate(ctx, [row], jobs);
  return visible ? { row, jobs } : null;
}

const getRecruiterMatchDetails = async ({ matchId, ...scope }) =>
  access.withAccess(scope, async (ctx) => {
    const result = await selected(ctx, matchId, false);
    return result ? (await hydrate(ctx, [result.row], result.jobs))[0] : null;
  });

const updateMatchStatus = async ({ matchId, status, expectedVersion, ...scope }) => {
  const normalizedStatus = String(status || 'generated')
    .trim()
    .toLowerCase();
  if (!MATCH_STATUSES.has(normalizedStatus)) throw invalidInput('Match status is invalid.');
  return access.withAccess(scope, async (ctx) => {
    const result = await selected(ctx, matchId, true);
    if (!result) return null;
    access.version(result.row, expectedVersion);
    if (result.row.status === normalizedStatus)
      return (await hydrate(ctx, [result.row], result.jobs))[0];
    const updated = await RecruiterMatch.findOneAndUpdate(
      {
        _id: result.row._id,
        recruiterId: result.row.recruiterId,
        organizationId: ctx.organizationId
      },
      {
        $set: {
          status: normalizedStatus,
          teamId: result.jobs.get(String(result.row.jobId)).teamId || null
        },
        $inc: { __v: 1 }
      },
      { session: ctx.session, new: true, runValidators: true }
    ).lean();
    return (await hydrate(ctx, [updated], result.jobs))[0];
  });
};

module.exports = {
  generateRecruiterMatches,
  listRecruiterMatches,
  getRecruiterMatchDetails,
  updateMatchStatus
};
