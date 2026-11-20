const { rankCandidates } = require('../../services/matching/aiRankingService');

const averageAvailable = (values) => {
  const available = values.filter(Number.isFinite);
  if (!available.length) return null;
  return Math.round(available.reduce((sum, value) => sum + value, 0) / available.length);
};

const normalizeMatchRecord = (rankedRow = {}, job = {}) => ({
  jobId: String(job?._id || ''),
  candidateId: String(rankedRow.candidate?.userId || rankedRow.candidateId || ''),
  matchScore: Number(rankedRow.rankScore || 0),
  skillMatchPercent: rankedRow.rawFeatures?.skillMatch ?? null,
  experienceMatch:
    rankedRow.rawFeatures?.experience == null
      ? 'Unavailable'
      : rankedRow.rawFeatures.experience >= 70
        ? 'Strong'
        : 'Moderate',
  githubProjectScore: averageAvailable([
    rankedRow.rawFeatures?.github,
    rankedRow.rawFeatures?.projectQuality
  ]),
  readinessScore: Number(rankedRow.candidate?.score || 0),
  confidenceScore: averageAvailable([
    rankedRow.rankScore,
    averageAvailable([rankedRow.rawFeatures?.consistency, rankedRow.rawFeatures?.growth])
  ]),
  recommendation: String(rankedRow.aiInsight?.recommendation || ''),
  strengths: Array.isArray(rankedRow.aiInsight?.strengths) ? rankedRow.aiInsight.strengths : [],
  weaknesses: Array.isArray(rankedRow.aiInsight?.weaknesses) ? rankedRow.aiInsight.weaknesses : [],
  explanation: String(rankedRow.aiInsight?.summary || ''),
  breakdown: {
    ...rankedRow.scoreBreakdown,
    matchedSkills: rankedRow.rawFeatures?.matchedSkills || []
  }
});

const generateMatches = ({ job, candidates = [] }) => {
  const result = rankCandidates({ job, candidates });
  return {
    ...result,
    records: (result.rankedCandidates || []).map((row) => normalizeMatchRecord(row, job))
  };
};

module.exports = {
  generateMatches,
  normalizeMatchRecord
};
