const crypto = require('node:crypto');
const { analyzeGitHubProfile } = require('../services/githubservice');
const aiService = require('../services/aiservice');
const { getSkillGapPrompt } = require('../prompts/skillGapPrompt');
const AnalysisCache = require('../models/analysisCache');
const ResumeAnalysis = require('../models/resumeAnalysis');
const Analysis = require('../models/analysis');
const User = require('../models/user');
const { createVersion } = require('../services/aiVersionService');
const { buildSkillGraph, generateWeeklyLearningRoadmap } = require('../services/skillGraphService');
const {
  getDeveloperSignals,
  buildSignalHash,
  buildSignalsUsedSummary,
  buildResumeAnalysisSignals,
  buildResumeCacheIdentity,
  buildAnalysisBasedOn
} = require('../services/developerSignalService');
const {
  estimateTokens,
  buildSkillGapPromptContext
} = require('../services/promptBuilderService');
const {
  extractSkillsFromRepositories,
  canonicalizeSkillName,
  normalizeSkillList,
  INDUSTRY_SKILLS
} = require('../utils/skilldetector');

const ANALYSIS_VERSION = 'v6-skill-intelligence';
const MIN_MISSING_SKILLS = 12;
const MIN_KNOWN_SKILLS = 8;
const DETERMINISTIC_CONFIDENCE_THRESHOLD = 70;

const DEFAULT_MISSING_SKILLS = [
  'Testing',
  'System Design',
  'CI/CD',
  'Docker',
  'SQL',
  'Cloud Basics',
  'Security Basics',
  'Performance Optimization',
  'Design Patterns',
  'Monitoring and Observability',
  'API Versioning',
  'Caching Strategies',
  'Scalability Patterns',
  'Accessibility',
  'Documentation'
];

const STACK_SKILL_HINTS = {
  Frontend: ['React', 'TypeScript', 'Next.js', 'Accessibility', 'Testing', 'CI/CD', 'Deployment'],
  Backend: ['Node.js', 'REST APIs', 'SQL', 'PostgreSQL', 'Docker', 'CI/CD', 'Caching Strategies', 'Deployment'],
  'Full Stack': ['React', 'TypeScript', 'Node.js', 'REST APIs', 'SQL', 'Docker', 'CI/CD', 'Deployment'],
  'AI/ML': ['Python', 'SQL', 'Docker', 'AWS', 'CI/CD', 'Deployment', 'Monitoring and Observability']
};

const STACK_ALLOWED_CATEGORIES = {
  Frontend: new Set(['Frontend', 'Language', 'Testing', 'Tools', 'DevOps', 'Cloud', 'Backend', 'General']),
  Backend: new Set(['Backend', 'Language', 'Database', 'Testing', 'Tools', 'DevOps', 'Cloud', 'General']),
  'Full Stack': new Set(['Frontend', 'Backend', 'Language', 'Database', 'Testing', 'Tools', 'DevOps', 'Cloud', 'General']),
  'AI/ML': new Set(['Language', 'Database', 'DevOps', 'Cloud', 'Testing', 'Tools', 'AI/ML', 'General'])
};

const EXPERIENCE_PRIORITY_LIMITS = {
  Student: 8,
  Intern: 8,
  '0-1 years': 9,
  '1-2 years': 10,
  '2-3 years': 12,
  '3-5 years': 14,
  '5+ years': 16
};

const EXPERIENCE_SKILL_HINTS = {
  Student: ['Git', 'Testing', 'Documentation', 'Deployment'],
  Intern: ['Git', 'Testing', 'Documentation', 'Deployment'],
  '0-1 years': ['Testing', 'SQL', 'Deployment', 'Documentation'],
  '1-2 years': ['Testing', 'SQL', 'CI/CD', 'Deployment'],
  '2-3 years': ['System Design', 'CI/CD', 'Docker', 'Performance Optimization'],
  '3-5 years': ['System Design', 'CI/CD', 'Monitoring and Observability', 'Security Basics'],
  '5+ years': ['System Design', 'Scalability Patterns', 'Security Basics', 'Monitoring and Observability']
};

const SKILL_RESOURCE_HINTS = {
  React: [
    { title: 'React docs', url: 'https://react.dev/learn' },
    { title: 'React Testing Library', url: 'https://testing-library.com/docs/react-testing-library/intro/' }
  ],
  JavaScript: [
    { title: 'MDN JavaScript guide', url: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide' }
  ],
  TypeScript: [
    { title: 'TypeScript handbook', url: 'https://www.typescriptlang.org/docs/handbook/intro.html' }
  ],
  'Node.js': [
    { title: 'Node.js docs', url: 'https://nodejs.org/en/learn' }
  ],
  'REST APIs': [
    { title: 'Microsoft REST API guidelines', url: 'https://github.com/microsoft/api-guidelines' }
  ],
  SQL: [
    { title: 'PostgreSQL tutorial', url: 'https://www.postgresql.org/docs/current/tutorial.html' }
  ],
  Docker: [
    { title: 'Docker docs', url: 'https://docs.docker.com/get-started/' }
  ],
  'CI/CD': [
    { title: 'GitHub Actions docs', url: 'https://docs.github.com/en/actions' }
  ],
  Testing: [
    { title: 'Testing JavaScript guide', url: 'https://testingjavascript.com/' }
  ],
  'System Design': [
    { title: 'System Design Primer', url: 'https://github.com/donnemartin/system-design-primer' }
  ],
  Accessibility: [
    { title: 'WCAG quick reference', url: 'https://www.w3.org/WAI/WCAG22/quickref/' }
  ],
  'Security Basics': [
    { title: 'OWASP Top 10', url: 'https://owasp.org/www-project-top-ten/' }
  ],
  'Monitoring and Observability': [
    { title: 'OpenTelemetry docs', url: 'https://opentelemetry.io/docs/' }
  ]
};

const isValidUrl = (value) => typeof value === 'string' && /^https?:\/\//i.test(value.trim());

const toDocSearchUrl = (topic) => {
  const query = encodeURIComponent(String(topic || 'software engineering docs'));
  return `https://www.google.com/search?q=${query}`;
};

const normalizeRoadmapResource = (resource, fallbackTopic = 'software engineering docs') => {
  if (typeof resource === 'object' && resource !== null) {
    const title = String(resource.title || resource.name || fallbackTopic).trim();
    const url = isValidUrl(resource.url) ? resource.url.trim() : toDocSearchUrl(title || fallbackTopic);
    return { title, url };
  }

  const text = String(resource || '').trim();
  if (!text) {
    return { title: fallbackTopic, url: toDocSearchUrl(fallbackTopic) };
  }

  if (isValidUrl(text)) {
    return { title: text.replace(/^https?:\/\//i, '').slice(0, 80), url: text };
  }

  return { title: text, url: toDocSearchUrl(text) };
};

const normalizeRoadmap = (roadmap = [], min = 3) => {
  const defaults = [
    {
      phase: 'Phase 1',
      title: 'Core Foundations',
      description: 'Build strong fundamentals for your current stack.',
      duration: '2-3 weeks',
      skills: ['JavaScript', 'Git', 'Testing'],
      resources: [
        { title: 'Official language docs', url: 'https://developer.mozilla.org/' },
        { title: 'Git documentation', url: 'https://git-scm.com/doc' }
      ],
      color: 'blue'
    },
    {
      phase: 'Phase 2',
      title: 'Project Depth',
      description: 'Apply missing skills in practical projects.',
      duration: '3-4 weeks',
      skills: ['Docker', 'CI/CD', 'Testing'],
      resources: [
        { title: 'Docker docs', url: 'https://docs.docker.com/' },
        { title: 'GitHub Actions docs', url: 'https://docs.github.com/en/actions' }
      ],
      color: 'green'
    },
    {
      phase: 'Phase 3',
      title: 'Interview Readiness',
      description: 'Prepare portfolio and interview-focused practice.',
      duration: '2-3 weeks',
      skills: ['System Design', 'Documentation'],
      resources: [
        { title: 'System Design Primer', url: 'https://github.com/donnemartin/system-design-primer' },
        { title: 'LeetCode', url: 'https://leetcode.com/' }
      ],
      color: 'orange'
    }
  ];

  const safe = Array.isArray(roadmap) ? [...roadmap] : [];
  while (safe.length < min) safe.push(defaults[safe.length % defaults.length]);

  return safe.map((phase, index) => {
    const fallbackPhase = defaults[index % defaults.length];
    const phaseSkills = uniqueSkillNames(Array.isArray(phase.skills) ? phase.skills : fallbackPhase.skills);
    const firstSkill = phaseSkills[0] || fallbackPhase.skills[0] || 'Testing';
    const resources = Array.isArray(phase.resources)
      ? phase.resources.map((resource) => normalizeRoadmapResource(resource, firstSkill))
      : [];
    const objective = String(phase.objective || `Build practical confidence in ${firstSkill} for the target role.`).trim();
    const expectedOutcome = String(phase.expectedOutcome || `Use ${firstSkill} in a working, reviewable implementation.`).trim();
    const measurableDeliverable = String(phase.measurableDeliverable || `Publish a commit, PR, or portfolio note showing ${firstSkill} with tests or documentation.`).trim();

    return {
      phase: String(phase.phase || `Phase ${index + 1}`).trim(),
      title: String(phase.title || `Milestone ${index + 1}`).trim(),
      description: String(phase.description || 'Complete focused practice for this milestone.').trim(),
      duration: String(phase.duration || '2-3 weeks').trim(),
      skills: phaseSkills,
      resources: resources.length ? resources : getSkillResources(firstSkill),
      objective,
      expectedOutcome,
      measurableDeliverable,
      topSkill: firstSkill,
      color: ['purple', 'blue', 'green', 'orange'].includes(String(phase.color || '').trim())
        ? String(phase.color).trim()
        : fallbackPhase.color
    };
  });
};

const toSkillName = (value) => canonicalizeSkillName(typeof value === 'string' ? value : value?.name || value?.skill || '');

const uniqueByLower = (values = []) => {
  const seen = new Set();
  return values.filter((value) => {
    const key = String(value || '').trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const uniqueSkillNames = (values = []) => normalizeSkillList(values);

const uniqueObjectsByName = (values = []) => {
  const seen = new Set();
  return values.filter((item) => {
    const key = String(item?.name || '').trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const getSkillMeta = (skillName = '') => {
  const canonical = canonicalizeSkillName(skillName);
  if (!canonical) {
    return { name: '', category: '', priority: '', jobDemand: 0 };
  }
  const known = INDUSTRY_SKILLS.find((skill) => skill.name.toLowerCase() === canonical.toLowerCase());
  return {
    name: canonical,
    category: known?.category || 'General',
    priority: known?.priority || 'Medium',
    jobDemand: clamp(known?.jobDemand || 62)
  };
};

const sourceLabel = (source) => {
  const labels = {
    github: 'GitHub',
    resume: 'Resume',
    portfolio: 'Portfolio',
    integration: 'Integration',
    jobs: 'Jobs',
    expected: 'Career Profile',
    weekly: 'Weekly Reports',
    sprint: 'Career Sprint'
  };
  return labels[source] || 'Signal';
};

const addSkillEvidence = (map, rawName, source, evidence, score = 40, extra = {}) => {
  const meta = getSkillMeta(rawName);
  if (!meta.name) return;
  const key = meta.name.toLowerCase();
  const existing = map.get(key) || {
    name: meta.name,
    category: meta.category,
    priority: meta.priority,
    jobDemand: meta.jobDemand,
    sources: new Set(),
    evidence: [],
    score: 0,
    weight: 0
  };

  existing.sources.add(sourceLabel(source));
  if (evidence) existing.evidence.push(String(evidence).trim());
  existing.score += Number(score || 0);
  existing.weight += 1;
  Object.assign(existing, extra);
  map.set(key, existing);
};

const materializeSkillEvidence = (entry, overrides = {}) => {
  const source = Array.from(entry.sources || []);
  const confidenceScore = clamp((entry.score / Math.max(entry.weight || 1, 1)) + (source.length - 1) * 8);
  return {
    name: entry.name,
    source: source.join(' + ') || 'Signal',
    confidenceScore,
    evidence: uniqueByLower(entry.evidence || []).slice(0, 5),
    category: entry.category || 'General',
    priority: overrides.priority || entry.priority || 'Medium',
    jobDemand: clamp(overrides.jobDemand || entry.jobDemand || 60),
    ...overrides
  };
};

const evidenceSentenceForCurrent = (skill, careerStack) => {
  const sources = String(skill.source || '').trim();
  if (sources.includes('GitHub') && sources.includes('Resume')) {
    return `${skill.name} appears in both GitHub evidence and resume analysis for ${careerStack}.`;
  }
  if (sources.includes('GitHub')) return `${skill.name} was detected from repository languages, topics, or descriptions.`;
  if (sources.includes('Resume')) return `${skill.name} was extracted from the latest resume analysis.`;
  if (sources.includes('Portfolio')) return `${skill.name} appears in portfolio project evidence.`;
  if (sources.includes('Integration')) return `${skill.name} was detected through connected integration evidence.`;
  return `${skill.name} is supported by available developer signals.`;
};

const evidenceSentenceForMissing = (skill, careerStack, experienceLevel) => {
  const sources = String(skill.source || '').trim();
  if (sources.includes('Career Profile')) {
    return `${skill.name} is expected for ${careerStack} at ${experienceLevel} level but is not yet proven in the strongest signals.`;
  }
  if (sources.includes('Resume')) return `${skill.name} is claimed in the resume but needs project or GitHub proof.`;
  if (sources.includes('Jobs')) return `${skill.name} appears in cached job-demand signals for the target profile.`;
  if (sources.includes('Weekly Reports') || sources.includes('Career Sprint')) return `${skill.name} has appeared as a repeated weak or incomplete learning area.`;
  return `${skill.name} is a recognized ${careerStack} skill that is not yet sufficiently evidenced.`;
};

const cleanSkillObjects = (skills = [], kind, careerStack, experienceLevel) => {
  const seen = new Set();
  return (Array.isArray(skills) ? skills : [])
    .map((skill) => {
      const name = toSkillName(skill);
      if (!name) return null;
      const key = name.toLowerCase();
      if (seen.has(key)) return null;
      seen.add(key);
      const meta = getSkillMeta(name);
      const demand = kind === 'missing' ? clamp(skill.jobDemand || meta.jobDemand || 60) : skill.jobDemand;
      const confidenceScore = clamp(skill.confidenceScore || (kind === 'current' ? 58 : 52));
      const priority = normalizePriority(skill.priority || meta.priority, demand || meta.jobDemand, confidenceScore);
      const learningEffort = estimateLearningEffort({ ...skill, name, jobDemand: demand, priority, confidenceScore }, experienceLevel);
      const evidence = uniqueByLower([
        ...(Array.isArray(skill.evidence) ? skill.evidence : []),
        kind === 'current'
          ? evidenceSentenceForCurrent({ ...skill, name }, careerStack)
          : evidenceSentenceForMissing({ ...skill, name }, careerStack, experienceLevel)
      ]).slice(0, 5);

      return {
        ...skill,
        name,
        category: meta.category || skill.category || 'General',
        priority,
        jobDemand: demand,
        confidenceScore,
        evidence,
        source: String(skill.source || '').trim() || (kind === 'current' ? 'Evidence' : 'Career Profile'),
        detectionMethod: String(skill.source || '').trim() || (kind === 'current' ? 'Developer Evidence' : 'Career Profile'),
        whyExists: kind === 'current'
          ? evidenceSentenceForCurrent({ ...skill, name }, careerStack)
          : evidenceSentenceForMissing({ ...skill, name }, careerStack, experienceLevel),
        whyItMatters: businessImpactForSkill({ ...skill, name, category: meta.category, jobDemand: demand }, careerStack),
        businessImpact: businessImpactForSkill({ ...skill, name, category: meta.category, jobDemand: demand }, careerStack),
        learningEffort: kind === 'missing' ? learningEffort : undefined,
        recommendedResources: kind === 'missing' ? getSkillResources(name) : undefined,
        suggestedProject: kind === 'missing' ? buildSkillProject({ ...skill, name, jobDemand: demand, priority }, careerStack) : undefined
      };
    })
    .filter(Boolean);
};

const isRelevantForStack = (skillName, careerStack) => {
  const meta = getSkillMeta(skillName);
  const allowed = STACK_ALLOWED_CATEGORIES[careerStack] || STACK_ALLOWED_CATEGORIES['Full Stack'];
  if (allowed.has(meta.category)) return true;
  return getExpectedSkills(careerStack, 'Student').some((skill) => skill.toLowerCase() === meta.name.toLowerCase());
};

const normalizePriority = (priority, demand = 0, confidence = 0) => {
  const value = String(priority || '').trim();
  if (['High', 'Medium', 'Low'].includes(value)) return value;
  if (demand >= 84 || confidence >= 78) return 'High';
  if (demand >= 64 || confidence >= 52) return 'Medium';
  return 'Low';
};

const estimateLearningEffort = (skill, experienceLevel = 'Student') => {
  const demand = clamp(skill.jobDemand || getSkillMeta(skill.name).jobDemand || 60);
  const priority = normalizePriority(skill.priority, demand, skill.confidenceScore);
  const seniorLevels = new Set(['2-3 years', '3-5 years', '5+ years']);
  const baseWeeks = priority === 'High' ? 3 : priority === 'Medium' ? 2 : 1;
  const demandWeeks = demand >= 85 ? 1 : 0;
  const experienceWeeks = seniorLevels.has(experienceLevel) ? 1 : 0;
  const weeks = Math.max(1, Math.min(6, baseWeeks + demandWeeks + experienceWeeks));
  return {
    weeks,
    label: weeks === 1 ? '1 focused week' : `${weeks} focused weeks`,
    level: weeks >= 4 ? 'Deep practice' : weeks >= 2 ? 'Applied practice' : 'Quick validation'
  };
};

const getSkillResources = (skillName) => {
  const name = toSkillName(skillName);
  const resources = SKILL_RESOURCE_HINTS[name] || [
    { title: `${name} official documentation`, url: toDocSearchUrl(`${name} official documentation`) },
    { title: `${name} practical project guide`, url: toDocSearchUrl(`${name} practical project guide`) }
  ];
  return resources.slice(0, 2).map((resource) => normalizeRoadmapResource(resource, name));
};

const businessImpactForSkill = (skill, careerStack) => {
  const demand = clamp(skill.jobDemand || getSkillMeta(skill.name).jobDemand || 60);
  if (demand >= 85) {
    return `${skill.name} is likely to improve match quality for ${careerStack} roles because demand is high and it appears in core hiring signals.`;
  }
  if (String(skill.category || '').includes('DevOps')) {
    return `${skill.name} improves delivery reliability, deployment confidence, and production-readiness signals.`;
  }
  if (String(skill.category || '').includes('Testing')) {
    return `${skill.name} reduces regression risk and makes portfolio projects more credible to reviewers.`;
  }
  if (String(skill.category || '').includes('Database')) {
    return `${skill.name} improves data-modeling credibility and backend role alignment.`;
  }
  return `${skill.name} strengthens practical role fit and gives reviewers clearer evidence of production-ready engineering.`;
};

const buildSkillProject = (skill, careerStack = 'Full Stack') => {
  const name = toSkillName(skill);
  return {
    title: `${careerStack} ${name} proof project`,
    skill: name,
    difficulty: (skill.jobDemand || 0) >= 84 ? 'Intermediate' : 'Focused',
    estimatedWeeks: estimateLearningEffort(skill).weeks,
    outcome: `Ship a small, reviewable feature that proves ${name} with tests, documentation, and deployment notes.`,
    deliverable: `A repository PR or portfolio case study showing ${name} in a realistic workflow.`
  };
};

const buildSuggestedProjects = (skills = [], careerStack = 'Full Stack') => skills.slice(0, 5).map((skill, index) => {
  const name = toSkillName(skill);
  return {
    ...buildSkillProject({ ...skill, name }, careerStack),
    difficulty: index < 2 ? 'Intermediate' : 'Focused'
  };
});

const buildRoadmapBuckets = ({ missingSkills, weakSkills, weeklyRoadmap }) => {
  const ordered = uniqueObjectsByName([
    ...missingSkills.filter((skill) => skill.priority === 'High'),
    ...weakSkills,
    ...missingSkills.filter((skill) => skill.priority === 'Medium'),
    ...missingSkills.filter((skill) => skill.priority === 'Low')
  ]);

  const immediateSkills = ordered.slice(0, 3);
  const shortTermSkills = ordered.slice(3, 7);
  const midTermSkills = ordered.slice(7, 11);
  const longTermSkills = ordered.slice(11, 16);
  const prerequisites = {};
  (weeklyRoadmap || []).forEach((week) => {
    (week.focusSkills || []).forEach((skill) => {
      prerequisites[skill] = week.reason || '';
    });
  });

  return {
    immediateSkills,
    shortTermSkills,
    midTermSkills,
    longTermSkills,
    prerequisites,
    estimatedWeeks: Math.max(4, Math.min(16, Math.ceil(ordered.length / 2))),
    suggestedProjects: buildSuggestedProjects(ordered)
  };
};

const clamp = (value, min = 0, max = 100) => {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return min;
  return Math.max(min, Math.min(max, Math.round(numeric)));
};

const computeDeterministicConfidence = ({ evidenceBreakdown, resumeInsights, githubData, developerSignals }) => {
  const provenCount = (evidenceBreakdown?.provenSkills || []).length;
  const claimedNotProven = (evidenceBreakdown?.claimedButNotProvenSkills || []).length;
  const missingExpected = (evidenceBreakdown?.missingExpectedSkills || []).length;
  const totalGap = provenCount + claimedNotProven + missingExpected;
  const evidenceRatio = totalGap > 0
    ? (provenCount + claimedNotProven * 0.5) / totalGap
    : 0.3;
  const resumeFactor = clamp(resumeInsights?.atsScore || 0) / 100;
  const githubFactor = Math.min(1, (githubData?.repoCount || 0) / 10);
  const integrationFactor = developerSignals?.integrationSignal?.present ? 0.8 : 0.4;
  const jobsFactor = developerSignals?.jobsDemandSignal?.present ? 0.8 : 0.4;
  return clamp(
    (evidenceRatio * 40) + (resumeFactor * 20) + (githubFactor * 20) + (integrationFactor * 10) + (jobsFactor * 10)
  );
};

const saveAIVersionSnapshot = async ({ req, source, output, metadata = {} }) => {
  if (!req.user?._id || !output || typeof output !== 'object') return;
  try {
    await createVersion({
      userId: req.user._id,
      source,
      outputJson: output,
      metadata
    });
  } catch (error) {
    console.error('Skill gap AI snapshot error:', error.message);
  }
};

const loadResumeAnalysis = async (userId) => {
  if (!userId) return null;
  const userContext = await User.findById(userId).select('defaultResumeFileId').lean();
  const defaultResumeFileId = userContext?.defaultResumeFileId || null;
  if (defaultResumeFileId) {
    const activeAnalysis = await ResumeAnalysis.findOne({ userId, fileId: defaultResumeFileId })
      .sort({ analyzedAt: -1 })
      .lean();
    if (activeAnalysis) return activeAnalysis;
  }
  return ResumeAnalysis.findOne({ userId }).sort({ analyzedAt: -1 }).lean();
};

const getGitHubData = async (username) => {
  try {
    return await analyzeGitHubProfile(String(username || '').trim());
  } catch (error) {
    console.warn('Skill gap GitHub fallback:', error.message);
    return {
      repoCount: 0,
      developerLevel: 'Unknown',
      strengths: [],
      weakAreas: [],
      scores: {},
      languageDistribution: [],
      repositories: []
    };
  }
};

const buildGithubInsights = (githubData = {}) => ({
  repoCount: githubData?.repoCount || 0,
  developerLevel: githubData?.developerLevel || '',
  strengths: githubData?.strengths || [],
  weakAreas: githubData?.weakAreas || [],
  languageDistribution: githubData?.languageDistribution || [],
  repositories: githubData?.repositories || [],
  scores: githubData?.scores || {}
});

const getExpectedSkills = (careerStack = 'Full Stack', experienceLevel = 'Student') => uniqueSkillNames([
  ...(STACK_SKILL_HINTS[careerStack] || STACK_SKILL_HINTS['Full Stack']),
  ...(EXPERIENCE_SKILL_HINTS[experienceLevel] || EXPERIENCE_SKILL_HINTS.Student),
  ...DEFAULT_MISSING_SKILLS
]);

const buildGithubSkills = (githubData = {}) => uniqueSkillNames(
  extractSkillsFromRepositories(githubData?.repositories || [], githubData?.languageDistribution || [])
    .concat((githubData?.languageDistribution || []).map((entry) => entry?.language))
).slice(0, 25);

const buildSkillEvidenceBreakdown = ({ resumeInsights, githubData, careerStack, experienceLevel }) => {
  const resumeSkills = uniqueSkillNames(resumeInsights?.technicalSkills || resumeInsights?.skills || []);
  const githubSkills = buildGithubSkills(githubData);
  const githubLookup = new Set(githubSkills.map((skill) => skill.toLowerCase()));
  const resumeLookup = new Set(resumeSkills.map((skill) => skill.toLowerCase()));
  const expectedSkills = getExpectedSkills(careerStack, experienceLevel);

  return {
    resumeSkills,
    githubSkills,
    provenSkills: resumeSkills.filter((skill) => githubLookup.has(skill.toLowerCase())),
    claimedButNotProvenSkills: resumeSkills.filter((skill) => !githubLookup.has(skill.toLowerCase())),
    missingExpectedSkills: expectedSkills.filter((skill) => !resumeLookup.has(skill.toLowerCase()) && !githubLookup.has(skill.toLowerCase()))
  };
};

const emptySignals = {
  careerSprintSignal: { present: false, completedTasks: 0, missedTasks: 0, streak: 0, consistencyScore: 0, activeLearningFocus: '', repeatedIncompleteSkills: [], completedSkillSignals: [], progressPercent: 0, status: 'Unavailable', updatedAt: null },
  weeklyReportSignal: { present: false, weeklyProgressScore: 0, status: 'Unavailable', completedRecommendations: null, missedRecommendations: null, skillsImprovedThisWeek: [], repeatedWeakAreas: [], trendDelta: 0, updatedAt: null },
  portfolioSignal: { present: false, completenessScore: 0, listedProjects: 0, liveLinks: 0, githubLinks: 0, contactVisibility: false, projectPresentationQuality: 0, publicEnabled: false, portfolioSkills: [], updatedAt: null },
  integrationSignal: { present: false, usedProviders: [], integrationScore: 0, strongestProof: [], weakProof: [], detectedSkills: [], certifications: [], updatedAt: null },
  careerProfileSignal: { present: false, careerStack: '', experienceLevel: '', careerGoal: '', githubUsername: '', updatedAt: null },
  jobsDemandSignal: { present: false, sampledJobs: 0, topSkills: [], updatedAt: null }
};

const loadDeveloperSignalsSafely = async ({ userId, username, resumeInsights, githubInsights }) => {
  if (!userId) {
    return {
      developerSignals: emptySignals,
      signalHash: 'no-signals',
      signalsUsed: buildSignalsUsedSummary({ username, resumeInsights, githubInsights, signals: emptySignals })
    };
  }

  try {
    const developerSignals = await getDeveloperSignals(userId);
    return {
      developerSignals,
      signalHash: buildSignalHash(developerSignals),
      signalsUsed: buildSignalsUsedSummary({ username, resumeInsights, githubInsights, signals: developerSignals })
    };
  } catch (error) {
    console.warn('Skill gap signal fallback:', error.message);
    return {
      developerSignals: emptySignals,
      signalHash: 'no-signals',
      signalsUsed: buildSignalsUsedSummary({ username, resumeInsights, githubInsights, signals: emptySignals })
    };
  }
};

const buildEvidenceBuckets = (signals = {}) => {
  const integrationSkills = new Set(uniqueSkillNames(signals.integrationSignal?.detectedSkills || []).map((skill) => skill.toLowerCase()));
  const sprintSkills = new Set(uniqueSkillNames(signals.careerSprintSignal?.completedSkillSignals || []).map((skill) => skill.toLowerCase()));
  const repeatedWeakSkills = new Set([
    ...(signals.careerSprintSignal?.repeatedIncompleteSkills || []),
    ...(signals.weeklyReportSignal?.repeatedWeakAreas || [])
  ].map((skill) => canonicalizeSkillName(skill)).filter(Boolean).map((skill) => skill.toLowerCase()));
  const portfolioSkills = new Set(uniqueSkillNames(signals.portfolioSignal?.portfolioSkills || []).map((skill) => skill.toLowerCase()));

  return {
    integrationSkills,
    sprintSkills,
    repeatedWeakSkills,
    portfolioSkills
  };
};

const buildFallbackSkillGap = ({
  resumeInsights,
  githubInsights,
  developerSignals,
  evidenceBreakdown,
  careerStack,
  experienceLevel
}) => {
  const focusSkills = uniqueSkillNames([
    ...(evidenceBreakdown?.missingExpectedSkills || []),
    ...(evidenceBreakdown?.claimedButNotProvenSkills || []),
    ...(developerSignals.weeklyReportSignal?.repeatedWeakAreas || []),
    ...(developerSignals.careerSprintSignal?.repeatedIncompleteSkills || []),
    ...(developerSignals.integrationSignal?.weakProof || []),
    ...getExpectedSkills(careerStack, experienceLevel)
  ]);

  return {
    analysisSummary: `Primary evidence comes from resume claims, GitHub proof, and supporting progress signals. Missing areas are prioritized where stack expectations are not yet visible in code or the resume still needs stronger coverage.`,
    yourSkills: uniqueSkillNames([
      ...(evidenceBreakdown?.provenSkills || []),
      ...(resumeInsights.skills || []),
      ...(evidenceBreakdown?.githubSkills || [])
    ]).slice(0, 8).map((skill) => ({
      name: skill,
      category: (evidenceBreakdown?.provenSkills || []).some((item) => item.toLowerCase() === skill.toLowerCase())
        ? 'Proven by GitHub'
        : 'Resume Signal',
      proficiency: (evidenceBreakdown?.provenSkills || []).some((item) => item.toLowerCase() === skill.toLowerCase()) ? 72 : 60,
      isFoundational: true,
      source: (evidenceBreakdown?.provenSkills || []).some((item) => item.toLowerCase() === skill.toLowerCase()) ? 'GitHub + Resume' : 'Resume',
      confidenceScore: (evidenceBreakdown?.provenSkills || []).some((item) => item.toLowerCase() === skill.toLowerCase()) ? 78 : 62,
      evidence: [
        (evidenceBreakdown?.provenSkills || []).some((item) => item.toLowerCase() === skill.toLowerCase())
          ? `${skill} appears in both resume analysis and GitHub evidence.`
          : `${skill} appears in the available resume or GitHub signal.`
      ]
    })),
    missingSkills: focusSkills.slice(0, MIN_MISSING_SKILLS).map((skill, index) => ({
      name: skill,
      category: index < 4 ? 'Priority Gap' : 'General',
      priority: index < 4 ? 'High' : index < 8 ? 'Medium' : 'Low',
      jobDemand: clamp(88 - (index * 3)),
      levelRelevance: index < 6 ? 'Current' : 'Next Level',
      source: 'Career Profile',
      confidenceScore: clamp(76 - (index * 2), 45, 86),
      evidence: [`${skill} is a recognized ${careerStack} skill not yet strongly proven for ${experienceLevel} level.`]
    })),
    coverage: clamp((resumeInsights.atsScore * 0.18) + ((githubInsights.repoCount || 0) * 4)),
    missing: 50,
    levelAssessment: 'Your current evidence shows a workable foundation, but several role-relevant gaps still need stronger proof in code, documentation, or consistent practice.',
    roadmap: [],
    totalWeeks: '8 weeks'
  };
};

const applySkillEvidence = ({ yourSkills, missingSkills, signals }) => {
  const evidence = buildEvidenceBuckets(signals);
  const presentSkillNames = new Set();

  const enrichedCurrent = uniqueObjectsByName(
    yourSkills.map((skill) => {
      const lowerName = String(skill.name || '').toLowerCase();
      let proficiency = clamp(skill.proficiency || 0);
      if (evidence.integrationSkills.has(lowerName)) proficiency = clamp(proficiency + 6);
      if (evidence.sprintSkills.has(lowerName)) proficiency = clamp(proficiency + 4);
      if (evidence.portfolioSkills.has(lowerName)) proficiency = clamp(proficiency + 3);
      presentSkillNames.add(lowerName);
      return {
        ...skill,
        proficiency
      };
    })
  );

  const enrichedMissing = uniqueObjectsByName(
    missingSkills
      .filter((skill) => !presentSkillNames.has(String(skill.name || '').toLowerCase()))
      .map((skill) => {
        const lowerName = String(skill.name || '').toLowerCase();
        const repeatedWeak = evidence.repeatedWeakSkills.has(lowerName);
        return {
          ...skill,
          priority: repeatedWeak ? 'High' : skill.priority,
          jobDemand: repeatedWeak ? clamp((skill.jobDemand || 60) + 6) : clamp(skill.jobDemand || 60)
        };
      })
  );

  return {
    yourSkills: enrichedCurrent,
    missingSkills: enrichedMissing
  };
};

const buildDeterministicSkillGroups = ({
  resumeInsights,
  githubData,
  developerSignals,
  evidenceBreakdown,
  careerStack,
  experienceLevel,
  aiKnownSkills = [],
  aiMissingSkills = []
}) => {
  const evidenceMap = new Map();
  const githubRepos = Array.isArray(githubData.repositories) ? githubData.repositories : [];

  (evidenceBreakdown.githubSkills || []).forEach((skill) => {
    const repoNames = githubRepos
      .filter((repo) => {
        const haystack = [repo?.name, repo?.description, repo?.language, ...(repo?.topics || [])].join(' ').toLowerCase();
        return haystack.includes(String(skill).toLowerCase()) || canonicalizeSkillName(repo?.language || '').toLowerCase() === String(skill).toLowerCase();
      })
      .map((repo) => repo.name)
      .filter(Boolean)
      .slice(0, 3);
    addSkillEvidence(
      evidenceMap,
      skill,
      'github',
      repoNames.length ? `Detected in repositories: ${repoNames.join(', ')}` : 'Detected from GitHub language or repository metadata',
      82
    );
  });

  (evidenceBreakdown.resumeSkills || []).forEach((skill) => {
    addSkillEvidence(evidenceMap, skill, 'resume', resumeInsights.fileName ? `Listed in resume ${resumeInsights.fileName}` : 'Listed in resume analysis', 64);
  });

  (developerSignals.portfolioSignal?.portfolioSkills || []).forEach((skill) => {
    addSkillEvidence(evidenceMap, skill, 'portfolio', 'Appears in public portfolio skills or project tech', 58);
  });

  (developerSignals.integrationSignal?.detectedSkills || []).forEach((skill) => {
    addSkillEvidence(evidenceMap, skill, 'integration', 'Detected through connected integration evidence', 66);
  });

  (developerSignals.careerSprintSignal?.completedSkillSignals || []).forEach((skill) => {
    addSkillEvidence(evidenceMap, skill, 'sprint', 'Completed Career Sprint work references this skill', 52);
  });

  (aiKnownSkills || []).forEach((skill) => {
    const name = toSkillName(skill);
    if (!name) return;
    addSkillEvidence(evidenceMap, name, 'expected', 'AI sequencing agreed this is part of the current skill base', 48, {
      aiProficiency: clamp(skill?.proficiency || 0)
    });
  });

  const provenLookup = new Set((evidenceBreakdown.provenSkills || []).map((skill) => skill.toLowerCase()));
  const resumeLookup = new Set((evidenceBreakdown.resumeSkills || []).map((skill) => skill.toLowerCase()));
  const githubLookup = new Set((evidenceBreakdown.githubSkills || []).map((skill) => skill.toLowerCase()));
  const expectedSkills = getExpectedSkills(careerStack, experienceLevel);
  const expectedLookup = new Set(expectedSkills.map((skill) => skill.toLowerCase()));
  const jobsDemandLookup = new Map(
    (developerSignals.jobsDemandSignal?.topSkills || [])
      .map((skill) => [canonicalizeSkillName(skill?.name || '').toLowerCase(), skill])
      .filter(([key]) => key)
  );

  const currentSkillObjects = Array.from(evidenceMap.values())
    .map((entry) => {
      const item = materializeSkillEvidence(entry);
      const isProven = provenLookup.has(item.name.toLowerCase()) || item.source.includes('GitHub');
      const proficiency = clamp(
        entry.aiProficiency
          || (isProven ? 74 : item.source.includes('Resume') ? 62 : 54)
          + Math.min(12, item.evidence.length * 3)
      );
      return {
        ...item,
        proficiency,
        isFoundational: expectedLookup.has(item.name.toLowerCase())
      };
    })
    .sort((a, b) => (b.confidenceScore - a.confidenceScore) || (b.proficiency - a.proficiency) || a.name.localeCompare(b.name));

  const missingMap = new Map();
  const addMissing = (rawName, source, evidence, baseScore = 62, priorityOverride = '') => {
    const meta = getSkillMeta(rawName);
    if (!meta.name || evidenceMap.has(meta.name.toLowerCase())) return;
    if (!isRelevantForStack(meta.name, careerStack)) return;
    addSkillEvidence(missingMap, meta.name, source, evidence, baseScore, {
      priority: priorityOverride || meta.priority,
      jobDemand: jobsDemandLookup.get(meta.name.toLowerCase())?.demandScore || meta.jobDemand
    });
  };

  (evidenceBreakdown.missingExpectedSkills || []).forEach((skill) => {
    addMissing(skill, 'expected', `${skill} is expected for ${careerStack} at ${experienceLevel} level but was not proven in GitHub or resume`, 76, 'High');
  });

  (evidenceBreakdown.claimedButNotProvenSkills || []).forEach((skill) => {
    addMissing(skill, 'resume', `${skill} is claimed in the resume but not visible in GitHub/project proof`, 70, 'High');
  });

  (developerSignals.weeklyReportSignal?.repeatedWeakAreas || []).forEach((skill) => {
    addMissing(skill, 'weekly', 'Repeated weak area in weekly reports', 72, 'High');
  });

  (developerSignals.careerSprintSignal?.repeatedIncompleteSkills || []).forEach((skill) => {
    addMissing(skill, 'sprint', 'Repeated incomplete Career Sprint focus', 68, 'High');
  });

  (developerSignals.integrationSignal?.weakProof || []).forEach((skill) => {
    addMissing(skill, 'integration', 'Connected integration has weak proof for this area', 58, 'Medium');
  });

  (developerSignals.jobsDemandSignal?.topSkills || []).forEach((skill) => {
    const demandName = canonicalizeSkillName(skill?.name || '');
    if (demandName && expectedLookup.has(demandName.toLowerCase())) {
      addMissing(demandName, 'jobs', `High demand in ${developerSignals.jobsDemandSignal.sampledJobs || 0} cached jobs`, 66, 'High');
    }
  });

  (aiMissingSkills || []).forEach((skill) => {
    addMissing(toSkillName(skill), 'expected', 'AI prioritization selected this as a learning candidate', 52, skill?.priority);
  });

  expectedSkills.forEach((skill) => addMissing(skill, 'expected', `Baseline ${careerStack} expectation for ${experienceLevel}`, 55));

  const missingSkillObjects = Array.from(missingMap.values())
    .map((entry) => {
      const item = materializeSkillEvidence(entry);
      const confidenceScore = clamp(item.confidenceScore + (expectedLookup.has(item.name.toLowerCase()) ? 8 : 0));
      const jobDemand = clamp(item.jobDemand || jobsDemandLookup.get(item.name.toLowerCase())?.demandScore || 60);
      return {
        ...item,
        confidenceScore,
        priority: normalizePriority(item.priority, jobDemand, confidenceScore),
        jobDemand,
        levelRelevance: confidenceScore >= 72 ? 'Current' : confidenceScore >= 52 ? 'Next Level' : 'Advanced'
      };
    })
    .sort((a, b) => {
      const priorityRank = { High: 3, Medium: 2, Low: 1 };
      return ((priorityRank[b.priority] || 0) - (priorityRank[a.priority] || 0))
        || (b.jobDemand - a.jobDemand)
        || (b.confidenceScore - a.confidenceScore)
        || a.name.localeCompare(b.name);
    });

  const weakSkills = uniqueObjectsByName([
    ...currentSkillObjects.filter((skill) => skill.confidenceScore < 66 || skill.proficiency < 62),
    ...missingSkillObjects.filter((skill) => skill.priority === 'High').slice(0, 4)
  ]).slice(0, 10);

  const highDemandSkills = uniqueObjectsByName([
    ...missingSkillObjects.filter((skill) => skill.jobDemand >= 78),
    ...(developerSignals.jobsDemandSignal?.topSkills || [])
      .map((skill) => {
        const name = canonicalizeSkillName(skill.name);
        if (!name) return null;
        return {
          name,
          category: getSkillMeta(name).category,
          priority: 'High',
          jobDemand: clamp(skill.demandScore || getSkillMeta(name).jobDemand),
          source: 'Jobs',
          confidenceScore: clamp(58 + Math.min(32, Number(skill.postings || 0) * 2)),
          evidence: [`Appears across ${skill.postings || 0} cached job postings`]
        };
      })
      .filter(Boolean)
  ]).filter((skill) => isRelevantForStack(skill.name, careerStack)).slice(0, 10);

  const maxMissing = Math.max(MIN_MISSING_SKILLS, EXPERIENCE_PRIORITY_LIMITS[experienceLevel] || MIN_MISSING_SKILLS);

  return {
    yourSkills: uniqueObjectsByName(currentSkillObjects).slice(0, 30),
    missingSkills: uniqueObjectsByName(missingSkillObjects).slice(0, maxMissing),
    weakSkills,
    highDemandSkills,
    provenSkills: uniqueSkillNames(evidenceBreakdown.provenSkills || []),
    resumeSkills: uniqueSkillNames(evidenceBreakdown.resumeSkills || []),
    githubSkills: uniqueSkillNames(evidenceBreakdown.githubSkills || []),
    claimedButNotProvenSkills: uniqueSkillNames(evidenceBreakdown.claimedButNotProvenSkills || [])
  };
};

const logSkillGapPipeline = (event, data = {}, level = 'log') => {
  const line = `[SkillGapPipeline] ${JSON.stringify({ event, ...data })}`;
  if (level === 'warn') console.warn(line);
  else if (level === 'error') console.error(line);
  else console.log(line);
};

const createStageTimer = () => {
  const startedAt = Date.now();
  const stages = {};
  return {
    async time(name, fn) {
      const stageStartedAt = Date.now();
      try {
        return await fn();
      } finally {
        stages[name] = Date.now() - stageStartedAt;
      }
    },
    mark(name, stageStartedAt) {
      stages[name] = Date.now() - stageStartedAt;
    },
    snapshot() {
      return { ...stages, totalMs: Date.now() - startedAt };
    }
  };
};

/**
 * @desc Analyze skill gap using the user's global career profile
 * @route POST /api/skillgap/skill-gap
 */
const analyzeSkillGap = async (req, res) => {
  const timer = createStageTimer();
  let usernameForLog = req.body?.username || '';
  try {
    let { username, resumeText } = req.body;
    const forceRefresh = req.body?.forceRefresh === true || req.body?.forceRefresh === 'true';
    const defaultGithubUsername = String(req.user?.githubUsername || '').trim();
    const requestedUsername = String(username || '').trim();
    const isTemporaryMode = req.body?.isTemporary === true
      || req.body?.isTemporary === 'true'
      || Boolean(requestedUsername && defaultGithubUsername && requestedUsername.toLowerCase() !== defaultGithubUsername.toLowerCase());
    username = requestedUsername || defaultGithubUsername;
    usernameForLog = username;

    const careerStack = req.user?.careerStack || req.body.careerStack || 'Full Stack';
    const experienceLevel = req.user?.experienceLevel || req.body.experienceLevel || 'Student';

    if (!username) {
      return res.status(400).json({ message: 'Username is required.' });
    }

    const storedResumePromise = (!resumeText && req.user?._id)
      ? timer.time('storedResumeFetchMs', () => Analysis.findOne({ userId: req.user._id }).select('resumeText').lean())
      : Promise.resolve(null);

    const [githubData, latestResumeAnalysis, storedResumeAnalysis] = await Promise.all([
      timer.time('githubFetchMs', () => getGitHubData(username.trim())),
      timer.time('resumeFetchMs', () => loadResumeAnalysis(req.user?._id || null)),
      storedResumePromise
    ]);
    if (!resumeText && storedResumeAnalysis?.resumeText) {
      resumeText = storedResumeAnalysis.resumeText;
    }

    const cleanResume = String(resumeText || '').trim();
    const resumeInsights = buildResumeAnalysisSignals(latestResumeAnalysis, experienceLevel);
    const githubInsights = buildGithubInsights(githubData);
    const resumeCacheIdentity = buildResumeCacheIdentity({
      resumeText: cleanResume,
      resumeAnalysis: latestResumeAnalysis
    });
    const { developerSignals, signalHash, signalsUsed } = await timer.time('signalAggregationMs', () => loadDeveloperSignalsSafely({
      userId: req.user?._id || null,
      username,
      resumeInsights,
      githubInsights
    }));
    const skillDetectionStartedAt = Date.now();
    const evidenceBreakdown = buildSkillEvidenceBreakdown({
      resumeInsights,
      githubData,
      careerStack,
      experienceLevel
    });
    timer.mark('skillDetectionMs', skillDetectionStartedAt);

    const deterministicConfidence = computeDeterministicConfidence({
      evidenceBreakdown,
      resumeInsights,
      githubData,
      developerSignals
    });
    const skipAI = deterministicConfidence >= DETERMINISTIC_CONFIDENCE_THRESHOLD;

    const cacheKey = {
      githubUsername: username,
      careerStack,
      experienceLevel,
      resumeHash: resumeCacheIdentity.resumeHash,
      resumeAnalysisId: resumeCacheIdentity.resumeAnalysisId,
      signalHash,
      analysisVersion: ANALYSIS_VERSION
    };

    const scopedCacheKey = req.user?._id && !isTemporaryMode
      ? { userId: req.user._id, githubUsername: username, careerStack, experienceLevel, resumeHash: resumeCacheIdentity.resumeHash, resumeAnalysisId: resumeCacheIdentity.resumeAnalysisId, signalHash, analysisVersion: ANALYSIS_VERSION }
      : null;
    const cached = await timer.time('cacheLookupMs', async () => (
      scopedCacheKey && !forceRefresh ? AnalysisCache.findOne(scopedCacheKey).lean() : null
    ));
    if (cached?.analysisData) {
      const cachedResult = {
        ...cached.analysisData,
        analysisBasedOn: buildAnalysisBasedOn({
          username,
          careerStack,
          experienceLevel,
          resumeInsights
        }),
        resumeStatusMessage: cached.analysisData.resumeStatusMessage || resumeInsights.statusMessage,
        fromCache: true,
        aiUsed: Boolean(cached.analysisData.aiUsed),
        deterministicConfidence: cached.analysisData.deterministicConfidence || 0,
        cacheMetadata: {
          ...(cached.analysisData.cacheMetadata || {}),
          loadedFromCache: true,
          cacheKey,
          cachedAt: cached.updatedAt || cached.createdAt || null
        }
      };
      await saveAIVersionSnapshot({
        req,
        source: 'skill_gap',
        output: cachedResult,
        metadata: {
          fromCache: true,
          username,
          careerStack,
          experienceLevel,
          signalHash,
          resumeAnalysisId: resumeCacheIdentity.resumeAnalysisId
        }
      });
      const serializationStartedAt = Date.now();
      const responseSizeBytes = Buffer.byteLength(JSON.stringify(cachedResult), 'utf8');
      timer.mark('responseSerializationMs', serializationStartedAt);
      logSkillGapPipeline('request_complete', {
        username,
        cache: 'backend_hit',
        aiUsed: Boolean(cachedResult.aiUsed),
        deterministicConfidence,
        responseSizeBytes,
        timings: timer.snapshot()
      });
      return res.json(cachedResult);
    }
    logSkillGapPipeline('cache_miss', { username, forceRefresh, cacheEligible: Boolean(scopedCacheKey) });

    // Build deterministic groups first — these always anchor the result.
    const deterministicIdentity = {
      username,
      careerStack,
      experienceLevel,
      resumeHash: resumeCacheIdentity.resumeHash,
      resumeAnalysisId: resumeCacheIdentity.resumeAnalysisId,
      signalHash,
      analysisVersion: ANALYSIS_VERSION
    };
    const deterministicCacheKey = crypto.createHash('sha256').update(JSON.stringify(deterministicIdentity)).digest('hex');
    let deterministicGroups = await aiService.getDeterministicSummary('skill_gap', deterministicIdentity);
    if (deterministicGroups) {
      logSkillGapPipeline('deterministic_summary_cache_hit', { username, cacheKey: deterministicCacheKey.slice(0, 12) });
    } else {
      deterministicGroups = await timer.time('deterministicAnalysisMs', () => buildDeterministicSkillGroups({
        resumeInsights,
        githubData,
        developerSignals,
        evidenceBreakdown,
        careerStack,
        experienceLevel,
        aiKnownSkills: [],
        aiMissingSkills: []
      }));
      await aiService.setDeterministicSummary('skill_gap', deterministicIdentity, deterministicGroups);
      logSkillGapPipeline('deterministic_summary_cache_miss', { username, cacheKey: deterministicCacheKey.slice(0, 12) });
    }

    let aiUsed = false;
    let aiResult = null;

    if (!skipAI) {
      const fallback = buildFallbackSkillGap({
        resumeInsights,
        githubInsights,
        developerSignals,
        evidenceBreakdown,
        careerStack,
        experienceLevel
      });
      const prompt = await timer.time('promptGenerationMs', () => {
        const compactContext = buildSkillGapPromptContext({
          careerStack,
          experienceLevel,
          evidenceBreakdown,
          resumeInsights,
          githubInsights,
          developerSignals,
          deterministicGroups
        });
        const promptText = getSkillGapPrompt(
          careerStack,
          experienceLevel,
          compactContext.detectedSkills,
          compactContext.resume,
          compactContext.github,
          compactContext.signals
        );
        logSkillGapPipeline('prompt_generated', {
          username,
          chars: Buffer.byteLength(promptText, 'utf8'),
          estimatedTokens: estimateTokens(promptText),
          compactContextChars: Buffer.byteLength(JSON.stringify(compactContext), 'utf8')
        });
        return promptText;
      });

      aiResult = await timer.time('aiResponseMs', () => aiService.runAIAnalysis(prompt, {
        yourSkills: fallback.yourSkills,
        missingSkills: fallback.missingSkills,
        coverage: fallback.coverage,
        missing: fallback.missing,
        levelAssessment: fallback.levelAssessment,
        roadmap: fallback.roadmap,
        totalWeeks: fallback.totalWeeks,
        analysisSummary: fallback.analysisSummary
      }));

      aiUsed = aiResult && typeof aiResult === 'object' && aiResult.__fallback !== true;
    } else {
      aiService.recordDeterministicSkip('skill_gap');
      logSkillGapPipeline('ai_skipped', { username, deterministicConfidence, threshold: DETERMINISTIC_CONFIDENCE_THRESHOLD });
      aiResult = {
        __fallback: true,
        yourSkills: [],
        missingSkills: [],
        coverage: 0,
        missing: 0,
        levelAssessment: '',
        roadmap: [],
        totalWeeks: '',
        analysisSummary: ''
      };
    }

    // Merge AI output into deterministic groups.
    // Deterministic evidence always anchors the result; AI adds only where evidence agrees or stack is relevant.

    let yourSkills = [...(deterministicGroups.yourSkills || [])];
    let missingSkills = [...(deterministicGroups.missingSkills || [])];
    let weakSkills = [...(deterministicGroups.weakSkills || [])];
    let highDemandSkills = [...(deterministicGroups.highDemandSkills || [])];

    const existingSkillNames = new Set([
      ...yourSkills.map((skill) => String(skill.name || '').toLowerCase()).filter(Boolean),
      ...missingSkills.map((skill) => String(skill.name || '').toLowerCase()).filter(Boolean)
    ]);

    // Build evidence lookup: which skill names have corroborating signals across the platform
    const evidenceSkillNames = new Set([
      ...uniqueSkillNames([
        ...(evidenceBreakdown.provenSkills || []),
        ...(evidenceBreakdown.githubSkills || []),
        ...(evidenceBreakdown.resumeSkills || []),
        ...(evidenceBreakdown.claimedButNotProvenSkills || []),
        ...(developerSignals.integrationSignal?.detectedSkills || []),
        ...(developerSignals.careerSprintSignal?.completedSkillSignals || []),
        ...(developerSignals.portfolioSignal?.portfolioSkills || []),
        ...(developerSignals.jobsDemandSignal?.topSkills || []).map((value) => value?.name || value),
        ...(developerSignals.weeklyReportSignal?.repeatedWeakAreas || []),
        ...(developerSignals.careerSprintSignal?.repeatedIncompleteSkills || [])
      ]).map((value) => value.toLowerCase())
    ]);

    // Merge AI yourSkills: add only if not already present and has evidence backing
    if (aiUsed && Array.isArray(aiResult.yourSkills)) {
      aiResult.yourSkills.forEach((skill) => {
        const name = toSkillName(skill);
        if (!name || existingSkillNames.has(name.toLowerCase())) return;
        const proficiency = clamp(skill?.proficiency || 50);
        if (proficiency < 35) return;
        const skillLower = name.toLowerCase();
        const hasEvidence = evidenceSkillNames.has(skillLower);
        existingSkillNames.add(name.toLowerCase());
        yourSkills.push({
          name,
          category: skill?.category || 'General',
          proficiency: hasEvidence ? clamp(proficiency + 8) : proficiency,
          isFoundational: Boolean(skill?.isFoundational),
          confidenceScore: hasEvidence ? clamp(proficiency + 12) : clamp(proficiency - 10),
          source: hasEvidence ? 'AI + Evidence' : 'AI',
          evidence: [hasEvidence ? `${name} matched existing GitHub, resume, or platform evidence.` : `${name} was suggested by AI and kept because it is a recognized skill.`]
        });
      });
    }

    // Merge AI missingSkills: add only if not already present AND has evidence or is stack-relevant
    if (aiUsed && Array.isArray(aiResult.missingSkills)) {
      aiResult.missingSkills.forEach((skill) => {
        const name = toSkillName(skill);
        if (!name || existingSkillNames.has(name.toLowerCase())) return;
        const skillLower = name.toLowerCase();
        const hasEvidence = evidenceSkillNames.has(skillLower) || (evidenceBreakdown.missingExpectedSkills || []).some(
          (expected) => String(expected).toLowerCase() === skillLower
        );
        const isStackRelevant = isRelevantForStack(name, careerStack);
        if (!hasEvidence && !isStackRelevant) return;
        existingSkillNames.add(name.toLowerCase());
        missingSkills.push({
          name,
          category: skill?.category || 'General',
          priority: hasEvidence ? (skill?.priority || 'Medium') : 'Low',
          jobDemand: clamp(skill?.jobDemand || 60),
          levelRelevance: skill?.levelRelevance || 'Current',
          confidenceScore: hasEvidence ? clamp((skill?.jobDemand || 60) + 10) : 40,
          source: hasEvidence ? 'AI + Evidence' : 'AI (stack-relevant)',
          evidence: [
            hasEvidence
              ? `${name} is missing from stronger proof signals and was reinforced by AI prioritization.`
              : `${name} is a recognized ${careerStack} skill relevant to the selected career profile.`
          ]
        });
      });
    }

    // Apply evidence adjustments to enrich proficiency and priority
    const evidenceAdjusted = applySkillEvidence({
      yourSkills,
      missingSkills,
      signals: developerSignals
    });
    yourSkills = evidenceAdjusted.yourSkills;
    missingSkills = evidenceAdjusted.missingSkills;

    // Ensure minimum counts with stack-aligned fallback
    const detectedKnown = uniqueSkillNames([
      ...evidenceBreakdown.provenSkills,
      ...resumeInsights.skills,
      ...evidenceBreakdown.githubSkills,
      ...(githubData.repositories || []).map((repo) => repo.language || '').filter(Boolean),
      ...(developerSignals.integrationSignal?.detectedSkills || []),
      ...(developerSignals.careerSprintSignal?.completedSkillSignals || []),
      ...(developerSignals.portfolioSignal?.portfolioSkills || [])
    ]);

    while (yourSkills.length < MIN_KNOWN_SKILLS && detectedKnown[yourSkills.length]) {
      const skillName = detectedKnown[yourSkills.length];
      if (!existingSkillNames.has(skillName.toLowerCase())) {
        existingSkillNames.add(skillName.toLowerCase());
        yourSkills.push({
          name: skillName,
          category: 'General',
          proficiency: 60,
          isFoundational: true,
          confidenceScore: 60,
          source: 'Evidence fallback',
          evidence: [`${skillName} was detected in available GitHub, resume, integration, sprint, or portfolio signals.`]
        });
      }
    }

    const stackFilteredExpected = getExpectedSkills(careerStack, experienceLevel);
    const existingMissing = new Set(missingSkills.map((skill) => String(skill.name || '').toLowerCase()));
    for (const fallbackSkill of stackFilteredExpected) {
      if (missingSkills.length >= MIN_MISSING_SKILLS) break;
      const lower = fallbackSkill.toLowerCase();
      if (existingMissing.has(lower) || existingSkillNames.has(lower)) continue;
      if (!isRelevantForStack(fallbackSkill, careerStack)) continue;
      existingMissing.add(lower);
      existingSkillNames.add(lower);
      missingSkills.push({
        name: fallbackSkill,
        category: getSkillMeta(fallbackSkill).category || 'General',
        priority: 'Medium',
        jobDemand: clamp(getSkillMeta(fallbackSkill).jobDemand || 65),
        levelRelevance: 'Current',
        confidenceScore: 56,
        source: 'Stack expectation',
        evidence: [`${fallbackSkill} is a baseline ${careerStack} expectation for ${experienceLevel} level.`]
      });
    }

    yourSkills = cleanSkillObjects(yourSkills, 'current', careerStack, experienceLevel);
    missingSkills = cleanSkillObjects(missingSkills, 'missing', careerStack, experienceLevel);
    weakSkills = cleanSkillObjects(weakSkills, 'missing', careerStack, experienceLevel).slice(0, 10);
    highDemandSkills = cleanSkillObjects(highDemandSkills, 'missing', careerStack, experienceLevel).slice(0, 10);

    // Sort: yourSkills by proficiency + confidence, missingSkills by priority then jobDemand
    yourSkills.sort((a, b) => (clamp(b.proficiency || 0) + clamp(b.confidenceScore || 0)) - (clamp(a.proficiency || 0) + clamp(a.confidenceScore || 0)));
    const priorityRank = { High: 3, Medium: 2, Low: 1 };
    missingSkills.sort((a, b) => (priorityRank[b.priority] || 0) - (priorityRank[a.priority] || 0) || clamp(b.jobDemand || 0) - clamp(a.jobDemand || 0));

    const knownCount = yourSkills.length;
    const missingCount = missingSkills.length;
    const avgProficiency = knownCount > 0
      ? Math.round(yourSkills.reduce((sum, skill) => sum + clamp(skill.proficiency || 0), 0) / knownCount)
      : 0;
    const balanceFactor = (knownCount + missingCount) > 0 ? (knownCount / (knownCount + missingCount)) : 0;
    const proficiencyFactor = avgProficiency / 100;
    const resumeFactorVal = clamp(resumeInsights.atsScore || 0) / 100;
    const aiCoverage = clamp((aiResult && aiUsed) ? (aiResult.coverage || 0) : 0);
    const integrationFactor = clamp(developerSignals.integrationSignal?.integrationScore || 0) / 100;

    const computedCoverage = Math.round(((balanceFactor * 0.57) + (proficiencyFactor * 0.23) + (resumeFactorVal * 0.1) + (integrationFactor * 0.1)) * 100);
    const aiWeight = aiUsed ? 0.06 : 0;
    const deterministicWeight = 1 - aiWeight;
    const blendedCoverage = Math.round((computedCoverage * deterministicWeight) + (aiCoverage * aiWeight));
    const coverage = clamp(blendedCoverage);
    const missing = clamp(100 - coverage);
    const coverageBreakdown = {
      knownSkillCount: knownCount,
      missingSkillCount: missingCount,
      averageProficiency: avgProficiency,
      balanceFactor: clamp(balanceFactor * 100),
      resumeFactor: clamp(resumeFactorVal * 100),
      integrationFactor: clamp(integrationFactor * 100),
      deterministicConfidence,
      aiUsed,
      formula: aiUsed
        ? 'coverage = known/missing balance 57% + proficiency 23% + resume 10% + integrations 10%, with 6% AI smoothing'
        : 'coverage = known/missing balance 60% + proficiency 24% + resume 11% + integrations 11% (deterministic only, AI skipped)'
    };

    const fallback = buildFallbackSkillGap({
      resumeInsights,
      githubInsights,
      developerSignals,
      evidenceBreakdown,
      careerStack,
      experienceLevel
    });

    const fullResult = {
      username,
      careerStack,
      experienceLevel,
      analysisSummary: String((aiUsed && aiResult?.analysisSummary) || fallback.analysisSummary || '').trim(),
      aiUsed,
      deterministicConfidence,
      skipAI,
      yourSkills,
      missingSkills,
      resumeSkills: deterministicGroups.resumeSkills,
      githubSkills: deterministicGroups.githubSkills,
      provenSkills: deterministicGroups.provenSkills,
      claimedButNotProvenSkills: deterministicGroups.claimedButNotProvenSkills,
      weakSkills,
      highDemandSkills,
      coverage,
      missing,
      coverageBreakdown,
      levelAssessment: String((aiUsed && aiResult?.levelAssessment) || fallback.levelAssessment || '').trim(),
      roadmap: normalizeRoadmap((aiUsed && aiResult?.roadmap) || fallback.roadmap, 3),
      totalWeeks: String((aiUsed && aiResult?.totalWeeks) || fallback.totalWeeks || '8 weeks').trim(),
      resumeInsights,
      githubStats: githubData,
      signalsUsed,
      analysisBasedOn: buildAnalysisBasedOn({
        username,
        careerStack,
        experienceLevel,
        resumeInsights
      }),
      resumeStatusMessage: resumeInsights.statusMessage,
      cacheMetadata: {
        loadedFromCache: false,
        cacheKey,
        signalHash,
        analysisVersion: ANALYSIS_VERSION,
        temporary: isTemporaryMode
      }
    };

    const skillGraph = buildSkillGraph({
      currentSkills: fullResult.yourSkills,
      missingSkills: fullResult.missingSkills
    });

    fullResult.skillGraph = skillGraph;
    fullResult.weeklyRoadmap = generateWeeklyLearningRoadmap(skillGraph, 8);
    const roadmapBuckets = buildRoadmapBuckets({
      missingSkills: fullResult.missingSkills,
      weakSkills: fullResult.weakSkills,
      weeklyRoadmap: fullResult.weeklyRoadmap
    });
    fullResult.immediateSkills = roadmapBuckets.immediateSkills;
    fullResult.shortTermSkills = roadmapBuckets.shortTermSkills;
    fullResult.midTermSkills = roadmapBuckets.midTermSkills;
    fullResult.longTermSkills = roadmapBuckets.longTermSkills;
    fullResult.prerequisites = roadmapBuckets.prerequisites;
    fullResult.estimatedWeeks = roadmapBuckets.estimatedWeeks;
    fullResult.suggestedProjects = buildSuggestedProjects(fullResult.immediateSkills, careerStack);
    fullResult.skillGapSignals = {
      version: ANALYSIS_VERSION,
      generatedAt: new Date().toISOString(),
      githubUsername: username,
      careerStack,
      experienceLevel,
      coverage,
      coverageBreakdown,
      provenSkills: fullResult.provenSkills,
      resumeSkills: fullResult.resumeSkills,
      claimedButNotProvenSkills: fullResult.claimedButNotProvenSkills,
      missingSkills: fullResult.missingSkills.map((skill) => ({
        name: skill.name,
        priority: skill.priority,
        confidenceScore: skill.confidenceScore,
        category: skill.category,
        jobDemand: skill.jobDemand,
        evidence: skill.evidence || []
      })),
      weakSkills: fullResult.weakSkills.map((skill) => ({
        name: skill.name,
        priority: skill.priority,
        confidenceScore: skill.confidenceScore,
        category: skill.category
      })),
      highDemandSkills: fullResult.highDemandSkills.map((skill) => ({
        name: skill.name,
        jobDemand: skill.jobDemand,
        priority: skill.priority,
        evidence: skill.evidence || []
      })),
      immediateSkills: fullResult.immediateSkills.map((skill) => skill.name),
      shortTermSkills: fullResult.shortTermSkills.map((skill) => skill.name),
      signalHash
    };

    if (scopedCacheKey) {
      await timer.time('cacheWriteMs', () => AnalysisCache.findOneAndUpdate(
        scopedCacheKey,
        { $set: { analysisData: fullResult, userId: req.user._id } },
        { upsert: true }
      ));
    }

    await saveAIVersionSnapshot({
      req,
      source: 'skill_gap',
      output: fullResult,
      metadata: {
        fromCache: false,
        username,
        careerStack,
        experienceLevel,
        signalHash,
        resumeAnalysisId: resumeCacheIdentity.resumeAnalysisId
      }
    });

    const serializationStartedAt = Date.now();
    const responseSizeBytes = Buffer.byteLength(JSON.stringify(fullResult), 'utf8');
    timer.mark('responseSerializationMs', serializationStartedAt);
    logSkillGapPipeline('request_complete', {
      username,
      cache: scopedCacheKey ? 'backend_stored' : 'temporary_no_backend_cache',
      aiUsed,
      skipAI,
      deterministicConfidence,
      responseSizeBytes,
      timings: timer.snapshot()
    });

    return res.json(fullResult);
  } catch (error) {
    console.error('Skill Gap Error:', { message: error.message, username: usernameForLog || req.body?.username, timings: timer.snapshot() });
    return res.status(500).json({
      message: 'Analysis failed. GitHub profile may be private or AI is overloaded. Try again in 30 seconds.',
      error: error.message
    });
  }
};

module.exports = { analyzeSkillGap };
