// Synthetic UI fixtures shared by browser checks; never production evidence.
const profile = {
  careerStack: 'Backend',
  activeCareerStack: 'Backend',
  experienceLevel: 'Student',
  activeExperienceLevel: 'Student',
  activeGithubUsername: 'fixture',
  isConfigured: true,
};
function fixture() {
  const skills = ['PARTIAL', 'CLAIMED_ONLY', 'NOT_EVIDENCED', 'UNKNOWN'].map((status, i) => ({
    name: [
      'TypeScript',
      'React Native',
      'Java',
      'A very long skill name that must wrap gracefully at every mobile viewport width',
    ][i],
    category: 'Technical',
    requirement: i === 1 ? 'OPTIONAL' : 'REQUIRED',
    weight: 1,
    status,
    evidenceCredit: i === 0 ? 0.5 : 0,
    evidenceConfidence: i < 2 ? 'LOW' : 'INSUFFICIENT',
    independentTechnicalSources: i === 0 ? 1 : 0,
    evidence:
      i < 2
        ? [
            {
              type: i === 0 ? 'github' : 'resume',
              kind: i === 0 ? 'METADATA' : 'CLAIM',
              artifact: 'Synthetic fixture source',
              id: 'fixture',
              origin: 'fixture',
              timestamp: '2026-01-01T00:00:00Z',
              freshness: 'STALE',
              conflicting: false,
            },
          ]
        : [],
    warnings: [],
  }));
  const names = [
    'Docker',
    'PostgreSQL',
    'CI/CD',
    'Testing',
    'Redis',
    'API design',
    'Observability',
    'Security',
  ];
  names.forEach((name, i) =>
    skills.push({ ...skills[2], name, category: i < 4 ? 'Delivery' : 'Architecture' }),
  );
  const suggestedProjects = names.slice(0, 4).map((skill) => ({
    title: skill + ' proof project',
    skill,
    difficulty: 'Intermediate',
    estimatedWeeks: 2,
    outcome: 'Build a working backend example with automated checks.',
    deliverable: 'Repository, tests and a documented implementation.',
  }));
  const missingSkills = names.slice(0, 3).map((name, i) => ({
    name,
    category: 'Delivery',
    priority: i === 0 ? 'High' : 'Medium',
    whyItMatters: 'Make practical implementation visible through a focused, reproducible example.',
    suggestedProject: suggestedProjects[i],
  }));
  const roadmap = [
    {
      phase: 'Phase 1',
      title: 'Build the foundation',
      duration: 'Weeks 1–2',
      description: 'Create a reproducible development environment.',
      skills: ['Docker', 'PostgreSQL'],
      resources: [{ title: 'Docker documentation', url: 'https://docs.docker.com' }],
      objective: 'Containerize the service',
      expectedOutcome: 'Reproducible local environment',
      measurableDeliverable: 'Compose configuration and integration checks',
    },
  ];
  const weeklyRoadmap = [
    {
      week: 1,
      focusSkills: ['Docker'],
      reason: 'Establish a deployment foundation',
      outcomes: ['Run the service in a container'],
    },
  ];
  return {
    suggestedProjects,
    missingSkills,
    roadmap,
    weeklyRoadmap,
    immediateSkills: ['Docker'],
    shortTermSkills: ['PostgreSQL'],
    midTermSkills: ['CI/CD'],
    longTermSkills: ['Observability'],
    totalWeeks: '8 weeks',
    username: 'fixture',
    careerStack: 'Backend',
    experienceLevel: 'Student',
    ruleVersion: 'skill-evidence-coverage-v1',
    requirementMatrixVersion: 'skill-gap-requirements-v1',
    calculatedAt: '2026-10-12T00:00:00Z',
    coverage: 16.67,
    skills,
    categoryBreakdown: {
      Delivery: { requiredSkillCount: 4, optionalSkillCount: 0, coverage: 0 },
      Architecture: { requiredSkillCount: 4, optionalSkillCount: 0, coverage: 0 },
      Technical: {
        requiredSkillCount: 3,
        optionalSkillCount: 1,
        requiredWeight: 3,
        weightedCredit: 0.5,
        coverage: 16.67,
      },
    },
    evidenceCompleteness: { availableCoreSources: 1, totalCoreSources: 2, complete: false },
    evidenceConfidence: 'INSUFFICIENT',
    sourceReferences: [
      {
        type: 'github',
        id: 'fixture',
        available: true,
        completeness: 'PARTIAL',
        timestamp: '2026-01-01T00:00:00Z',
        freshness: 'STALE',
      },
      {
        type: 'resume',
        id: 'fixture',
        available: false,
        completeness: 'UNKNOWN',
        timestamp: null,
        freshness: 'UNKNOWN',
      },
    ],
    aiUsed: false,
    warnings: ['partial_source_limitations'],
    legacyReadinessScore: 79,
    legacyConfidence: 65,
  };
}

module.exports = { profile, fixture };
