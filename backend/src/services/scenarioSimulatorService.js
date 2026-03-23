const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, Number(value || 0)));

const normalizeStringList = (list = []) => {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const result = [];

  list.forEach((item) => {
    const value = String(item || '').trim();
    const key = value.toLowerCase();
    if (!value || seen.has(key)) return;
    seen.add(key);
    result.push(value);
  });

  return result;
};

const difficultyWeight = {
  low: 0.8,
  medium: 1,
  high: 1.2
};

const normalizeProjects = (projects = []) => {
  if (!Array.isArray(projects)) return [];
  return projects
    .map((project) => ({
      name: String(project?.name || project?.title || '').trim(),
      impact: clamp(project?.impact || 65),
      complexity: String(project?.complexity || 'medium').toLowerCase(),
      weeks: Math.max(1, Number(project?.weeks || 3))
    }))
    .filter((project) => project.name);
};

const computeSkillImpact = (skills = []) => {
  if (!skills.length) return 0;
  const base = Math.min(18, skills.length * 2.4);
  const uniquenessBoost = Math.min(8, skills.length * 0.8);
  return clamp(base + uniquenessBoost, 0, 24);
};

const computeProjectImpact = (projects = []) => {
  if (!projects.length) return 0;

  const weighted = projects.reduce((sum, project) => {
    const multiplier = difficultyWeight[project.complexity] || 1;
    const cadence = Math.min(1.3, 0.8 + (project.weeks / 12));
    return sum + (project.impact * multiplier * cadence);
  }, 0);

  const normalized = weighted / (projects.length * 6.5);
  return clamp(normalized, 0, 26);
};

const simulateHiringOutcome = ({
  baselineHiringScore = 55,
  baselineJobMatch = 48,
  skills = [],
  projects = []
}) => {
  const uniqueSkills = normalizeStringList(skills);
  const normalizedProjects = normalizeProjects(projects);

  const skillImpact = computeSkillImpact(uniqueSkills);
  const projectImpact = computeProjectImpact(normalizedProjects);
  const synergyBoost = uniqueSkills.length && normalizedProjects.length
    ? Math.min(9, (uniqueSkills.length * normalizedProjects.length) / 3)
    : 0;

  const totalImprovement = clamp(skillImpact + projectImpact + synergyBoost, 0, 42);

  const predictedHiringScore = clamp(Number(baselineHiringScore) + totalImprovement);
  const predictedJobMatch = clamp(Number(baselineJobMatch) + Math.round(totalImprovement * 0.78));

  return {
    baseline: {
      hiringScore: clamp(baselineHiringScore),
      jobMatch: clamp(baselineJobMatch)
    },
    predicted: {
      hiringScore: predictedHiringScore,
      jobMatch: predictedJobMatch
    },
    improvements: {
      hiringScore: clamp(predictedHiringScore - clamp(baselineHiringScore)),
      jobMatch: clamp(predictedJobMatch - clamp(baselineJobMatch)),
      skillImpact: Math.round(skillImpact),
      projectImpact: Math.round(projectImpact),
      synergyBoost: Math.round(synergyBoost)
    },
    assumptions: {
      skillsConsidered: uniqueSkills,
      projectsConsidered: normalizedProjects.map((project) => ({
        name: project.name,
        complexity: project.complexity,
        impact: project.impact,
        weeks: project.weeks
      }))
    }
  };
};

module.exports = { simulateHiringOutcome };
