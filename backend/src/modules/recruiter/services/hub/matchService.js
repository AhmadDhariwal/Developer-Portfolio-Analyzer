const RecruiterMatch = require('../../models/RecruiterMatch');
const RecruiterShortlist = require('../../models/RecruiterShortlist');
const Job = require('../../models/Job');
const { lockOwnedJob } = require('../matching/jobLifecycleService');
const { requireObjectId, validateCandidateIds } = require('../../utils/recruiterValidation');
const { listCandidates, getCandidatesByIds } = require('../matching/matchingService');
const { generateMatches } = require('../../utils/hub/matchCalculator');
const { getRecruiterCandidatesByIds } = require('./candidateService');

const MATCH_STATUSES = new Set(['generated', 'shortlisted', 'rejected']);

const mapJobSummary = (job = {}) => ({
  _id: String(job?._id || ''),
  title: String(job?.title || ''),
  stack: String(job?.stack || ''),
  status: String(job?.status || ''),
  description: String(job?.description || ''),
  requiredSkills: Array.isArray(job?.requiredSkills) ? job.requiredSkills : [],
  preferredSkills: Array.isArray(job?.preferredSkills) ? job.preferredSkills : []
});

const hydrateMatches = async ({ recruiterId, organizationId, job, matches = [] }) => {
  const candidateIds = [
    ...new Set(matches.map((entry) => String(entry.candidateId || '')).filter(Boolean))
  ];
  const jobIds = [...new Set(matches.map((entry) => String(entry.jobId || '')).filter(Boolean))];

  const [candidates, jobs] = await Promise.all([
    getRecruiterCandidatesByIds(candidateIds, organizationId),
    jobIds.length > 0
      ? Job.find({ _id: { $in: jobIds }, recruiterId, organizationId })
          .select('title stack status description requiredSkills preferredSkills')
          .lean()
      : []
  ]);

  const jobMap = new Map(jobs.map((entry) => [String(entry._id), mapJobSummary(entry)]));

  if (job?._id) {
    jobMap.set(String(job._id), mapJobSummary(job));
  }

  return matches
    .filter((entry) => candidates.get(String(entry.candidateId)) && jobMap.has(String(entry.jobId)))
    .map((entry) => ({
      ...entry,
      candidate: candidates.get(String(entry.candidateId)),
      job: jobMap.get(String(entry.jobId || '')) || null
    }));
};

const loadJob = async ({ recruiterId, organizationId, jobId }) => {
  return Job.findOne({ _id: jobId, recruiterId, organizationId }).lean();
};

const generateRecruiterMatches = async ({ recruiterId, organizationId, payload = {} }) => {
  const jobId = requireObjectId(payload.jobId, 'jobId');
  const candidateIds = validateCandidateIds(payload.candidateIds ?? [], 300);
  const job = await loadJob({ recruiterId, organizationId, jobId });
  if (!job) {
    const error = new Error('Job not found.');
    error.statusCode = 404;
    throw error;
  }

  const candidates = candidateIds.length
    ? [...(await getCandidatesByIds(candidateIds, { organizationId })).values()].filter(Boolean)
    : await listCandidates({ organizationId, limit: 300 });
  const scopedCandidates = [
    ...new Map(candidates.map((candidate) => [candidate.userId, candidate])).values()
  ];

  const result = generateMatches({ job, candidates: scopedCandidates });
  const teamId = job.teamId || null;

  if (result.records.length > 0) {
    await Job.db.transaction(async (session) => {
      await lockOwnedJob({ jobId, recruiterId, organizationId, session });
      const existingShortlists = await RecruiterShortlist.find({
        recruiterId,
        organizationId,
        jobId,
        candidateId: { $in: result.records.map((record) => record.candidateId) }
      })
        .session(session)
        .select('candidateId status')
        .lean();
      const existingStatus = new Map(
        existingShortlists.map((row) => [
          String(row.candidateId),
          row.status === 'rejected' ? 'rejected' : 'shortlisted'
        ])
      );
      await RecruiterMatch.bulkWrite(
        result.records.map((record) => ({
          updateOne: {
            filter: { recruiterId, organizationId, jobId, candidateId: record.candidateId },
            update: {
              $set: { ...record, teamId },
              $setOnInsert: { status: existingStatus.get(record.candidateId) || 'generated' }
            },
            upsert: true
          }
        })),
        { session }
      );
    });
  }

  const shortlistMap = new Map(
    (
      await RecruiterShortlist.find({
        recruiterId,
        organizationId,
        jobId,
        candidateId: { $in: result.records.map((record) => record.candidateId) }
      })
        .select('candidateId')
        .lean()
    ).map((entry) => [String(entry.candidateId), true])
  );

  const hydratedMatches = await hydrateMatches({
    recruiterId,
    organizationId,
    job,
    matches: result.records.map((record, index) => ({
      ...record,
      rank: index + 1,
      shortlisted: shortlistMap.has(record.candidateId)
    }))
  });

  return {
    job: mapJobSummary(job),
    matches: hydratedMatches,
    meta: result.meta
  };
};

const listRecruiterMatches = async ({ recruiterId, organizationId, query = {} }) => {
  const filter = {
    recruiterId,
    organizationId
  };
  if (query.jobId) filter.jobId = requireObjectId(query.jobId, 'jobId');
  if (query.candidateId) filter.candidateId = requireObjectId(query.candidateId, 'candidateId');
  if (query.status) filter.status = String(query.status);

  const matches = await RecruiterMatch.find(filter).sort({ updatedAt: -1 }).lean();

  return hydrateMatches({
    recruiterId,
    organizationId,
    matches: matches.map((entry) => ({
      ...entry,
      candidateId: String(entry.candidateId || ''),
      jobId: String(entry.jobId || '')
    }))
  });
};

const getRecruiterMatchDetails = async ({ recruiterId, organizationId, matchId }) => {
  const match = await RecruiterMatch.findOne({
    _id: requireObjectId(matchId, 'matchId'),
    recruiterId,
    organizationId
  }).lean();
  if (!match) return null;

  const [hydrated] = await hydrateMatches({
    recruiterId,
    organizationId,
    matches: [
      {
        ...match,
        candidateId: String(match.candidateId || ''),
        jobId: String(match.jobId || '')
      }
    ]
  });

  return hydrated || null;
};

const updateMatchStatus = async ({ recruiterId, organizationId, matchId, status }) => {
  const normalizedStatus = String(status || 'generated')
    .trim()
    .toLowerCase();
  if (!MATCH_STATUSES.has(normalizedStatus)) {
    const error = new Error('Match status is invalid.');
    error.statusCode = 400;
    throw error;
  }

  const match = await RecruiterMatch.findOneAndUpdate(
    { _id: requireObjectId(matchId, 'matchId'), recruiterId, organizationId },
    { $set: { status: normalizedStatus } },
    { new: true, runValidators: true }
  ).lean();
  if (!match) return null;

  const [hydrated] = await hydrateMatches({
    recruiterId,
    organizationId,
    matches: [
      {
        ...match,
        candidateId: String(match.candidateId || ''),
        jobId: String(match.jobId || '')
      }
    ]
  });

  return hydrated || null;
};

module.exports = {
  generateRecruiterMatches,
  listRecruiterMatches,
  getRecruiterMatchDetails,
  updateMatchStatus
};
