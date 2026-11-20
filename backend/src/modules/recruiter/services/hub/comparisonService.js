const { getRecruiterCandidatesByIds, formatCandidateComparison } = require('./candidateService');
const { getRecruiterJobDetails } = require('./recruiterJobService');
const { generateMatches } = require('../../utils/hub/matchCalculator');
const { requireObjectId, validateCandidateIds } = require('../../utils/recruiterValidation');

const compareCandidates = async ({ recruiterId, organizationId, payload = {} }) => {
  const candidateIds = validateCandidateIds(payload.candidateIds ?? [], 3);
  const jobId = payload.jobId ? requireObjectId(payload.jobId, 'jobId') : null;

  if (candidateIds.length < 2) {
    const error = new Error('Select at least 2 candidates to compare.');
    error.statusCode = 400;
    throw error;
  }

  const available = await getRecruiterCandidatesByIds(candidateIds, organizationId);
  const candidates = [
    ...new Map(
      [...available.values()].filter(Boolean).map((candidate) => [candidate.id, candidate])
    ).values()
  ];

  let matchSummaries = [];
  if (jobId) {
    const job = await getRecruiterJobDetails({ recruiterId, organizationId, jobId });
    if (job) {
      const matchResult = generateMatches({ job, candidates });
      matchSummaries = matchResult.records;
    }
  }

  const matchMap = new Map(matchSummaries.map((summary) => [String(summary.candidateId), summary]));
  return candidates.map((candidate) => ({
    ...formatCandidateComparison(candidate),
    match: matchMap.get(String(candidate.id || candidate.userId || '')) || null
  }));
};

module.exports = {
  compareCandidates
};
