const RecruiterMatch = require('../../models/RecruiterMatch');
const RecruiterShortlist = require('../../models/RecruiterShortlist');
const Job = require('../../models/Job');
const { listCandidates } = require('../recruiter/matchingService');
const { generateMatches } = require('../../utils/recruiter-hub/matchCalculator');

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

  return {
    job,
    matches: result.records.map((record, index) => ({
      ...record,
      rank: index + 1,
      shortlisted: shortlistMap.has(record.candidateId)
    })),
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

  return RecruiterMatch.find(filter)
    .sort({ updatedAt: -1 })
    .populate('candidateId', 'name email githubUsername jobTitle location')
    .populate('jobId', 'title stack status')
    .lean();
};

const getRecruiterMatchDetails = async ({ recruiterId, organizationId, matchId }) => {
  return RecruiterMatch.findOne({ _id: matchId, recruiterId, organizationId })
    .populate('candidateId', 'name email githubUsername jobTitle location')
    .populate('jobId', 'title stack status description requiredSkills preferredSkills')
    .lean();
};

const updateMatchStatus = async ({ recruiterId, organizationId, matchId, status }) => {
  return RecruiterMatch.findOneAndUpdate(
    { _id: matchId, recruiterId, organizationId },
    { $set: { status } },
    { new: true }
  ).lean();
};

module.exports = {
  generateRecruiterMatches,
  listRecruiterMatches,
  getRecruiterMatchDetails,
  updateMatchStatus
};
