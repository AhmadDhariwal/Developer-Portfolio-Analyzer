const RecruiterMatch = require('../../models/RecruiterMatch');
const RecruiterShortlist = require('../../models/RecruiterShortlist');
const Job = require('../../models/Job');
const { listCandidates } = require('../recruiter/matchingService');
const { generateMatches } = require('../../utils/recruiter-hub/matchCalculator');
const { getRecruiterCandidateDetails } = require('./candidateService');

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
  const candidateIds = [...new Set(matches.map((entry) => String(entry.candidateId || '')).filter(Boolean))];
  const jobIds = [...new Set(matches.map((entry) => String(entry.jobId || '')).filter(Boolean))];

  const [candidates, jobs] = await Promise.all([
    Promise.all(candidateIds.map((candidateId) => getRecruiterCandidateDetails(candidateId, organizationId))),
    jobIds.length > 0
      ? Job.find({ _id: { $in: jobIds }, recruiterId, organizationId })
          .select('title stack status description requiredSkills preferredSkills')
          .lean()
      : []
  ]);

  const candidateMap = new Map(
    candidates
      .filter(Boolean)
      .map((candidate) => [String(candidate.id || candidate.userId || ''), candidate])
  );
  const jobMap = new Map(jobs.map((entry) => [String(entry._id), mapJobSummary(entry)]));

  if (job?._id) {
    jobMap.set(String(job._id), mapJobSummary(job));
  }

  return matches.map((entry) => ({
    ...entry,
    candidate: candidateMap.get(String(entry.candidateId || '')) || null,
    job: jobMap.get(String(entry.jobId || '')) || null
  }));
};

const loadJob = async ({ recruiterId, organizationId, jobId }) => {
  return Job.findOne({ _id: jobId, recruiterId, organizationId }).lean();
};

const generateRecruiterMatches = async ({ recruiterId, organizationId, teamIds = [], payload = {} }) => {
  const jobId = String(payload.jobId || '').trim();
  const candidateIds = Array.isArray(payload.candidateIds) ? payload.candidateIds.map((item) => String(item || '').trim()).filter(Boolean) : [];
  const job = await loadJob({ recruiterId, organizationId, jobId });
  if (!job) {
    const error = new Error('Job not found.');
    error.statusCode = 404;
    throw error;
  }

  const candidates = await listCandidates({
    organizationId,
    stack: String(job.stack || '').trim(),
    limit: 300
  });

  const scopedCandidates = candidateIds.length > 0
    ? candidates.filter((candidate) => candidateIds.includes(String(candidate.userId || candidate.id || '')))
    : candidates;

  const result = generateMatches({ job, candidates: scopedCandidates });
  const teamId = teamIds[0] || null;

  if (result.records.length > 0) {
    await Promise.all(result.records.map((record) => RecruiterMatch.findOneAndUpdate(
      {
        recruiterId,
        organizationId,
        jobId: record.jobId,
        candidateId: record.candidateId
      },
      {
        $set: {
          ...record,
          recruiterId,
          organizationId,
          teamId
        }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    )));
  }

  const shortlistMap = new Map(
    (await RecruiterShortlist.find({
      recruiterId,
      organizationId,
      candidateId: { $in: result.records.map((record) => record.candidateId) }
    }).select('candidateId').lean()).map((entry) => [String(entry.candidateId), true])
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
  if (query.jobId) filter.jobId = String(query.jobId);
  if (query.candidateId) filter.candidateId = String(query.candidateId);
  if (query.status) filter.status = String(query.status);

  const matches = await RecruiterMatch.find(filter)
    .sort({ updatedAt: -1 })
    .lean();

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
  const match = await RecruiterMatch.findOne({ _id: matchId, recruiterId, organizationId }).lean();
  if (!match) return null;

  const [hydrated] = await hydrateMatches({
    recruiterId,
    organizationId,
    matches: [{
      ...match,
      candidateId: String(match.candidateId || ''),
      jobId: String(match.jobId || '')
    }]
  });

  return hydrated || null;
};

const updateMatchStatus = async ({ recruiterId, organizationId, matchId, status }) => {
  const normalizedStatus = String(status || 'generated').trim().toLowerCase();
  if (!MATCH_STATUSES.has(normalizedStatus)) {
    const error = new Error('Match status is invalid.');
    error.statusCode = 400;
    throw error;
  }

  const match = await RecruiterMatch.findOneAndUpdate(
    { _id: matchId, recruiterId, organizationId },
    { $set: { status: normalizedStatus } },
    { new: true, runValidators: true }
  ).lean();
  if (!match) return null;

  const [hydrated] = await hydrateMatches({
    recruiterId,
    organizationId,
    matches: [{
      ...match,
      candidateId: String(match.candidateId || ''),
      jobId: String(match.jobId || '')
    }]
  });

  return hydrated || null;
};

module.exports = {
  generateRecruiterMatches,
  listRecruiterMatches,
  getRecruiterMatchDetails,
  updateMatchStatus
};
