const { rankCandidates } = require('../../services/recruiter/aiRankingService');

const averageWeighted = (breakdown = {}, keys = []) => {
  if (!keys.length) return 0;
  const values = keys.map((key) => Number(breakdown?.[key]?.weighted || 0));
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
};

const normalizeMatchRecord = (rankedRow = {}, job = {}) => ({
  jobId: String(job?._id || ''),
  candidateId: String(rankedRow.candidateId || rankedRow.candidate?.userId || rankedRow.candidate?.id || ''),
  matchScore: Number(rankedRow.rankScore || 0),
  skillMatchPercent: averageWeighted(rankedRow.scoreBreakdown, ['skillCoverage', 'requiredSkillAlignment']),
  experienceMatch: Number(rankedRow.rawFeatures?.experienceAlignment || 0) >= 70 ? 'Strong' : 'Moderate',
  githubProjectScore: averageWeighted(rankedRow.scoreBreakdown, ['githubSignal', 'projectImpact']),
  readinessScore: Number(rankedRow.candidate?.score || 0),
  confidenceScore: Math.round((Number(rankedRow.rankScore || 0) + averageWeighted(rankedRow.scoreBreakdown, ['consistency', 'growthTrajectory'])) / 2),
  recommendation: String(rankedRow.aiInsight?.recommendation || ''),
  strengths: Array.isArray(rankedRow.aiInsight?.strengths) ? rankedRow.aiInsight.strengths : [],
  weaknesses: Array.isArray(rankedRow.aiInsight?.weaknesses) ? rankedRow.aiInsight.weaknesses : [],
  explanation: String(rankedRow.aiInsight?.summary || ''),
  breakdown: rankedRow.scoreBreakdown || {}
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
