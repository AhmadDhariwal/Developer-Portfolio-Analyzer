const crypto = require('node:crypto');
const aiService = require('../services/aiservice');
const { createNotification } = require('../services/notificationService');
const { getRecommendationPrompt } = require('../prompts/recommendationPrompt');
const AnalysisCache = require('../models/analysisCache');
const ResumeAnalysis = require('../models/resumeAnalysis');
const GitHubAnalysisCache = require('../models/githubAnalysisCache');
const SavedPreview = require('../models/savedPreview');
const User = require('../models/user');
const { createVersion } = require('../services/aiVersionService');
const {
  getDeveloperSignals,
  buildSignalHash,
  buildSignalsUsedSummary,
  buildResumeAnalysisSignals,
  buildResumeCacheIdentity,
  buildAnalysisBasedOn,
  getPublicJobMarketSignal
} = require('../services/developerSignalService');
const { extractSkillsFromRepositories, canonicalizeSkillName, detectSkillGaps } = require('../utils/skilldetector');
const { resolvePreviewResume } = require('../services/previewResumeCacheService');
const { parseGitHubUsername } = require('../services/githubservice');

const RECOMMENDATION_ANALYSIS_VERSION = 'v5-career-advisor-data-quality';
const SKILL_GAP_LOOKUP_VERSION = 'v5-skill-intelligence';
const RECOMMENDATION_TTL_MS = 24 * 60 * 60 * 1000;
const ALLOWED_STACKS = ['Frontend', 'Backend', 'Full Stack', 'AI/ML'];
const ALLOWED_LEVELS = ['Student', 'Intern', '0-1 years', '1-2 years', '2-3 years', '3-5 years', '5+ years'];
const RECOMMENDATION_MEMORY_TTL_MS = Math.min(
  5 * 60 * 1000,
  Math.max(15_000, Number.parseInt(process.env.RECOMMENDATIONS_MEMORY_TTL_MS || '60000', 10) || 60_000)
);
const RECOMMENDATION_REDIS_LOOKUP_BUDGET_MS = Math.min(
  250,
  Math.max(40, Number.parseInt(process.env.RECOMMENDATIONS_REDIS_LOOKUP_BUDGET_MS || '120', 10) || 120)
);
const RECOMMENDATION_REDIS_TTL_SECONDS = Math.min(
  3600,
  Math.max(60, Number.parseInt(process.env.RECOMMENDATIONS_REDIS_TTL_SECONDS || '900', 10) || 900)
);
const EMPTY_RECOMMENDATION_ENRICHMENT = Object.freeze({
  analysisSummary: '',
  projectNarratives: [],
  technologyNarratives: [],
  careerPathNarratives: [],
  portfolioRecommendations: [],
  resumeRecommendations: [],
  learningActions: [],
  interviewReadinessActions: [],
  aiUsed: false
});
const STAGE_TIMINGS_ENABLED = process.env.NODE_ENV !== 'production'
  || process.env.RECOMMENDATIONS_STAGE_TIMINGS === 'true'
  || process.env.NODE_ENV === 'test';
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
const recommendationMemoryCache = new Map();
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
      promise,
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
} = {}) => [
  isTemporaryMode ? 'preview' : 'profile',
  String(userId || 'anonymous'),
  String(username || '').trim().toLowerCase(),
  careerStack,
  experienceLevel,
  String(resumeIdentity || 'no-resume'),
  String(signalHash || 'pending'),
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

const writeRecommendationMemory = (key, payload) => {
  if (!key || !payload?.analysisData) return;
  recommendationMemoryCache.set(key, {
    ...payload,
    expiresAt: Date.now() + RECOMMENDATION_MEMORY_TTL_MS
  });
};

const clearRecommendationMemoryCache = () => {
  recommendationMemoryCache.clear();
};

const getRecommendationMemoryCacheSize = () => recommendationMemoryCache.size;

const buildRecommendationResultCacheKey = (identity) => crypto
  .createHash('sha256')
  .update(JSON.stringify(identity))
  .digest('hex');

const isPersistableRecommendationResult = (result = {}) => {
  if (!result || typeof result !== 'object') return false;
  if (!Array.isArray(result.projects) || result.projects.length < 1) return false;
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
  githubUsername: 1
};
const STACK_PROJECT_HINTS = {
  Frontend: ['React', 'TypeScript', 'Accessibility', 'Deployment'],
  Backend: ['Node.js', 'REST APIs', 'SQL', 'Deployment'],
  'Full Stack': ['React', 'Node.js', 'SQL', 'Deployment'],
  'AI/ML': ['Python', 'SQL', 'Deployment', 'Docker']
};

const isValidUrl = (value) => typeof value === 'string' && /^https?:\/\//i.test(value.trim());
const toSearchUrl = (query) => `https://www.google.com/search?q=${encodeURIComponent(String(query || 'software engineering'))}`;

const normalizeProjectLink = (project) => {
  if (isValidUrl(project?.startUrl)) return project.startUrl.trim();
  if (isValidUrl(project?.url)) return project.url.trim();
  const query = `${project?.title || 'software project'} github tutorial`;
  return toSearchUrl(query);
};

const normalizeCareerPathLink = (path) => {
  if (isValidUrl(path?.exploreUrl)) return path.exploreUrl.trim();
  if (isValidUrl(path?.url)) return path.url.trim();
  const query = `${path?.title || 'software engineer'} career roadmap`;
  return toSearchUrl(query);
};

const toSkillName = (value) => (typeof value === 'string' ? value : value?.name || '').trim();

const uniqueBy = (values = [], keyFn) => {
  const seen = new Set();
  return values.filter((item) => {
    const key = keyFn(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const uniqueStrings = (values = [], limit = 12) => uniqueBy(
  values.map((value) => String(value || '').trim()).filter(Boolean),
  (value) => value.toLowerCase()
).slice(0, limit);

const clamp = (value, min = 0, max = 100) => {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return min;
  return Math.max(min, Math.min(max, Math.round(numeric)));
};

const average = (values = []) => {
  const safeValues = values.map((value) => Number(value || 0)).filter((value) => Number.isFinite(value));
  if (!safeValues.length) return 0;
  return safeValues.reduce((sum, value) => sum + value, 0) / safeValues.length;
};

const sourceList = (...sources) => uniqueStrings(sources.flat().filter(Boolean), 8);

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
  return Number.isFinite(timestamp) && (Date.now() - timestamp) <= RECOMMENDATION_TTL_MS;
};

const toPriorityWeight = (priority = '') => {
  const normalized = String(priority || '').toLowerCase();
  if (normalized.includes('high') || normalized.includes('must')) return 3;
  if (normalized.includes('medium')) return 2;
  return 1;
};

const sortByPriorityImpact = (items = []) => [...items].sort((left, right) => {
  const priorityDelta = toPriorityWeight(right.priority) - toPriorityWeight(left.priority);
  if (priorityDelta !== 0) return priorityDelta;
  return Number(right.estimatedImpact || 0) - Number(left.estimatedImpact || 0);
});

const priorityToRaw = (priority = '') => {
  const normalized = String(priority || '').toLowerCase();
  if (normalized.includes('must') || normalized.includes('high')) return 'High';
  if (normalized.includes('medium')) return 'Medium';
  return 'Low';
};

const normalizeActionList = (values = [], fallback = [], min = 2, max = 6) => {
  const safe = uniqueStrings(values, max);
  if (safe.length >= min) return safe.slice(0, max);
  return uniqueStrings([...safe, ...fallback], max).slice(0, Math.max(min, Math.min(max, safe.length + fallback.length)));
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
      impact: clamp(project.impact || 0),
      confidenceScore: clamp(project.confidenceScore || project.impact || 70),
      priority: priorityToRaw(project.priority || (Number(project.impact || 0) >= 82 ? 'High' : 'Medium')),
      estimatedImpact: clamp(project.estimatedImpact || project.impact || 70),
      reason: String(project.reason || project.whyThisProject || '').trim(),
      evidence: uniqueStrings(project.evidence || project.triggerSkills || project.newTech || [], 5),
      sourceSignalsUsed: uniqueStrings(project.sourceSignalsUsed || [], 6),
      estimatedEffort: String(project.estimatedEffort || project.estimatedWeeks || '').trim(),
      startUrl: normalizeProjectLink(project)
    })),
    technologies: technologies.map((technology) => ({
      ...technology,
      priorityRaw: priorityToRaw(technology.priorityRaw || technology.priority),
      confidenceScore: clamp(technology.confidenceScore || technology.jobDemand || 65),
      estimatedImpact: clamp(technology.estimatedImpact || technology.jobDemand || 65),
      reason: String(technology.reason || technology.description || '').trim(),
      evidence: uniqueStrings(technology.evidence || [], 5),
      sourceSignalsUsed: uniqueStrings(technology.sourceSignalsUsed || [], 6),
      estimatedEffort: String(technology.estimatedEffort || '2-4 weeks').trim()
    })),
    careerPaths: careerPaths.map((path, index) => ({
      ...path,
      id: path.id || `c_${index + 1}`,
      hiringCompanies: uniqueStrings(path.hiringCompanies || [], 6),
      actionItems: uniqueStrings(path.actionItems || [], 6),
      confidenceScore: clamp(path.confidenceScore || path.match || 65),
      priority: priorityToRaw(path.priority || (Number(path.match || 0) >= 75 ? 'High' : 'Medium')),
      estimatedImpact: clamp(path.estimatedImpact || path.match || 65),
      reason: String(path.reason || path.description || '').trim(),
      evidence: uniqueStrings(path.evidence || path.actionItems || [], 5),
      sourceSignalsUsed: uniqueStrings(path.sourceSignalsUsed || [], 6),
      estimatedEffort: String(path.estimatedEffort || path.timeline || '').trim(),
      exploreUrl: normalizeCareerPathLink(path)
    })),
    portfolioRecommendations: normalizeActionList(payload.portfolioRecommendations, [], 0, 4),
    resumeRecommendations: normalizeActionList(payload.resumeRecommendations, [], 0, 4),
    learningActions: normalizeActionList(payload.learningActions, [], 0, 6),
    interviewReadinessActions: normalizeActionList(payload.interviewReadinessActions, [], 0, 4)
  };
};

const buildRecommendationDataQuality = (payload = {}) => {
  const signals = payload.signalsUsed || {};
  const hasGitHubData = Boolean(Number(signals.github?.repoCount || 0) || (payload.githubSkills || []).length || (payload.githubInsights?.repositories || []).length);
  const hasResumeData = Boolean(signals.resume?.analyzed);
  const hasSkillGapData = Boolean(signals.skillGap?.present);
  const hasPortfolioData = Boolean(signals.portfolio?.present || Number(signals.portfolio?.projectCount || 0));
  const hasJobMarketData = Boolean(Number(signals.jobsDemand?.sampledJobs || 0) || (signals.jobsDemand?.topSkills || []).length);
  const sources = [hasGitHubData, hasResumeData, hasSkillGapData, hasPortfolioData, hasJobMarketData];

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
  normalized.projects = uniqueBy(normalized.projects.filter((item) => item.title), (item) => item.title.toLowerCase());
  normalized.technologies = uniqueBy(normalized.technologies.filter((item) => item.name), (item) => item.name.toLowerCase());
  normalized.careerPaths = uniqueBy(normalized.careerPaths.filter((item) => item.title), (item) => item.title.toLowerCase());
  normalized.structuredRecommendations = Object.fromEntries(
    Object.entries(normalized.structuredRecommendations || {}).map(([category, cards]) => [
      category,
      uniqueBy((Array.isArray(cards) ? cards : []).filter((card) => String(card?.title || '').trim()), (card) => String(card.title).trim().toLowerCase())
    ]).filter(([, cards]) => cards.length)
  );
  normalized.dataQuality = buildRecommendationDataQuality(normalized);
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

const loadResumeAnalysis = async (userId) => {
  if (!userId) return null;
  const userContext = await User.findById(userId)
    .select('defaultResumeFileId')
    .lean();
  const defaultResumeFileId = userContext?.defaultResumeFileId || null;
  const resumeSelect = {
    fileId: 1,
    fileName: 1,
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
  if (defaultResumeFileId) {
    const activeAnalysis = await ResumeAnalysis.findOne({ userId, fileId: defaultResumeFileId })
      .select(resumeSelect)
      .sort({ analyzedAt: -1 })
      .lean();
    if (activeAnalysis) return activeAnalysis;
  }
  return ResumeAnalysis.findOne({ userId }).select(resumeSelect).sort({ analyzedAt: -1 }).lean();
};

const getGitHubData = async (username, { forceRefresh = false, isTemporaryMode = false } = {}) => {
  const { analyzeGitHubProfile } = require('../services/githubservice');
  try {
    const normalizedUsername = String(username || '').trim().toLowerCase();
    const cached = normalizedUsername
      ? await GitHubAnalysisCache.findOne({ normalizedUsername }).sort({ updatedAt: -1 }).lean()
      : null;
    const cacheExpiresAt = cached?.expiresAt ? new Date(cached.expiresAt).getTime() : 0;
    if (!forceRefresh && cached?.result && cacheExpiresAt > Date.now()) return cached.result;

    recommendationRuntimeCounters.githubCalls += 1;
    const freshData = await analyzeGitHubProfile(String(username || '').trim(), { forceRefresh });
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
      repositories: []
    };
  }
};

const isUsableRecommendationNarrative = (value, { min = 20, max = 800 } = {}) => {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length < min || text.length > max) return false;
  if (/[{}\[\]<>]|<\/?[a-z]|lorem ipsum|as an ai\b|language model\b|i cannot\b|not sure\b|\bn\/a\b|todo\b|placeholder|sample text|test summary|leverage synerg|in today's (?:fast-paced|digital)|cutting-edge solutions/i.test(text)) {
    return false;
  }
  if ((text.match(/[!?.]/g) || []).length > 8) return false;
  return true;
};

const isRecommendationNarrativeGrounded = (text, { careerStack = '', experienceLevel = '', anchors = [] } = {}) => {
  const lower = String(text || '').toLowerCase();
  if (!lower) return false;
  if (careerStack && lower.includes(String(careerStack).toLowerCase())) return true;
  if (experienceLevel && lower.includes(String(experienceLevel).toLowerCase())) return true;
  return (Array.isArray(anchors) ? anchors : []).some((name) => {
    const token = String(name || '').trim().toLowerCase();
    return token.length >= 2 && lower.includes(token);
  });
};

const hasRecommendationFactPollution = (aiResult = {}) => {
  if (!aiResult || typeof aiResult !== 'object' || Array.isArray(aiResult)) return true;
  return Array.isArray(aiResult.projects)
    || Array.isArray(aiResult.technologies)
    || Array.isArray(aiResult.careerPaths)
    || Array.isArray(aiResult.structuredRecommendations)
    || Array.isArray(aiResult.roadmap)
    || (aiResult.recommendationScores != null && typeof aiResult.recommendationScores === 'object')
    || typeof aiResult.readinessScore === 'number'
    || typeof aiResult.overallRecommendationScore === 'number'
    || typeof aiResult.impact === 'number'
    || typeof aiResult.match === 'number'
    || typeof aiResult.jobDemand === 'number'
    || typeof aiResult.salaryRange === 'string'
    || typeof aiResult.startUrl === 'string'
    || typeof aiResult.exploreUrl === 'string'
    || typeof aiResult.priority === 'string'
    || typeof aiResult.difficulty === 'string';
};

const pickGroundedNarrative = (raw, fallbackText, context, bounds) => {
  if (!isUsableRecommendationNarrative(raw, bounds)) return fallbackText;
  const cleaned = String(raw).replace(/\s+/g, ' ').trim();
  if (!isRecommendationNarrativeGrounded(cleaned, context)) return fallbackText;
  return cleaned;
};

const pickGroundedActions = (raw, fallbackActions, min, max, context) => {
  const cleaned = (Array.isArray(raw) ? raw : [])
    .map((value) => String(value || '').replace(/\s+/g, ' ').trim())
    .filter((value) => (
      isUsableRecommendationNarrative(value, { min: 12, max: 240 })
      && isRecommendationNarrativeGrounded(value, context)
    ));
  if (cleaned.length >= min) return uniqueStrings(cleaned, max);
  return normalizeActionList(cleaned, fallbackActions, min, max);
};

const resolveRecommendationEnrichment = (aiResult, fallback = {}, {
  aiOk = false,
  careerStack = '',
  experienceLevel = '',
  anchors = []
} = {}) => {
  if (!aiOk || !aiResult || typeof aiResult !== 'object' || Array.isArray(aiResult) || aiResult.__fallback === true) {
    return { ...EMPTY_RECOMMENDATION_ENRICHMENT };
  }
  if (hasRecommendationFactPollution(aiResult)) {
    return { ...EMPTY_RECOMMENDATION_ENRICHMENT };
  }

  const context = { careerStack, experienceLevel, anchors };
  const planProjectIds = new Set((fallback.projects || []).map((item) => String(item.id || '').trim()).filter(Boolean));
  const planTechNames = new Set((fallback.technologies || []).map((item) => String(item.name || '').trim().toLowerCase()).filter(Boolean));
  const planPathIds = new Set((fallback.careerPaths || []).map((item) => String(item.id || '').trim()).filter(Boolean));

  const projectNarratives = (Array.isArray(aiResult.projectNarratives) ? aiResult.projectNarratives : [])
    .filter((item) => planProjectIds.has(String(item?.id || '').trim()))
    .map((item) => {
      const id = String(item.id || '').trim();
      const base = (fallback.projects || []).find((project) => String(project.id || '').trim() === id) || {};
      const description = pickGroundedNarrative(item.description, '', context, { min: 24, max: 500 });
      const whyThisProject = pickGroundedNarrative(item.whyThisProject, '', context, { min: 24, max: 500 });
      if (!description && !whyThisProject) return null;
      return {
        id,
        description: description || base.description || '',
        whyThisProject: whyThisProject || base.whyThisProject || ''
      };
    })
    .filter(Boolean);

  const technologyNarratives = (Array.isArray(aiResult.technologyNarratives) ? aiResult.technologyNarratives : [])
    .filter((item) => planTechNames.has(String(item?.name || '').trim().toLowerCase()))
    .map((item) => {
      const name = String(item.name || '').trim();
      const description = pickGroundedNarrative(
        item.description,
        '',
        { ...context, anchors: [...anchors, name] },
        { min: 20, max: 400 }
      );
      if (!description) return null;
      return { name, description };
    })
    .filter(Boolean);

  const careerPathNarratives = (Array.isArray(aiResult.careerPathNarratives) ? aiResult.careerPathNarratives : [])
    .filter((item) => planPathIds.has(String(item?.id || '').trim()))
    .map((item) => {
      const id = String(item.id || '').trim();
      const base = (fallback.careerPaths || []).find((path) => String(path.id || '').trim() === id) || {};
      const description = pickGroundedNarrative(item.description, '', context, { min: 24, max: 500 });
      const actionItems = pickGroundedActions(item.actionItems, [], 0, 6, context);
      if (!description && !actionItems.length) return null;
      return {
        id,
        description: description || base.description || '',
        actionItems: actionItems.length ? actionItems : (base.actionItems || [])
      };
    })
    .filter(Boolean);

  const analysisSummary = pickGroundedNarrative(aiResult.analysisSummary, '', context, { min: 40, max: 800 });
  const portfolioRecommendations = pickGroundedActions(aiResult.portfolioRecommendations, [], 0, 4, context);
  const resumeRecommendations = pickGroundedActions(aiResult.resumeRecommendations, [], 0, 4, context);
  const learningActions = pickGroundedActions(aiResult.learningActions, [], 0, 6, context);
  const interviewReadinessActions = pickGroundedActions(aiResult.interviewReadinessActions, [], 0, 4, context);

  const aiUsed = Boolean(
    analysisSummary
    || projectNarratives.length
    || technologyNarratives.length
    || careerPathNarratives.length
    || portfolioRecommendations.length
    || resumeRecommendations.length
    || learningActions.length
    || interviewReadinessActions.length
  );

  return {
    analysisSummary,
    projectNarratives,
    technologyNarratives,
    careerPathNarratives,
    portfolioRecommendations,
    resumeRecommendations,
    learningActions,
    interviewReadinessActions,
    aiUsed
  };
};

const mergeNarrativeEnrichment = (fallback, enrichment = {}) => {
  const projectNarratives = new Map((Array.isArray(enrichment.projectNarratives) ? enrichment.projectNarratives : [])
    .map((item) => [String(item?.id || '').trim(), item]));
  const technologyNarratives = new Map((Array.isArray(enrichment.technologyNarratives) ? enrichment.technologyNarratives : [])
    .map((item) => [String(item?.name || '').trim().toLowerCase(), item]));
  const careerPathNarratives = new Map((Array.isArray(enrichment.careerPathNarratives) ? enrichment.careerPathNarratives : [])
    .map((item) => [String(item?.id || '').trim(), item]));

  return {
    ...fallback,
    analysisSummary: String(enrichment.analysisSummary || fallback.analysisSummary || '').trim(),
    projects: fallback.projects.map((project) => {
      const narrative = projectNarratives.get(String(project.id || '').trim()) || {};
      return {
        ...project,
        // Deterministic titles remain authoritative; AI may only enrich narrative fields.
        description: String(narrative.description || project.description || '').trim(),
        whyThisProject: String(narrative.whyThisProject || project.whyThisProject || '').trim()
      };
    }),
    technologies: fallback.technologies.map((technology) => {
      const narrative = technologyNarratives.get(String(technology.name || '').trim().toLowerCase()) || {};
      return { ...technology, description: String(narrative.description || technology.description || '').trim() };
    }),
    careerPaths: fallback.careerPaths.map((path) => {
      const narrative = careerPathNarratives.get(String(path.id || '').trim()) || {};
      const actionItems = Array.isArray(narrative.actionItems) && narrative.actionItems.length
        ? normalizeActionList(narrative.actionItems, path.actionItems, 2, 6)
        : path.actionItems;
      return {
        ...path,
        description: String(narrative.description || path.description || '').trim(),
        actionItems
      };
    }),
    portfolioRecommendations: normalizeActionList(enrichment.portfolioRecommendations, fallback.portfolioRecommendations, 2, 4),
    resumeRecommendations: normalizeActionList(enrichment.resumeRecommendations, fallback.resumeRecommendations, 2, 4),
    learningActions: normalizeActionList(enrichment.learningActions, fallback.learningActions, 3, 6),
    interviewReadinessActions: normalizeActionList(enrichment.interviewReadinessActions, fallback.interviewReadinessActions, 2, 4),
    aiUsed: Boolean(enrichment.aiUsed)
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

const buildGithubSkills = (githubData = {}) => uniqueStrings(
  extractSkillsFromRepositories(githubData?.repositories || [], githubData?.languageDistribution || [])
    .concat((githubData?.languageDistribution || []).map((entry) => entry?.language))
    .map((skill) => canonicalizeSkillName(skill))
    .filter(Boolean),
  25
);

const buildGithubDataFromSignals = (githubSignals = {}, username = '') => {
  if (!githubSignals?.present) return null;
  return {
    repoCount: Number(githubSignals.repoCount || 0),
    developerLevel: githubSignals.developerLevel || '',
    strengths: githubSignals.strengths || [],
    weakAreas: githubSignals.weakAreas || [],
    languageDistribution: Array.isArray(githubSignals.languageDistribution) ? githubSignals.languageDistribution : [],
    technologies: Array.isArray(githubSignals.technologies) ? githubSignals.technologies : [],
    technologyCategories: githubSignals.technologyCategories || {},
    repositories: Array.isArray(githubSignals.repositories) ? githubSignals.repositories : [],
    scores: githubSignals.scores || {},
    recruiterInsights: githubSignals.recruiterInsights || {},
    githubSignals: {
      ...githubSignals,
      username: githubSignals.username || username
    },
    signalSource: 'githubSignals'
  };
};

const summarizeSignalsForAI = (developerSignals = {}) => ({
  githubSignals: {
    present: Boolean(developerSignals.githubSignals?.present),
    repoCount: Number(developerSignals.githubSignals?.repoCount || 0),
    developerLevel: developerSignals.githubSignals?.developerLevel || '',
    topLanguages: (developerSignals.githubSignals?.languageDistribution || []).slice(0, 8),
    topTechnologies: (developerSignals.githubSignals?.technologies || []).slice(0, 8).map((tech) => tech?.name || tech?.technology || tech).filter(Boolean),
    weakAreas: developerSignals.githubSignals?.weakAreas || []
  },
  resumeSignals: {
    analyzed: Boolean(developerSignals.resumeSignals?.analyzed),
    atsScore: Number(developerSignals.resumeSignals?.atsScore || 0),
    skills: (developerSignals.resumeSignals?.skills || []).slice(0, 16),
    weaknesses: (developerSignals.resumeSignals?.weaknesses || []).slice(0, 8),
    missingSections: (developerSignals.resumeSignals?.missingSections || []).slice(0, 8)
  },
  skillGapSignals: {
    present: Boolean(developerSignals.skillGapSignals?.present),
    coverage: Number(developerSignals.skillGapSignals?.coverage || 0),
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

const buildRecommendationEvidence = ({ resumeInsights, githubData, careerStack }) => {
  const resumeSkills = uniqueStrings((resumeInsights?.technicalSkills || resumeInsights?.skills || []).map((skill) => canonicalizeSkillName(skill)).filter(Boolean), 25);
  const githubSkills = buildGithubSkills(githubData);
  const githubLookup = new Set(githubSkills.map((skill) => skill.toLowerCase()));
  const claimedButNotProvenSkills = resumeSkills.filter((skill) => !githubLookup.has(skill.toLowerCase()));
  const provenSkills = resumeSkills.filter((skill) => githubLookup.has(skill.toLowerCase()));
  const deploymentKeywords = ['deployment', 'aws', 'docker', 'kubernetes', 'ci/cd', 'cloud'];
  const resumeKeywordLookup = new Set(
    [
      ...(resumeInsights?.experienceKeywords || []),
      ...(resumeInsights?.skills || []),
      ...(resumeInsights?.weaknesses || []),
      ...(resumeInsights?.missingSections || [])
    ].map((value) => String(value || '').toLowerCase())
  );
  const hasDeploymentSignal = deploymentKeywords.some((keyword) => {
    const normalized = keyword.toLowerCase();
    return resumeKeywordLookup.has(normalized)
      || githubSkills.some((skill) => skill.toLowerCase().includes(normalized))
      || (resumeInsights?.skills || []).some((skill) => String(skill || '').toLowerCase().includes(normalized));
  });

  return {
    resumeSkills,
    githubSkills,
    provenSkills,
    claimedButNotProvenSkills,
    hasDeploymentSignal,
    preferredProjectTech: uniqueStrings([
      ...(STACK_PROJECT_HINTS[careerStack] || STACK_PROJECT_HINTS['Full Stack']),
      ...provenSkills,
      ...githubSkills
    ], 8)
  };
};

const buildRecommendationFallback = ({
  username,
  careerStack,
  experienceLevel,
  knownSkills,
  missingSkills,
  resumeInsights,
  githubInsights,
  developerSignals,
  recommendationEvidence
}) => {
  const sprintSignal = developerSignals.careerSprintSignal || {};
  const weeklySignal = developerSignals.weeklyReportSignal || {};
  const portfolioSignal = developerSignals.portfolioSignal || {};
  const integrationSignal = developerSignals.integrationSignal || {};
  const skillGapSignal = developerSignals.skillGapSignals || {};
  const jobsDemandSignal = developerSignals.jobsDemandSignal || {};
  const completedTopics = new Set(uniqueStrings([
    ...(sprintSignal.completedSkillSignals || []),
    ...(weeklySignal.skillsImprovedThisWeek || [])
  ], 20).map((skill) => skill.toLowerCase()));
  const highDemandSkills = uniqueStrings((jobsDemandSignal.topSkills || []).map((skill) => skill?.name || skill), 10);

  const focusSkills = uniqueStrings([
    ...(skillGapSignal.immediateSkills || []),
    ...(skillGapSignal.weakSkills || []),
    ...(recommendationEvidence?.claimedButNotProvenSkills || []),
    ...missingSkills,
    ...highDemandSkills,
    ...(weeklySignal.repeatedWeakAreas || []),
    ...(sprintSignal.repeatedIncompleteSkills || []),
    ...(integrationSignal.weakProof || [])
  ], 10).filter((skill) => !completedTopics.has(skill.toLowerCase())).slice(0, 6);
  const baseTech = uniqueStrings(recommendationEvidence?.preferredProjectTech?.length
    ? recommendationEvidence.preferredProjectTech
    : knownSkills, 5);
  const firstProofGap = recommendationEvidence?.claimedButNotProvenSkills?.[0] || '';
  const missingKeywordHint = resumeInsights?.weaknesses?.[0] || resumeInsights?.missingSections?.[0] || '';
  const summaryParts = [
    githubInsights.repoCount > 0 ? `${username} has ${githubInsights.repoCount} repositories contributing live code evidence` : 'GitHub signal is currently limited',
    resumeInsights.atsScore ? `resume ATS signal is ${resumeInsights.atsScore}` : 'resume ATS signal is limited',
    portfolioSignal.completenessScore ? `portfolio completeness is ${portfolioSignal.completenessScore}%` : 'portfolio evidence is still thin',
    weeklySignal.weeklyProgressScore ? `weekly progress is ${weeklySignal.weeklyProgressScore}%` : 'weekly progress data is limited'
  ];

  const projectFocusSkills = uniqueStrings([
    firstProofGap,
    ...focusSkills,
    ...(recommendationEvidence?.hasDeploymentSignal ? [] : ['Deployment'])
  ], 4);

  const projectTemplates = projectFocusSkills.slice(0, 3).map((skill, index) => ({
    id: `p_${index + 1}`,
    title: `${careerStack} ${skill} Builder`,
    description: `Ship a scoped ${careerStack.toLowerCase()} project that proves ${skill} with measurable functionality and clean delivery.`,
    tech: baseTech,
    newTech: skill ? [skill] : [],
    difficulty: sprintSignal.consistencyScore < 45 ? 'Beginner' : experienceLevel.includes('5+') ? 'Advanced' : 'Intermediate',
    impact: clamp(72 + (index * 6) + (weeklySignal.weeklyProgressScore >= 70 ? 8 : 0)),
    estimatedWeeks: sprintSignal.consistencyScore < 45 ? '1-2 weeks' : '2-4 weeks',
    whyThisProject: `This directly addresses ${skill} while keeping the build realistic for ${experienceLevel} level progression.`,
    evidence: uniqueStrings([
      skill ? `Focus skill: ${skill}` : '',
      firstProofGap ? `Resume-to-GitHub proof gap: ${firstProofGap}` : '',
      portfolioSignal.completenessScore < 60 ? 'Portfolio proof needs improvement' : ''
    ], 4),
    sourceSignalsUsed: sourceList('githubSignals', 'resumeSignals', 'skillGapSignals', portfolioSignal.present ? 'portfolioSignals' : ''),
    priority: index === 0 ? 'High' : 'Medium',
    confidenceScore: clamp(74 + (index * 5) + (skillGapSignal.present ? 8 : 0)),
    estimatedImpact: clamp(76 + (index * 5)),
    estimatedEffort: sprintSignal.consistencyScore < 45 ? 'Low to medium' : 'Medium',
    startUrl: toSearchUrl(`${careerStack} ${skill} project tutorial`)
  }));

  const technologyTemplates = focusSkills.slice(0, 6).map((skill, index) => ({
    name: skill,
    category: highDemandSkills.some((candidate) => candidate.toLowerCase() === String(skill).toLowerCase()) ? 'Market Demand' : index < 2 ? 'Priority Gap' : 'Growth Opportunity',
    priority: index < 2 ? 'Must Learn' : index < 4 ? 'High' : 'Medium',
    priorityRaw: index < 2 ? 'High' : index < 4 ? 'High' : 'Medium',
    jobDemand: clamp((jobsDemandSignal.topSkills || []).find((item) => String(item?.name || '').toLowerCase() === String(skill).toLowerCase())?.demandScore || (88 - (index * 4))),
    description: `${skill} is showing up as a meaningful gap across your current code, profile, progress, or job-market signals.`,
    evidence: uniqueStrings([
      skillGapSignal.missingSkills?.includes(skill) ? 'Skill gap signal' : '',
      skillGapSignal.weakSkills?.includes(skill) ? 'Weak skill signal' : '',
      highDemandSkills.some((candidate) => candidate.toLowerCase() === String(skill).toLowerCase()) ? 'Jobs Hub demand' : ''
    ], 4),
    sourceSignalsUsed: sourceList('skillGapSignals', 'weeklyReportSignals', 'careerSprintSignals', highDemandSkills.includes(skill) ? 'jobMarketSignals' : '')
  }));

  // Build signal-derived career paths instead of hardcoded templates.
  // Paths are only included when backed by real signals: careerStack, experienceLevel,
  // skillGap, jobs demand, and recommendation evidence.
  const careerPaths = [];
  const hasSufficientEvidence =
    (knownSkills.length >= 1 || githubInsights.repoCount > 0 || resumeInsights.atsScore > 0) &&
    (jobsDemandSignal.present || skillGapSignal.present || githubInsights.repoCount > 0);

  // Primary path: derived from careerStack and experienceLevel
  if (hasSufficientEvidence) {
    const primaryEvidence = uniqueStrings([
      careerStack,
      experienceLevel,
      ...(jobsDemandSignal.topSkills || []).slice(0, 3).map((skill) => skill?.name || skill),
      ...(skillGapSignal.immediateSkills || []).slice(0, 2)
    ], 5);
    careerPaths.push({
      id: 'c_1',
      title: `${careerStack} Engineer`,
      match: clamp(72 + Math.min(14, knownSkills.length) + (jobsDemandSignal.present ? 6 : 0)),
      salaryRange: 'Market dependent',
      description: `Primary career path derived from your ${careerStack} stack alignment, ${experienceLevel} experience level, and ${knownSkills.length} detected skills.`,
      timeline: sprintSignal.consistencyScore < 45 ? '4-8 months' : '3-6 months',
      hiringCompanies: [],
      actionItems: normalizeActionList([
        focusSkills[0] ? `Convert ${focusSkills[0]} into a shipped project` : '',
        resumeInsights.keyAchievements?.[0] ? `Quantify ${resumeInsights.keyAchievements[0]} on your resume` : '',
        jobsDemandSignal.topSkills?.[0] ? `Align your portfolio with in-demand skills like ${jobsDemandSignal.topSkills[0]?.name || jobsDemandSignal.topSkills[0]}` : ''
      ], [], 1, 4),
      evidence: primaryEvidence,
      sourceSignalsUsed: sourceList('careerProfile', 'skillGapSignals', 'resumeSignals', 'githubSignals', jobsDemandSignal.present ? 'jobMarketSignals' : ''),
      priority: 'High',
      confidenceScore: clamp(72 + Math.min(14, knownSkills.length) + (jobsDemandSignal.present ? 8 : 0)),
      estimatedImpact: 82,
      estimatedEffort: sprintSignal.consistencyScore < 45 ? '4-8 months' : '3-6 months',
      exploreUrl: toSearchUrl(`${careerStack} engineer roadmap`)
    });
  }

  // Secondary path: only if jobs demand data exists with alternative stack alignment
  if (jobsDemandSignal.present && jobsDemandSignal.topSkills?.length >= 3) {
    const altSkills = jobsDemandSignal.topSkills
      .map((skill) => skill?.name || skill)
      .filter(Boolean)
      .slice(0, 5);
    const altSkillStr = altSkills.slice(0, 3).join(', ');
    careerPaths.push({
      id: 'c_2',
      title: `${careerStack} Specialist`,
      match: clamp(60 + Math.min(10, altSkills.length * 6)),
      salaryRange: 'Market dependent',
      description: `A specialized path for ${careerStack} developers focusing on high-demand market skills: ${altSkillStr}.`,
      timeline: '4-8 months',
      hiringCompanies: [],
      actionItems: normalizeActionList([
        `Focus learning on ${altSkills[0] || 'a high-demand skill'} to improve market visibility`,
        `Add ${altSkillStr} proof to your GitHub repositories`
      ], [], 2, 4),
      evidence: altSkills,
      sourceSignalsUsed: sourceList('jobMarketSignals', 'skillGapSignals'),
      priority: 'Medium',
      confidenceScore: clamp(58 + Math.min(10, altSkills.length * 6)),
      estimatedImpact: 72,
      estimatedEffort: '4-8 months',
      exploreUrl: toSearchUrl(`${careerStack} ${altSkills[0] || ''} specialist roadmap`)
    });
  }

  // Note: No generic third path is added. If insufficient evidence exists,
  // careerPaths remains minimal (0-2 items) instead of showing hardcoded templates.

  return normalizeRecommendationPayload({
    analysisSummary: `${summaryParts[0]}, ${summaryParts[1]}, ${summaryParts[2]}, and ${summaryParts[3]}. Recommendations therefore prioritize ${projectFocusSkills[0] || 'the highest-value missing proof'} through realistic next steps.`,
    projects: projectTemplates,
    technologies: technologyTemplates,
    careerPaths,
    portfolioRecommendations: normalizeActionList([
      portfolioSignal.completenessScore < 60 ? 'Add 2 polished project case studies with outcomes and screenshots' : '',
      portfolioSignal.liveLinks < Math.min(2, portfolioSignal.listedProjects || 0) ? 'Add working live links for your strongest public projects' : '',
      !portfolioSignal.present ? 'Create a public portfolio page that highlights your strongest shipped work' : '',
      !recommendationEvidence?.hasDeploymentSignal ? 'Add at least one deployed project so cloud and delivery proof shows up in your portfolio' : ''
    ], ['Refresh project summaries so recruiters can scan impact quickly'], 2, 4),
    resumeRecommendations: normalizeActionList([
      resumeInsights.atsScore < 70 ? 'Increase ATS alignment by mirroring target-role keywords naturally in experience bullets' : '',
      !resumeInsights.keyAchievements?.length ? 'Add quantified impact bullets for your most relevant projects and roles' : '',
      resumeInsights.keywordDensity < 55 ? 'Tighten skill-to-experience alignment so core stack keywords appear with evidence' : '',
      firstProofGap ? `If you claim ${firstProofGap} on the resume, add a GitHub project that clearly proves it` : '',
      missingKeywordHint ? `Address this resume gap explicitly: ${missingKeywordHint}` : '',
      resumeInsights.missingSections?.length ? `Fill missing resume sections such as ${resumeInsights.missingSections.slice(0, 2).join(' and ')}` : ''
    ], ['Review resume bullets for stronger measurable outcomes'], 2, 4),
    learningActions: normalizeActionList([
      sprintSignal.consistencyScore < 45 ? `Break ${focusSkills[0] || 'your next gap'} into 30-45 minute sessions instead of one large weekly task` : '',
      weeklySignal.weeklyProgressScore < 50 ? 'Pick one priority gap and finish a proof-of-work artifact before adding another topic' : '',
      sprintSignal.repeatedIncompleteSkills?.[0] ? `Resolve the repeated incomplete area around ${sprintSignal.repeatedIncompleteSkills[0]}` : '',
      focusSkills[0] ? `Practice ${focusSkills[0]} inside a real repository rather than isolated notes only` : '',
      firstProofGap ? `Turn your claimed ${firstProofGap} experience into visible GitHub proof this month` : ''
    ], ['Stay consistent with one focused learning goal this week'], 3, 6),
    interviewReadinessActions: normalizeActionList([
      integrationSignal.usedProviders.includes('leetcode') ? '' : 'Start a lightweight DSA routine to strengthen coding interview readiness',
      githubInsights.weakAreas?.[0] ? `Prepare concise explanations for ${githubInsights.weakAreas[0]} tradeoffs in interviews` : '',
      resumeInsights.keyAchievements?.[0] ? `Turn "${resumeInsights.keyAchievements[0]}" into a STAR-style interview story` : 'Prepare two project stories with measurable outcomes'
    ], ['Practice explaining one shipped project end-to-end'], 2, 4)
  });
};

const loadDeveloperSignalsSafely = async ({ userId, username, resumeInsights, githubInsights, allowSignals }) => {
  if (!allowSignals || !userId) {
    const emptySignals = {
      githubSignals: { present: false, repoCount: 0, developerLevel: '', strengths: [], weakAreas: [], languageDistribution: [], repositories: [], scores: {}, updatedAt: null },
      resumeSignals: { analyzed: false, analysisId: 'no-resume', atsScore: 0, skills: [], weaknesses: [], missingSections: [], statusMessage: 'Resume not analyzed yet' },
      skillGapSignals: { present: false, knownSkills: [], missingSkills: [], weakSkills: [], highDemandSkills: [], coverage: 0, updatedAt: null },
      careerSprintSignal: { present: false, completedTasks: 0, missedTasks: 0, streak: 0, consistencyScore: 0, activeLearningFocus: '', repeatedIncompleteSkills: [], completedSkillSignals: [], progressPercent: 0, status: 'Unavailable', updatedAt: null },
      weeklyReportSignal: { present: false, weeklyProgressScore: 0, status: 'Unavailable', completedRecommendations: null, missedRecommendations: null, skillsImprovedThisWeek: [], repeatedWeakAreas: [], trendDelta: 0, updatedAt: null },
      portfolioSignal: { present: false, completenessScore: 0, listedProjects: 0, liveLinks: 0, githubLinks: 0, contactVisibility: false, projectPresentationQuality: 0, publicEnabled: false, portfolioSkills: [], updatedAt: null },
      integrationSignal: { present: false, usedProviders: [], integrationScore: 0, strongestProof: [], weakProof: [], detectedSkills: [], certifications: [], updatedAt: null },
      careerProfileSignal: { present: false, careerStack: '', experienceLevel: '', careerGoal: '', githubUsername: '', updatedAt: null },
      jobsDemandSignal: { present: false, sampledJobs: 0, topSkills: [], updatedAt: null }
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

const resolveKnownAndMissingSkills = async ({
  userId,
  username,
  careerStack,
  experienceLevel,
  resumeCacheIdentity,
  resumeSkills,
  githubData,
  resumeInsights,
  githubInsights,
  developerSignals,
  recommendationEvidence,
  providedKnownSkills,
  providedMissingSkills
}) => {
  let knownSkills = Array.isArray(providedKnownSkills) ? providedKnownSkills : null;
  let missingSkills = Array.isArray(providedMissingSkills) ? providedMissingSkills : null;
  const skillGapSignals = developerSignals.skillGapSignals || {};

  if (!knownSkills || !missingSkills) {
    const cachedGap = (skillGapSignals.present || !userId) ? null : await AnalysisCache.findOne({
      userId,
      githubUsername: username,
      careerStack,
      experienceLevel,
      resumeHash: resumeCacheIdentity.resumeHash,
      resumeAnalysisId: resumeCacheIdentity.resumeAnalysisId,
      analysisVersion: SKILL_GAP_LOOKUP_VERSION
    }).lean();

    if (skillGapSignals.present) {
      missingSkills = missingSkills || skillGapSignals.missingSkills || [];
      knownSkills = knownSkills || skillGapSignals.knownSkills || [];
    } else if (cachedGap?.analysisData?.missingSkills?.length) {
      missingSkills = missingSkills || cachedGap.analysisData.missingSkills.map((skill) => skill.name || skill);
      knownSkills = knownSkills || (cachedGap.analysisData.yourSkills?.map((skill) => skill.name || skill) ?? []);
    } else {
      const deterministicKnown = uniqueStrings([
        ...resumeSkills,
        ...(recommendationEvidence?.provenSkills || []),
        ...(recommendationEvidence?.githubSkills || []),
        ...(githubData?.languageDistribution || []).map((language) => language.language),
        ...(developerSignals.integrationSignal?.detectedSkills || []),
        ...(developerSignals.portfolioSignal?.portfolioSkills || []),
        ...(developerSignals.careerSprintSignal?.completedSkillSignals || [])
      ], 30);
      const deterministicGap = detectSkillGaps(deterministicKnown);
      knownSkills = knownSkills || deterministicGap.currentSkills.map((skill) => skill.name);
      missingSkills = missingSkills || deterministicGap.missingSkills
        .filter((skill) => (
          skill.priority === 'High'
          || (developerSignals.jobsDemandSignal?.topSkills || []).some((demandSkill) =>
            String(demandSkill?.name || '').toLowerCase() === skill.name.toLowerCase()
          )
        ))
        .map((skill) => skill.name);
    }
  }

  const integrationSkills = developerSignals.integrationSignal?.detectedSkills || [];
  const sprintEvidenceSkills = developerSignals.careerSprintSignal?.completedSkillSignals || [];
  const portfolioSkills = developerSignals.portfolioSignal?.portfolioSkills || [];

  return {
    knownSkills: uniqueStrings([
      ...(knownSkills || []),
      ...(recommendationEvidence?.provenSkills || []),
      ...resumeSkills,
      ...(recommendationEvidence?.githubSkills || []),
      ...(githubData?.languageDistribution || []).map((language) => language.language),
      ...integrationSkills,
      ...sprintEvidenceSkills,
      ...portfolioSkills
    ], 30),
    missingSkills: uniqueStrings(
      [
      ...(recommendationEvidence?.claimedButNotProvenSkills || []),
      ...((missingSkills || []).map((skill) => toSkillName(skill)).filter(Boolean)),
      ...(skillGapSignals.weakSkills || []),
      ...(skillGapSignals.immediateSkills || [])
    ],
    20
  )
  };
};

const makeRecommendationCard = ({
  id,
  category,
  title,
  description,
  priority = 'Medium',
  confidenceScore = 70,
  reason = '',
  evidence = [],
  sourceSignalsUsed = [],
  estimatedImpact = 70,
  estimatedEffort = 'Medium',
  actionUrl = '',
  actionLabel = 'Open'
}) => ({
  id,
  category,
  title: String(title || '').trim(),
  description: String(description || '').trim(),
  priority: priorityToRaw(priority),
  confidenceScore: clamp(confidenceScore),
  reason: String(reason || description || '').trim(),
  evidence: uniqueStrings(evidence, 6),
  sourceSignalsUsed: uniqueStrings(sourceSignalsUsed, 8),
  estimatedImpact: clamp(estimatedImpact),
  estimatedEffort: String(estimatedEffort || 'Medium').trim(),
  actionUrl,
  actionLabel
});

const buildRecommendationScores = ({ resumeInsights, githubInsights, developerSignals, resolvedSkills, recommendationEvidence }) => {
  const skillGapSignal = developerSignals.skillGapSignals || {};
  const portfolioSignal = developerSignals.portfolioSignal || {};
  const weeklySignal = developerSignals.weeklyReportSignal || {};
  const sprintSignal = developerSignals.careerSprintSignal || {};
  const integrationSignal = developerSignals.integrationSignal || {};
  const jobsDemandSignal = developerSignals.jobsDemandSignal || {};

  const skillCoverage = skillGapSignal.present
    ? clamp(skillGapSignal.coverage)
    : clamp((resolvedSkills.knownSkills.length / Math.max(resolvedSkills.knownSkills.length + resolvedSkills.missingSkills.length, 1)) * 100);
  const githubScore = clamp(githubInsights.scores?.healthScore || githubInsights.scores?.activity || githubInsights.scores?.architecture || 0);
  const resumeScore = clamp(average([
    resumeInsights.atsScore,
    resumeInsights.keywordDensity,
    resumeInsights.formatScore,
    resumeInsights.contentQuality
  ]));
  const portfolioScore = clamp(average([
    portfolioSignal.completenessScore,
    portfolioSignal.projectPresentationQuality,
    portfolioSignal.liveLinks > 0 ? 80 : 35,
    portfolioSignal.githubLinks > 0 ? 80 : 40
  ]));
  const learningScore = clamp(average([
    skillCoverage,
    sprintSignal.consistencyScore,
    weeklySignal.weeklyProgressScore
  ]));
  const interviewScore = clamp(average([
    resumeScore,
    githubScore,
    integrationSignal.usedProviders?.includes('leetcode') ? 78 : 45,
    recommendationEvidence?.provenSkills?.length ? 72 : 45
  ]));
  const highDemandCoverage = uniqueStrings([
    ...(resolvedSkills.knownSkills || []),
    ...(recommendationEvidence?.provenSkills || [])
  ], 40);
  const highDemandKnown = (jobsDemandSignal.topSkills || []).filter((skill) =>
    highDemandCoverage.some((known) => known.toLowerCase() === String(skill?.name || '').toLowerCase())
  ).length;
  const marketReadinessScore = clamp(average([
    skillCoverage,
    jobsDemandSignal.present ? Math.min(100, (highDemandKnown / Math.max(jobsDemandSignal.topSkills.length, 1)) * 100 + 45) : 55,
    resumeScore,
    portfolioScore
  ]));
  const readinessScore = clamp(average([githubScore, resumeScore, skillCoverage, integrationSignal.integrationScore]));
  const careerGrowthScore = clamp(average([
    learningScore,
    weeklySignal.weeklyProgressScore,
    sprintSignal.consistencyScore,
    portfolioScore
  ]));
  const overallRecommendationScore = clamp(average([
    readinessScore,
    portfolioScore,
    learningScore,
    interviewScore,
    marketReadinessScore,
    careerGrowthScore
  ]));

  return {
    readinessScore,
    portfolioScore,
    learningScore,
    interviewScore,
    marketReadinessScore,
    careerGrowthScore,
    overallRecommendationScore,
    explanation: {
      readinessScore: 'GitHub health, resume quality, skill coverage, and integration proof.',
      portfolioScore: 'Portfolio completeness, presentation quality, live links, and GitHub links.',
      learningScore: 'Skill coverage blended with Career Sprint consistency and Weekly Report progress.',
      interviewScore: 'Resume story strength, GitHub proof, coding-practice integrations, and proven skills.',
      marketReadinessScore: 'Skill coverage weighted toward Jobs Hub high-demand skills.',
      careerGrowthScore: 'Learning momentum, weekly progress, sprint consistency, and portfolio proof.',
      overallRecommendationScore: 'Average of readiness, portfolio, learning, interview, market, and growth scores.'
    }
  };
};

const buildStructuredRecommendations = ({ result, developerSignals, scores }) => {
  const skillGapSignal = developerSignals.skillGapSignals || {};
  const portfolioSignal = developerSignals.portfolioSignal || {};
  const resumeSignal = developerSignals.resumeSignals || {};
  const jobsDemandSignal = developerSignals.jobsDemandSignal || {};
  const integrationSignal = developerSignals.integrationSignal || {};
  const sprintSignal = developerSignals.careerSprintSignal || {};

  const cards = [
    ...(result.learningActions || []).map((action, index) => makeRecommendationCard({
      id: `learn_${index + 1}`,
      category: 'Learning Recommendations',
      title: action,
      description: action,
      priority: index < 2 ? 'High' : 'Medium',
      confidenceScore: skillGapSignal.present ? 86 : 70,
      reason: 'This action targets active skill gaps without repeating completed sprint progress.',
      evidence: uniqueStrings([...(skillGapSignal.missingSkills || []), ...(skillGapSignal.weakSkills || [])], 5),
      sourceSignalsUsed: sourceList('skillGapSignals', 'careerSprintSignals', 'weeklyReportSignals', 'jobMarketSignals'),
      estimatedImpact: scores.learningScore >= 70 ? 70 : 86,
      estimatedEffort: '1-2 weeks',
      actionUrl: '/app/courses',
      actionLabel: 'Open Learning Hub'
    })),
    ...(result.projects || []).map((project, index) => makeRecommendationCard({
      id: `project_${project.id || index + 1}`,
      category: 'Project Recommendations',
      title: project.title,
      description: project.description,
      priority: project.priority || (index < 2 ? 'High' : 'Medium'),
      confidenceScore: project.confidenceScore || project.impact,
      reason: project.reason || project.whyThisProject,
      evidence: project.evidence || project.newTech || [],
      sourceSignalsUsed: project.sourceSignalsUsed || sourceList('githubSignals', 'resumeSignals', 'skillGapSignals', 'portfolioSignals'),
      estimatedImpact: project.estimatedImpact || project.impact,
      estimatedEffort: project.estimatedEffort || project.estimatedWeeks,
      actionUrl: project.startUrl,
      actionLabel: 'Start Project'
    })),
    ...(result.technologies || []).map((technology, index) => makeRecommendationCard({
      id: `tech_${index + 1}_${String(technology.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
      category: 'Technology Recommendations',
      title: technology.name,
      description: technology.description,
      priority: technology.priorityRaw || technology.priority,
      confidenceScore: technology.confidenceScore || technology.jobDemand,
      reason: technology.reason || technology.description,
      evidence: technology.evidence || [`Job demand ${technology.jobDemand || 0}%`],
      sourceSignalsUsed: technology.sourceSignalsUsed || sourceList('skillGapSignals', 'jobMarketSignals'),
      estimatedImpact: technology.estimatedImpact || technology.jobDemand,
      estimatedEffort: technology.estimatedEffort || '2-4 weeks',
      actionUrl: '/app/skill-gap',
      actionLabel: 'Open Skill Gap'
    })),
    ...(result.portfolioRecommendations || []).map((action, index) => makeRecommendationCard({
      id: `portfolio_${index + 1}`,
      category: 'Portfolio Recommendations',
      title: action,
      description: action,
      priority: portfolioSignal.completenessScore < 60 ? 'High' : 'Medium',
      confidenceScore: 84,
      reason: 'Portfolio proof affects recruiter trust and project scan quality.',
      evidence: [`Completeness ${portfolioSignal.completenessScore || 0}%`, `${portfolioSignal.liveLinks || 0} live links`],
      sourceSignalsUsed: sourceList('portfolioSignals', 'githubSignals'),
      estimatedImpact: portfolioSignal.completenessScore < 60 ? 88 : 70,
      estimatedEffort: '1-3 days',
      actionUrl: '/app/portfolio',
      actionLabel: 'Open Portfolio'
    })),
    ...(result.resumeRecommendations || []).map((action, index) => makeRecommendationCard({
      id: `resume_${index + 1}`,
      category: 'Resume Recommendations',
      title: action,
      description: action,
      priority: resumeSignal.atsScore < 70 ? 'High' : 'Medium',
      confidenceScore: resumeSignal.analyzed ? 88 : 65,
      reason: 'Resume changes improve ATS match and make project evidence easier to evaluate.',
      evidence: [`ATS ${resumeSignal.atsScore || 0}`, ...(resumeSignal.weaknesses || []).slice(0, 3)],
      sourceSignalsUsed: sourceList('resumeSignals', 'skillGapSignals', 'githubSignals'),
      estimatedImpact: resumeSignal.atsScore < 70 ? 84 : 68,
      estimatedEffort: '1-2 days',
      actionUrl: '/app/resume-analyzer',
      actionLabel: 'Open Resume'
    })),
    ...(result.interviewReadinessActions || []).map((action, index) => makeRecommendationCard({
      id: `interview_${index + 1}`,
      category: 'Interview Recommendations',
      title: action,
      description: action,
      priority: scores.interviewScore < 65 ? 'High' : 'Medium',
      confidenceScore: 78,
      reason: 'Interview readiness should convert your strongest evidence into clear, practiced stories.',
      evidence: uniqueStrings([...(resumeSignal.strengths || []), ...(integrationSignal.strongestProof || [])], 5),
      sourceSignalsUsed: sourceList('resumeSignals', 'githubSignals', 'integrationSignals'),
      estimatedImpact: scores.interviewScore < 65 ? 82 : 65,
      estimatedEffort: '3-5 focused sessions',
      actionUrl: '/app/interview-prep',
      actionLabel: 'Open Interview Prep'
    })),
    makeRecommendationCard({
      id: 'job_readiness_1',
      category: 'Job Readiness Recommendations',
      title: scores.marketReadinessScore >= 75 ? 'Start applying to tightly matched roles' : 'Close market-facing skill gaps before broad applications',
      description: scores.marketReadinessScore >= 75
        ? 'Your current profile has enough market alignment to begin targeted applications.'
        : 'Focus applications around roles that match proven skills while closing high-demand gaps.',
      priority: scores.marketReadinessScore >= 75 ? 'Medium' : 'High',
      confidenceScore: 82,
      reason: 'Jobs Hub demand and skill coverage determine how broadly you should apply.',
      evidence: (jobsDemandSignal.topSkills || []).slice(0, 5).map((skill) => skill.name),
      sourceSignalsUsed: sourceList('jobMarketSignals', 'skillGapSignals', 'resumeSignals'),
      estimatedImpact: 84,
      estimatedEffort: '1 week',
      actionUrl: '/app/jobs',
      actionLabel: 'Open Jobs'
    }),
    makeRecommendationCard({
      id: 'certification_1',
      category: 'Certification Recommendations',
      title: integrationSignal.certifications?.length ? 'Use existing certifications as proof in portfolio and resume' : 'Add one market-relevant certification only if it supports a target gap',
      description: integrationSignal.certifications?.length
        ? 'Existing certifications should be surfaced where recruiters already scan.'
        : 'Prioritize practical proof first; choose certification when it strengthens AWS, cloud, security, or data credibility.',
      priority: integrationSignal.certifications?.length ? 'Medium' : 'Low',
      confidenceScore: 68,
      reason: 'Certifications matter most when they support a job-market gap or external proof source.',
      evidence: uniqueStrings([...(integrationSignal.certifications || []), ...(jobsDemandSignal.topSkills || []).map((skill) => skill.name)], 5),
      sourceSignalsUsed: sourceList('integrationSignals', 'jobMarketSignals'),
      estimatedImpact: 58,
      estimatedEffort: '2-6 weeks',
      actionUrl: '/app/integrations',
      actionLabel: 'Open Integrations'
    }),
    makeRecommendationCard({
      id: 'open_source_1',
      category: 'Open Source Recommendations',
      title: 'Contribute one small fix or documentation improvement in your target stack',
      description: 'A scoped contribution builds collaboration proof without derailing your core project roadmap.',
      priority: sprintSignal.consistencyScore < 45 ? 'Low' : 'Medium',
      confidenceScore: 66,
      reason: 'Open-source proof is useful after your main portfolio and learning loop are stable.',
      evidence: uniqueStrings([...(result.githubSkills || []), sprintSignal.activeLearningFocus], 5),
      sourceSignalsUsed: sourceList('githubSignals', 'careerSprintSignals'),
      estimatedImpact: 62,
      estimatedEffort: '2-4 days',
      actionUrl: 'https://github.com/search?q=good+first+issue&type=issues',
      actionLabel: 'Find Issues'
    }),
    ...(result.careerPaths || []).map((path, index) => makeRecommendationCard({
      id: `career_${path.id || index + 1}`,
      category: 'Career Growth Recommendations',
      title: path.title,
      description: path.description,
      priority: path.priority || (index === 0 ? 'High' : 'Medium'),
      confidenceScore: path.confidenceScore || path.match,
      reason: path.reason || path.description,
      evidence: path.evidence || path.actionItems || [],
      sourceSignalsUsed: path.sourceSignalsUsed || sourceList('careerProfile', 'skillGapSignals', 'jobMarketSignals'),
      estimatedImpact: path.estimatedImpact || path.match,
      estimatedEffort: path.estimatedEffort || path.timeline,
      actionUrl: path.exploreUrl,
      actionLabel: 'Explore'
    }))
  ].filter((card) => card.title);

  const deduped = uniqueBy(cards, (item) => `${item.category}:${item.title}`.toLowerCase());
  const grouped = deduped.reduce((accumulator, card) => {
    if (!accumulator[card.category]) accumulator[card.category] = [];
    accumulator[card.category].push(card);
    return accumulator;
  }, {});

  Object.keys(grouped).forEach((category) => {
    grouped[category] = sortByPriorityImpact(grouped[category]).slice(0, 8);
  });

  return grouped;
};

const buildRecommendationRoadmap = ({ result, structuredRecommendations, developerSignals }) => {
  const priorityActions = sortByPriorityImpact(Object.values(structuredRecommendations).flat()).slice(0, 12);
  const techNames = uniqueStrings((result.technologies || []).map((tech) => tech.name), 8);
  const projectTitles = uniqueStrings((result.projects || []).map((project) => project.title), 6);
  const certificationCards = structuredRecommendations['Certification Recommendations'] || [];

  return {
    immediateActions: priorityActions.slice(0, 4),
    next30Days: priorityActions.slice(0, 5),
    next60Days: priorityActions.slice(3, 8),
    next90Days: priorityActions.slice(6, 11),
    longTermGrowth: structuredRecommendations['Career Growth Recommendations'] || [],
    suggestedProjects: result.projects || [],
    suggestedCertifications: certificationCards,
    suggestedTechnologies: result.technologies || [],
    suggestedLearningPath: uniqueStrings([
      ...(developerSignals.skillGapSignals?.immediateSkills || []),
      ...(result.learningActions || []),
      ...techNames
    ], 12),
    timeline: [
      { label: 'Immediate Actions', items: priorityActions.slice(0, 4).map((item) => item.title) },
      { label: 'Next 30 Days', items: priorityActions.slice(0, 5).map((item) => item.title) },
      { label: 'Next 60 Days', items: priorityActions.slice(3, 8).map((item) => item.title) },
      { label: 'Next 90 Days', items: priorityActions.slice(6, 11).map((item) => item.title) },
      { label: 'Long-Term Growth', items: uniqueStrings([...(structuredRecommendations['Career Growth Recommendations'] || []).map((item) => item.title), ...projectTitles], 6) }
    ]
  };
};

const buildRecommendationSignals = ({ result, scores, developerSignals, signalHash, cacheKey }) => ({
  version: RECOMMENDATION_ANALYSIS_VERSION,
  generatedAt: new Date().toISOString(),
  signalHash,
  cacheKey,
  scores,
  priorityRecommendations: sortByPriorityImpact(Object.values(result.structuredRecommendations || {}).flat()).slice(0, 10).map((item) => ({
    id: item.id,
    category: item.category,
    title: item.title,
    priority: item.priority,
    confidenceScore: item.confidenceScore,
    estimatedImpact: item.estimatedImpact,
    sourceSignalsUsed: item.sourceSignalsUsed
  })),
  skills: {
    recommendedTechnologies: uniqueStrings((result.technologies || []).map((tech) => tech.name), 12),
    missingSkills: uniqueStrings(developerSignals.skillGapSignals?.missingSkills || [], 12),
    weakSkills: uniqueStrings(developerSignals.skillGapSignals?.weakSkills || [], 10)
  },
  roadmapSummary: {
    immediateActions: (result.roadmap?.immediateActions || []).map((item) => item.title).slice(0, 5),
    next30Days: (result.roadmap?.next30Days || []).map((item) => item.title).slice(0, 5),
    suggestedProjects: (result.projects || []).map((project) => project.title).slice(0, 5)
  }
});

const normalizeTitleSet = (items = []) => new Set(
  items.map((item) => String(item?.title || item?.name || item || '').trim().toLowerCase()).filter(Boolean)
);

const buildRecommendationVersioning = ({ current = {}, previous = null }) => {
  const currentCards = Object.values(current.structuredRecommendations || {}).flat();
  const previousCards = Object.values(previous?.structuredRecommendations || previous?.analysisData?.structuredRecommendations || {}).flat();
  const currentSet = normalizeTitleSet(currentCards);
  const previousSet = normalizeTitleSet(previousCards);
  const newRecommendations = currentCards.filter((item) => !previousSet.has(item.title.toLowerCase()));
  const obsoleteRecommendations = previousCards.filter((item) => !currentSet.has(item.title.toLowerCase()));
  const completedHints = new Set(uniqueStrings([
    ...(current.signalsUsed?.careerSprint?.activeLearningFocus ? [current.signalsUsed.careerSprint.activeLearningFocus] : []),
    ...(current.signalsUsed?.skillGap?.knownSkills || [])
  ], 20).map((item) => item.toLowerCase()));
  const completedRecommendations = previousCards.filter((item) =>
    item.evidence?.some((evidence) => completedHints.has(String(evidence || '').toLowerCase()))
  );

  return {
    currentRecommendation: {
      generatedAt: current.cacheMetadata?.cachedAt || new Date().toISOString(),
      score: current.recommendationScores?.overallRecommendationScore || 0,
      count: currentCards.length
    },
    previousRecommendation: previous ? {
      generatedAt: previous.cacheMetadata?.cachedAt || previous.updatedAt || previous.createdAt || null,
      score: previous.recommendationScores?.overallRecommendationScore || 0,
      count: previousCards.length
    } : null,
    delta: {
      scoreChange: previous ? clamp((current.recommendationScores?.overallRecommendationScore || 0) - (previous.recommendationScores?.overallRecommendationScore || 0), -100, 100) : 0,
      newCount: newRecommendations.length,
      obsoleteCount: obsoleteRecommendations.length,
      completedCount: completedRecommendations.length
    },
    newRecommendations: newRecommendations.slice(0, 8),
    completedRecommendations: completedRecommendations.slice(0, 8),
    obsoleteRecommendations: obsoleteRecommendations.slice(0, 8)
  };
};

const finalizeRecommendationResult = ({
  username,
  careerStack,
  experienceLevel,
  rawResult,
  fallback,
  resumeInsights,
  githubInsights,
  signalsUsed,
  analysisBasedOn,
  recommendationEvidence,
  developerSignals,
  resolvedSkills,
  signalHash,
  cacheKey,
  previousRecommendation
}) => {
  const projects = uniqueBy(Array.isArray(rawResult.projects) ? rawResult.projects : [], (item) => String(item?.title || '').toLowerCase());
  const technologies = uniqueBy(Array.isArray(rawResult.technologies) ? rawResult.technologies : [], (item) => String(item?.name || '').toLowerCase());
  const careerPaths = uniqueBy(Array.isArray(rawResult.careerPaths) ? rawResult.careerPaths : [], (item) => String(item?.title || '').toLowerCase());

  while (projects.length < 3 && fallback.projects[projects.length]) projects.push(fallback.projects[projects.length]);
  while (technologies.length < 6 && fallback.technologies[technologies.length]) technologies.push(fallback.technologies[technologies.length]);
  while (careerPaths.length < 3 && fallback.careerPaths[careerPaths.length]) careerPaths.push(fallback.careerPaths[careerPaths.length]);

  const normalized = normalizeRecommendationPayload({
    username,
    careerStack,
    experienceLevel,
    analysisSummary: rawResult.analysisSummary || fallback.analysisSummary || '',
    projects: projects.slice(0, 8),
    technologies: technologies.slice(0, 12),
    careerPaths: careerPaths.slice(0, 6),
    portfolioRecommendations: normalizeActionList(rawResult.portfolioRecommendations, fallback.portfolioRecommendations, 2, 4),
    resumeRecommendations: normalizeActionList(rawResult.resumeRecommendations, fallback.resumeRecommendations, 2, 4),
    learningActions: normalizeActionList(rawResult.learningActions, fallback.learningActions, 3, 6),
    interviewReadinessActions: normalizeActionList(rawResult.interviewReadinessActions, fallback.interviewReadinessActions, 2, 4),
    resumeInsights,
    githubInsights,
    signalsUsed,
    analysisBasedOn,
    resumeStatusMessage: resumeInsights.statusMessage,
    claimedButNotProvenSkills: recommendationEvidence?.claimedButNotProvenSkills || [],
    githubSkills: recommendationEvidence?.githubSkills || [],
    resumeSkills: recommendationEvidence?.resumeSkills || []
  });

  normalized.recommendationScores = buildRecommendationScores({
    resumeInsights,
    githubInsights,
    developerSignals,
    resolvedSkills,
    recommendationEvidence
  });
  normalized.structuredRecommendations = buildStructuredRecommendations({
    result: normalized,
    developerSignals,
    scores: normalized.recommendationScores
  });
  normalized.roadmap = buildRecommendationRoadmap({
    result: normalized,
    structuredRecommendations: normalized.structuredRecommendations,
    developerSignals
  });
  normalized.recommendationSignals = buildRecommendationSignals({
    result: normalized,
    scores: normalized.recommendationScores,
    developerSignals,
    signalHash,
    cacheKey
  });
  normalized.recommendationVersioning = buildRecommendationVersioning({
    current: normalized,
    previous: previousRecommendation
  });
  normalized.cacheMetadata = {
    loadedFromCache: false,
    cacheKey,
    signalHash,
    analysisVersion: RECOMMENDATION_ANALYSIS_VERSION,
    recommendationVersion: RECOMMENDATION_ANALYSIS_VERSION,
    temporary: false,
    ttlHours: 24,
    cachedAt: null
  };

  return normalizeRecommendationResponse(normalized);
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
  forceRefresh = false
}) => {
  const isTemporaryMode = !allowSignals;
  const stageTimer = createStageTimer();
  const validationStarted = process.hrtime.bigint();
  const cleanResume = isTemporaryMode ? String(resumeText || '').trim() : '';
  const normalizedGithubUsername = String(username || '').trim().replace(/^@/, '').toLowerCase();
  const providedKnownSkills = uniqueStrings(knownSkills || [], 30);
  const providedMissingSkills = uniqueStrings(missingSkills || [], 20);
  stageTimer.mark('validation', validationStarted);

  const inflightKey = JSON.stringify({
    userId: String(userId || 'temporary'),
    username: normalizedGithubUsername,
    careerStack,
    experienceLevel,
    forceRefresh: Boolean(forceRefresh),
    saveResult: Boolean(saveResult),
    previewResumeId: String(previewResumeId || ''),
    resumeHash: String(resumeHash || ''),
    resumeTextFingerprint: cleanResume ? `${cleanResume.length}:${crypto.createHash('sha1').update(cleanResume).digest('hex').slice(0, 12)}` : '',
    providedKnownSkills,
    providedMissingSkills,
    analysisVersion: RECOMMENDATION_ANALYSIS_VERSION
  });

  const existingInflight = recommendationInflight.get(inflightKey);
  if (existingInflight) {
    try {
      const shared = await existingInflight;
      return res.json(stageTimer.attach(normalizeRecommendationResponse({
        ...shared,
        fromCache: true,
        cacheMetadata: {
          ...(shared.cacheMetadata || {}),
          loadedFromCache: true,
          cacheLayer: shared.cacheMetadata?.cacheLayer || 'inflight'
        }
      })));
    } catch (error) {
      return res.status(error.status || 500).json({
        message: error.message || 'Failed to generate recommendations.'
      });
    }
  }

  let settleInflight;
  const workPromise = new Promise((resolve, reject) => {
    settleInflight = { resolve, reject };
  });
  recommendationInflight.set(inflightKey, workPromise);

  try {
    const earlyMemoryKey = buildRecommendationSoftMemoryKey({
      userId: userId || (isTemporaryMode ? 'anonymous' : ''),
      username: normalizedGithubUsername,
      careerStack,
      experienceLevel,
      isTemporaryMode,
      resumeIdentity: isTemporaryMode
        ? `${previewResumeId || 'inline'}:${resumeHash || 'no-resume'}`
        : 'profile-active',
      signalHash: 'pending'
    });
    if (!forceRefresh) {
      const earlyMemoryHit = await stageTimer.measure('cache', () => Promise.resolve(readRecommendationMemory(earlyMemoryKey)));
      if (earlyMemoryHit?.analysisData) {
        recommendationRuntimeCounters.memoryHits += 1;
        const cachedResult = normalizeRecommendationResponse({
          ...earlyMemoryHit.analysisData,
          fromCache: true,
          cacheMetadata: {
            ...(earlyMemoryHit.analysisData.cacheMetadata || {}),
            loadedFromCache: true,
            cacheLayer: 'memory',
            signalHash: earlyMemoryHit.signalHash || earlyMemoryHit.analysisData.cacheMetadata?.signalHash,
            cachedAt: earlyMemoryHit.updatedAt || null
          }
        });
        settleInflight.resolve(cachedResult);
        return res.json(stageTimer.attach(cachedResult));
      }
    }

    let latestResumeAnalysis = null;
    let storedResumeInsights;
    let resumeCacheIdentity;

    if (isTemporaryMode) {
      const previewResume = await stageTimer.measure('Mongo', () => resolvePreviewResume({
        previewResumeId,
        resumeHash,
        resumeText: cleanResume,
        experienceLevel
      }));
      if (previewResume.error) {
        const error = new Error(previewResume.error);
        error.status = previewResume.status;
        throw error;
      }
      storedResumeInsights = previewResume.resumeInsights;
      resumeCacheIdentity = previewResume.resumeCacheIdentity;
    } else {
      latestResumeAnalysis = await stageTimer.measure('Mongo', () => loadResumeAnalysis(userId));
      storedResumeInsights = buildResumeAnalysisSignals(latestResumeAnalysis, experienceLevel);
      resumeCacheIdentity = buildResumeCacheIdentity({ resumeAnalysis: latestResumeAnalysis });
    }

    const resumeIdentity = `${resumeCacheIdentity.resumeAnalysisId || 'no-resume'}:${resumeCacheIdentity.resumeHash || 'no-resume'}`;

    const runPipeline = async () => {
      const softMemoryKeyPending = buildRecommendationSoftMemoryKey({
        userId: userId || (isTemporaryMode ? 'anonymous' : ''),
        username: normalizedGithubUsername,
        careerStack,
        experienceLevel,
        isTemporaryMode,
        resumeIdentity,
        signalHash: 'pending'
      });

      if (!forceRefresh) {
        const memoryHit = await stageTimer.measure('cache', () => Promise.resolve(readRecommendationMemory(softMemoryKeyPending)));
        if (memoryHit?.analysisData) {
          recommendationRuntimeCounters.memoryHits += 1;
          return normalizeRecommendationResponse({
            ...memoryHit.analysisData,
            fromCache: true,
            cacheMetadata: {
              ...(memoryHit.analysisData.cacheMetadata || {}),
              loadedFromCache: true,
              cacheLayer: 'memory',
              signalHash: memoryHit.signalHash || memoryHit.analysisData.cacheMetadata?.signalHash,
              cachedAt: memoryHit.updatedAt || null
            }
          });
        }
      }


      const preliminarySignals = await stageTimer.measure('Mongo', () => loadDeveloperSignalsSafely({
        userId,
        username,
        resumeInsights: storedResumeInsights,
        githubInsights: {},
        allowSignals
      }));
      const upstreamSignalHash = buildSignalHash({
        ...preliminarySignals.developerSignals,
        recommendationSignal: {},
        recommendationSignals: {}
      });
      const signalHash = crypto.createHash('sha256').update(JSON.stringify({
        upstreamSignalHash,
        providedKnownSkills,
        providedMissingSkills
      })).digest('hex');

      const softMemoryKey = buildRecommendationSoftMemoryKey({
        userId: userId || (isTemporaryMode ? 'anonymous' : ''),
        username: normalizedGithubUsername,
        careerStack,
        experienceLevel,
        isTemporaryMode,
        resumeIdentity,
        signalHash
      });

      if (!forceRefresh) {
        const memoryHit = await stageTimer.measure('cache', () => Promise.resolve(readRecommendationMemory(softMemoryKey)));
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
      const scopedCacheKey = saveResult && req.user?._id
        ? { ...cacheKey, userId: req.user._id }
        : null;
      const resultCacheIdentity = {
        mode: isTemporaryMode ? 'preview' : 'profile',
        userId: String(userId || 'temporary'),
        ...cacheKey,
        providedKnownSkills,
        providedMissingSkills
      };
      const resultCacheKey = buildRecommendationResultCacheKey(resultCacheIdentity);
      const previewCacheKey = `recommendations:preview:${normalizedGithubUsername}:${resumeCacheIdentity.resumeHash || 'no-resume'}:${careerStack}:${experienceLevel}:${signalHash}:${RECOMMENDATION_ANALYSIS_VERSION}`;

      if (!forceRefresh) {
        const redisCached = await stageTimer.measure('Redis', () => withBudget(
          aiService.getSharedCache(isTemporaryMode ? previewCacheKey : resultCacheKey, isTemporaryMode ? 'preview' : 'recommendations:result'),
          RECOMMENDATION_REDIS_LOOKUP_BUDGET_MS,
          null
        ));
        if (redisCached?.analysisData && isPersistableRecommendationResult(redisCached.analysisData)) {
          recommendationRuntimeCounters.redisHits += 1;
          writeRecommendationMemory(softMemoryKey, {
            analysisData: redisCached.analysisData,
            updatedAt: redisCached.updatedAt || new Date(),
            signalHash,
            expiresAt: new Date(Date.now() + RECOMMENDATION_TTL_MS)
          });
          writeRecommendationMemory(softMemoryKeyPending, {
            analysisData: redisCached.analysisData,
            updatedAt: redisCached.updatedAt || new Date(),
            signalHash,
            expiresAt: new Date(Date.now() + RECOMMENDATION_TTL_MS)
          });
          writeRecommendationMemory(earlyMemoryKey, {
            analysisData: redisCached.analysisData,
            updatedAt: redisCached.updatedAt || new Date(),
            signalHash,
            expiresAt: new Date(Date.now() + RECOMMENDATION_TTL_MS)
          });
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
        const mongoCached = await stageTimer.measure('Mongo', () => AnalysisCache.findOne(scopedCacheKey)
          .select(ANALYSIS_CACHE_RESULT_FIELDS)
          .lean());
        if (isCacheFresh(mongoCached) && isPersistableRecommendationResult(mongoCached?.analysisData)) {
          recommendationRuntimeCounters.mongoHits += 1;
          writeRecommendationMemory(softMemoryKey, {
            analysisData: mongoCached.analysisData,
            updatedAt: mongoCached.updatedAt || mongoCached.createdAt || new Date(),
            signalHash,
            expiresAt: new Date(Date.now() + RECOMMENDATION_TTL_MS)
          });
          writeRecommendationMemory(softMemoryKeyPending, {
            analysisData: mongoCached.analysisData,
            updatedAt: mongoCached.updatedAt || mongoCached.createdAt || new Date(),
            signalHash,
            expiresAt: new Date(Date.now() + RECOMMENDATION_TTL_MS)
          });
          writeRecommendationMemory(earlyMemoryKey, {
            analysisData: mongoCached.analysisData,
            updatedAt: mongoCached.updatedAt || mongoCached.createdAt || new Date(),
            signalHash,
            expiresAt: new Date(Date.now() + RECOMMENDATION_TTL_MS)
          });
          setImmediate(() => {
            aiService.setSharedCache(resultCacheKey, {
              analysisData: mongoCached.analysisData,
              updatedAt: mongoCached.updatedAt || mongoCached.createdAt || new Date()
            }, RECOMMENDATION_REDIS_TTL_SECONDS, 'recommendations:result').catch(() => {});
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
            resumeStatusMessage: mongoCached.analysisData.resumeStatusMessage || storedResumeInsights.statusMessage,
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

      recommendationRuntimeCounters.pipelineExecutions += 1;

      const resumeInsights = preliminarySignals.developerSignals.resumeSignals?.analyzed
        ? preliminarySignals.developerSignals.resumeSignals
        : storedResumeInsights;
      const githubData = buildGithubDataFromSignals(preliminarySignals.developerSignals.githubSignals, username)
        || await stageTimer.measure('external provider', () => getGitHubData(username, { forceRefresh, isTemporaryMode }));
      const githubInsights = buildGithubInsights(githubData);
      const recommendationEvidence = buildRecommendationEvidence({
        resumeInsights,
        githubData,
        careerStack
      });
      const developerSignals = preliminarySignals.developerSignals;
      const signalsUsed = buildSignalsUsedSummary({
        username,
        resumeInsights,
        githubInsights,
        signals: developerSignals
      });

      const resolvedSkills = await stageTimer.measure('deterministic processing', () => resolveKnownAndMissingSkills({
        userId,
        username,
        careerStack,
        experienceLevel,
        resumeCacheIdentity,
        resumeSkills: resumeInsights.skills,
        githubData,
        resumeInsights,
        githubInsights,
        developerSignals,
        recommendationEvidence,
        providedKnownSkills: knownSkills,
        providedMissingSkills: missingSkills
      }));

      const previousRecommendation = scopedCacheKey
        ? await stageTimer.measure('Mongo', () => AnalysisCache.findOne({
          userId: req.user._id,
          analysisVersion: RECOMMENDATION_ANALYSIS_VERSION,
          $or: [
            { signalHash: { $ne: signalHash } },
            { resumeHash: { $ne: resumeCacheIdentity.resumeHash } },
            { githubUsername: { $ne: username } }
          ]
        }).select(ANALYSIS_CACHE_RESULT_FIELDS).sort({ updatedAt: -1 }).lean())
        : null;

      const fallback = await stageTimer.measure('deterministic processing', async () => buildRecommendationFallback({
        username,
        careerStack,
        experienceLevel,
        knownSkills: resolvedSkills.knownSkills,
        missingSkills: resolvedSkills.missingSkills,
        resumeInsights,
        githubInsights,
        developerSignals,
        recommendationEvidence
      }));
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

      recommendationRuntimeCounters.aiCalls += 1;
      const narrativeFallback = { __fallback: true };
      const aiMeta = await stageTimer.measure('AI', () => aiService.runAIAnalysis(prompt, narrativeFallback, 0, {
        timeoutMs: 7000,
        returnMeta: true
      }));
      const aiOk = Boolean(aiMeta && aiMeta.ok === true);
      const enrichment = await stageTimer.measure('deterministic processing', async () => resolveRecommendationEnrichment(aiOk ? aiMeta.value : null, fallback, {
        aiOk,
        careerStack,
        experienceLevel,
        anchors: uniqueStrings([
          ...resolvedSkills.knownSkills,
          ...resolvedSkills.missingSkills,
          ...(recommendationEvidence?.claimedButNotProvenSkills || []),
          ...(fallback.projects || []).map((project) => project.title),
          ...(fallback.technologies || []).map((technology) => technology.name)
        ], 24)
      }));
      const deterministicResult = mergeNarrativeEnrichment(fallback, enrichment);
      const result = await stageTimer.measure('deterministic processing', async () => finalizeRecommendationResult({
        username,
        careerStack,
        experienceLevel,
        rawResult: deterministicResult,
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
      }));
      result.cacheMetadata.temporary = !saveResult;
      result.aiUsed = Boolean(enrichment.aiUsed);

      if (!isPersistableRecommendationResult(result)) {
        result.cacheMetadata.partial = true;
        return result;
      }

      if (isTemporaryMode) {
        result.mode = 'preview';
        result.isTemporary = true;
        result.savedToProfile = false;
        writeRecommendationMemory(softMemoryKey, {
          analysisData: result,
          updatedAt: new Date(),
          signalHash,
          expiresAt: new Date(Date.now() + RECOMMENDATION_TTL_MS)
        });
        writeRecommendationMemory(softMemoryKeyPending, {
          analysisData: result,
          updatedAt: new Date(),
          signalHash,
          expiresAt: new Date(Date.now() + RECOMMENDATION_TTL_MS)
        });
        writeRecommendationMemory(earlyMemoryKey, {
          analysisData: result,
          updatedAt: new Date(),
          signalHash,
          expiresAt: new Date(Date.now() + RECOMMENDATION_TTL_MS)
        });
        setImmediate(() => {
          recommendationRuntimeCounters.persistenceOperations += 1;
          aiService.setSharedCache(previewCacheKey, {
            analysisData: result,
            updatedAt: new Date()
          }, 1800, 'preview').catch(() => {});
        });
        stageTimer.mark('persistence', process.hrtime.bigint());
      } else {
        writeRecommendationMemory(softMemoryKey, {
          analysisData: result,
          updatedAt: new Date(),
          signalHash,
          expiresAt: new Date(Date.now() + RECOMMENDATION_TTL_MS)
        });
        writeRecommendationMemory(softMemoryKeyPending, {
          analysisData: result,
          updatedAt: new Date(),
          signalHash,
          expiresAt: new Date(Date.now() + RECOMMENDATION_TTL_MS)
        });
        writeRecommendationMemory(earlyMemoryKey, {
          analysisData: result,
          updatedAt: new Date(),
          signalHash,
          expiresAt: new Date(Date.now() + RECOMMENDATION_TTL_MS)
        });
        if (scopedCacheKey) {
          recommendationRuntimeCounters.persistenceOperations += 1;
          await stageTimer.measure('persistence', () => AnalysisCache.findOneAndUpdate(
            scopedCacheKey,
            { $set: { analysisData: result, userId: req.user._id } },
            { upsert: true }
          ));
        }
        setImmediate(() => {
          aiService.setSharedCache(resultCacheKey, {
            analysisData: result,
            updatedAt: new Date()
          }, RECOMMENDATION_REDIS_TTL_SECONDS, 'recommendations:result').catch(() => {});
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
          voidRecommendationNotification({
            userId: req.user._id,
            type: 'career_update',
            title: 'Career Recommendations Updated',
            message: 'Your latest career recommendations are ready to review.',
            dedupeKey: `recommendations:${signalHash || 'latest'}`,
            dedupeWindowHours: 24,
            preferenceKey: 'newRecommendations'
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


const PREVIEW_STACKS = new Set(['Frontend', 'Backend', 'Full Stack', 'AI/ML']);
const PREVIEW_LEVELS = new Set(['Student', 'Intern', '0-1 years', '1-2 years', '2-3 years', '3-5 years', '5+ years']);
const previewText = (value, max = 500) => String(value || '').trim().slice(0, max);
const previewStrings = (values, max = 12) => uniqueStrings(Array.isArray(values) ? values.map((value) => typeof value === 'string' ? value : value?.name) : [], max);
const previewSkills = (values, max = 16) => (Array.isArray(values) ? values : [])
  .map((skill) => ({ name: previewText(typeof skill === 'string' ? skill : skill?.name, 80), priority: previewText(skill?.priority, 16), jobDemand: clamp(skill?.jobDemand || 0) }))
  .filter((skill) => skill.name)
  .slice(0, max);
const previewCards = (values, max = 8) => (Array.isArray(values) ? values : [])
  .map((card) => ({ title: previewText(card?.title, 160), description: previewText(card?.description || card?.reason, 500), priority: previewText(card?.priority, 16), estimatedImpact: clamp(card?.estimatedImpact || card?.impact || 0) }))
  .filter((card) => card.title)
  .slice(0, max);

const buildSavedPreviewSummary = (module, result = {}) => {
  if (module === 'skill-gap') {
    return {
      analysisSummary: previewText(result.analysisSummary || result.levelAssessment, 1000),
      coverage: clamp(result.coverage || 0),
      missing: clamp(result.missing || 0),
      yourSkills: previewSkills(result.yourSkills),
      weakSkills: previewSkills(result.weakSkills),
      highDemandSkills: previewSkills(result.highDemandSkills),
      missingSkills: previewSkills(result.missingSkills),
      actions: previewCards(result.suggestedProjects, 6)
    };
  }
  return {
    analysisSummary: previewText(result.analysisSummary, 1000),
    projects: previewCards(result.projects, 8),
    technologies: previewSkills(result.technologies, 12),
    careerPaths: previewCards(result.careerPaths, 6),
    portfolioRecommendations: previewStrings(result.portfolioRecommendations, 4),
    resumeRecommendations: previewStrings(result.resumeRecommendations, 4),
    learningActions: previewStrings(result.learningActions, 6),
    interviewReadinessActions: previewStrings(result.interviewReadinessActions, 4),
    recommendationScores: Object.fromEntries(Object.entries(result.recommendationScores || {}).filter(([, value]) => Number.isFinite(Number(value))).map(([key, value]) => [key, clamp(value)])),
    actions: Object.values(result.structuredRecommendations || {}).flatMap((cards) => previewCards(cards, 6)).slice(0, 16)
  };
};

const savePreview = async (req, res) => {
  try {
    const module = String(req.body?.module || '').trim();
    const githubUsername = String(req.body?.githubUsername || '').trim().replace(/^@/, '').toLowerCase();
    const careerStack = String(req.body?.careerStack || '').trim();
    const experienceLevel = String(req.body?.experienceLevel || '').trim();
    const resumeHash = String(req.body?.resumeHash || 'no-resume').trim();
    if (!['skill-gap', 'recommendations'].includes(module) || !githubUsername || !PREVIEW_STACKS.has(careerStack) || !PREVIEW_LEVELS.has(experienceLevel)) {
      return res.status(400).json({ message: 'Invalid saved preview metadata.' });
    }
    if (resumeHash !== 'no-resume' && !/^[a-f0-9]{64}$/i.test(resumeHash)) {
      return res.status(400).json({ message: 'Invalid preview resume identity.' });
    }
    const title = previewText(req.body?.title, 120) || `${githubUsername} ${careerStack} preview`;
    const previewIdentity = { userId: req.user._id, module, githubUsername, careerStack, experienceLevel, resumeHash };
    const update = {
      $set: {
        title,
        source: 'preview',
        resultSummary: buildSavedPreviewSummary(module, req.body?.result)
      },
      $setOnInsert: previewIdentity
    };
    let preview;
    try {
      preview = await SavedPreview.findOneAndUpdate(
        previewIdentity,
        update,
        { upsert: true, new: true, setDefaultsOnInsert: true }
      ).lean();
    } catch (error) {
      if (error?.code !== 11000) throw error;
      preview = await SavedPreview.findOne(previewIdentity).lean();
      if (!preview) throw error;
    }
    return res.status(200).json({ preview });
  } catch (error) {
    console.error('Save preview error:', error.message);
    return res.status(500).json({ message: 'Failed to save preview.' });
  }
};

const listSavedPreviews = async (req, res) => {
  const previews = await SavedPreview.find({ userId: req.user._id }).sort({ createdAt: -1 }).limit(50).lean();
  return res.json({ previews });
};

const deleteSavedPreview = async (req, res) => {
  if (!/^[a-f\d]{24}$/i.test(String(req.params.id || ''))) {
    return res.status(400).json({ message: 'Invalid saved preview id.' });
  }
  const deleted = await SavedPreview.findOneAndDelete({ _id: req.params.id, userId: req.user._id }).lean();
  if (!deleted) return res.status(404).json({ message: 'Saved preview not found.' });
  return res.status(204).send();
};
/**
 * @desc Generate personalised roadmap and project suggestions
 * @route POST /api/recommendations
 */
const getRecommendations = async (req, res) => {
  try {
    let { username, forceRefresh } = req.body;
    const activeGithub = String(req.user?.activeGithubUsername || req.user?.githubUsername || '').trim();

    if (!req.user?._id) {
      return res.status(401).json({ message: 'Authentication required.' });
    }

    const requestedUsername = String(username || '').trim();
    if (requestedUsername && activeGithub && requestedUsername.toLowerCase() !== activeGithub.toLowerCase()) {
      return res.status(400).json({ message: 'Use Preview mode to analyze another GitHub username.' });
    }

    let finalUsername;
    try {
      finalUsername = parseGitHubUsername(activeGithub);
    } catch (error) {
      return res.status(error.status || 400).json({ message: error.message || 'GitHub username is required.' });
    }

    const careerStack = req.user?.careerStack || req.body.careerStack || 'Full Stack';
    const experienceLevel = req.user?.experienceLevel || req.body.experienceLevel || 'Student';
    if (!ALLOWED_STACKS.includes(careerStack)) {
      return res.status(400).json({ message: `Target stack must be one of: ${ALLOWED_STACKS.join(', ')}` });
    }
    if (!ALLOWED_LEVELS.includes(experienceLevel)) {
      return res.status(400).json({ message: `Experience level must be one of: ${ALLOWED_LEVELS.join(', ')}` });
    }

    return runRecommendationPipeline({
      req,
      res,
      username: finalUsername,
      careerStack,
      experienceLevel,
      resumeText: '',
      knownSkills: undefined,
      missingSkills: undefined,
      userId: req.user._id,
      allowSignals: true,
      saveResult: true,
      source: 'recommendations',
      forceRefresh: forceRefresh === true || forceRefresh === 'true'
    });
  } catch (error) {
    console.error('Recommendations Error:', error.message);
    return res.status(error.status || 500).json({
      message: error.status ? error.message : 'Failed to generate recommendations.',
    });
  }
};

/**
 * @desc Generate recommendations (supports both temporary and permanent analysis)
 * @route POST /api/recommendations/generate
 */
const generateRecommendations = async (req, res) => {
  try {
    let {
      githubUsername,
      careerStack,
      experienceLevel,
      isTemporary,
      missingSkills,
      knownSkills,
      resumeText,
      previewResumeId,
      resumeHash
    } = req.body;
    const forceRefresh = req.body.forceRefresh === true || req.body.forceRefresh === 'true';
    const isTemporaryMode = isTemporary === true || isTemporary === 'true';
    const activeGithub = String(req.user?.activeGithubUsername || req.user?.githubUsername || '').trim();

    if (!isTemporaryMode) {
      if (!req.user?._id) {
        return res.status(401).json({ message: 'Authentication required for profile mode.' });
      }
      const requestedUsername = String(githubUsername || '').trim();
      if (requestedUsername && activeGithub && requestedUsername.toLowerCase() !== activeGithub.toLowerCase()) {
        return res.status(400).json({ message: 'Use Preview mode to analyze another GitHub username.' });
      }
    }

    let username;
    try {
      username = parseGitHubUsername(isTemporaryMode ? githubUsername : activeGithub);
    } catch (error) {
      return res.status(error.status || 400).json({ message: error.message || 'GitHub username is required.' });
    }

    const finalCareerStack = isTemporaryMode
      ? careerStack
      : (req.user?.careerStack || careerStack || 'Full Stack');
    const finalExperienceLevel = isTemporaryMode
      ? experienceLevel
      : (req.user?.experienceLevel || experienceLevel || 'Student');

    // Validation for Preview Mode and profile fallbacks
    if (!ALLOWED_STACKS.includes(finalCareerStack)) {
      return res.status(400).json({ message: `Target stack is required and must be one of: ${ALLOWED_STACKS.join(', ')}` });
    }
    if (!ALLOWED_LEVELS.includes(finalExperienceLevel)) {
      return res.status(400).json({ message: `Experience level is required and must be one of: ${ALLOWED_LEVELS.join(', ')}` });
    }
    if (isTemporaryMode) {
      if (resumeText !== undefined && typeof resumeText !== 'string') {
        return res.status(400).json({ message: 'Resume input must be a valid text string.' });
      }
    }

    return runRecommendationPipeline({
      req,
      res,
      username,
      careerStack: finalCareerStack,
      experienceLevel: finalExperienceLevel,
      resumeText,
      previewResumeId,
      resumeHash,
      knownSkills: isTemporaryMode ? knownSkills : undefined,
      missingSkills: isTemporaryMode ? missingSkills : undefined,
      userId: !isTemporaryMode ? req.user._id : null,
      allowSignals: !isTemporaryMode,
      saveResult: !isTemporaryMode,
      source: 'recommendations/generate',
      forceRefresh
    });
  } catch (error) {
    console.error('Generate Recommendations Error:', error.message);
    return res.status(error.status || 500).json({
      message: error.status ? error.message : 'Failed to generate recommendations.',
    });
  }
};

module.exports = {
  getRecommendations,
  generateRecommendations,
  savePreview,
  listSavedPreviews,
  deleteSavedPreview,
  resolveRecommendationEnrichment,
  mergeNarrativeEnrichment,
  isUsableRecommendationNarrative,
  hasRecommendationFactPollution,
  clearRecommendationMemoryCache,
  getRecommendationMemoryCacheSize,
  RECOMMENDATION_ANALYSIS_VERSION
};
