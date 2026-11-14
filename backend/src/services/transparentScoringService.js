const { numeric, clamp, safeAverage } = require('./scoring/math');
const portfolioScore = require('./scoring/portfolioScore');

const normalizeBreakdown = (breakdown = {}) => ({
  codeQuality: clamp(breakdown.codeQuality),
  skillCoverage: clamp(breakdown.skillCoverage),
  industryReadiness: clamp(breakdown.industryReadiness),
  projectImpact: clamp(breakdown.projectImpact)
});

// Preserve the existing confidence checks; confidence policy is not redesigned.
const getConfidenceScore = ({ githubAnalysis = {}, resumeAnalysis = {}, skillGapAnalysis = {} }) => {
  const checks = [
    Number(githubAnalysis?.repoCount || githubAnalysis?.repositories?.length || 0) > 0,
    Boolean(githubAnalysis?.scores),
    Number(resumeAnalysis?.atsScore || 0) > 0,
    Array.isArray(skillGapAnalysis?.yourSkills) && skillGapAnalysis.yourSkills.length > 0,
    Array.isArray(skillGapAnalysis?.missingSkills) && skillGapAnalysis.missingSkills.length > 0,
    Number(skillGapAnalysis?.coverage || 0) > 0
  ];
  return clamp(Math.round(40 + (checks.filter(Boolean).length / checks.length) * 60));
};

const calculateTransparentScore = (input = {}, options = {}) => {
  const scoring = portfolioScore.calculate(input, options);
  const breakdown = Object.fromEntries(Object.entries(scoring.breakdown).map(([key, item]) => [key, item.value ?? 0]));
  const weights = Object.fromEntries(Object.entries(scoring.breakdown).map(([key, item]) => [key, item.weight]));
  const confidenceScore = getConfidenceScore(input);
  // Keep numeric legacy API fields; explicit unavailable status lives in scoring.
  const score = scoring.score ?? 0;
  const reasons = Object.entries(scoring.breakdown).map(([key, item]) => item.available
    ? `${key} contributes ${Math.round(item.weight * 100)}% weight and is currently ${Math.round(item.value)}%.`
    : `${key} is unavailable and does not contribute a zero-quality signal.`);
  return {
    overallScore: score, weightedScore: score, confidenceScore, breakdown,
    explainabilityBreakdown: { weights, featureScores: breakdown, confidenceScore, aiInfluence: 0, deterministicScore: score },
    reasons, scoring
  };
};

// Compatibility reads never recalculate history or assign a new rule version/date.
const normalizeTransparentScorePayload = (result = {}) => {
  const breakdown = normalizeBreakdown(result.breakdown);
  const score = clamp(numeric(result.overallScore) ?? numeric(result.weightedScore) ?? safeAverage(Object.values(breakdown)));
  const weightedScore = clamp(numeric(result.weightedScore) ?? score);
  const confidenceScore = clamp(numeric(result.confidenceScore) ?? 60);
  const reasons = Array.isArray(result.reasons) && result.reasons.length ? result.reasons : [
    'Score includes weighted analysis of code quality, coverage, readiness, and impact.',
    'Confidence score reflects the amount of available GitHub and resume data.'
  ];
  return {
    ...result, overallScore: score, weightedScore, confidenceScore, breakdown,
    explainabilityBreakdown: {
      weights: result.explainabilityBreakdown?.weights || portfolioScore.getWeights('Full Stack'),
      featureScores: breakdown, confidenceScore,
      aiInfluence: clamp(numeric(result.explainabilityBreakdown?.aiInfluence) ?? score),
      deterministicScore: clamp(numeric(result.explainabilityBreakdown?.deterministicScore) ?? weightedScore)
    }, reasons
  };
};

module.exports = { calculateTransparentScore, normalizeTransparentScorePayload };
