const recommendationGovernance = require('./recommendationGovernanceService');
const notificationPersistence = require('../../notifications/services/notificationPersistenceService');
const {
  resolveRecommendationEnrichment,
  mergeNarrativeEnrichment,
  isUsableRecommendationNarrative,
  hasRecommendationFactPollution
} = require('./recommendationNarrativeService');
const {
  uniqueBy,
  uniqueStrings,
  normalizeActionList
} = require('../utils/recommendationUtilities');
const developerContext = require('../../../core/developer-context/developerContextService');
const engine = require('./recommendationEngineService');
const skillGapContract = require('../../skill-gap/services/skillGapCacheContract');
const generation = require('./recommendationGenerationService');
const crypto = require('node:crypto');
const aiService = require('../../../core/ai/aiservice');
const { getRecommendationPrompt } = require('../prompts/recommendationPrompt');
const AnalysisCache = require('../../skill-gap/models/analysisCache');
const ResumeAnalysis = require('../../resume/models/resumeAnalysis');
const GitHubAnalysisCache = require('../../github/models/githubAnalysisCache');
const User = require('../../auth/models/user');
const Recommendation = require('../models/recommendation');
const { createVersion } = require('../../super-admin/services/aiVersionService');
const {
  getDeveloperSignals,
  buildSignalHash,
  buildSignalsUsedSummary,
  buildResumeAnalysisSignals,
  buildResumeCacheIdentity,
  buildAnalysisBasedOn,
  getPublicJobMarketSignal
} = require('../../../core/developer-context/developerSignalService');
const { resolvePreviewResume } = require('../../resume/services/previewResumeCacheService');

const RECOMMENDATION_ANALYSIS_VERSION = 'v7-recommendations-evidence-policy';
const RECOMMENDATION_TTL_MS = 24 * 60 * 60 * 1000;
const ALLOWED_STACKS = ['Frontend', 'Backend', 'Full Stack', 'AI/ML'];
const ALLOWED_LEVELS = [
  'Student',
  'Intern',
  '0-1 years',
  '1-2 years',
  '2-3 years',
  '3-5 years',
  '5+ years'
];
const RECOMMENDATION_MEMORY_TTL_MS = Math.min(
  5 * 60 * 1000,
  Math.max(
    15_000,
    Number.parseInt(process.env.RECOMMENDATIONS_MEMORY_TTL_MS || '60000', 10) || 60_000
  )
);
const RECOMMENDATION_REDIS_LOOKUP_BUDGET_MS = Math.min(
  250,
  Math.max(
    40,
    Number.parseInt(process.env.RECOMMENDATIONS_REDIS_LOOKUP_BUDGET_MS || '120', 10) || 120
  )
);
const RECOMMENDATION_REDIS_TTL_SECONDS = Math.min(
  3600,
  Math.max(60, Number.parseInt(process.env.RECOMMENDATIONS_REDIS_TTL_SECONDS || '900', 10) || 900)
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
  total: 0
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
          requestCounters: { ...recommendationRuntimeCounters }
        }
      };
    }
  };
};
const recommendationInflight = new Map();
const BoundedMemoryCache = require('../../../core/cache/boundedMemoryCache');
const recommendationMemoryCache = new BoundedMemoryCache(256);
const recommendationGithubSources = new Map();
const recommendationRuntimeCounters = {
  pipelineExecutions: 0,
  githubCalls: 0,
  aiCalls: 0,
  persistenceOperations: 0,
  memoryHits: 0,
  redisHits: 0,
  mongoHits: 0
};

const withBudget = async (promise, budgetMs, fallback = null) => {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve(promise).catch(() => fallback),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(fallback), budgetMs);
        timer.unref?.();
      })
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
  signalHash = ''
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
    RECOMMENDATION_ANALYSIS_VERSION
  ].join('|');

const buildRecommendationSourceMemoryKey = ({
  userId = '',
  username = '',
  careerStack = '',
  experienceLevel = '',
  isTemporaryMode = false,
  resumeIdentity = 'no-resume',
  sourceFingerprint = ''
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
    RECOMMENDATION_ANALYSIS_VERSION
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
  const expiresAt = Math.min(
    Date.now() + RECOMMENDATION_MEMORY_TTL_MS,
    new Date(payload.expiresAt ?? Date.now() + RECOMMENDATION_MEMORY_TTL_MS).getTime()
  );
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return;
  const entry = {
    ...payload,
    expiresAt
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

const ANALYSIS_CACHE_RESULT_FIELDS = {
  analysisData: 1,
  updatedAt: 1,
  createdAt: 1,
  signalHash: 1,
  expiresAt: 1,
  resumeHash: 1,
  resumeAnalysisId: 1,
  githubUsername: 1
};
const isCacheFresh = (cache) => {
  if (!cache) return false;
  return Date.now() <= cacheDeadline(cache);
};
const cacheDeadline = (cache) => {
  const timestamp = new Date(cache.updatedAt || cache.createdAt).getTime();
  const explicit = new Date(cache.expiresAt).getTime();
  return Math.min(
    timestamp + RECOMMENDATION_TTL_MS,
    cache.expiresAt && Number.isFinite(explicit) ? explicit : Infinity
  );
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
        project.priority || (Number(project.impact || 0) >= 82 ? 'High' : 'Medium')
      ),
      estimatedImpact: engine.number(project.estimatedImpact),
      reason: String(project.reason || project.whyThisProject || '').trim(),
      evidence: uniqueStrings(
        project.evidence || project.triggerSkills || project.newTech || [],
        5
      ),
      sourceSignalsUsed: uniqueStrings(project.sourceSignalsUsed || [], 6),
      estimatedEffort: String(project.estimatedEffort || project.estimatedWeeks || '').trim(),
      startUrl: project.startUrl || '/app/github-analyzer'
    })),
    technologies: technologies.map((technology) => ({
      ...technology,
      priorityRaw: priorityToRaw(technology.priorityRaw || technology.priority),
      confidenceScore: engine.number(technology.confidenceScore),
      estimatedImpact: engine.number(technology.estimatedImpact),
      reason: String(technology.reason || technology.description || '').trim(),
      evidence: uniqueStrings(technology.evidence || [], 5),
      sourceSignalsUsed: uniqueStrings(technology.sourceSignalsUsed || [], 6),
      estimatedEffort: String(technology.estimatedEffort || '').trim()
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
      exploreUrl: path.exploreUrl || '/app/profile'
    })),
    portfolioRecommendations: normalizeActionList(payload.portfolioRecommendations, [], 0, 4),
    resumeRecommendations: normalizeActionList(payload.resumeRecommendations, [], 0, 4),
    learningActions: normalizeActionList(payload.learningActions, [], 0, 6),
    interviewReadinessActions: normalizeActionList(payload.interviewReadinessActions, [], 0, 4)
  };
};

const buildRecommendationDataQuality = (payload = {}) => {
  const signals = payload.signalsUsed || {};
  const hasGitHubData = Boolean(
    payload.sourceMetadata?.github?.available ||
    Number(signals.github?.repoCount || 0) ||
    (payload.githubSkills || []).length ||
    (payload.githubInsights?.repositories || []).length
  );
  const hasResumeData = Boolean(signals.resume?.analyzed);
  const hasSkillGapData = Boolean(signals.skillGap?.present);
  const hasPortfolioData = Boolean(
    signals.portfolio?.present || Number(signals.portfolio?.projectCount || 0)
  );
  const hasJobMarketData = Boolean(
    Number(signals.jobsDemand?.sampledJobs || 0) || (signals.jobsDemand?.topSkills || []).length
  );
  const sources = [
    hasGitHubData,
    hasResumeData,
    hasSkillGapData,
    hasPortfolioData,
    hasJobMarketData
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
      overallRecommendationScore: sources.filter(Boolean).length >= 2
    }
  };
};

const normalizeRecommendationResponse = (payload = {}) => {
  const normalized = normalizeRecommendationPayload(payload);
  normalized.projects = uniqueBy(
    normalized.projects.filter((item) => item.title),
    (item) => item.title.toLowerCase()
  );
  normalized.technologies = uniqueBy(
    normalized.technologies.filter((item) => item.name),
    (item) => item.name.toLowerCase()
  );
  normalized.careerPaths = uniqueBy(
    normalized.careerPaths.filter((item) => item.title),
    (item) => item.title.toLowerCase()
  );
  normalized.structuredRecommendations = Object.fromEntries(
    Object.entries(normalized.structuredRecommendations || {})
      .map(([category, cards]) => [
        category,
        uniqueBy(
          (Array.isArray(cards) ? cards : []).filter((card) => String(card?.title || '').trim()),
          (card) => String(card.title).trim().toLowerCase()
        )
      ])
      .filter(([, cards]) => cards.length)
  );
  normalized.dataQuality = buildRecommendationDataQuality(normalized);
  if (normalized.ruleVersion === engine.RULE_VERSION)
    normalized.dataQuality.scoreAvailability = Object.fromEntries(
      Object.entries(normalized.recommendationScores || {}).map(([key, value]) => [
        key,
        engine.number(value) !== null
      ])
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
      metadata
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

const loadResumeAnalysis = (userId, user) => {
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
    statusMessage: 1
  };
  return developerContext.resolveResumeAnalysis(userId, user, {
    ResumeAnalysis,
    select: resumeSelect,
    defaultOnly: true
  });
};

const getGitHubData = async (
  username,
  { forceRefresh = false, isTemporaryMode = false, userId } = {}
) => {
  if (!username) return { repositories: [], scores: {}, unavailable: true };
  const { analyzeGitHubProfile } = require('../../github/services/githubservice');
  try {
    if (userId && !isTemporaryMode) {
      const { getCachedGitHubAnalysis } = require('../../github/services/githubservice');
      const accepted = await getCachedGitHubAnalysis(username, { userId });
      return accepted.data || { repositories: [], scores: {}, unavailable: true };
    }
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
      expiresAt: Date.now() + RECOMMENDATION_MEMORY_TTL_MS
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
      unavailable: true
    };
  }
};

const sourceConflict = () =>
  Object.assign(Error('Recommendation sources changed. Refresh and try again.'), { status: 409 });

const loadProfileSources = async (req, { userId, username, careerStack, experienceLevel }) => {
  const gapScope = skillGapContract.buildScope({ userId, user: req.user });
  const loadGap = (resumeIdentity) =>
    AnalysisCache.findOne({ ...gapScope, ...resumeIdentity, careerStack, experienceLevel })
      .sort({ updatedAt: -1, _id: -1 })
      .lean();
  const [user, resumeAnalysis, githubData, candidate] = await Promise.all([
    developerContext.loadUser(userId, { User }),
    loadResumeAnalysis(userId, req.user),
    getGitHubData(username, { userId }),
    loadGap()
  ]);
  if (
    !user ||
    user.isActive === false ||
    Number(user.sessionRevision || 0) !== Number(req.user?.sessionRevision || 0)
  ) {
    throw sourceConflict();
  }
  const profileFingerprint = developerContext.buildProfileHash(user, { defaultOnly: true });
  if (profileFingerprint !== developerContext.buildProfileHash(req.user, { defaultOnly: true })) {
    throw sourceConflict();
  }
  const defaultResumeFileId = developerContext.resolveDefaultResumeFileId(user);
  const resumeInsights = engine.resumeSignals(
    resumeAnalysis,
    buildResumeAnalysisSignals(resumeAnalysis, experienceLevel)
  );
  const resumeCacheIdentity = buildResumeCacheIdentity({ resumeAnalysis, defaultResumeFileId });
  const sourceMetadata = engine.sourceMetadata({
    username,
    githubData,
    resumeAnalysis,
    resumeInsights
  });
  // A candidate from the broader scope is reusable only when it also wins the exact
  // scope under the same total ordering. Otherwise, look up the exact resume key.
  const cache =
    candidate &&
    (candidate.resumeHash !== resumeCacheIdentity.resumeHash ||
      candidate.resumeAnalysisId !== resumeCacheIdentity.resumeAnalysisId)
      ? await loadGap(resumeCacheIdentity)
      : candidate;
  const skillGap = engine.compatibleSkillGap(cache, {
    userId,
    username,
    careerStack,
    experienceLevel,
    ...resumeCacheIdentity,
    profileRevision: user.updatedAt || null,
    sources: sourceMetadata
  });
  const fingerprint = engine.sourceFingerprint({
    githubData,
    resumeInsights,
    skillGap,
    profileFingerprint
  });
  return {
    resumeAnalysis,
    resumeInsights,
    resumeCacheIdentity,
    githubData,
    sourceMetadata,
    skillGap,
    fingerprint
  };
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
    weakAreas: developerSignals.githubSignals?.weakAreas || []
  },
  resumeSignals: {
    analyzed: Boolean(developerSignals.resumeSignals?.analyzed),
    atsScore: engine.number(developerSignals.resumeSignals?.atsScore),
    skills: (developerSignals.resumeSignals?.skills || []).slice(0, 16),
    weaknesses: (developerSignals.resumeSignals?.weaknesses || []).slice(0, 8),
    missingSections: (developerSignals.resumeSignals?.missingSections || []).slice(0, 8)
  },
  skillGapSignals: {
    present: Boolean(developerSignals.skillGapSignals?.present),
    coverage: engine.number(developerSignals.skillGapSignals?.coverage),
    missingSkills: (developerSignals.skillGapSignals?.missingSkills || []).slice(0, 12),
    weakSkills: (developerSignals.skillGapSignals?.weakSkills || []).slice(0, 8),
    highDemandSkills: (developerSignals.skillGapSignals?.highDemandSkills || []).slice(0, 8)
  },
  portfolioSignals: developerSignals.portfolioSignal || {},
  careerSprintSignals: developerSignals.careerSprintSignal || {},
  weeklyReportSignals: developerSignals.weeklyReportSignal || {},
  integrationSignals: developerSignals.integrationSignal || {},
  careerProfile: developerSignals.careerProfileSignal || {},
  jobMarketSignals: developerSignals.jobsDemandSignal || {}
});

const loadDeveloperSignalsSafely = async ({
  userId,
  username,
  resumeInsights,
  githubInsights,
  allowSignals
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
        updatedAt: null
      },
      resumeSignals: {
        analyzed: false,
        analysisId: 'no-resume',
        atsScore: 0,
        skills: [],
        weaknesses: [],
        missingSections: [],
        statusMessage: 'Resume not analyzed yet'
      },
      skillGapSignals: {
        present: false,
        knownSkills: [],
        missingSkills: [],
        weakSkills: [],
        highDemandSkills: [],
        coverage: 0,
        updatedAt: null
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
        updatedAt: null
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
        updatedAt: null
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
        updatedAt: null
      },
      integrationSignal: {
        present: false,
        usedProviders: [],
        integrationScore: 0,
        strongestProof: [],
        weakProof: [],
        detectedSkills: [],
        certifications: [],
        updatedAt: null
      },
      careerProfileSignal: {
        present: false,
        careerStack: '',
        experienceLevel: '',
        careerGoal: '',
        githubUsername: '',
        updatedAt: null
      },
      jobsDemandSignal: {
        present: false,
        sampledJobs: 0,
        topSkills: [],
        updatedAt: null
      }
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
        signals: emptySignals
      })
    };
  }

  try {
    const developerSignals = await getDeveloperSignals(userId, {
      resumeSignals: resumeInsights?.analyzed ? resumeInsights : undefined,
      githubSignals: githubInsights?.present ? githubInsights : undefined
    });
    const signalHash = buildSignalHash(developerSignals);
    const signalsUsed = buildSignalsUsedSummary({
      username,
      resumeInsights,
      githubInsights,
      signals: developerSignals
    });
    return { developerSignals, signalHash, signalsUsed };
  } catch (error) {
    console.warn('Developer signal fallback:', error.message);
    return loadDeveloperSignalsSafely({
      userId: null,
      username,
      resumeInsights,
      githubInsights,
      allowSignals: false
    });
  }
};

const buildRecommendationSignals = ({
  result,
  scores,
  developerSignals,
  signalHash,
  cacheKey
}) => ({
  version: RECOMMENDATION_ANALYSIS_VERSION,
  generatedAt: new Date().toISOString(),
  signalHash,
  cacheKey,
  scores,
  priorityRecommendations: sortByPriorityImpact(
    Object.values(result.structuredRecommendations || {}).flat()
  )
    .slice(0, 10)
    .map((item) => ({
      id: item.id,
      category: item.category,
      title: item.title,
      priority: item.priority,
      confidenceScore: item.confidenceScore,
      estimatedImpact: item.estimatedImpact,
      sourceSignalsUsed: item.sourceSignalsUsed
    })),
  skills: {
    recommendedTechnologies: uniqueStrings(
      (result.technologies || []).map((tech) => tech.name),
      12
    ),
    missingSkills: uniqueStrings(developerSignals.skillGapSignals?.missingSkills || [], 12),
    weakSkills: uniqueStrings(developerSignals.skillGapSignals?.weakSkills || [], 10)
  },
  roadmapSummary: {
    immediateActions: (result.roadmap?.immediateActions || [])
      .map((item) => item.title)
      .slice(0, 5),
    next30Days: (result.roadmap?.next30Days || []).map((item) => item.title).slice(0, 5),
    suggestedProjects: (result.projects || []).map((project) => project.title).slice(0, 5)
  }
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
  previousRecommendation
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
        atsScore: resumeInsights.atsScore
      },
      skillGap: {
        ...developerSignals.skillGapSignals,
        coverage: developerSignals.skillGapSignals.coverage ?? null
      }
    },
    cacheMetadata: {
      loadedFromCache: false,
      cacheKey,
      signalHash,
      analysisVersion: RECOMMENDATION_ANALYSIS_VERSION,
      recommendationVersion: RECOMMENDATION_ANALYSIS_VERSION,
      temporary: false,
      ttlHours: 24,
      cachedAt: null
    }
  };
  result.githubInsights = {
    ...githubInsights,
    repositories: (githubInsights.repositories || []).slice(0, 30).map((repository) => ({
      name: String(repository.name || '').slice(0, 140),
      hasReadme: repository.hasReadme ?? null,
      hasTests: repository.hasTests ?? null
    }))
  };
  result.recommendationSignals = buildRecommendationSignals({
    result,
    scores: result.recommendationScores,
    developerSignals,
    signalHash,
    cacheKey
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
  bypassInflight = false
}) => {
  const isTemporaryMode = !allowSignals;
  const cacheOwner =
    userId ||
    (isTemporaryMode
      ? req.recommendationGovernance?.owner || `preview:${req.user?._id || req.ip || 'anonymous'}`
      : '');
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

  const readProfileSources = () =>
    loadProfileSources(req, { userId, username, careerStack, experienceLevel });
  const inflightKey = JSON.stringify({
    userId: String(cacheOwner),
    username: normalizedGithubUsername,
    careerStack,
    experienceLevel,
    defaultResumeFileId: String(developerContext.resolveDefaultResumeFileId(req.user) || ''),
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
    analysisVersion: RECOMMENDATION_ANALYSIS_VERSION
  });

  const existingInflight = !bypassInflight && recommendationInflight.get(inflightKey);
  if (existingInflight) {
    try {
      const shared = await existingInflight;
      if (!isTemporaryMode) {
        const current = await readProfileSources();
        if (current.fingerprint !== shared.sourceFingerprint) {
          return await runRecommendationPipeline({
            req,
            res,
            username,
            careerStack,
            experienceLevel,
            resumeText,
            ownerScope: req.user?._id ? `account:${req.user._id}` : `guest:${req.ip}`,
            previewResumeId,
            resumeHash,
            knownSkills,
            missingSkills,
            userId,
            allowSignals,
            saveResult,
            source,
            forceRefresh: false,
            bypassInflight: true
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
              cacheLayer: shared.cacheMetadata?.cacheLayer || 'inflight'
            }
          })
        )
      );
    } catch (error) {
      if (error.status === 409) {
        return runRecommendationPipeline({
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
          bypassInflight: true
        });
      }
      return res.status(error.status || 500).json({
        message: error.status ? error.message : 'Failed to generate recommendations.'
      });
    }
  }

  let settleInflight;
  if (recommendationInflight.size >= 64)
    return res.status(503).json({ message: 'Recommendation capacity temporarily unavailable.' });
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
    let skillGap = null;
    let sourceMetadata;
    let sourceFingerprint;

    if (isTemporaryMode) {
      const [previewResume, rawGithub] = await stageTimer.measure('Mongo', () =>
        Promise.all([
          resolvePreviewResume({
            previewResumeId,
            resumeHash,
            resumeText: cleanResume,
            experienceLevel
          }),
          getGitHubData(username, { forceRefresh, isTemporaryMode })
        ])
      );
      if (previewResume.error) {
        const error = new Error(previewResume.error);
        error.status = previewResume.status;
        throw error;
      }
      storedResumeInsights = previewResume.resumeInsights;
      resumeCacheIdentity = previewResume.resumeCacheIdentity;
      githubData = rawGithub;
      sourceMetadata = engine.sourceMetadata({
        username,
        githubData,
        resumeInsights: storedResumeInsights
      });
      sourceFingerprint = engine.sourceFingerprint({
        githubData,
        resumeInsights: storedResumeInsights,
        skillGap
      });
    } else {
      ({
        resumeAnalysis: latestResumeAnalysis,
        resumeInsights: storedResumeInsights,
        resumeCacheIdentity,
        githubData,
        sourceMetadata,
        skillGap,
        fingerprint: sourceFingerprint
      } = await stageTimer.measure('Mongo', readProfileSources));
    }

    const resumeIdentity = `${resumeCacheIdentity.resumeAnalysisId || 'no-resume'}:${resumeCacheIdentity.resumeHash || 'no-resume'}`;
    const sourceMemoryKey = buildRecommendationSourceMemoryKey({
      userId: cacheOwner,
      username: normalizedGithubUsername,
      careerStack,
      experienceLevel,
      isTemporaryMode,
      resumeIdentity,
      sourceFingerprint
    });

    if (!forceRefresh) {
      const memoryHit = await stageTimer.measure('cache', () =>
        Promise.resolve(readRecommendationMemory(sourceMemoryKey))
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
            cachedAt: memoryHit.updatedAt || null
          }
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
          githubInsights: buildGithubInsights(githubData)
        })
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
              .filter((skill) => skill.status === 'NOT_EVIDENCED')
              .map((skill) => skill.name),
            weakSkills: [
              ...(skillGap.partialSkills || []),
              ...(skillGap.claimedOnlySkills || [])
            ].map((skill) => skill.name),
            sourceReferences: skillGap.sourceReferences,
            skills: skillGap.skills || []
          }
        : {
            present: false,
            coverage: null,
            knownSkills: [],
            missingSkills: [],
            weakSkills: [],
            ruleVersion: null
          };
      preliminarySignals.developerSignals.githubSignals = {
        ...sourceMetadata.github,
        scores: githubData.scores || {},
        scoring: githubData.scoring || null,
        repositories: githubData.repositories || [],
        githubSignals: githubData.githubSignals || {}
      };
      const upstreamSignalHash = buildSignalHash({
        ...preliminarySignals.developerSignals,
        recommendationSignal: {},
        recommendationSignals: {}
      });
      const signalHash = crypto
        .createHash('sha256')
        .update(
          JSON.stringify({
            analysisVersion: RECOMMENDATION_ANALYSIS_VERSION,
            upstreamSignalHash,
            username: normalizedGithubUsername,
            careerStack,
            experienceLevel,
            sourceFingerprint,
            sources: sourceMetadata,
            skillGap,
            supportingSignals: preliminarySignals.developerSignals,
            providedKnownSkills,
            providedMissingSkills
          })
        )
        .digest('hex');

      const softMemoryKey = buildRecommendationSoftMemoryKey({
        userId: cacheOwner,
        username: normalizedGithubUsername,
        careerStack,
        experienceLevel,
        isTemporaryMode,
        resumeIdentity,
        signalHash
      });

      if (!forceRefresh) {
        const memoryHit = await stageTimer.measure('cache', () =>
          Promise.resolve(readRecommendationMemory(softMemoryKey))
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
              cachedAt: memoryHit.updatedAt || null
            }
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
        analysisVersion: RECOMMENDATION_ANALYSIS_VERSION
      };
      const scopedCacheKey =
        saveResult && req.user?._id && username ? { ...cacheKey, userId: req.user._id } : null;
      const resultCacheIdentity = {
        mode: isTemporaryMode ? 'preview' : 'profile',
        userId: String(cacheOwner),
        ...cacheKey,
        providedKnownSkills,
        providedMissingSkills
      };
      const resultCacheKey = buildRecommendationResultCacheKey(resultCacheIdentity);
      const previewCacheKey = `recommendations:preview:${engine.hash(cacheOwner)}:${normalizedGithubUsername}:${resumeCacheIdentity.resumeHash || 'no-resume'}:${careerStack}:${experienceLevel}:${signalHash}:${RECOMMENDATION_ANALYSIS_VERSION}`;

      if (!forceRefresh) {
        const redisMetadata = await stageTimer.measure('Redis', () =>
          withBudget(
            aiService.getSharedCache(
              isTemporaryMode ? previewCacheKey : resultCacheKey,
              isTemporaryMode ? 'preview' : 'recommendations:result',
              { withMetadata: true }
            ),
            RECOMMENDATION_REDIS_LOOKUP_BUDGET_MS,
            null
          )
        );
        const redisCached = redisMetadata?.value || redisMetadata;
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
              expiresAt: new Date(redisMetadata?.expiresAt || Date.now())
            },
            sourceMemoryKey
          );
          return normalizeRecommendationResponse({
            ...redisCached.analysisData,
            analysisBasedOn: buildAnalysisBasedOn({
              username,
              careerStack,
              experienceLevel,
              resumeInsights: storedResumeInsights
            }),
            fromCache: true,
            cacheMetadata: {
              ...(redisCached.analysisData.cacheMetadata || {}),
              loadedFromCache: true,
              cacheLayer: 'redis',
              cacheKey: isTemporaryMode ? previewCacheKey : cacheKey,
              signalHash,
              cachedAt: redisCached.updatedAt || null
            }
          });
        }
      }

      if (scopedCacheKey && !forceRefresh) {
        const mongoCached = await stageTimer.measure('Mongo', () =>
          AnalysisCache.findOne(scopedCacheKey).select(ANALYSIS_CACHE_RESULT_FIELDS).lean()
        );
        if (
          isCacheFresh(mongoCached) &&
          isPersistableRecommendationResult(mongoCached?.analysisData)
        ) {
          recommendationRuntimeCounters.mongoHits += 1;
          const sourceExpiresAt = cacheDeadline(mongoCached);
          writeRecommendationMemory(
            softMemoryKey,
            {
              analysisData: mongoCached.analysisData,
              updatedAt: mongoCached.updatedAt || mongoCached.createdAt || new Date(),
              signalHash,
              expiresAt: sourceExpiresAt
            },
            sourceMemoryKey
          );
          setImmediate(() => {
            const remainingTtl = Math.floor((sourceExpiresAt - Date.now()) / 1000);
            if (remainingTtl <= 0) return;
            aiService
              .setSharedCache(
                resultCacheKey,
                {
                  analysisData: mongoCached.analysisData,
                  updatedAt: mongoCached.updatedAt || mongoCached.createdAt || new Date()
                },
                Math.min(RECOMMENDATION_REDIS_TTL_SECONDS, remainingTtl),
                'recommendations:result'
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
              resumeInsights: storedResumeInsights
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
              cachedAt: mongoCached.updatedAt || mongoCached.createdAt || null
            }
          });
        }
      }
      if (saveResult && userId && !username && !forceRefresh) {
        const saved = await Recommendation.findOne({
          userId,
          snapshotVersion: engine.RULE_VERSION,
          contextHash: signalHash
        }).lean();
        if (
          saved?.result &&
          isCacheFresh(saved) &&
          isPersistableRecommendationResult(saved.result)
        ) {
          writeRecommendationMemory(softMemoryKey, {
            analysisData: saved.result,
            updatedAt: saved.createdAt,
            expiresAt: cacheDeadline(saved),
            signalHash
          });
          return normalizeRecommendationResponse({
            ...saved.result,
            fromCache: true,
            cacheMetadata: {
              ...saved.result.cacheMetadata,
              loadedFromCache: true,
              cacheLayer: 'mongo',
              cachedAt: saved.createdAt
            }
          });
        }
      }

      recommendationRuntimeCounters.pipelineExecutions += 1;

      const resumeInsights = storedResumeInsights;
      const githubInsights = buildGithubInsights(githubData);
      const recommendationEvidence = {
        claimedButNotProvenSkills: (skillGap?.claimedOnlySkills || []).map((skill) => skill.name)
      };
      const developerSignals = preliminarySignals.developerSignals;
      const signalsUsed = buildSignalsUsedSummary({
        username,
        resumeInsights,
        githubInsights,
        signals: developerSignals
      });

      const resolvedSkills = {
        knownSkills: preliminarySignals.developerSignals.skillGapSignals.knownSkills,
        missingSkills: preliminarySignals.developerSignals.skillGapSignals.missingSkills
      };
      const currentRecommendation =
        forceRefresh && scopedCacheKey
          ? await stageTimer.measure('Mongo', () =>
              AnalysisCache.findOne(scopedCacheKey).select(ANALYSIS_CACHE_RESULT_FIELDS).lean()
            )
          : null;
      const previousRecommendation = scopedCacheKey
        ? await stageTimer.measure('Mongo', () =>
            AnalysisCache.findOne({
              userId: req.user._id,
              analysisVersion: RECOMMENDATION_ANALYSIS_VERSION,
              $or: [
                { signalHash: { $ne: signalHash } },
                { resumeHash: { $ne: resumeCacheIdentity.resumeHash } },
                { githubUsername: { $ne: username } }
              ]
            })
              .select(ANALYSIS_CACHE_RESULT_FIELDS)
              .sort({ updatedAt: -1 })
              .lean()
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
          supportingSignals: developerSignals
        })
      );
      const prompt = getRecommendationPrompt(
        careerStack,
        experienceLevel,
        resolvedSkills.knownSkills,
        resolvedSkills.missingSkills,
        resumeInsights,
        githubInsights,
        summarizeSignalsForAI(developerSignals),
        fallback
      );

      const aiMeta = await stageTimer.measure('AI', () =>
        generation.enrich({
          aiService,
          prompt,
          signalHash,
          identity: String(cacheOwner),
          enabled: forceRefresh,
          governance: req.recommendationGovernance
        })
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
              ...(fallback.technologies || []).map((technology) => technology.name)
            ],
            24
          )
        })
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
            resumeInsights
          }),
          recommendationEvidence,
          developerSignals,
          resolvedSkills,
          signalHash,
          cacheKey,
          previousRecommendation: previousRecommendation?.analysisData || null
        })
      );
      result.cacheMetadata.temporary = !saveResult;
      result.sourceFingerprint = sourceFingerprint;
      for (const card of result.recommendations) {
        card.navigation.careerSprint.api = {
          method: 'POST',
          url: `/api/recommendations/${card.id}/career-sprint`,
          body: { signalHash }
        };
      }
      result.mode = isTemporaryMode ? 'preview' : 'profile';
      result.isTemporary = isTemporaryMode;
      result.savedToProfile = saveResult;
      result.aiSuggestions = engine.safeSuggestions(
        {
          learningActions: deterministicResult.learningActions.filter((action) =>
            enrichment.learningActions.includes(action)
          )
        },
        fallback
      );
      result.aiUsed = result.aiSuggestions.length > 0;
      const previousAiOutdated = Boolean(
        currentRecommendation?.analysisData?.aiRefreshRecommended ||
        previousRecommendation?.analysisData?.aiUsed ||
        previousRecommendation?.analysisData?.aiRefreshRecommended
      );
      result.aiRefreshRecommended = !result.aiUsed && previousAiOutdated;
      result.aiStatus = result.aiUsed
        ? 'included'
        : result.aiRefreshRecommended
          ? 'Refresh Recommended'
          : 'not_in_use';
      result.cacheMetadata.aiRefreshRecommended = result.aiRefreshRecommended;
      result.cacheMetadata.aiStatus = result.aiStatus;

      if (req.recommendationGovernance?.signal.aborted) throw recommendationGovernance.failure();

      // Provider latency must not allow an obsolete source revision to become current.
      if (saveResult && userId) {
        const current = await stageTimer.measure('Mongo', readProfileSources);
        if (current.fingerprint !== sourceFingerprint) throw sourceConflict();
      }

      if (
        !result.aiUsed &&
        currentRecommendation?.analysisData?.aiUsed &&
        currentRecommendation.analysisData.sourceFingerprint === result.sourceFingerprint &&
        isPersistableRecommendationResult(currentRecommendation.analysisData)
      ) {
        return normalizeRecommendationResponse({
          ...currentRecommendation.analysisData,
          fromCache: true,
          cacheMetadata: {
            ...currentRecommendation.analysisData.cacheMetadata,
            loadedFromCache: true,
            cacheLayer: 'mongo',
            cachedAt: currentRecommendation.updatedAt || currentRecommendation.createdAt
          }
        });
      }

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
            expiresAt: new Date(Date.now() + RECOMMENDATION_TTL_MS)
          },
          sourceMemoryKey
        );
        setImmediate(() => {
          recommendationRuntimeCounters.persistenceOperations += 1;
          aiService
            .setSharedCache(
              previewCacheKey,
              {
                analysisData: result,
                updatedAt: new Date()
              },
              1800,
              'preview'
            )
            .catch(() => {});
        });
        stageTimer.mark('persistence', process.hrtime.bigint());
      } else {
        if (scopedCacheKey) {
          recommendationRuntimeCounters.persistenceOperations += 1;
          await stageTimer.measure('persistence', () =>
            (req.recommendationGovernance
              ? recommendationGovernance.transaction
              : async (work) => work(undefined))(async (session) => {
              if (req.recommendationGovernance)
                await recommendationGovernance.fence(
                  req.recommendationGovernance.reservation,
                  session,
                  req.recommendationGovernance.signal
                );
              return AnalysisCache.findOneAndUpdate(
                scopedCacheKey,
                { $set: { analysisData: result, userId: req.user._id } },
                { upsert: true, session }
              );
            })
          );
        }
        if (saveResult && req.user?._id) {
          await notificationPersistence.commit(
            req.user._id,
            async (session) => {
              if (req.recommendationGovernance)
                await recommendationGovernance.fence(
                  req.recommendationGovernance.reservation,
                  session,
                  req.recommendationGovernance.signal
                );
              return Recommendation.findOneAndUpdate(
                {
                  userId: req.user._id,
                  snapshotVersion: engine.RULE_VERSION,
                  contextHash: signalHash
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
                    techStack: result.technologies
                      .map((technology) => technology.name)
                      .slice(0, 12),
                    difficultyScore: null
                  }
                },
                { upsert: true, runValidators: true, session }
              );
            },
            {
              type: 'career_update',
              title: 'Career Recommendations Updated',
              message: 'Your latest career recommendations are ready to review.',
              eventId: `recommendations:${engine.RULE_VERSION}:${signalHash}`,
              preferenceKey: 'newRecommendations'
            }
          );
        }
        writeRecommendationMemory(
          softMemoryKey,
          {
            analysisData: result,
            updatedAt: new Date(),
            signalHash,
            expiresAt: new Date(Date.now() + RECOMMENDATION_TTL_MS)
          },
          sourceMemoryKey
        );
        setImmediate(() => {
          aiService
            .setSharedCache(
              resultCacheKey,
              {
                analysisData: result,
                updatedAt: new Date()
              },
              RECOMMENDATION_REDIS_TTL_SECONDS,
              'recommendations:result'
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
              aiUsed: Boolean(enrichment.aiUsed)
            }
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
    req.releaseRecommendationReservation?.();
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
  ALLOWED_LEVELS
};
