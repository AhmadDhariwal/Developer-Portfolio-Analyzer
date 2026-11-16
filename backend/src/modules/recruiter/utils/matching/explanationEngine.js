const buildSummary = (candidateName, role, finalScore) => {
  if (finalScore >= 80) return `Strong ${role || 'technical'} candidate with clear interview readiness.`;
  if (finalScore >= 65) return `Solid ${role || 'technical'} candidate with a few focused improvement areas.`;
  return `${candidateName} needs additional growth before moving to advanced interview rounds.`;
};

const buildRecommendation = (finalScore) => {
  if (finalScore >= 80) return 'Recommended for interview';
  if (finalScore >= 65) return 'Recommended for shortlist';
  if (finalScore >= 50) return 'Hold for future pipeline';
  return 'Not recommended for this role right now';
};

const generateExplanation = ({
  candidate,
  job,
  finalScore,
  features,
  breakdown
}) => {
  const strengths = [];
  const weaknesses = [];

  if (features.skillMatch >= 70) strengths.push('High skill relevance to role requirements');
  if (features.projectQuality >= 70) strengths.push('Strong project quality and delivery signal');
  if (features.github >= 70) strengths.push('Good GitHub activity and engineering consistency');
  if (features.experience >= 70) strengths.push('Experience level matches the job expectation');
  if (features.consistency >= 70) strengths.push('Consistent execution from Career Sprint signals');
  if (features.growth >= 70) strengths.push('High growth potential from recent trend data');

  if (features.skillMatch < 50) weaknesses.push('Limited skill overlap with required stack');
  if (features.projectQuality < 50) weaknesses.push('Project portfolio needs stronger impact evidence');
  if (features.github < 50) weaknesses.push('GitHub signal is below expected benchmark');
  if (features.experience < 50) weaknesses.push('Experience is below minimum expected level');
  if (features.consistency < 50) weaknesses.push('Execution consistency trend is currently weak');
  if (features.growth < 50) weaknesses.push('Growth potential indicators are below target');

  if (!strengths.length) strengths.push('Candidate shows baseline profile completeness');
  if (!weaknesses.length) weaknesses.push('No major weaknesses identified for this role');

  return {
    summary: buildSummary(candidate.fullName || candidate.name || 'Candidate', job.role || job.title, finalScore),
    strengths,
    weaknesses,
    recommendation: buildRecommendation(finalScore),
    details: {
      topWeightedDriver: Object.entries(breakdown)
        .sort((a, b) => b[1].weighted - a[1].weighted)[0]?.[0] || 'skillMatch'
    }
  };
};

module.exports = {
  generateExplanation
};
