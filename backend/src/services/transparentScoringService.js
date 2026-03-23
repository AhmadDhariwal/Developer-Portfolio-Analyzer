const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, Number(value || 0)));

const average = (values = []) => {
  if (!Array.isArray(values) || !values.length) return 0;
  return values.reduce((sum, value) => sum + Number(value || 0), 0) / values.length;
};

const normalizeBreakdown = (breakdown = {}, fallback = {}) => ({
  codeQuality: clamp(breakdown.codeQuality ?? fallback.codeQuality ?? 0),
  skillCoverage: clamp(breakdown.skillCoverage ?? fallback.skillCoverage ?? 0),
  industryReadiness: clamp(breakdown.industryReadiness ?? fallback.industryReadiness ?? 0),
  projectImpact: clamp(breakdown.projectImpact ?? fallback.projectImpact ?? 0)
});

const getWeights = (careerStack = 'Full Stack') => {
  const base = {
    codeQuality: 0.32,
    skillCoverage: 0.28,
    industryReadiness: 0.22,
    projectImpact: 0.18
  };

  if (careerStack === 'Frontend') {
    return { ...base, codeQuality: 0.3, skillCoverage: 0.34, industryReadiness: 0.2, projectImpact: 0.16 };
  }
  if (careerStack === 'Backend') {
    return { ...base, codeQuality: 0.36, skillCoverage: 0.24, industryReadiness: 0.22, projectImpact: 0.18 };
  }
  if (careerStack === 'AI/ML') {
    return { ...base, codeQuality: 0.28, skillCoverage: 0.24, industryReadiness: 0.28, projectImpact: 0.2 };
  }
  return base;
};

const getConfidenceScore = ({ githubAnalysis = {}, resumeAnalysis = {}, skillGapAnalysis = {} }) => {
  const checks = [
    Number(githubAnalysis?.repoCount || githubAnalysis?.repositories?.length || 0) > 0,
    Boolean(githubAnalysis?.scores),
    Number(resumeAnalysis?.atsScore || 0) > 0,
    Array.isArray(skillGapAnalysis?.yourSkills) && skillGapAnalysis.yourSkills.length > 0,
    Array.isArray(skillGapAnalysis?.missingSkills) && skillGapAnalysis.missingSkills.length > 0,
    Number(skillGapAnalysis?.coverage || 0) > 0
  ];

  const completeRatio = checks.filter(Boolean).length / checks.length;
  return clamp(Math.round(40 + completeRatio * 60));
};

const calculateTransparentScore = ({
  githubAnalysis = {},
  resumeAnalysis = {},
  skillGapAnalysis = {},
  integrationInsight = {},
  aiBreakdown = {},
  aiOverallScore = 0,
  careerStack = 'Full Stack'
}) => {
  const derivedBreakdown = {
    codeQuality: clamp(githubAnalysis?.scores?.codeQuality || githubAnalysis?.score || 0),
    skillCoverage: clamp(skillGapAnalysis?.coverage || 0),
    industryReadiness: clamp(average([
      resumeAnalysis?.atsScore,
      resumeAnalysis?.keywordDensity,
      resumeAnalysis?.contentQuality,
      resumeAnalysis?.formatScore
    ])),
    projectImpact: clamp(average([
      githubAnalysis?.scores?.projectImpact,
      githubAnalysis?.scores?.consistency,
      githubAnalysis?.scores?.contribution,
      integrationInsight?.integrationScore
    ]))
  };

  const normalizedAI = normalizeBreakdown(aiBreakdown, derivedBreakdown);
  const blendedBreakdown = {
    codeQuality: clamp((derivedBreakdown.codeQuality * 0.6) + (normalizedAI.codeQuality * 0.4)),
    skillCoverage: clamp((derivedBreakdown.skillCoverage * 0.6) + (normalizedAI.skillCoverage * 0.4)),
    industryReadiness: clamp((derivedBreakdown.industryReadiness * 0.55) + (normalizedAI.industryReadiness * 0.45)),
    projectImpact: clamp((derivedBreakdown.projectImpact * 0.55) + (normalizedAI.projectImpact * 0.45))
  };

  const weights = getWeights(careerStack);
  const weightedScore = clamp(Math.round(
    (blendedBreakdown.codeQuality * weights.codeQuality) +
    (blendedBreakdown.skillCoverage * weights.skillCoverage) +
    (blendedBreakdown.industryReadiness * weights.industryReadiness) +
    (blendedBreakdown.projectImpact * weights.projectImpact)
  ));

  const confidenceScore = getConfidenceScore({ githubAnalysis, resumeAnalysis, skillGapAnalysis });
  const aiInfluence = clamp(Number(aiOverallScore || 0));
  const finalScore = clamp(Math.round((weightedScore * 0.8) + (aiInfluence * 0.2)));

  const reasons = [
    `Code quality contributes ${Math.round(weights.codeQuality * 100)}% weight and is currently ${Math.round(blendedBreakdown.codeQuality)}%.`,
    `Skill coverage contributes ${Math.round(weights.skillCoverage * 100)}% weight and is currently ${Math.round(blendedBreakdown.skillCoverage)}%.`,
    `Industry readiness contributes ${Math.round(weights.industryReadiness * 100)}% weight and is currently ${Math.round(blendedBreakdown.industryReadiness)}%.`,
    `Project impact contributes ${Math.round(weights.projectImpact * 100)}% weight and is currently ${Math.round(blendedBreakdown.projectImpact)}%.`,
    integrationInsight?.integrationScore
      ? `Integration signals contributed ${Math.round(Number(integrationInsight.integrationScore || 0))}% external validation score.`
      : 'No connected integration signals were available for this scoring cycle.'
  ];

  return {
    overallScore: finalScore,
    weightedScore,
    confidenceScore,
    breakdown: blendedBreakdown,
    explainabilityBreakdown: {
      weights,
      featureScores: blendedBreakdown,
      confidenceScore,
      aiInfluence,
      deterministicScore: weightedScore
    },
    reasons
  };
};

const normalizeTransparentScorePayload = (result = {}) => {
  const normalizedBreakdown = normalizeBreakdown(result.breakdown || {}, {});
  const score = clamp(result.overallScore || result.weightedScore || average(Object.values(normalizedBreakdown)));

  const weights = result.explainabilityBreakdown?.weights || getWeights('Full Stack');
  const reasons = Array.isArray(result.reasons) && result.reasons.length
    ? result.reasons
    : [
        'Score includes weighted analysis of code quality, coverage, readiness, and impact.',
        'Confidence score reflects the amount of available GitHub and resume data.'
      ];

  return {
    ...result,
    overallScore: score,
    weightedScore: clamp(result.weightedScore || score),
    confidenceScore: clamp(result.confidenceScore || 60),
    breakdown: normalizedBreakdown,
    explainabilityBreakdown: {
      weights,
      featureScores: normalizedBreakdown,
      confidenceScore: clamp(result.confidenceScore || 60),
      aiInfluence: clamp(result.explainabilityBreakdown?.aiInfluence || score),
      deterministicScore: clamp(result.explainabilityBreakdown?.deterministicScore || result.weightedScore || score)
    },
    reasons
  };
};

module.exports = { calculateTransparentScore, normalizeTransparentScorePayload };
