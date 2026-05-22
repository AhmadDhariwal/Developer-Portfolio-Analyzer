const { getRecruiterCandidateDetails, formatCandidateComparison } = require('./candidateService');
const { getRecruiterJobDetails } = require('./recruiterJobService');
const { generateMatches } = require('../../utils/recruiter-hub/matchCalculator');

const compareCandidates = async ({ recruiterId, organizationId, payload = {} }) => {
  const candidateIds = Array.isArray(payload.candidateIds)
    ? payload.candidateIds.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 3)
    : [];

  if (candidateIds.length < 2) {
    const error = new Error('Select at least 2 candidates to compare.');
    error.statusCode = 400;
    throw error;
  }

  const candidates = (await Promise.all(candidateIds.map((candidateId) => getRecruiterCandidateDetails(candidateId, organizationId))))
    .filter(Boolean);

  let matchSummaries = [];
  if (payload.jobId) {
    const job = await getRecruiterJobDetails({ recruiterId, organizationId, jobId: String(payload.jobId) });
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
