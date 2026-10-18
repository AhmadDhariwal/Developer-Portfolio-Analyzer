const {
  resolveRecommendationEnrichment,
  mergeNarrativeEnrichment,
  isUsableRecommendationNarrative,
  hasRecommendationFactPollution,
} = require('./recommendationNarrativeService');
const {
  uniqueBy,
  uniqueStrings,
  normalizeActionList,
} = require('../utils/recommendationUtilities');
const developerContext = require('../services/developerContextService');
const engine = require('../services/recommendationEngineService');
const generation = require('../services/recommendationGenerationService');
const crypto = require('node:crypto');
const aiService = require('../services/aiservice');
const { createNotification } = require('../services/notificationService');
const { getRecommendationPrompt } = require('../prompts/recommendationPrompt');
const AnalysisCache = require('../models/analysisCache');
const ResumeAnalysis = require('../models/resumeAnalysis');
const GitHubAnalysisCache = require('../models/githubAnalysisCache');
const User = require('../models/user');
const Recommendation = require('../models/recommendation');
const { createVersion } = require('../services/aiVersionService');
const {
  getDeveloperSignals,
  buildSignalHash,
  buildSignalsUsedSummary,
  buildResumeAnalysisSignals,
  buildResumeCacheIdentity,
  buildAnalysisBasedOn,
  getPublicJobMarketSignal,
} = require('../services/developerSignalService');
const { resolvePreviewResume } = require('../services/previewResumeCacheService');

const RECOMMENDATION_ANALYSIS_VERSION = 'v6-recommendations-evidence';
const RECOMMENDATION_TTL_MS = 24 * 60 * 60 * 1000;
const ALLOWED_STACKS = ['Frontend', 'Backend', 'Full Stack', 'AI/ML'];
const ALLOWED_LEVELS = [
  'Student',
  'Intern',
  '0-1 years',
  '1-2 years',
  '2-3 years',
  '3-5 years',
  '5+ years',
];
const RECOMMENDATION_MEMORY_TTL_MS = Math.min(
  5 * 60 * 1000,
  Math.max(
    15_000,
    Number.parseInt(process.env.RECOMMENDATIONS_MEMORY_TTL_MS || '60000', 10) || 60_000,
  ),
);
const RECOMMENDATION_REDIS_LOOKUP_BUDGET_MS = Math.min(
  250,
  Math.max(
    40,
    Number.parseInt(process.env.RECOMMENDATIONS_REDIS_LOOKUP_BUDGET_MS || '120', 10) || 120,
  ),
);
const RECOMMENDATION_REDIS_TTL_SECONDS = Math.min(
  3600,
  Math.max(60, Number.parseInt(process.env.RECOMMENDATIONS_REDIS_TTL_SECONDS || '900', 10) || 900),
);
const STAGE_TIMINGS_ENABLED =
  process.env.NODE_ENV !== 'production' ||
  process.env.RECOMMENDATIONS_STAGE_TIMINGS === 'true' ||
  process.env.NODE_ENV === 'test';
const EMPTY_STAGE_TIMINGS = Object.freeze({
  validation: 0,
  cache: 0,
  Redis: 0,
  Mongo: 0,
  'external provider': 0,
  AI: 0,
  'deterministic processing': 0,
  persistence: 0,
  total: 0,
});
const createStageTimer = () => {
  const startedAt = process.hrtime.bigint();
  const stages = { ...EMPTY_STAGE_TIMINGS };
  return {
    async measure(name, work) {
      const stageStartedAt = process.hrtime.bigint();
      const value = await work();
      const elapsed = Number(process.hrtime.bigint() - stageStartedAt) / 1e6;
      stages[name] = Number(((Number(stages[name]) || 0) + elapsed).toFixed(4));
      return value;
    },
    mark(name, started) {
      const elapsed = Number(process.hrtime.bigint() - started) / 1e6;
      stages[name] = Number(((Number(stages[name]) || 0) + elapsed).toFixed(4));
    },
    attach(result) {
      if (!STAGE_TIMINGS_ENABLED || !result || typeof result !== 'object') return result;
      const total = Number(process.hrtime.bigint() - startedAt) / 1e6;
      return {
        ...result,
        cacheMetadata: {
          ...(result.cacheMetadata || {}),
          stageTimingsMs: { ...stages, total: Number(total.toFixed(4)) },
          requestCounters: { ...recommendationRuntimeCounters },
        },
      };
    },
  };
};
const recommendationInflight = new Map();
const recommendationMemoryCache = new Map();
const recommendationGithubSources = new Map();
const recommendationRuntimeCounters = {
  pipelineExecutions: 0,
  githubCalls: 0,
  aiCalls: 0,
  persistenceOperations: 0,
  memoryHits: 0,
  redisHits: 0,
  mongoHits: 0,
};

const withBudget = async (promise, budgetMs, fallback = null) => {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve(promise).catch(() => fallback),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(fallback), budgetMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const buildRecommendationSoftMemoryKey = ({
  userId = '',
  username = '',
  careerStack = '',
  experienceLevel = '',
  isTemporaryMode = false,
  resumeIdentity = 'profile-active',
  signalHash = '',
} = {}) =>
  [
    isTemporaryMode ? 'preview' : 'profile',
    String(userId || 'anonymous'),
    String(username || '')
      .trim()
      .toLowerCase(),
    careerStack,
    experienceLevel,
    String(resumeIdentity || 'no-resume'),
    String(signalHash || 'pending'),
    RECOMMENDATION_ANALYSIS_VERSION,
  ].join('|');

const buildRecommendationSourceMemoryKey = ({
  userId = '',
  username = '',
  careerStack = '',
  experienceLevel = '',
  isTemporaryMode = false,
  resumeIdentity = 'no-resume',
  sourceFingerprint = '',
} = {}) =>
  [
    isTemporaryMode ? 'preview' : 'profile',
    String(userId || 'anonymous'),
    String(username || '')
      .trim()
      .toLowerCase(),
    careerStack,
    experienceLevel,
    String(resumeIdentity || 'no-resume'),
    String(sourceFingerprint || 'no-source'),
    RECOMMENDATION_ANALYSIS_VERSION,
  ].join('|');

const readRecommendationMemory = (key) => {
  if (!key) return null;
  const entry = recommendationMemoryCache.get(key);
  if (!entry) return null;
  if (Number(entry.expiresAt || 0) <= Date.now()) {
    recommendationMemoryCache.delete(key);
    return null;
  }
  return entry;
};

const writeRecommendationMemory = (key, payload, altKey = null) => {
  if (!key || !payload?.analysisData) return;
  const entry = {
    ...payload,
    expiresAt: Date.now() + RECOMMENDATION_MEMORY_TTL_MS,
  };
  recommendationMemoryCache.set(key, entry);
  if (altKey) {
    recommendationMemoryCache.set(altKey, entry);
  }
};

const clearRecommendationMemoryCache = () => {
  recommendationMemoryCache.clear();
};

const getRecommendationMemoryCacheSize = () => recommendationMemoryCache.size;

const buildRecommendationResultCacheKey = (identity) =>
  crypto.createHash('sha256').update(JSON.stringify(identity)).digest('hex');

const isPersistableRecommendationResult = (result = {}) => {
  if (!result || typeof result !== 'object') return false;
  if (
    !Array.isArray(result.recommendations) ||
    !result.recommendations.length ||
    result.ruleVersion !== engine.RULE_VERSION
  )
    return false;
  if (result.cacheMetadata?.partial === true) return false;
  return true;
};

const voidRecommendationNotification = (payload) => {
  setImmediate(() => {
    createNotification(payload).catch((error) => {
      console.warn('Recommendation notification failed:', error.message);
    });
  });
};

const ANALYSIS_CACHE_RESULT_FIELDS = {
  analysisData: 1,
  updatedAt: 1,
  createdAt: 1,
  signalHash: 1,
  expiresAt: 1,
  resumeHash: 1,
  resumeAnalysisId: 1,
  githubUsername: 1,
};
const isCacheFresh = (cache) => {
  if (!cache) return false;
  // Check explicit expiresAt if present on the cache document
  if (cache.expiresAt) {
    const expiresTimestamp = new Date(cache.expiresAt).getTime();
    if (Number.isFinite(expiresTimestamp) && Date.now() > expiresTimestamp) return false;
  }
  // Fall back to updatedAt / createdAt with TTL
  const updatedAt = cache.updatedAt || cache.createdAt;
  if (!updatedAt) return false;
  const timestamp = new Date(updatedAt).getTime();
  return Number.isFinite(timestamp) && Date.now() - timestamp <= RECOMMENDATION_TTL_MS;
};

const sortByPriorityImpact = (items = []) => engine.rank(items);

const priorityToRaw = (priority = '') => {
  const normalized = String(priority || '').toLowerCase();
  if (normalized.includes('must') || normalized.includes('high')) return 'High';
  if (normalized.includes('medium')) return 'Medium';
  return 'Low';
};

const normalizeRecommendationPayload = (payload = {}) => {
  const projects = Array.isArray(payload.projects) ? payload.projects : [];
  const technologies = Array.isArray(payload.technologies) ? payload.technologies : [];
  const careerPaths = Array.isArray(payload.careerPaths) ? payload.careerPaths : [];

  return {
    ...payload,
    analysisSummary: String(payload.analysisSummary || '').trim(),
    projects: projects.map((project, index) => ({
      ...project,
      id: project.id || `p_${index + 1}`,
      tech: uniqueStrings(project.tech || [], 8),
      newTech: uniqueStrings(project.newTech || [], 4),
      impact: engine.number(project.impact),
      confidenceScore: engine.number(project.confidenceScore),
      priority: priorityToRaw(
        project.priority || (Number(project.impact || 0) >= 82 ? 'High' : 'Medium'),
      ),
      estimatedImpact: engine.number(project.estimatedImpact),
      reason: String(project.reason || project.whyThisProject || '').trim(),
      evidence: uniqueStrings(
        project.evidence || project.triggerSkills || project.newTech || [],
        5,
      ),
      sourceSignalsUsed: uniqueStrings(project.sourceSignalsUsed || [], 6),
      estimatedEffort: String(project.estimatedEffort || project.estimatedWeeks || '').trim(),
      startUrl: project.startUrl || '/app/github-analyzer',
    })),
    technologies: technologies.map((technology) => ({
      ...technology,
      priorityRaw: priorityToRaw(technology.priorityRaw || technology.priority),
      confidenceScore: engine.number(technology.confidenceScore),
      estimatedImpact: engine.number(technology.estimatedImpact),
      reason: String(technology.reason || technology.description || '').trim(),
      evidence: uniqueStrings(technology.evidence || [], 5),
      sourceSignalsUsed: uniqueStrings(technology.sourceSignalsUsed || [], 6),
      estimatedEffort: String(technology.estimatedEffort || '').trim(),
    })),
    careerPaths: careerPaths.map((path, index) => ({
      ...path,
      id: path.id || `c_${index + 1}`,
      hiringCompanies: uniqueStrings(path.hiringCompanies || [], 6),
      actionItems: uniqueStrings(path.actionItems || [], 6),
      confidenceScore: engine.number(path.confidenceScore),
      priority: priorityToRaw(path.priority || (Number(path.match || 0) >= 75 ? 'High' : 'Medium')),
      estimatedImpact: engine.number(path.estimatedImpact),
      reason: String(path.reason || path.description || '').trim(),
      evidence: uniqueStrings(path.evidence || path.actionItems || [], 5),
      sourceSignalsUsed: uniqueStrings(path.sourceSignalsUsed || [], 6),
      estimatedEffort: String(path.estimatedEffort || path.timeline || '').trim(),
      exploreUrl: path.exploreUrl || '/app/profile',
    })),
    portfolioRecommendations: normalizeActionList(payload.portfolioRecommendations, [], 0, 4),
    resumeRecommendations: normalizeActionList(payload.resumeRecommendations, [], 0, 4),
    learningActions: normalizeActionList(payload.learningActions, [], 0, 6),
    interviewReadinessActions: normalizeActionList(payload.interviewReadinessActions, [], 0, 4),
  };
};

const buildRecommendationDataQuality = (payload = {}) => {
  const signals = payload.signalsUsed || {};
  const hasGitHubData = Boolean(
    payload.sourceMetadata?.github?.available ||
    Number(signals.github?.repoCount || 0) ||
    (payload.githubSkills || []).length ||
    (payload.githubInsights?.repositories || []).length,
  );
  const hasResumeData = Boolean(signals.resume?.analyzed);
  const hasSkillGapData = Boolean(signals.skillGap?.present);
  const hasPortfolioData = Boolean(
    signals.portfolio?.present || Number(signals.portfolio?.projectCount || 0),
  );
  const hasJobMarketData = Boolean(
    Number(signals.jobsDemand?.sampledJobs || 0) || (signals.jobsDemand?.topSkills || []).length,
  );
  const sources = [
    hasGitHubData,
    hasResumeData,
    hasSkillGapData,
    hasPortfolioData,
    hasJobMarketData,
  ];

  return {
    hasGitHubData,
    hasResumeData,
    hasSkillGapData,
    hasPortfolioData,
    hasJobMarketData,
    dataCompleteness: Math.round((sources.filter(Boolean).length / sources.length) * 100),
    scoreAvailability: {
      readinessScore: hasGitHubData || hasResumeData || hasSkillGapData,
      portfolioScore: hasPortfolioData,
      learningScore: hasSkillGapData,
      interviewScore: hasGitHubData || hasResumeData || hasSkillGapData,
      marketReadinessScore: hasJobMarketData && hasSkillGapData,
      careerGrowthScore: hasPortfolioData || hasSkillGapData,
      overallRecommendationScore: sources.filter(Boolean).length >= 2,
    },
  };
};

const normalizeRecommendationResponse = (payload = {}) => {
  const normalized = normalizeRecommendationPayload(payload);
  normalized.projects = uniqueBy(
    normalized.projects.filter((item) => item.title),
    (item) => item.title.toLowerCase(),
  );
  normalized.technologies = uniqueBy(
    normalized.technologies.filter((item) => item.name),
    (item) => item.name.toLowerCase(),
  );
  normalized.careerPaths = uniqueBy(
    normalized.careerPaths.filter((item) => item.title),
    (item) => item.title.toLowerCase(),
  );
  normalized.structuredRecommendations = Object.fromEntries(
    Object.entries(normalized.structuredRecommendations || {})
      .map(([category, cards]) => [
        category,
        uniqueBy(
          (Array.isArray(cards) ? cards : []).filter((card) => String(card?.title || '').trim()),
          (card) => String(card.title).trim().toLowerCase(),
        ),
      ])
      .filter(([, cards]) => cards.length),
  );
  normalized.dataQuality = buildRecommendationDataQuality(normalized);
  if (normalized.ruleVersion === engine.RULE_VERSION)
    normalized.dataQuality.scoreAvailability = Object.fromEntries(
      Object.entries(normalized.recommendationScores || {}).map(([key, value]) => [
        key,
        engine.number(value) !== null,
      ]),
    );
  return normalized;
};

const saveAIVersionSnapshot = async ({ req, source, output, metadata = {} }) => {
  if (!req.user?._id || !output || typeof output !== 'object') return;
  try {
    await createVersion({
      userId: req.user._id,
      source,
      outputJson: output,
      metadata,
    });
  } catch (error) {
    console.error('Recommendation AI snapshot error:', error.message);
  }
};

const queueAIVersionSnapshot = (options) => {
  setImmediate(() => {
    saveAIVersionSnapshot(options).catch((error) => {
      console.error('Recommendation AI snapshot queue error:', error.message);
    });
  });
};

const loadResumeAnalysis = async (userId, expectedUser) => {
  const resumeSelect = {
    fileId: 1,
    fileName: 1,
    resumeSignals: 1,
    scoring: 1,
    contentQualityState: 1,
    analysisVersion: 1,
    resumeHash: 1,
    experienceYears: 1,
    experienceLevel: 1,
    suggestions: 1,
    scoreBreakdown: 1,
    createdAt: 1,
    technicalSkills: 1,
    skills: 1,
    atsScore: 1,
    keywordDensity: 1,
    formatScore: 1,
    contentQuality: 1,
    analyzedAt: 1,
    weaknesses: 1,
    missingSections: 1,
    keyAchievements: 1,
    experienceKeywords: 1,
    strengths: 1,
    statusMessage: 1,
  };
  const contextUser = await developerContext.loadUser(userId, { User });
  if (expectedUser && contextUser) {
    const current = developerContext.resolveIdentity(contextUser);
    const expected = developerContext.resolveIdentity(expectedUser);
    const changed =
      ['githubUsername', 'careerStack', 'experienceLevel'].some(
        (key) =>
          current[key] &&
          expected[key] &&
          String(current[key]).toLowerCase() !== String(expected[key]).toLowerCase(),
      ) ||
      String(developerContext.resolveSelectedResumeFileId(contextUser) || '') !==
        String(developerContext.resolveSelectedResumeFileId(expectedUser) || '');
    if (changed) {
      const error = new Error('Your active developer context changed. Reload and try again.');
      error.status = 409;
      throw error;
    }
  }
  const resumeFile = await developerContext.resolveResumeFile(userId, contextUser);
  if (!resumeFile) return null;
  return developerContext.resolveResumeAnalysis(
    userId,
    { ...contextUser, activeResumeFileId: resumeFile._id },
    {
      User,
      ResumeAnalysis,
      select: resumeSelect,
    },
  );
};

const getGitHubData = async (username, { forceRefresh = false, isTemporaryMode = false } = {}) => {
  if (!username) return { repositories: [], scores: {}, unavailable: true };
  const { analyzeGitHubProfile } = require('../services/githubservice');
  try {
    const normalizedUsername = String(username || '')
      .trim()
      .toLowerCase();
    const cached = normalizedUsername
      ? await GitHubAnalysisCache.findOne({ normalizedUsername }).sort({ updatedAt: -1 }).lean()
      : null;
    const cacheExpiresAt = cached?.expiresAt ? new Date(cached.expiresAt).getTime() : 0;
    if (!forceRefresh && cached?.result && cacheExpiresAt > Date.now()) return cached.result;
    const previous = recommendationGithubSources.get(normalizedUsername);
    if (!forceRefresh && !cached && previous && previous.expiresAt > Date.now())
      return previous.result;
    if (!forceRefresh && !isTemporaryMode) {
      return cached?.result
        ? { ...cached.result, cache: { ...cached.result.cache, stale: true } }
        : { repositories: [], scores: {}, unavailable: true };
    }

    recommendationRuntimeCounters.githubCalls += 1;
    const freshData = await analyzeGitHubProfile(String(username || '').trim(), { forceRefresh });
    recommendationGithubSources.set(normalizedUsername, {
      result: freshData,
      expiresAt: Date.now() + RECOMMENDATION_MEMORY_TTL_MS,
    });
    if (recommendationGithubSources.size > 500)
      recommendationGithubSources.delete(recommendationGithubSources.keys().next().value);
    if (isTemporaryMode && (!freshData || Number(freshData.repoCount || 0) < 1)) {
      throw new Error('GitHub profile has no public repositories or analysis is in progress.');
    }
    return freshData;
  } catch (githubError) {
    console.warn('Recommendations GitHub fallback:', githubError.message);
    if (isTemporaryMode) throw githubError;
    return {
      repoCount: 0,
      developerLevel: 'Unknown',
      strengths: [],
      weakAreas: [],
      languageDistribution: [],
      scores: {},
      repositories: [],
      unavailable: true,
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
  scores: githubData?.scores || {},
});

const summarizeSignalsForAI = (developerSignals = {}) => ({
  githubSignals: {
    present: Boolean(developerSignals.githubSignals?.present),
    repoCount: Number(developerSignals.githubSignals?.repoCount || 0),
    developerLevel: developerSignals.githubSignals?.developerLevel || '',
    topLanguages: (developerSignals.githubSignals?.languageDistribution || []).slice(0, 8),
    topTechnologies: (developerSignals.githubSignals?.technologies || [])
      .slice(0, 8)
      .map((tech) => tech?.name || tech?.technology || tech)
      .filter(Boolean),
    weakAreas: developerSignals.githubSignals?.weakAreas || [],
  },
  resumeSignals: {
    analyzed: Boolean(developerSignals.resumeSignals?.analyzed),
    atsScore: engine.number(developerSignals.resumeSignals?.atsScore),
    skills: (developerSignals.resumeSignals?.skills || []).slice(0, 16),
    weaknesses: (developerSignals.resumeSignals?.weaknesses || []).slice(0, 8),
    missingSections: (developerSignals.resumeSignals?.missingSections || []).slice(0, 8),
  },
  skillGapSignals: {
    present: Boolean(developerSignals.skillGapSignals?.present),
    coverage: engine.number(developerSignals.skillGapSignals?.coverage),
    missingSkills: (developerSignals.skillGapSignals?.missingSkills || []).slice(0, 12),
    weakSkills: (developerSignals.skillGapSignals?.weakSkills || []).slice(0, 8),
    highDemandSkills: (developerSignals.skillGapSignals?.highDemandSkills || []).slice(0, 8),
  },
  portfolioSignals: developerSignals.portfolioSignal || {},
  careerSprintSignals: developerSignals.careerSprintSignal || {},
  weeklyReportSignals: developerSignals.weeklyReportSignal || {},
  integrationSignals: developerSignals.integrationSignal || {},
  careerProfile: developerSignals.careerProfileSignal || {},
  jobMarketSignals: developerSignals.jobsDemandSignal || {},
});

const loadDeveloperSignalsSafely = async ({
  userId,
  username,
  resumeInsights,
  githubInsights,
  allowSignals,
}) => {
  if (!allowSignals || !userId) {
    const emptySignals = {
      githubSignals: {
        present: false,
        repoCount: 0,
        developerLevel: '',
        strengths: [],
        weakAreas: [],
        languageDistribution: [],
        repositories: [],
        scores: {},
        updatedAt: null,
      },
      resumeSignals: {
        analyzed: false,
        analysisId: 'no-resume',
        atsScore: 0,
        skills: [],
        weaknesses: [],
        missingSections: [],
        statusMessage: 'Resume not analyzed yet',
      },
      skillGapSignals: {
        present: false,
        knownSkills: [],
        missingSkills: [],
        weakSkills: [],
        highDemandSkills: [],
        coverage: 0,
        updatedAt: null,
      },
      careerSprintSignal: {
        present: false,
        completedTasks: 0,
        missedTasks: 0,
        streak: 0,
        consistencyScore: 0,
        activeLearningFocus: '',
        repeatedIncompleteSkills: [],
        completedSkillSignals: [],
        progressPercent: 0,
        status: 'Unavailable',
        updatedAt: null,
      },
      weeklyReportSignal: {
        present: false,
        weeklyProgressScore: 0,
        status: 'Unavailable',
        completedRecommendations: null,
        missedRecommendations: null,
        skillsImprovedThisWeek: [],
        repeatedWeakAreas: [],
        trendDelta: 0,
        updatedAt: null,
      },
      portfolioSignal: {
        present: false,
        completenessScore: 0,
        listedProjects: 0,
        liveLinks: 0,
        githubLinks: 0,
        contactVisibility: false,
        projectPresentationQuality: 0,
        publicEnabled: false,
        portfolioSkills: [],
        updatedAt: null,
      },
      integrationSignal: {
        present: false,
        usedProviders: [],
        integrationScore: 0,
        strongestProof: [],
        weakProof: [],
        detectedSkills: [],
        certifications: [],
        updatedAt: null,
      },
      careerProfileSignal: {
        present: false,
        careerStack: '',
        experienceLevel: '',
        careerGoal: '',
        githubUsername: '',
        updatedAt: null,
      },
      jobsDemandSignal: {
        present: false,
        sampledJobs: 0,
        topSkills: [],
        updatedAt: null,
      },
    };
    emptySignals.jobsDemandSignal = await getPublicJobMarketSignal();
    emptySignals.portfolioSignals = emptySignals.portfolioSignal;
    emptySignals.careerSprintSignals = emptySignals.careerSprintSignal;
    emptySignals.weeklyReportSignals = emptySignals.weeklyReportSignal;
    emptySignals.integrationSignals = emptySignals.integrationSignal;
    emptySignals.careerProfile = emptySignals.careerProfileSignal;

    return {
      developerSignals: emptySignals,
      signalHash: 'no-signals',
      signalsUsed: buildSignalsUsedSummary({
        username,
        resumeInsights,
        githubInsights,
        signals: emptySignals,
      }),
    };
  }

  try {
    const developerSignals = await getDeveloperSignals(userId, {
      resumeSignals: resumeInsights?.analyzed ? resumeInsights : undefined,
      githubSignals: githubInsights?.present ? githubInsights : undefined,
    });
    const signalHash = buildSignalHash(developerSignals);
    const signalsUsed = buildSignalsUsedSummary({
      username,
      resumeInsights,
      githubInsights,
      signals: developerSignals,
    });
    return { developerSignals, signalHash, signalsUsed };
  } catch (error) {
    console.warn('Developer signal fallback:', error.message);
    return loadDeveloperSignalsSafely({
      userId: null,
      username,
      resumeInsights,
      githubInsights,
      allowSignals: false,
    });
  }
};

const buildRecommendationSignals = ({
  result,
  scores,
  developerSignals,
  signalHash,
  cacheKey,
}) => ({
  version: RECOMMENDATION_ANALYSIS_VERSION,
  generatedAt: new Date().toISOString(),
  signalHash,
  cacheKey,
  scores,
  priorityRecommendations: sortByPriorityImpact(
    Object.values(result.structuredRecommendations || {}).flat(),
  )
    .slice(0, 10)
    .map((item) => ({
      id: item.id,
      category: item.category,
      title: item.title,
      priority: item.priority,
      confidenceScore: item.confidenceScore,
      estimatedImpact: item.estimatedImpact,
      sourceSignalsUsed: item.sourceSignalsUsed,
    })),
  skills: {
    recommendedTechnologies: uniqueStrings(
      (result.technologies || []).map((tech) => tech.name),
      12,
    ),
    missingSkills: uniqueStrings(developerSignals.skillGapSignals?.missingSkills || [], 12),
    weakSkills: uniqueStrings(developerSignals.skillGapSignals?.weakSkills || [], 10),
  },
  roadmapSummary: {
    immediateActions: (result.roadmap?.immediateActions || [])
      .map((item) => item.title)
      .slice(0, 5),
    next30Days: (result.roadmap?.next30Days || []).map((item) => item.title).slice(0, 5),
    suggestedProjects: (result.projects || []).map((project) => project.title).slice(0, 5),
  },
});

const finalizeRecommendationResult = ({
  fallback,
  resumeInsights,
  githubInsights,
  signalsUsed,
  analysisBasedOn,
  developerSignals,
  signalHash,
  cacheKey,
  previousRecommendation,
}) => {
  const result = {
    ...fallback,
    resumeInsights,
    githubInsights,
    analysisBasedOn,
    resumeStatusMessage: resumeInsights.statusMessage,
    signalsUsed: {
      ...signalsUsed,
      resume: {
        ...signalsUsed.resume,
        analyzed: resumeInsights.analyzed,
        atsScore: resumeInsights.atsScore,
      },
      skillGap: {
        ...developerSignals.skillGapSignals,
        coverage: developerSignals.skillGapSignals.coverage ?? null,
      },
    },
    cacheMetadata: {
      loadedFromCache: false,
      cacheKey,
      signalHash,
      analysisVersion: RECOMMENDATION_ANALYSIS_VERSION,
      recommendationVersion: RECOMMENDATION_ANALYSIS_VERSION,
      temporary: false,
      ttlHours: 24,
      cachedAt: null,
    },
  };
  result.githubInsights = {
    ...githubInsights,
    repositories: (githubInsights.repositories || []).slice(0, 30).map((repository) => ({
      name: String(repository.name || '').slice(0, 140),
      hasReadme: repository.hasReadme ?? null,
      hasTests: repository.hasTests ?? null,
    })),
  };
  result.recommendationSignals = buildRecommendationSignals({
    result,
    scores: result.recommendationScores,
    developerSignals,
    signalHash,
    cacheKey,
  });
  result.recommendationVersioning = engine.versionChanges(result, previousRecommendation);
  return normalizeRecommendationResponse(result);
};

const runRecommendationPipeline = async ({
  req,
  res,
  username,
  careerStack,
  experienceLevel,
  resumeText,
  previewResumeId,
  resumeHash,
  knownSkills,
  missingSkills,
  userId,
  allowSignals,
  saveResult,
  source,
  forceRefresh = false,
  bypassInflight = false,
}) => {
  const isTemporaryMode = !allowSignals;
  const stageTimer = createStageTimer();
  const validationStarted = process.hrtime.bigint();
  const cleanResume = isTemporaryMode ? String(resumeText || '').trim() : '';
  const normalizedGithubUsername = String(username || '')
    .trim()
    .replace(/^@/, '')
    .toLowerCase();
  const providedKnownSkills = uniqueStrings(knownSkills || [], 30);
  const providedMissingSkills = uniqueStrings(missingSkills || [], 20);
  stageTimer.mark('validation', validationStarted);

  const inflightKey = JSON.stringify({
    userId: String(userId || 'temporary'),
    username: normalizedGithubUsername,
    careerStack,
    experienceLevel,
    activeResumeFileId: String(developerContext.resolveSelectedResumeFileId(req.user) || ''),
    profileRevision: req.user?.updatedAt || null,
    forceRefresh: Boolean(forceRefresh),
    saveResult: Boolean(saveResult),
    previewResumeId: String(previewResumeId || ''),
    resumeHash: String(resumeHash || ''),
    resumeTextFingerprint: cleanResume
      ? `${cleanResume.length}:${crypto.createHash('sha1').update(cleanResume).digest('hex').slice(0, 12)}`
      : '',
    providedKnownSkills,
    providedMissingSkills,
    analysisVersion: RECOMMENDATION_ANALYSIS_VERSION,
  });

  const existingInflight = !bypassInflight && recommendationInflight.get(inflightKey);
  if (existingInflight) {
    try {
      const shared = await existingInflight;
      if (!isTemporaryMode) {
        const [currentResume, currentGithub, currentSnapshot] = await Promise.all([
          loadResumeAnalysis(userId, req.user),
          getGitHubData(username),
          AnalysisCache.findOne({
            userId,
            githubUsername: {
              $regex: '^' + normalizedGithubUsername + '$',
              $options: 'i',
            },
            careerStack,
            experienceLevel,
            resumeHash: shared.cacheMetadata.cacheKey.resumeHash,
            resumeAnalysisId: shared.cacheMetadata.cacheKey.resumeAnalysisId,
            'analysisData.ruleVersion': engine.SKILL_RULE,
          })
            .sort({ updatedAt: -1 })
            .lean(),
        ]);
        const currentInsights = engine.resumeSignals(
          currentResume,
          buildResumeAnalysisSignals(currentResume, experienceLevel),
        );
        const currentSkillGap = engine.compatibleSkillGap(currentSnapshot, {
          userId,
          username,
          careerStack,
          experienceLevel,
          ...buildResumeCacheIdentity({ resumeAnalysis: currentResume }),
          sources: engine.sourceMetadata({
            username,
            githubData: currentGithub,
            resumeAnalysis: currentResume,
            resumeInsights: currentInsights,
          }),
        });
        if (
          engine.sourceFingerprint({
            githubData: currentGithub,
            resumeInsights: currentInsights,
            skillGap: currentSkillGap,
          }) !== shared.sourceFingerprint
        ) {
          return await runRecommendationPipeline({
            req,
            res,
            username,
            careerStack,
            experienceLevel,
            resumeText,
            previewResumeId,
            resumeHash,
            knownSkills,
            missingSkills,
            userId,
            allowSignals,
            saveResult,
            source,
            forceRefresh: false,
            bypassInflight: true,
          });
        }
      }
      return res.json(
        stageTimer.attach(
          normalizeRecommendationResponse({
            ...shared,
            fromCache: true,
            cacheMetadata: {
              ...(shared.cacheMetadata || {}),
              loadedFromCache: true,
              cacheLayer: shared.cacheMetadata?.cacheLayer || 'inflight',
            },
          }),
        ),
      );
    } catch (error) {
      return res.status(error.status || 500).json({
        message: error.message || 'Failed to generate recommendations.',
      });
    }
  }

  let settleInflight;
  const workPromise = new Promise((resolve, reject) => {
    settleInflight = { resolve, reject };
  });
  workPromise.catch(() => {});
  recommendationInflight.set(inflightKey, workPromise);

  try {
    let latestResumeAnalysis = null;
    let storedResumeInsights;
    let resumeCacheIdentity;
    let githubData;
    let skillGapCandidate;

    if (isTemporaryMode) {
      const [previewResume, rawGithub] = await stageTimer.measure('Mongo', () =>
        Promise.all([
          resolvePreviewResume({
            previewResumeId,
            resumeHash,
            resumeText: cleanResume,
            experienceLevel,
          }),
          getGitHubData(username, { forceRefresh, isTemporaryMode }),
        ]),
      );
      if (previewResume.error) {
        const error = new Error(previewResume.error);
        error.status = previewResume.status;
        throw error;
      }
      storedResumeInsights = previewResume.resumeInsights;
      resumeCacheIdentity = previewResume.resumeCacheIdentity;
      githubData = rawGithub;
      skillGapCandidate = null;
    } else {
      const [loadedResume, rawGithub, loadedSkillGap] = await stageTimer.measure('Mongo', () =>
        Promise.all([
          loadResumeAnalysis(userId, req.user),
          getGitHubData(username, { forceRefresh, isTemporaryMode }),
          allowSignals && userId
            ? AnalysisCache.findOne({
                userId,
                githubUsername: {
                  $regex: '^' + normalizedGithubUsername + '$',
                  $options: 'i',
                },
                careerStack,
                experienceLevel,
                'analysisData.ruleVersion': engine.SKILL_RULE,
              })
                .sort({ updatedAt: -1 })
                .lean()
            : Promise.resolve(null),
        ]),
      );
      latestResumeAnalysis = loadedResume;
      storedResumeInsights = engine.resumeSignals(
        latestResumeAnalysis,
        buildResumeAnalysisSignals(latestResumeAnalysis, experienceLevel),
      );
      resumeCacheIdentity = buildResumeCacheIdentity({
        resumeAnalysis: latestResumeAnalysis,
      });
      githubData = rawGithub;
      skillGapCandidate = loadedSkillGap;
    }

    const resumeIdentity = `${resumeCacheIdentity.resumeAnalysisId || 'no-resume'}:${resumeCacheIdentity.resumeHash || 'no-resume'}`;
    let skillGapCache = skillGapCandidate;
    if (
      !isTemporaryMode &&
      skillGapCandidate &&
      (skillGapCandidate.resumeHash !== resumeCacheIdentity.resumeHash ||
        skillGapCandidate.resumeAnalysisId !== resumeCacheIdentity.resumeAnalysisId)
    ) {
      skillGapCache = await stageTimer.measure('Mongo', () =>
        AnalysisCache.findOne({
          userId,
          githubUsername: {
            $regex: '^' + normalizedGithubUsername + '$',
            $options: 'i',
          },
          careerStack,
          experienceLevel,
          resumeHash: resumeCacheIdentity.resumeHash,
          resumeAnalysisId: resumeCacheIdentity.resumeAnalysisId,
          'analysisData.ruleVersion': engine.SKILL_RULE,
        })
          .sort({ updatedAt: -1 })
          .lean(),
      );
    }

    const sourceMetadata = engine.sourceMetadata({
      username,
      githubData,
      resumeAnalysis: latestResumeAnalysis,
      resumeInsights: storedResumeInsights,
    });
    const snapshotContext = {
      userId,
      username,
      careerStack,
      experienceLevel,
      ...resumeCacheIdentity,
      sources: sourceMetadata,
    };
    const skillGap = engine.compatibleSkillGap(skillGapCache, snapshotContext);
    const sourceFingerprint = engine.sourceFingerprint({
      githubData,
      resumeInsights: storedResumeInsights,
      skillGap,
    });
    const sourceMemoryKey = buildRecommendationSourceMemoryKey({
      userId: userId || (isTemporaryMode ? 'anonymous' : ''),
      username: normalizedGithubUsername,
      careerStack,
      experienceLevel,
      isTemporaryMode,
      resumeIdentity,
      sourceFingerprint,
    });

    if (!forceRefresh) {
      const memoryHit = await stageTimer.measure('cache', () =>
        Promise.resolve(readRecommendationMemory(sourceMemoryKey)),
      );
      if (memoryHit?.analysisData) {
        recommendationRuntimeCounters.memoryHits += 1;
        const fullResult = normalizeRecommendationResponse({
          ...memoryHit.analysisData,
          fromCache: true,
          cacheMetadata: {
            ...(memoryHit.analysisData.cacheMetadata || {}),
            loadedFromCache: true,
            cacheLayer: 'memory',
            signalHash: memoryHit.signalHash,
            cachedAt: memoryHit.updatedAt || null,
          },
        });
        settleInflight.resolve(fullResult);
        return res.json(stageTimer.attach(fullResult));
      }
    }

    const runPipeline = async () => {
      const preliminarySignals = await stageTimer.measure('Mongo', () =>
        loadDeveloperSignalsSafely({
          userId,
          username,
          allowSignals,
          resumeInsights: storedResumeInsights,
          githubInsights: buildGithubInsights(githubData),
        }),
      );
      preliminarySignals.developerSignals.resumeSignals = storedResumeInsights;
      // Exclude this module's own previous output from its input fingerprint.
      preliminarySignals.developerSignals.recommendationSignal = {};
      preliminarySignals.developerSignals.recommendationSignals = {};
      preliminarySignals.developerSignals.skillGapSignals = skillGap
        ? {
            present: true,
            coverage: skillGap.coverage,
            ruleVersion: engine.SKILL_RULE,
            knownSkills: (skillGap.demonstratedSkills || []).map((skill) => skill.name),
            missingSkills: (skillGap.requiredSkills || skillGap.missingSkills || [])
              .filter((skill) => skill.status !== 'DEMONSTRATED')
              .map((skill) => skill.name),
            weakSkills: (skillGap.partialSkills || []).map((skill) => skill.name),
            sourceReferences: skillGap.sourceReferences,
            skills: skillGap.skills || [],
          }
        : {
            present: false,
            coverage: null,
            knownSkills: [],
            missingSkills: [],
            weakSkills: [],
            ruleVersion: null,
          };
      preliminarySignals.developerSignals.githubSignals = {
        ...sourceMetadata.github,
        scores: githubData.scores || {},
        scoring: githubData.scoring || null,
        repositories: githubData.repositories || [],
        githubSignals: githubData.githubSignals || {},
      };
      const upstreamSignalHash = buildSignalHash({
        ...preliminarySignals.developerSignals,
        recommendationSignal: {},
        recommendationSignals: {},
      });
      const signalHash = crypto
        .createHash('sha256')
        .update(
          JSON.stringify({
            upstreamSignalHash,
            username: normalizedGithubUsername,
            careerStack,
            experienceLevel,
            activeResumeFileId: String(
              developerContext.resolveSelectedResumeFileId(req.user) ||
                latestResumeAnalysis?.fileId ||
                '',
            ),
            sources: sourceMetadata,
            skillGap,
            supportingSignals: preliminarySignals.developerSignals,
            providedKnownSkills,
            providedMissingSkills,
          }),
        )
        .digest('hex');

      const softMemoryKey = buildRecommendationSoftMemoryKey({
        userId: userId || (isTemporaryMode ? 'anonymous' : ''),
        username: normalizedGithubUsername,
        careerStack,
        experienceLevel,
        isTemporaryMode,
        resumeIdentity,
        signalHash,
      });

      if (!forceRefresh) {
        const memoryHit = await stageTimer.measure('cache', () =>
          Promise.resolve(readRecommendationMemory(softMemoryKey)),
        );
        if (memoryHit?.analysisData) {
          recommendationRuntimeCounters.memoryHits += 1;
          return normalizeRecommendationResponse({
            ...memoryHit.analysisData,
            fromCache: true,
            cacheMetadata: {
              ...(memoryHit.analysisData.cacheMetadata || {}),
              loadedFromCache: true,
              cacheLayer: 'memory',
              signalHash,
              cachedAt: memoryHit.updatedAt || null,
            },
          });
        }
      }

      const cacheKey = {
        githubUsername: username,
        careerStack,
        experienceLevel,
        resumeHash: resumeCacheIdentity.resumeHash,
        resumeAnalysisId: resumeCacheIdentity.resumeAnalysisId,
        signalHash,
        analysisVersion: RECOMMENDATION_ANALYSIS_VERSION,
      };
      const scopedCacheKey =
        saveResult && req.user?._id && username ? { ...cacheKey, userId: req.user._id } : null;
      const resultCacheIdentity = {
        mode: isTemporaryMode ? 'preview' : 'profile',
        userId: String(userId || 'temporary'),
        ...cacheKey,
        providedKnownSkills,
        providedMissingSkills,
      };
      const resultCacheKey = buildRecommendationResultCacheKey(resultCacheIdentity);
      const previewCacheKey = `recommendations:preview:${normalizedGithubUsername}:${resumeCacheIdentity.resumeHash || 'no-resume'}:${careerStack}:${experienceLevel}:${signalHash}:${RECOMMENDATION_ANALYSIS_VERSION}`;

      if (!forceRefresh) {
        const redisCached = await stageTimer.measure('Redis', () =>
          withBudget(
            aiService.getSharedCache(
              isTemporaryMode ? previewCacheKey : resultCacheKey,
              isTemporaryMode ? 'preview' : 'recommendations:result',
            ),
            RECOMMENDATION_REDIS_LOOKUP_BUDGET_MS,
            null,
          ),
        );
        if (
          redisCached?.analysisData &&
          isPersistableRecommendationResult(redisCached.analysisData)
        ) {
          recommendationRuntimeCounters.redisHits += 1;
          writeRecommendationMemory(
            softMemoryKey,
            {
              analysisData: redisCached.analysisData,
              updatedAt: redisCached.updatedAt || new Date(),
              signalHash,
              expiresAt: new Date(Date.now() + RECOMMENDATION_TTL_MS),
            },
            sourceMemoryKey,
          );
          return normalizeRecommendationResponse({
            ...redisCached.analysisData,
            analysisBasedOn: buildAnalysisBasedOn({
              username,
              careerStack,
              experienceLevel,
              resumeInsights: storedResumeInsights,
            }),
            fromCache: true,
            cacheMetadata: {
              ...(redisCached.analysisData.cacheMetadata || {}),
              loadedFromCache: true,
              cacheLayer: 'redis',
              cacheKey: isTemporaryMode ? previewCacheKey : cacheKey,
              signalHash,
              cachedAt: redisCached.updatedAt || null,
            },
          });
        }
      }

      if (scopedCacheKey && !forceRefresh) {
        const mongoCached = await stageTimer.measure('Mongo', () =>
          AnalysisCache.findOne(scopedCacheKey).select(ANALYSIS_CACHE_RESULT_FIELDS).lean(),
        );
        if (
          isCacheFresh(mongoCached) &&
          isPersistableRecommendationResult(mongoCached?.analysisData)
        ) {
          recommendationRuntimeCounters.mongoHits += 1;
          writeRecommendationMemory(
            softMemoryKey,
            {
              analysisData: mongoCached.analysisData,
              updatedAt: mongoCached.updatedAt || mongoCached.createdAt || new Date(),
              signalHash,
              expiresAt: new Date(Date.now() + RECOMMENDATION_TTL_MS),
            },
            sourceMemoryKey,
          );
          setImmediate(() => {
            aiService
              .setSharedCache(
                resultCacheKey,
                {
                  analysisData: mongoCached.analysisData,
                  updatedAt: mongoCached.updatedAt || mongoCached.createdAt || new Date(),
                },
                RECOMMENDATION_REDIS_TTL_SECONDS,
                'recommendations:result',
              )
              .catch(() => {});
          });
          return normalizeRecommendationResponse({
            ...mongoCached.analysisData,
            ...normalizeRecommendationPayload(mongoCached.analysisData),
            analysisBasedOn: buildAnalysisBasedOn({
              username,
              careerStack,
              experienceLevel,
              resumeInsights: storedResumeInsights,
            }),
            resumeStatusMessage:
              mongoCached.analysisData.resumeStatusMessage || storedResumeInsights.statusMessage,
            fromCache: true,
            cacheMetadata: {
              ...(mongoCached.analysisData.cacheMetadata || {}),
              loadedFromCache: true,
              cacheLayer: 'mongo',
              cacheKey,
              signalHash,
              analysisVersion: RECOMMENDATION_ANALYSIS_VERSION,
              recommendationVersion: RECOMMENDATION_ANALYSIS_VERSION,
              ttlHours: 24,
              cachedAt: mongoCached.updatedAt || mongoCached.createdAt || null,
            },
          });
        }
      }
      if (saveResult && userId && !username && !forceRefresh) {
        const saved = await Recommendation.findOne({
          userId,
          snapshotVersion: engine.RULE_VERSION,
          contextHash: signalHash,
        }).lean();
        if (
          saved?.result &&
          isCacheFresh(saved) &&
          isPersistableRecommendationResult(saved.result)
        ) {
          writeRecommendationMemory(softMemoryKey, {
            analysisData: saved.result,
            updatedAt: saved.createdAt,
            signalHash,
          });
          return normalizeRecommendationResponse({
            ...saved.result,
            fromCache: true,
            cacheMetadata: {
              ...saved.result.cacheMetadata,
              loadedFromCache: true,
              cacheLayer: 'mongo',
              cachedAt: saved.createdAt,
            },
          });
        }
      }

      recommendationRuntimeCounters.pipelineExecutions += 1;

      const resumeInsights = storedResumeInsights;
      const githubInsights = buildGithubInsights(githubData);
      const recommendationEvidence = {
        claimedButNotProvenSkills: (skillGap?.claimedOnlySkills || []).map((skill) => skill.name),
      };
      const developerSignals = preliminarySignals.developerSignals;
      const signalsUsed = buildSignalsUsedSummary({
        username,
        resumeInsights,
        githubInsights,
        signals: developerSignals,
      });

      const resolvedSkills = {
        knownSkills: preliminarySignals.developerSignals.skillGapSignals.knownSkills,
        missingSkills: preliminarySignals.developerSignals.skillGapSignals.missingSkills,
      };
      const previousRecommendation = scopedCacheKey
        ? await stageTimer.measure('Mongo', () =>
            AnalysisCache.findOne({
              userId: req.user._id,
              analysisVersion: RECOMMENDATION_ANALYSIS_VERSION,
              $or: [
                { signalHash: { $ne: signalHash } },
                { resumeHash: { $ne: resumeCacheIdentity.resumeHash } },
                { githubUsername: { $ne: username } },
              ],
            })
              .select(ANALYSIS_CACHE_RESULT_FIELDS)
              .sort({ updatedAt: -1 })
              .lean(),
          )
        : null;

      const fallback = await stageTimer.measure('deterministic processing', async () =>
        engine.buildPlan({
          username,
          careerStack,
          experienceLevel,
          knownSkills: resolvedSkills.knownSkills,
          missingSkills: resolvedSkills.missingSkills,
          resumeInsights,
          githubInsights,
          developerSignals,
          recommendationEvidence,
          githubData,
          resumeAnalysis: latestResumeAnalysis,
          skillGap,
          supportingSignals: developerSignals,
        }),
      );
      const prompt = getRecommendationPrompt(
        careerStack,
        experienceLevel,
        resolvedSkills.knownSkills,
        resolvedSkills.missingSkills,
        resumeInsights,
        githubInsights,
        summarizeSignalsForAI(developerSignals),
        fallback,
      );

      const aiMeta = await stageTimer.measure('AI', () =>
        generation.enrich({
          aiService,
          prompt,
          signalHash,
          identity: String(userId || 'preview'),
          enabled: forceRefresh,
        }),
      );
      if (aiMeta?.aiCalled) recommendationRuntimeCounters.aiCalls += 1;
      const aiOk = Boolean(aiMeta && aiMeta.ok === true);
      const enrichment = await stageTimer.measure('deterministic processing', async () =>
        resolveRecommendationEnrichment(aiOk ? aiMeta.value : null, fallback, {
          aiOk,
          careerStack,
          experienceLevel,
          anchors: uniqueStrings(
            [
              ...resolvedSkills.knownSkills,
              ...resolvedSkills.missingSkills,
              ...(recommendationEvidence?.claimedButNotProvenSkills || []),
              ...(fallback.projects || []).map((project) => project.title),
              ...(fallback.technologies || []).map((technology) => technology.name),
            ],
            24,
          ),
        }),
      );
      const deterministicResult = mergeNarrativeEnrichment(fallback, enrichment);
      const result = await stageTimer.measure('deterministic processing', async () =>
        finalizeRecommendationResult({
          username,
          careerStack,
          experienceLevel,
          fallback,
          resumeInsights,
          githubInsights,
          signalsUsed,
          analysisBasedOn: buildAnalysisBasedOn({
            username,
            careerStack,
            experienceLevel,
            resumeInsights,
          }),
          recommendationEvidence,
          developerSignals,
          resolvedSkills,
          signalHash,
          cacheKey,
          previousRecommendation: previousRecommendation?.analysisData || null,
        }),
      );
      result.cacheMetadata.temporary = !saveResult;
      result.sourceFingerprint = engine.sourceFingerprint({
        githubData,
        resumeInsights,
        skillGap,
      });
      for (const card of result.recommendations) {
        card.navigation.careerSprint.api = {
          method: 'POST',
          url: `/api/recommendations/${card.id}/career-sprint`,
          body: { signalHash },
        };
      }
      result.mode = isTemporaryMode ? 'preview' : 'profile';
      result.isTemporary = isTemporaryMode;
      result.savedToProfile = saveResult;
      result.aiSuggestions = engine.safeSuggestions(
        {
          learningActions: deterministicResult.learningActions.filter((action) =>
            enrichment.learningActions.includes(action),
          ),
        },
        fallback,
      );
      result.aiUsed = result.aiSuggestions.length > 0;

      if (!isPersistableRecommendationResult(result)) {
        result.cacheMetadata.partial = true;
        return result;
      }

      if (isTemporaryMode) {
        result.mode = 'preview';
        result.isTemporary = true;
        result.savedToProfile = false;
        writeRecommendationMemory(
          softMemoryKey,
          {
            analysisData: result,
            updatedAt: new Date(),
            signalHash,
            expiresAt: new Date(Date.now() + RECOMMENDATION_TTL_MS),
          },
          sourceMemoryKey,
        );
        setImmediate(() => {
          recommendationRuntimeCounters.persistenceOperations += 1;
          aiService
            .setSharedCache(
              previewCacheKey,
              {
                analysisData: result,
                updatedAt: new Date(),
              },
              1800,
              'preview',
            )
            .catch(() => {});
        });
        stageTimer.mark('persistence', process.hrtime.bigint());
      } else {
        if (scopedCacheKey) {
          recommendationRuntimeCounters.persistenceOperations += 1;
          await stageTimer.measure('persistence', () =>
            AnalysisCache.findOneAndUpdate(
              scopedCacheKey,
              { $set: { analysisData: result, userId: req.user._id } },
              { upsert: true },
            ),
          );
        }
        if (saveResult && req.user?._id) {
          await Recommendation.findOneAndUpdate(
            {
              userId: req.user._id,
              snapshotVersion: engine.RULE_VERSION,
              contextHash: signalHash,
            },
            {
              $setOnInsert: {
                title: result.recommendations[0]?.title || result.analysisSummary,
                careerStack,
                experienceLevel,
                result,
                priority: result.recommendations[0]?.priority || 'Low',
                priorityType: (result.recommendations[0]?.priority || 'Low').toLowerCase(),
                category: result.recommendations[0]?.category || 'careerPaths',
                techStack: result.technologies.map((technology) => technology.name).slice(0, 12),
                difficultyScore: null,
              },
            },
            { upsert: true, runValidators: true },
          );
        }
        writeRecommendationMemory(
          softMemoryKey,
          {
            analysisData: result,
            updatedAt: new Date(),
            signalHash,
            expiresAt: new Date(Date.now() + RECOMMENDATION_TTL_MS),
          },
          sourceMemoryKey,
        );
        setImmediate(() => {
          aiService
            .setSharedCache(
              resultCacheKey,
              {
                analysisData: result,
                updatedAt: new Date(),
              },
              RECOMMENDATION_REDIS_TTL_SECONDS,
              'recommendations:result',
            )
            .catch(() => {});
        });
        if (saveResult) {
          queueAIVersionSnapshot({
            req,
            source,
            output: result,
            metadata: {
              fromCache: false,
              username,
              careerStack,
              experienceLevel,
              signalHash,
              resumeAnalysisId: resumeCacheIdentity.resumeAnalysisId,
              aiUsed: Boolean(enrichment.aiUsed),
            },
          });
          voidRecommendationNotification({
            userId: req.user._id,
            type: 'career_update',
            title: 'Career Recommendations Updated',
            message: 'Your latest career recommendations are ready to review.',
            dedupeKey: `recommendations:${signalHash || 'latest'}`,
            dedupeWindowHours: 24,
            preferenceKey: 'newRecommendations',
          });
        }
      }

      return result;
    };

    const fullResult = normalizeRecommendationResponse(await runPipeline());
    settleInflight.resolve(fullResult);
    return res.json(stageTimer.attach(fullResult));
  } catch (error) {
    settleInflight.reject(error);
    throw error;
  } finally {
    if (recommendationInflight.get(inflightKey) === workPromise) {
      recommendationInflight.delete(inflightKey);
    }
  }
};

module.exports = {
  runRecommendationPipeline,
  resolveRecommendationEnrichment,
  mergeNarrativeEnrichment,
  isUsableRecommendationNarrative,
  hasRecommendationFactPollution,
  clearRecommendationMemoryCache,
  getRecommendationMemoryCacheSize,
  RECOMMENDATION_ANALYSIS_VERSION,
  ALLOWED_STACKS,
  ALLOWED_LEVELS,
};
