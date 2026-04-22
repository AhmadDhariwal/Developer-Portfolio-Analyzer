const { predictGrowthPotential } = require('./potentialPredictor');

const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, Number(value) || 0));

const normalizeText = (value) => String(value || '').trim().toLowerCase();

const normalizeSkillSet = (skills = []) => {
  return [...new Set((Array.isArray(skills) ? skills : [])
    .map((skill) => normalizeText(skill))
    .filter(Boolean))];
};

const toExperienceScore = (years, minExperienceYears = 0) => {
  const normalizedYears = Math.max(0, Number(years) || 0);
  const minimum = Math.max(0, Number(minExperienceYears) || 0);

  if (minimum <= 0) {
    return clamp(normalizedYears * 15);
  }

  const ratio = normalizedYears / minimum;
  return clamp(ratio * 70 + Math.min(normalizedYears * 4, 30));
};

const computeSkillMatch = (candidateSkills = [], requiredSkills = []) => {
  const normalizedCandidateSkills = normalizeSkillSet(candidateSkills);
  const normalizedRequiredSkills = normalizeSkillSet(requiredSkills);

  if (!normalizedRequiredSkills.length) {
    return {
      score: normalizedCandidateSkills.length ? 70 : 0,
      matchedSkills: [],
      missingSkills: []
    };
  }

  const matched = normalizedRequiredSkills.filter((skill) => normalizedCandidateSkills.includes(skill));
  const missing = normalizedRequiredSkills.filter((skill) => !normalizedCandidateSkills.includes(skill));
  const score = clamp((matched.length / normalizedRequiredSkills.length) * 100);

  return {
    score,
    matchedSkills: matched,
    missingSkills: missing
  };
};

const computeProjectQuality = (projects = []) => {
  const safeProjects = Array.isArray(projects) ? projects : [];
  if (!safeProjects.length) return 0;

  const avgImpact = safeProjects.reduce((sum, project) => {
    return sum + (Number(project.impactScore) || 0);
  }, 0) / safeProjects.length;

  const completionBonus = safeProjects.filter((project) => project.status === 'completed').length / safeProjects.length;
  return clamp(avgImpact * 0.8 + completionBonus * 20);
};

const extractCandidateFeatures = ({ candidate, job, enrichment = {} }) => {
  const skillMatchResult = computeSkillMatch(candidate.skills, job.requiredSkills);
  const projectQuality = computeProjectQuality(candidate.projects);

  const resolvedConsistencyScore = enrichment.consistencyScore ?? candidate.consistencyScore;
  const consistencyScore = clamp(resolvedConsistencyScore);

  const growthScore = predictGrowthPotential({
    explicitGrowthScore: candidate.growthPotentialScore,
    weeklyCoverageDelta: enrichment.weeklyCoverageDelta,
    readinessDelta: enrichment.readinessDelta,
    sprintCompletionRate: enrichment.sprintCompletionRate,
    githubConsistencySignal: enrichment.githubConsistencySignal,
    projectVelocity: enrichment.projectVelocity
  });

  const githubScore = clamp(candidate.githubScore);
  const experienceScore = toExperienceScore(candidate.yearsOfExperience, job.minExperienceYears);

  return {
    githubScore,
    skillMatch: skillMatchResult.score,
    skillRelevance: skillMatchResult.score,
    projectQuality,
    experience: experienceScore,
    consistency: consistencyScore,
    growth: growthScore,
    matchedSkills: skillMatchResult.matchedSkills,
    missingSkills: skillMatchResult.missingSkills
  };
};

module.exports = {
  extractCandidateFeatures,
  normalizeSkillSet,
  computeSkillMatch,
  computeProjectQuality,
  toExperienceScore
};
