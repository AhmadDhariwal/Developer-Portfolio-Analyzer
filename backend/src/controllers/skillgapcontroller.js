const { analyzeGitHubProfile } = require('../services/githubservice');
const aiService = require('../services/aiservice');
const { getSkillGapPrompt } = require('../prompts/skillGapPrompt');
const AnalysisCache = require('../models/analysisCache');
const ResumeAnalysis = require('../models/resumeAnalysis');
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
const { extractSkillsFromRepositories, canonicalizeSkillName, INDUSTRY_SKILLS } = require('../utils/skilldetector');

const ANALYSIS_VERSION = 'v5-skill-intelligence';
const MIN_MISSING_SKILLS = 12;
const MIN_KNOWN_SKILLS = 8;

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
      skills: ['Core language fundamentals', 'Git workflows'],
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
      skills: ['Build one production-like project', 'Add tests and CI'],
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
      skills: ['System design practice', 'Behavioral storytelling'],
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
    const phaseSkills = Array.isArray(phase.skills) ? phase.skills.map(String).map((value) => value.trim()).filter(Boolean) : [];
    const firstSkill = phaseSkills[0] || 'software engineering';
    const resources = Array.isArray(phase.resources)
      ? phase.resources.map((resource) => normalizeRoadmapResource(resource, firstSkill))
      : [];

    return {
      phase: String(phase.phase || `Phase ${index + 1}`).trim(),
      title: String(phase.title || `Milestone ${index + 1}`).trim(),
      description: String(phase.description || 'Complete focused practice for this milestone.').trim(),
      duration: String(phase.duration || '2-3 weeks').trim(),
      skills: phaseSkills,
      resources: resources.length ? resources : [normalizeRoadmapResource(firstSkill, firstSkill)],
      color: ['purple', 'blue', 'green', 'orange'].includes(String(phase.color || '').trim())
        ? String(phase.color).trim()
        : defaults[index % defaults.length].color
    };
  });
};

const toSkillName = (value) => (typeof value === 'string' ? value : value?.name || '').trim();

const uniqueByLower = (values = []) => {
  const seen = new Set();
  return values.filter((value) => {
    const key = String(value || '').trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

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

const buildSuggestedProjects = (skills = [], careerStack = 'Full Stack') => skills.slice(0, 5).map((skill, index) => {
  const name = toSkillName(skill);
  return {
    title: `${careerStack} ${name} proof project`,
    skill: name,
    difficulty: index < 2 ? 'Intermediate' : 'Focused',
    estimatedWeeks: index < 2 ? 2 : 1,
    outcome: `Ship a small, reviewable feature that proves ${name} with tests or deployment notes.`
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

const getExpectedSkills = (careerStack = 'Full Stack', experienceLevel = 'Student') => uniqueByLower([
  ...(STACK_SKILL_HINTS[careerStack] || STACK_SKILL_HINTS['Full Stack']),
  ...(EXPERIENCE_SKILL_HINTS[experienceLevel] || EXPERIENCE_SKILL_HINTS.Student),
  ...DEFAULT_MISSING_SKILLS
]).map((skill) => canonicalizeSkillName(skill)).filter(Boolean);

const buildGithubSkills = (githubData = {}) => uniqueByLower(
  extractSkillsFromRepositories(githubData?.repositories || [], githubData?.languageDistribution || [])
    .concat((githubData?.languageDistribution || []).map((entry) => entry?.language))
    .map((skill) => canonicalizeSkillName(skill))
    .filter(Boolean)
).slice(0, 25);

const buildSkillEvidenceBreakdown = ({ resumeInsights, githubData, careerStack, experienceLevel }) => {
  const resumeSkills = uniqueByLower((resumeInsights?.technicalSkills || resumeInsights?.skills || []).map((skill) => canonicalizeSkillName(skill)).filter(Boolean));
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
  const integrationSkills = new Set((signals.integrationSignal?.detectedSkills || []).map((skill) => String(skill).toLowerCase()));
  const sprintSkills = new Set((signals.careerSprintSignal?.completedSkillSignals || []).map((skill) => String(skill).toLowerCase()));
  const repeatedWeakSkills = new Set([
    ...(signals.careerSprintSignal?.repeatedIncompleteSkills || []),
    ...(signals.weeklyReportSignal?.repeatedWeakAreas || [])
  ].map((skill) => String(skill).toLowerCase()));
  const portfolioSkills = new Set((signals.portfolioSignal?.portfolioSkills || []).map((skill) => String(skill).toLowerCase()));

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
  const focusSkills = uniqueByLower([
    ...(evidenceBreakdown?.missingExpectedSkills || []),
    ...(evidenceBreakdown?.claimedButNotProvenSkills || []),
    ...(developerSignals.weeklyReportSignal?.repeatedWeakAreas || []),
    ...(developerSignals.careerSprintSignal?.repeatedIncompleteSkills || []),
    ...(developerSignals.integrationSignal?.weakProof || []),
    ...getExpectedSkills(careerStack, experienceLevel)
  ]);

  return {
    analysisSummary: `Primary evidence comes from resume claims, GitHub proof, and supporting progress signals. Missing areas are prioritized where stack expectations are not yet visible in code or the resume still needs stronger coverage.`,
    yourSkills: uniqueByLower([
      ...(evidenceBreakdown?.provenSkills || []),
      ...(resumeInsights.skills || []),
      ...(evidenceBreakdown?.githubSkills || [])
    ]).slice(0, 8).map((skill) => ({
      name: skill,
      category: (evidenceBreakdown?.provenSkills || []).some((item) => item.toLowerCase() === skill.toLowerCase())
        ? 'Proven by GitHub'
        : 'Resume Signal',
      proficiency: (evidenceBreakdown?.provenSkills || []).some((item) => item.toLowerCase() === skill.toLowerCase()) ? 72 : 60,
      isFoundational: true
    })),
    missingSkills: focusSkills.slice(0, MIN_MISSING_SKILLS).map((skill, index) => ({
      name: skill,
      category: index < 4 ? 'Priority Gap' : 'General',
      priority: index < 4 ? 'High' : index < 8 ? 'Medium' : 'Low',
      jobDemand: clamp(88 - (index * 3)),
      levelRelevance: index < 6 ? 'Current' : 'Next Level'
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
      .map((skill) => [String(skill?.name || '').toLowerCase(), skill])
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
    if (expectedLookup.has(String(skill?.name || '').toLowerCase())) {
      addMissing(skill.name, 'jobs', `High demand in ${developerSignals.jobsDemandSignal.sampledJobs || 0} cached jobs`, 66, 'High');
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
    ...(developerSignals.jobsDemandSignal?.topSkills || []).map((skill) => ({
      name: canonicalizeSkillName(skill.name),
      category: getSkillMeta(skill.name).category,
      priority: 'High',
      jobDemand: clamp(skill.demandScore || getSkillMeta(skill.name).jobDemand),
      source: 'Jobs',
      confidenceScore: clamp(58 + Math.min(32, Number(skill.postings || 0) * 2)),
      evidence: [`Appears across ${skill.postings || 0} cached job postings`]
    }))
  ]).filter((skill) => isRelevantForStack(skill.name, careerStack)).slice(0, 10);

  const maxMissing = Math.max(MIN_MISSING_SKILLS, EXPERIENCE_PRIORITY_LIMITS[experienceLevel] || MIN_MISSING_SKILLS);

  return {
    yourSkills: uniqueObjectsByName(currentSkillObjects).slice(0, 30),
    missingSkills: uniqueObjectsByName(missingSkillObjects).slice(0, maxMissing),
    weakSkills,
    highDemandSkills,
    provenSkills: uniqueByLower(evidenceBreakdown.provenSkills || []),
    resumeSkills: uniqueByLower(evidenceBreakdown.resumeSkills || []),
    githubSkills: uniqueByLower(evidenceBreakdown.githubSkills || []),
    claimedButNotProvenSkills: uniqueByLower(evidenceBreakdown.claimedButNotProvenSkills || [])
  };
};

/**
 * @desc Analyze skill gap using the user's global career profile
 * @route POST /api/skillgap/skill-gap
 */
const analyzeSkillGap = async (req, res) => {
  try {
    let { username, resumeText } = req.body;
    const forceRefresh = req.body?.forceRefresh === true || req.body?.forceRefresh === 'true';
    const defaultGithubUsername = String(req.user?.githubUsername || '').trim();
    const requestedUsername = String(username || '').trim();
    const isTemporaryMode = req.body?.isTemporary === true
      || req.body?.isTemporary === 'true'
      || Boolean(requestedUsername && defaultGithubUsername && requestedUsername.toLowerCase() !== defaultGithubUsername.toLowerCase());
    username = requestedUsername || defaultGithubUsername;

    const careerStack = req.user?.careerStack || req.body.careerStack || 'Full Stack';
    const experienceLevel = req.user?.experienceLevel || req.body.experienceLevel || 'Student';

    if (!username) {
      return res.status(400).json({ message: 'Username is required.' });
    }

    if (!resumeText && req.user?._id) {
      const Analysis = require('../models/analysis');
      const analysis = await Analysis.findOne({ userId: req.user._id }).lean();
      resumeText = analysis?.resumeText || '';
    }

    const [githubData, latestResumeAnalysis] = await Promise.all([
      getGitHubData(username.trim()),
      loadResumeAnalysis(req.user?._id || null)
    ]);

    const cleanResume = String(resumeText || '').trim();
    const resumeInsights = buildResumeAnalysisSignals(latestResumeAnalysis, experienceLevel);
    const githubInsights = buildGithubInsights(githubData);
    const resumeCacheIdentity = buildResumeCacheIdentity({
      resumeText: cleanResume,
      resumeAnalysis: latestResumeAnalysis
    });
    const { developerSignals, signalHash, signalsUsed } = await loadDeveloperSignalsSafely({
      userId: req.user?._id || null,
      username,
      resumeInsights,
      githubInsights
    });
    const evidenceBreakdown = buildSkillEvidenceBreakdown({
      resumeInsights,
      githubData,
      careerStack,
      experienceLevel
    });

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
      ? { ...cacheKey, userId: req.user._id }
      : null;
    const cached = scopedCacheKey && !forceRefresh ? await AnalysisCache.findOne(scopedCacheKey).lean() : null;
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
      return res.json(cachedResult);
    }

    const detectedSkills = {
      github: uniqueByLower([
        ...evidenceBreakdown.githubSkills,
        ...resumeInsights.skills.slice(0, 12),
        ...(developerSignals.integrationSignal?.detectedSkills || []).slice(0, 10)
      ]),
      repoQuality: githubData.scores || {},
      evidenceSummary: {
        repoCount: githubData.repoCount || 0,
        topLanguages: (githubData.languageDistribution || []).slice(0, 8),
        provenSkills: evidenceBreakdown.provenSkills,
        claimedButNotProvenSkills: evidenceBreakdown.claimedButNotProvenSkills,
        highDemandSkills: (developerSignals.jobsDemandSignal?.topSkills || []).slice(0, 10)
      }
    };

    const fallback = buildFallbackSkillGap({
      resumeInsights,
      githubInsights,
      developerSignals,
      evidenceBreakdown,
      careerStack,
      experienceLevel
    });
    const prompt = getSkillGapPrompt(
      careerStack,
      experienceLevel,
      detectedSkills,
      resumeInsights,
      {
        repoCount: githubInsights.repoCount,
        developerLevel: githubInsights.developerLevel,
        strengths: (githubInsights.strengths || []).slice(0, 8),
        weakAreas: (githubInsights.weakAreas || []).slice(0, 8),
        languageDistribution: (githubInsights.languageDistribution || []).slice(0, 8),
        scores: githubInsights.scores || {}
      },
      developerSignals
    );

    const aiResult = await aiService.runAIAnalysis(prompt, {
      yourSkills: fallback.yourSkills,
      missingSkills: fallback.missingSkills,
      coverage: fallback.coverage,
      missing: fallback.missing,
      levelAssessment: fallback.levelAssessment,
      roadmap: fallback.roadmap,
      totalWeeks: fallback.totalWeeks,
      analysisSummary: fallback.analysisSummary
    });

    let yourSkills = (Array.isArray(aiResult.yourSkills) ? aiResult.yourSkills : [])
      .map((skill) => ({
        name: toSkillName(skill),
        category: skill?.category || 'General',
        proficiency: clamp(skill?.proficiency || 50),
        isFoundational: Boolean(skill?.isFoundational)
      }))
      .filter((skill) => skill.name);

    const detectedKnown = uniqueByLower([
      ...evidenceBreakdown.provenSkills,
      ...resumeInsights.skills,
      ...evidenceBreakdown.githubSkills,
      ...(githubData.repositories || []).map((repo) => repo.language || '').filter(Boolean),
      ...(developerSignals.integrationSignal?.detectedSkills || []),
      ...(developerSignals.careerSprintSignal?.completedSkillSignals || []),
      ...(developerSignals.portfolioSignal?.portfolioSkills || [])
    ]);

    while (yourSkills.length < MIN_KNOWN_SKILLS && detectedKnown[yourSkills.length]) {
      yourSkills.push({
        name: detectedKnown[yourSkills.length],
        category: 'General',
        proficiency: 60,
        isFoundational: true
      });
    }

    let missingSkills = (Array.isArray(aiResult.missingSkills) ? aiResult.missingSkills : [])
      .map((skill) => ({
        name: toSkillName(skill),
        category: skill?.category || 'General',
        priority: skill?.priority || 'Medium',
        jobDemand: clamp(skill?.jobDemand || 60),
        levelRelevance: skill?.levelRelevance || 'Current'
      }))
      .filter((skill) => skill.name);

    const derivedGapCandidates = uniqueByLower([
      ...evidenceBreakdown.missingExpectedSkills,
      ...evidenceBreakdown.claimedButNotProvenSkills,
      ...missingSkills.map((skill) => skill.name),
      ...(githubInsights.weakAreas || []),
      ...(developerSignals.weeklyReportSignal?.repeatedWeakAreas || []),
      ...(developerSignals.careerSprintSignal?.repeatedIncompleteSkills || []),
      ...(developerSignals.integrationSignal?.weakProof || []),
      ...getExpectedSkills(careerStack, experienceLevel)
    ]);
    const existingMissing = new Set(missingSkills.map((skill) => skill.name.toLowerCase()));
    for (const fallbackSkill of derivedGapCandidates) {
      if (missingSkills.length >= MIN_MISSING_SKILLS) break;
      if (existingMissing.has(fallbackSkill.toLowerCase())) continue;
      missingSkills.push({
        name: fallbackSkill,
        category: 'General',
        priority: 'Medium',
        jobDemand: 70,
        levelRelevance: 'Current'
      });
      existingMissing.add(fallbackSkill.toLowerCase());
    }

    const evidenceAdjusted = applySkillEvidence({
      yourSkills,
      missingSkills,
      signals: developerSignals
    });

    yourSkills = evidenceAdjusted.yourSkills;
    missingSkills = evidenceAdjusted.missingSkills;

    const deterministicGroups = buildDeterministicSkillGroups({
      resumeInsights,
      githubData,
      developerSignals,
      evidenceBreakdown,
      careerStack,
      experienceLevel,
      aiKnownSkills: yourSkills,
      aiMissingSkills: missingSkills
    });

    yourSkills = deterministicGroups.yourSkills.length ? deterministicGroups.yourSkills : yourSkills;
    missingSkills = deterministicGroups.missingSkills.length ? deterministicGroups.missingSkills : missingSkills;
    const weakSkills = deterministicGroups.weakSkills || [];
    const highDemandSkills = deterministicGroups.highDemandSkills || [];

    const knownCount = yourSkills.length;
    const missingCount = missingSkills.length;
    const avgProficiency = knownCount > 0
      ? Math.round(yourSkills.reduce((sum, skill) => sum + clamp(skill.proficiency || 0), 0) / knownCount)
      : 0;
    const balanceFactor = (knownCount + missingCount) > 0 ? (knownCount / (knownCount + missingCount)) : 0;
    const proficiencyFactor = avgProficiency / 100;
    const resumeFactor = clamp(resumeInsights.atsScore || 0) / 100;
    const aiCoverage = clamp(aiResult.coverage || 0);
    const integrationFactor = clamp(developerSignals.integrationSignal?.integrationScore || 0) / 100;

    const computedCoverage = Math.round(((balanceFactor * 0.57) + (proficiencyFactor * 0.23) + (resumeFactor * 0.1) + (integrationFactor * 0.1)) * 100);
    const blendedCoverage = Math.round((computedCoverage * 0.94) + (aiCoverage * 0.06));
    const coverage = clamp(blendedCoverage);
    const missing = clamp(100 - coverage);
    const coverageBreakdown = {
      knownSkillCount: knownCount,
      missingSkillCount: missingCount,
      averageProficiency: avgProficiency,
      balanceFactor: clamp(balanceFactor * 100),
      resumeFactor: clamp(resumeFactor * 100),
      integrationFactor: clamp(integrationFactor * 100),
      formula: 'coverage = known/missing balance 57% + proficiency 23% + resume 10% + integrations 10%, with 6% AI smoothing'
    };

    const fullResult = {
      username,
      careerStack,
      experienceLevel,
      analysisSummary: String(aiResult.analysisSummary || fallback.analysisSummary || '').trim(),
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
      levelAssessment: String(aiResult.levelAssessment || fallback.levelAssessment || '').trim(),
      roadmap: normalizeRoadmap(aiResult.roadmap, 3),
      totalWeeks: String(aiResult.totalWeeks || fallback.totalWeeks || '8 weeks').trim(),
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
      await AnalysisCache.findOneAndUpdate(
        scopedCacheKey,
        { $set: { analysisData: fullResult, userId: req.user._id } },
        { upsert: true }
      );
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

    return res.json(fullResult);
  } catch (error) {
    console.error('Skill Gap Error:', { message: error.message, username: req.body?.username });
    return res.status(500).json({
      message: 'Analysis failed. GitHub profile may be private or AI is overloaded. Try again in 30 seconds.',
      error: error.message
    });
  }
};

module.exports = { analyzeSkillGap };
