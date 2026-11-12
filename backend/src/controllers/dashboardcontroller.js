const { buildReadinessCenter } = require('../services/dashboardMetricsService');
const { clampScore: clamp, numeric } = require('../services/scoring/math');
const developerContext = require('../services/developerContextService');
const skillGapContract = require('../services/skillGapCacheContract');
const crypto = require('node:crypto');
const Analysis = require('../models/analysis');
const User = require('../models/user');
const AnalysisCache = require('../models/analysisCache');
const Recommendation = require('../models/recommendation');
const ResumeAnalysis = require('../models/resumeAnalysis');
const WeeklyReport = require('../models/weeklyReport');
const CareerSprint = require('../models/careerSprint');
const JobCache = require('../models/jobCache');
const NewsCache = require('../models/news');
const UserCourseProgress = require('../models/userCourseProgress');
const {
  getDeveloperSignals,
  buildSignalHash,
  buildResumeCacheIdentity,
} = require('../services/developerSignalService');
const { detectSkillGaps } = require('../utils/skilldetector');
const { getIntegrationInsight } = require('../services/integrationInsightService');
const IntegrationSyncLog = require('../models/integrationSyncLog');
const IntegrationConnection = require('../models/integrationConnection');

const DASHBOARD_FRESH_MS = 24 * 60 * 60 * 1000;

const average = (values = []) => {
  if (!Array.isArray(values) || !values.length) return 0;
  return values.reduce((sum, value) => sum + Number(value || 0), 0) / values.length;
};

const emptyContributionActivity = () => {
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  const now = new Date();
  const result = [];
  for (let i = 5; i >= 0; i -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    result.push({ month: months[date.getMonth()], count: 0 });
  }
  return result;
};

const safeDate = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const toFreshness = (value) => {
  const date = safeDate(value);
  if (!date) return 'missing';
  const age = Date.now() - date.getTime();
  return age >= 0 && age <= DASHBOARD_FRESH_MS ? 'fresh' : 'stale';
};

const statusLabel = (status) => {
  if (status === 'fresh') return 'Fresh';
  if (status === 'stale') return 'Stale';
  if (status === 'rate_limited') return 'Refresh Recommended';
  return 'Refresh Recommended';
};

const freshnessEntry = ({
  updatedAt = null,
  available = false,
  connected = false,
  stale = false,
  reason = '',
} = {}) => {
  const baseStatus = !safeDate(updatedAt) ? 'missing' : stale ? 'stale' : toFreshness(updatedAt);
  const status = available || connected || updatedAt ? baseStatus : 'missing';
  return {
    connected: Boolean(connected || available),
    available: Boolean(available),
    lastUpdated: updatedAt || null,
    status,
    label: statusLabel(status),
    refreshRecommended: status !== 'fresh',
    reason: reason || (status === 'fresh' ? '' : 'Analysis refresh recommended'),
  };
};

const toLanguageMap = (languageDistribution = {}) => {
  if (languageDistribution instanceof Map) return Object.fromEntries(languageDistribution);
  if (Array.isArray(languageDistribution)) {
    return languageDistribution.reduce((acc, item) => {
      if (item?.language) acc[item.language] = Number(item.percentage || 0);
      return acc;
    }, {});
  }
  return languageDistribution && typeof languageDistribution === 'object'
    ? languageDistribution
    : {};
};

const normalizeLanguageMap = (languageDistribution = {}) => {
  const rawMap = toLanguageMap(languageDistribution);
  const safeEntries = Object.entries(rawMap)
    .map(([language, value]) => [String(language || '').trim(), Number(value || 0)])
    .filter(
      ([language, value]) =>
        Boolean(language) &&
        language.toLowerCase() !== 'null' &&
        language.toLowerCase() !== 'undefined' &&
        Number.isFinite(value) &&
        value > 0,
    );

  const total = safeEntries.reduce((sum, [, value]) => sum + value, 0);
  if (!total) return {};

  let remaining = 100;
  return safeEntries
    .sort((left, right) => right[1] - left[1])
    .reduce((acc, [language, value], index, list) => {
      const normalized =
        index === list.length - 1
          ? remaining
          : Math.max(0, Math.min(remaining, Math.round((value / total) * 100)));
      acc[language] = normalized;
      remaining -= normalized;
      return acc;
    }, {});
};

const safeGetIntegrationInsight = async (userId) => {
  try {
    return await getIntegrationInsight(userId);
  } catch (error) {
    console.warn('Dashboard integration insight fallback:', error.message);
    return { integrationScore: 0, providers: [], mergedSkills: [], updatedAt: null };
  }
};

// Missing evidence must not acquire Mongoose default timestamps on a read.
const createEmptyAnalysis = (userId) => ({
  userId,
  githubScore: 0,
  readinessScore: 0,
  githubStats: { repos: 0, stars: 0, forks: 0, followers: 0 },
  languageDistribution: {},
  contributionActivity: emptyContributionActivity(),
  createdAt: null,
  updatedAt: null,
});

const latestCacheByPredicate = async (userId, predicate) =>
  AnalysisCache.findOne({ userId, ...predicate })
    .sort({ updatedAt: -1, _id: -1 })
    .lean();

const loadDefaultResumeAnalysis = (userId) =>
  developerContext.resolveResumeAnalysis(userId, undefined, { User, ResumeAnalysis });

const getCachedDashboardContext = async (userId, careerStack, experienceLevel, user) => {
  const context = user || (await developerContext.loadUser(userId, { User }));
  const scopedCache = {
    careerStack,
    experienceLevel,
    githubUsername: developerContext.resolveGithubUsername(context) || '',
  };
  const currentResume = await developerContext.resolveResumeAnalysis(userId, context, {
    ResumeAnalysis,
  });
  Object.assign(scopedCache, buildResumeCacheIdentity({ resumeAnalysis: currentResume }));
  const skillGapScope = skillGapContract.buildScope({
    userId,
    user: context,
    resumeIdentity: buildResumeCacheIdentity({ resumeAnalysis: currentResume }),
  });
  const [
    latestPortfolioCache,
    latestSkillGapCache,
    latestRecommendationCache,
    latestResume,
    latestWeeklyReport,
    latestCareerSprint,
    latestJob,
    latestNews,
    learningProgress,
  ] = await Promise.all([
    latestCacheByPredicate(userId, {
      ...scopedCache,
      'analysisData.portfolioScore.overallScore': { $exists: true },
    }),
    latestCacheByPredicate(userId, {
      ...skillGapScope,
      'analysisData.missingSkills': { $exists: true },
    }),
    latestCacheByPredicate(userId, {
      ...scopedCache,
      'analysisData.projects': { $exists: true },
    }),
    Promise.resolve(currentResume),
    WeeklyReport.findOne({ userId })
      .select('weekEndDate createdAt updatedAt meta')
      .sort({ weekEndDate: -1, updatedAt: -1, _id: -1 })
      .lean(),
    CareerSprint.findOne({ userId })
      .select('tasks updatedAt')
      .sort({ updatedAt: -1, _id: -1 })
      .lean(),
    JobCache.findOne({
      expiresAt: { $gt: new Date() },
      freshUntil: { $gt: new Date() },
      hidden: { $ne: true },
      $or: [{ validThrough: null }, { validThrough: { $gt: new Date() } }],
    })
      .select('title company jobId skills lastSynced updatedAt')
      .sort({ lastSynced: -1, updatedAt: -1, _id: 1 })
      .lean(),
    // Match Tech News' authoritative public pool using its existing unique index.
    NewsCache.findOne({ cacheKey: 'news:v3:public:pool', expiresAt: { $gt: new Date() } })
      .select('trendingTopics lastUpdated updatedAt')
      .lean(),
    UserCourseProgress.find({ userId })
      .select('status updatedAt createdAt')
      .sort({ updatedAt: -1, _id: -1 })
      .lean(),
  ]);

  return {
    latestPortfolioCache,
    latestSkillGapCache,
    latestRecommendationCache,
    latestResume,
    latestWeeklyReport,
    latestCareerSprint,
    latestJob,
    latestNews,
    learningProgress: Array.isArray(learningProgress) ? learningProgress : [],
  };
};

const deriveReadinessBreakdown = ({
  portfolioScore,
  analysis,
  resume,
  skillGapCache,
  integrationInsight,
}) => {
  const skillData = skillGapCache?.analysisData;
  const canonicalCoverage =
    !skillData || skillData.ruleVersion === 'skill-evidence-coverage-v1'
      ? numeric(skillData?.coverage)
      : undefined;
  const cachedBreakdown =
    portfolioScore?.breakdown || portfolioScore?.analysisData?.portfolioScore?.breakdown;
  if (cachedBreakdown) {
    return {
      codeQuality: clamp(cachedBreakdown.codeQuality),
      skillCoverage:
        canonicalCoverage !== undefined
          ? canonicalCoverage === null
            ? null
            : clamp(canonicalCoverage)
          : clamp(cachedBreakdown.skillCoverage),
      industryReadiness: clamp(cachedBreakdown.industryReadiness),
      projectImpact: clamp(cachedBreakdown.projectImpact),
    };
  }

  const topSkillCount = Array.isArray(skillGapCache?.analysisData?.yourSkills)
    ? skillGapCache.analysisData.yourSkills.length
    : 0;
  const missingSkillCount = Array.isArray(skillGapCache?.analysisData?.missingSkills)
    ? skillGapCache.analysisData.missingSkills.length
    : 0;
  const totalSkills = topSkillCount + missingSkillCount;
  const coverage = totalSkills > 0 ? Math.round((topSkillCount / totalSkills) * 100) : 0;

  return {
    codeQuality: clamp(analysis?.githubScore || 0),
    skillCoverage:
      canonicalCoverage !== undefined
        ? canonicalCoverage === null
          ? null
          : clamp(canonicalCoverage)
        : clamp(numeric(skillData?.coverage) ?? coverage),
    industryReadiness: clamp(
      resume
        ? average([
            resume.atsScore,
            resume.keywordDensity,
            resume.contentQuality,
            resume.formatScore,
          ])
        : (numeric(analysis?.readinessScore) ?? numeric(analysis?.githubScore) ?? 0),
    ),
    projectImpact: clamp(average([analysis?.githubScore, integrationInsight?.integrationScore])),
  };
};

const buildSummaryMeta = ({
  analysis,
  latestResume,
  latestSkillGapCache,
  latestRecommendationCache,
  latestWeeklyReport,
  latestCareerSprint,
  latestJob,
  latestNews,
  learningProgress = [],
  integrationInsight,
  githubStatus,
  rateLimited,
  noUsername,
  staleFlags = {},
}) => {
  const githubFreshness = toFreshness(analysis?.updatedAt || analysis?.createdAt);
  const resumeFreshness = toFreshness(latestResume?.analyzedAt);
  const skillGapFreshness = staleFlags.skillGap
    ? 'stale'
    : toFreshness(latestSkillGapCache?.updatedAt);
  const recommendationFreshness = staleFlags.recommendations
    ? 'stale'
    : toFreshness(latestRecommendationCache?.updatedAt);
  const weeklyFreshness = toFreshness(
    latestWeeklyReport?.updatedAt ||
      latestWeeklyReport?.createdAt ||
      latestWeeklyReport?.weekEndDate,
  );
  const careerSprintFreshness = toFreshness(latestCareerSprint?.updatedAt);
  const jobsFreshness = toFreshness(latestJob?.lastSynced || latestJob?.updatedAt);
  const newsFreshness = toFreshness(latestNews?.lastUpdated || latestNews?.updatedAt);
  const learningFreshness = toFreshness(
    learningProgress?.[0]?.updatedAt || learningProgress?.[0]?.createdAt,
  );
  const integrationFreshness = toFreshness(integrationInsight?.updatedAt);

  const syncStatus = rateLimited
    ? 'rate_limited'
    : noUsername
      ? 'queued'
      : githubStatus === 'fresh'
        ? 'fresh'
        : githubStatus === 'missing'
          ? 'queued'
          : 'stale';

  return {
    syncStatus,
    dataFreshness: {
      github: githubFreshness,
      resume: resumeFreshness,
      skillGap: skillGapFreshness,
      recommendations: recommendationFreshness,
      weeklyReports: weeklyFreshness,
      careerSprint: careerSprintFreshness,
      jobs: jobsFreshness,
      news: newsFreshness,
      learning: learningFreshness,
      integrations: integrationFreshness,
    },
    sourcesUsed: {
      github: {
        connected: !noUsername,
        available: Boolean(analysis?.updatedAt || analysis?.createdAt),
        status: githubFreshness,
      },
      resume: {
        connected: Boolean(latestResume),
        available: Boolean(latestResume),
        status: resumeFreshness,
      },
      skillGap: {
        connected: Boolean(latestSkillGapCache),
        available: Boolean(latestSkillGapCache),
        status: skillGapFreshness,
      },
      recommendations: {
        connected: Boolean(latestRecommendationCache),
        available: Boolean(latestRecommendationCache),
        status: recommendationFreshness,
      },
      weeklyReports: {
        connected: Boolean(latestWeeklyReport),
        available: Boolean(latestWeeklyReport),
        status: weeklyFreshness,
      },
      careerSprint: {
        connected: Boolean(latestCareerSprint),
        available: Boolean(latestCareerSprint),
        status: careerSprintFreshness,
      },
      jobs: {
        connected: Boolean(latestJob),
        available: Boolean(latestJob),
        status: jobsFreshness,
      },
      news: {
        connected: Boolean(latestNews),
        available: Boolean(latestNews),
        status: newsFreshness,
      },
      learning: {
        connected: Array.isArray(learningProgress) && learningProgress.length > 0,
        available: Array.isArray(learningProgress) && learningProgress.length > 0,
        status: learningFreshness,
      },
      integrations: {
        connected:
          Array.isArray(integrationInsight?.providers) && integrationInsight.providers.length > 0,
        available: Boolean(integrationInsight?.providers?.length),
        status: integrationFreshness,
      },
    },
  };
};

const buildEtag = (payload) =>
  `"dashboard-${crypto.createHash('sha1').update(JSON.stringify(payload)).digest('hex')}"`;

const maybeSendNotModified = (req, res, payload) => {
  const etag = buildEtag(payload);
  res.set('ETag', etag);
  res.set('Cache-Control', 'private, no-cache');
  const validators = String(req.headers['if-none-match'] || '')
    .split(',')
    .map((value) => value.trim().replace(/^W\//, ''));
  if (validators.includes(etag) || validators.includes('*')) {
    res.status(304).end();
    return true;
  }
  return false;
};

const ensureAnalysis = async (userId, githubUsername) => {
  const analysis = await Analysis.findOne({ userId })
    .sort({ updatedAt: -1, createdAt: -1, _id: -1 })
    .lean();
  if (
    analysis &&
    (!analysis.githubSignals?.username ||
      analysis.githubSignals.username.toLowerCase() === String(githubUsername).toLowerCase())
  ) {
    return {
      analysis,
      rateLimited: false,
      noUsername: !githubUsername,
      githubStatus: toFreshness(analysis.updatedAt || analysis.createdAt),
      languageSource: 'cached_snapshot',
    };
  }

  return {
    analysis: createEmptyAnalysis(userId),
    rateLimited: false,
    noUsername: !githubUsername,
    githubStatus: githubUsername ? 'stale' : 'missing',
    languageSource: 'missing',
  };
};

const buildRecommendationPreview = (recommendationData = {}) => {
  const signalItems = recommendationData.recommendationSignals?.priorityRecommendations;
  if (Array.isArray(signalItems) && signalItems.length) {
    return signalItems.slice(0, 4).map((item) => ({
      title: String(item.title || 'Recommendation').trim(),
      priority: item.priority || 'High',
      priorityType: String(item.priority || 'high').toLowerCase(),
      category: item.category || 'Career Action',
      confidenceScore: Number(item.confidenceScore || 0),
      estimatedImpact: Number(item.estimatedImpact || 0),
      sourceSignalsUsed: item.sourceSignalsUsed || [],
    }));
  }

  const structured = Object.values(recommendationData.structuredRecommendations || {}).flat();
  if (structured.length) {
    return structured.slice(0, 4).map((item) => ({
      title: String(item.title || 'Recommendation').trim(),
      priority: item.priority || 'High',
      priorityType: String(item.priority || 'high').toLowerCase(),
      category: item.category || 'Career Action',
      confidenceScore: Number(item.confidenceScore || 0),
      estimatedImpact: Number(item.estimatedImpact || 0),
      sourceSignalsUsed: item.sourceSignalsUsed || [],
    }));
  }

  const projects = Array.isArray(recommendationData.projects) ? recommendationData.projects : [];
  return projects.slice(0, 4).map((project) => ({
    title: String(project.title || 'Recommendation').trim(),
    priority: 'High',
    priorityType: 'high',
    category:
      Array.isArray(project.tech) && project.tech.length
        ? project.tech.slice(0, 2).join(', ')
        : 'Project',
  }));
};

const buildDashboardSignalHash = ({
  dependencySignalHash,
  latestNews,
  latestJob,
  careerStack,
  experienceLevel,
}) =>
  crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
        dependencySignalHash,
        news: {
          updatedAt: latestNews?.lastUpdated || latestNews?.updatedAt || null,
          topics: latestNews?.trendingTopics || [],
        },
        jobs: {
          updatedAt: latestJob?.lastSynced || latestJob?.updatedAt || null,
          jobId: latestJob?.jobId || '',
          skills: latestJob?.skills || [],
        },
        careerStack,
        experienceLevel,
      }),
    )
    .digest('hex');

const isCacheOlderThan = (cache, ...values) => {
  const cacheDate = safeDate(cache?.updatedAt || cache?.createdAt);
  if (!cacheDate) return false;
  return values
    .map((value) => safeDate(value))
    .filter(Boolean)
    .some((date) => date.getTime() > cacheDate.getTime() + 1000);
};

const firstString = (values = [], fallback = '') => {
  const value = (Array.isArray(values) ? values : [])
    .map((item) => String(item?.name || item?.skill || item?.title || item || '').trim())
    .find(Boolean);
  return value || fallback;
};

const skillNamesFromCache = (values = [], limit = 24) =>
  [
    ...new Set(
      (Array.isArray(values) ? values : [])
        .map((item) => String(item?.name || item?.skill || item || '').trim())
        .filter(Boolean),
    ),
  ].slice(0, limit);

const buildCommandCenter = ({
  latestSkillGapCache,
  latestRecommendationCache,
  latestCareerSprint,
  latestJob,
  latestNews,
}) => {
  const skillData = latestSkillGapCache?.analysisData || {};
  const missingSkills = Array.isArray(skillData.missingSkills) ? skillData.missingSkills : [];
  const highDemandSkills = Array.isArray(skillData.highDemandSkills)
    ? skillData.highDemandSkills
    : [];
  const projects = Array.isArray(latestRecommendationCache?.analysisData?.projects)
    ? latestRecommendationCache.analysisData.projects
    : [];
  const tasks = Array.isArray(latestCareerSprint?.tasks) ? latestCareerSprint.tasks : [];
  const sprintTask =
    tasks.find((task) => !task?.isCompleted && task?.priority === 'high') ||
    tasks.find((task) => !task?.isCompleted) ||
    null;
  const topics = Array.isArray(latestNews?.trendingTopics) ? latestNews.trendingTopics : [];

  return [
    {
      key: 'prioritySkill',
      label: 'Top Priority Skill',
      value: firstString(highDemandSkills, firstString(missingSkills, 'No priority skill yet')),
      source: 'Skill Gap',
      route: '/app/skill-gap',
    },
    {
      key: 'skillGap',
      label: 'Top Skill Gap',
      value: firstString(missingSkills, 'No skill gap detected'),
      source: 'Skill Gap',
      route: '/app/skill-gap',
    },
    {
      key: 'project',
      label: 'Top Recommended Project',
      value: String(projects[0]?.title || 'Generate recommendations to pick a project'),
      source: 'Recommendations',
      route: '/app/recommendations',
    },
    {
      key: 'sprint',
      label: 'Top Sprint Task',
      value: String(sprintTask?.title || 'Start a career sprint task'),
      source: 'Career Sprint',
      route: '/app/career-sprint',
    },
    {
      key: 'job',
      label: 'Recent Job Opportunity',
      value: latestJob ? `${latestJob.title} at ${latestJob.company}` : 'No current job snapshot',
      source: 'Jobs',
      route: '/app/jobs',
    },
    {
      key: 'news',
      label: 'Top News Topic',
      value: topics[0] || 'No news topic snapshot',
      source: 'News',
      route: '/app/news',
    },
  ];
};

// Compatibility hook for upstream writers. Dashboard reads deliberately use durable
// evidence on every request, so invalidation works across API replicas without a TTL map.
const invalidateDashboardSummaryCache = () => {};

const latestTimestamp = (...values) => {
  const valid = values
    .filter(Boolean)
    .map((value) => new Date(value))
    .filter((date) => !Number.isNaN(date.getTime()));
  if (!valid.length) return null;
  return valid.sort((left, right) => right.getTime() - left.getTime())[0].toISOString();
};

const getDashboardSummary = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-password').lean();
    if (!user) return res.status(404).json({ message: 'User not found' });

    const githubUsername = developerContext.resolveGithubUsername(user) || '';
    const careerStack = developerContext.resolveCareerStack(user) || 'Full Stack';
    const experienceLevel = developerContext.resolveExperienceLevel(user) || 'Student';
    const [analysisState, cachedContext, integrationInsight] = await Promise.all([
      ensureAnalysis(req.user._id, githubUsername),
      getCachedDashboardContext(req.user._id, careerStack, experienceLevel, user),
      safeGetIntegrationInsight(req.user._id),
    ]);

    const { analysis, rateLimited, noUsername, githubStatus, languageSource } = analysisState;
    const {
      latestPortfolioCache,
      latestSkillGapCache,
      latestRecommendationCache,
      latestResume,
      latestWeeklyReport,
      latestCareerSprint,
      latestJob,
      latestNews,
      learningProgress,
    } = cachedContext;
    const learningRecords = Array.isArray(learningProgress) ? learningProgress : [];
    const learningUpdatedAt =
      learningRecords[0]?.updatedAt || learningRecords[0]?.createdAt || null;
    const learningSnapshot = {
      totalTracked: learningRecords.length,
      savedCount: learningRecords.filter((item) => item?.status === 'saved').length,
      inProgressCount: learningRecords.filter((item) => item?.status === 'in_progress').length,
      completedCount: learningRecords.filter((item) => item?.status === 'completed').length,
      progressSource: 'user-entered',
      completionSource: 'self-reported',
      updatedAt: learningUpdatedAt,
    };

    const developerSignals = await getDeveloperSignals(req.user._id, {
      githubSource: { analysis: analysis?.updatedAt ? analysis : null },
      resumeAnalysis: latestResume,
    });
    const dependencySignalHash = buildSignalHash(developerSignals);
    const signalHash = buildDashboardSignalHash({
      dependencySignalHash,
      latestNews,
      latestJob,
      careerStack,
      experienceLevel,
    });
    const contextVersion = `dashboard:${signalHash.slice(0, 16)}`;

    const staleFlags = {
      portfolio: Boolean(
        latestPortfolioCache &&
        isCacheOlderThan(
          latestPortfolioCache,
          analysis?.updatedAt || analysis?.createdAt,
          latestResume?.analyzedAt,
          latestSkillGapCache?.updatedAt,
          integrationInsight?.updatedAt,
        ),
      ),
      skillGap: Boolean(
        latestSkillGapCache &&
        isCacheOlderThan(
          latestSkillGapCache,
          analysis?.updatedAt || analysis?.createdAt,
          latestResume?.analyzedAt,
          integrationInsight?.updatedAt,
        ),
      ),
      recommendations: Boolean(
        latestRecommendationCache &&
        isCacheOlderThan(
          latestRecommendationCache,
          analysis?.updatedAt || analysis?.createdAt,
          latestResume?.analyzedAt,
          latestSkillGapCache?.updatedAt,
          integrationInsight?.updatedAt,
        ),
      ),
      dashboard: false,
    };
    staleFlags.dashboard = Boolean(
      staleFlags.portfolio || staleFlags.skillGap || staleFlags.recommendations,
    );

    const baseReadiness = clamp(
      numeric(latestPortfolioCache?.analysisData?.portfolioScore?.overallScore) ??
        // Legacy Analysis.readinessScore defaults to zero even before scoring.
        (numeric(analysis?.readinessScore) || numeric(analysis?.githubScore) || 0),
    );
    const integrationScore = clamp(integrationInsight.integrationScore);
    const readinessScore =
      integrationScore > 0
        ? Math.round(baseReadiness * 0.85 + integrationScore * 0.15)
        : baseReadiness;

    const oneMonthAgo = new Date(Date.now() - 25 * 24 * 60 * 60 * 1000);
    const lastMonthReadiness = await AnalysisCache.findOne({
      userId: req.user._id,
      githubUsername,
      careerStack,
      experienceLevel,
      'analysisData.portfolioScore.overallScore': { $exists: true },
      updatedAt: { $lte: oneMonthAgo },
    })
      .sort({ updatedAt: -1, _id: -1 })
      .lean();

    const lastMonthScore = Number(
      lastMonthReadiness?.analysisData?.portfolioScore?.overallScore || 0,
    );
    // Historical portfolio snapshots do not capture historical integration weighting.
    // Compare like-for-like portfolio scores, never a blended score with an unblended one.
    const currentPortfolioScore = numeric(
      latestPortfolioCache?.analysisData?.portfolioScore?.overallScore,
    );
    const scoreChangeFromLastMonth =
      lastMonthReadiness && currentPortfolioScore !== null
        ? Math.round(currentPortfolioScore - lastMonthScore)
        : null;
    const readinessBreakdown = deriveReadinessBreakdown({
      portfolioScore: latestPortfolioCache?.analysisData?.portfolioScore,
      analysis,
      resume: latestResume,
      skillGapCache: latestSkillGapCache,
      integrationInsight,
    });

    const meta = buildSummaryMeta({
      analysis,
      latestResume,
      latestSkillGapCache,
      latestRecommendationCache,
      latestWeeklyReport,
      latestCareerSprint,
      latestJob,
      latestNews,
      learningProgress: learningRecords,
      integrationInsight,
      githubStatus,
      rateLimited,
      noUsername,
      staleFlags,
    });

    const lastAnalyzedAt = latestTimestamp(
      analysis?.updatedAt,
      analysis?.createdAt,
      latestPortfolioCache?.updatedAt,
      latestResume?.analyzedAt,
      latestSkillGapCache?.updatedAt,
      latestRecommendationCache?.updatedAt,
      latestWeeklyReport?.updatedAt ||
        latestWeeklyReport?.createdAt ||
        latestWeeklyReport?.weekEndDate,
      latestCareerSprint?.updatedAt,
      latestJob?.lastSynced || latestJob?.updatedAt,
      latestNews?.lastUpdated || latestNews?.updatedAt,
      learningUpdatedAt,
      integrationInsight?.updatedAt,
    );
    const lastUpdated = lastAnalyzedAt;

    const recommendationSnapshot = {
      items: latestRecommendationCache?.analysisData
        ? buildRecommendationPreview(latestRecommendationCache.analysisData)
        : [],
      stale: staleFlags.recommendations,
      status: staleFlags.recommendations
        ? 'stale'
        : toFreshness(latestRecommendationCache?.updatedAt),
      updatedAt: latestRecommendationCache?.updatedAt || null,
      message: staleFlags.recommendations ? 'Analysis refresh recommended' : '',
    };

    const sourceFreshness = {
      github: freshnessEntry({
        updatedAt: analysis?.updatedAt || analysis?.createdAt || null,
        connected: !noUsername,
        available: Boolean(analysis?.updatedAt || analysis?.createdAt),
        stale: githubStatus === 'stale' || rateLimited,
        reason: rateLimited ? 'GitHub refresh recommended after rate limit resets' : '',
      }),
      resume: freshnessEntry({
        updatedAt: latestResume?.analyzedAt || null,
        available: Boolean(latestResume),
      }),
      skillGap: freshnessEntry({
        updatedAt: latestSkillGapCache?.updatedAt || null,
        available: Boolean(latestSkillGapCache),
        stale: staleFlags.skillGap,
      }),
      recommendations: freshnessEntry({
        updatedAt: latestRecommendationCache?.updatedAt || null,
        available: Boolean(latestRecommendationCache),
        stale: staleFlags.recommendations,
      }),
      weeklyReports: freshnessEntry({
        updatedAt:
          latestWeeklyReport?.updatedAt ||
          latestWeeklyReport?.createdAt ||
          latestWeeklyReport?.weekEndDate ||
          null,
        available: Boolean(latestWeeklyReport),
      }),
      jobs: freshnessEntry({
        updatedAt: latestJob?.lastSynced || latestJob?.updatedAt || null,
        available: Boolean(latestJob),
      }),
      news: freshnessEntry({
        updatedAt: latestNews?.lastUpdated || latestNews?.updatedAt || null,
        available: Boolean(latestNews),
      }),
      careerSprint: freshnessEntry({
        updatedAt: latestCareerSprint?.updatedAt || null,
        available: Boolean(latestCareerSprint),
      }),
      learning: freshnessEntry({
        updatedAt: learningUpdatedAt,
        available: learningRecords.length > 0,
      }),
      integrations: freshnessEntry({
        updatedAt: integrationInsight?.updatedAt || null,
        connected:
          Array.isArray(integrationInsight?.providers) && integrationInsight.providers.length > 0,
        available: Boolean(integrationInsight?.providers?.length),
      }),
    };
    sourceFreshness.weekly = sourceFreshness.weeklyReports;

    const scopedSkillGapData = latestSkillGapCache?.analysisData || {};
    const skillsSnapshot = {
      topSkills: skillNamesFromCache(
        scopedSkillGapData.yourSkills || developerSignals.skillGapSignals?.knownSkills || [],
        24,
      ),
      missingSkills: skillNamesFromCache(
        scopedSkillGapData.missingSkills || developerSignals.skillGapSignals?.missingSkills || [],
        20,
      ),
      coveragePercentage: skillGapContract.coverage(
        latestSkillGapCache
          ? scopedSkillGapData.coverage
          : developerSignals.skillGapSignals?.coverage,
      ),
      stale: staleFlags.skillGap,
      updatedAt: latestSkillGapCache?.updatedAt || null,
    };

    const readinessCenter = buildReadinessCenter({
      readinessScore,
      latestResume,
      latestPortfolioCache,
      latestSkillGapCache,
      latestRecommendationCache,
      latestCareerSprint,
      latestWeeklyReport,
      latestJob,
      integrationScore: integrationInsight.providers?.length ? integrationScore : null,
    });

    const commandCenter = buildCommandCenter({
      latestSkillGapCache,
      latestRecommendationCache,
      latestCareerSprint,
      latestJob,
      latestNews,
    });

    const payload = {
      score: Number(analysis?.githubScore || 0),
      readinessScore,
      readinessBreakdown,
      scoreChangeFromLastMonth,
      repositories: Number(analysis?.githubStats?.repos || 0),
      stars: Number(analysis?.githubStats?.stars || 0),
      forks: Number(analysis?.githubStats?.forks || 0),
      followers: Number(analysis?.githubStats?.followers || 0),
      userName: user.name || 'Developer',
      githubHandle: githubUsername,
      lastAnalyzedAt,
      updatedAt: lastAnalyzedAt,
      languageSource,
      integration: {
        score: integrationScore,
        providers: (integrationInsight.providers || []).map((provider) => ({
          provider: provider.provider,
          profileScore: Number(provider.profileScore || 0),
          activityScore: Number(provider.activityScore || 0),
          confidence: Number(provider.confidence || 0),
          syncedAt: provider.syncedAt || null,
        })),
        mergedSkills: integrationInsight.mergedSkills || [],
        updatedAt: integrationInsight.updatedAt || null,
      },
      resume: {
        analyzed: Boolean(latestResume),
        atsScore: Number(latestResume?.atsScore || 0),
        keywordDensity: Number(latestResume?.keywordDensity || 0),
        formatScore: Number(latestResume?.formatScore || 0),
        contentQuality: Number(latestResume?.contentQuality || 0),
        analyzedAt: latestResume?.analyzedAt || null,
      },
      rateLimited: Boolean(rateLimited),
      noUsername: Boolean(noUsername),
      recommendationSnapshot,
      skillsSnapshot,
      learningSnapshot,
      readinessCenter,
      commandCenter,
      sourceFreshness,
      dashboardContext: {
        signalHash,
        dependencySignalHash,
        contextVersion,
        lastUpdated,
        careerStack,
        experienceLevel,
        stale: staleFlags.dashboard,
        refreshRecommended: staleFlags.dashboard,
        message: staleFlags.dashboard ? 'Analysis refresh recommended' : '',
      },
      signalMetadata: {
        signalHash,
        dependencySignalHash,
        contextVersion,
        lastUpdated,
        staleSources: Object.entries(staleFlags)
          .filter(([, stale]) => stale)
          .map(([source]) => source),
        sourceFreshness,
      },
      ...meta,
    };

    if (maybeSendNotModified(req, res, payload)) return;
    res.json(payload);
  } catch (error) {
    console.error('Dashboard summary error:', error);
    res.status(500).json({ message: 'Failed to load dashboard summary' });
  }
};

const getDashboardContributions = async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .select('githubUsername activeGithubUsername')
      .lean();
    const githubUsername = developerContext.resolveGithubUsername(user) || '';
    const { analysis, rateLimited } = await ensureAnalysis(req.user._id, githubUsername);
    const data =
      Array.isArray(analysis?.contributionActivity) && analysis.contributionActivity.length
        ? analysis.contributionActivity
        : emptyContributionActivity();

    res.json({
      data,
      syncStatus: rateLimited
        ? 'rate_limited'
        : toFreshness(analysis?.updatedAt || analysis?.createdAt),
      updatedAt: analysis?.updatedAt || analysis?.createdAt || null,
    });
  } catch (error) {
    console.error('Dashboard contributions error:', error);
    res.status(500).json({ message: 'Failed to load contributions' });
  }
};

const getDashboardLanguages = async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .select('githubUsername activeGithubUsername')
      .lean();
    const githubUsername = developerContext.resolveGithubUsername(user) || '';
    const { analysis, rateLimited, languageSource } = await ensureAnalysis(
      req.user._id,
      githubUsername,
    );

    res.json({
      data: normalizeLanguageMap(analysis?.languageDistribution),
      syncStatus: rateLimited
        ? 'rate_limited'
        : toFreshness(analysis?.updatedAt || analysis?.createdAt),
      updatedAt: analysis?.updatedAt || analysis?.createdAt || null,
      source: languageSource,
    });
  } catch (error) {
    console.error('Dashboard languages error:', error);
    res.status(500).json({ message: 'Failed to load language distribution' });
  }
};

const getDashboardSkills = async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .select(
        'githubUsername activeGithubUsername activeCareerStack careerStack activeExperienceLevel experienceLevel activeResumeFileId defaultResumeFileId',
      )
      .lean();
    const githubUsername = developerContext.resolveGithubUsername(user) || '';

    const resume = await developerContext.resolveResumeAnalysis(req.user._id, user, {
      ResumeAnalysis,
    });
    const [{ analysis, rateLimited }, integrationInsight, latestSkillGapCache] = await Promise.all([
      ensureAnalysis(req.user._id, githubUsername),
      safeGetIntegrationInsight(req.user._id),
      latestCacheByPredicate(
        req.user._id,
        skillGapContract.buildScope({
          userId: req.user._id,
          user,
          resumeIdentity: buildResumeCacheIdentity({ resumeAnalysis: resume }),
        }),
      ),
    ]);

    const languageMap = normalizeLanguageMap(analysis?.languageDistribution);
    const derivedTopSkills = Object.keys(languageMap)
      .filter((key) => Number(languageMap[key] || 0) > 0)
      .concat(integrationInsight.mergedSkills || []);

    let topSkills = [];
    let missingSkills = [];
    let coveragePercentage = null;

    if (latestSkillGapCache?.analysisData) {
      topSkills = Array.isArray(latestSkillGapCache.analysisData.yourSkills)
        ? latestSkillGapCache.analysisData.yourSkills
            .map((skill) => (typeof skill === 'string' ? skill : skill?.name || skill?.skill))
            .filter(Boolean)
        : [];
      missingSkills = Array.isArray(latestSkillGapCache.analysisData.missingSkills)
        ? latestSkillGapCache.analysisData.missingSkills
            .map((skill) => (typeof skill === 'string' ? skill : skill?.name || skill?.skill))
            .filter(Boolean)
        : [];
      coveragePercentage = skillGapContract.coverage(latestSkillGapCache.analysisData.coverage);
    } else {
      const detected = detectSkillGaps(derivedTopSkills);
      topSkills = derivedTopSkills;
      missingSkills = (detected.missingSkills || [])
        .map((skill) => skill.name || skill)
        .filter(Boolean);

      // Metadata fallback cannot establish canonical evidence coverage.
      coveragePercentage = null;
    }

    res.json({
      topSkills: [
        ...new Set(topSkills.map((value) => String(value || '').trim()).filter(Boolean)),
      ].slice(0, 12),
      missingSkills: [
        ...new Set(missingSkills.map((value) => String(value || '').trim()).filter(Boolean)),
      ].slice(0, 8),
      coveragePercentage,
      syncStatus: rateLimited
        ? 'rate_limited'
        : latestSkillGapCache
          ? toFreshness(latestSkillGapCache.updatedAt)
          : 'stale',
      updatedAt: latestSkillGapCache?.updatedAt || analysis?.updatedAt || null,
    });
  } catch (error) {
    console.error('Dashboard skills error:', error);
    res.status(500).json({ message: 'Failed to load skills' });
  }
};

const getDashboardRecommendations = async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .select(
        'githubUsername activeGithubUsername activeCareerStack careerStack activeExperienceLevel experienceLevel activeResumeFileId defaultResumeFileId',
      )
      .lean();
    const careerStack = developerContext.resolveCareerStack(user) || 'Full Stack';
    const experienceLevel = developerContext.resolveExperienceLevel(user) || 'Student';
    const resume = await developerContext.resolveResumeAnalysis(req.user._id, user, {
      ResumeAnalysis,
    });
    const resumeIdentity = buildResumeCacheIdentity({ resumeAnalysis: resume });
    const [latestRecommendationCache, savedRecommendations] = await Promise.all([
      latestCacheByPredicate(req.user._id, {
        githubUsername: developerContext.resolveGithubUsername(user) || '',
        careerStack,
        experienceLevel,
        ...resumeIdentity,
        'analysisData.projects': { $exists: true },
      }),
      Recommendation.find({ userId: req.user._id, careerStack, experienceLevel })
        .sort({ createdAt: -1, _id: -1 })
        .limit(4)
        .lean(),
    ]);

    const items = latestRecommendationCache?.analysisData
      ? buildRecommendationPreview(latestRecommendationCache.analysisData)
      : savedRecommendations.map((item) => ({
          title: item.title,
          priority: item.priority,
          priorityType: item.priorityType,
          category: item.category,
        }));

    res.json({
      items,
      syncStatus: latestRecommendationCache
        ? toFreshness(latestRecommendationCache.updatedAt)
        : items.length
          ? 'stale'
          : 'queued',
      updatedAt: latestRecommendationCache?.updatedAt || savedRecommendations[0]?.createdAt || null,
    });
  } catch (error) {
    console.error('Dashboard recommendations error:', error);
    res.status(500).json({ message: 'Failed to load recommendations' });
  }
};

const getDashboardIntegrationAnalytics = async (req, res) => {
  try {
    const parsedDays = Number(String(req.query.days ?? '7'));
    if (!Number.isInteger(parsedDays) || parsedDays < 1 || parsedDays > 30) {
      return res.status(400).json({ message: 'days must be an integer between 1 and 30' });
    }
    const days = parsedDays;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [logs, persistedInsight, connections] = await Promise.all([
      IntegrationSyncLog.find({
        userId: req.user._id,
        createdAt: { $gte: since },
      })
        .select('provider activityScore profileScore confidence status createdAt')
        .sort({ createdAt: -1, _id: -1 })
        .lean(),
      safeGetIntegrationInsight(req.user._id),
      IntegrationConnection.find({ userId: req.user._id, status: 'connected' })
        .select('provider lastSyncedAt metadata')
        .lean(),
    ]);

    const logMap = new Map();
    logs.forEach((log) => {
      if (!logMap.has(log.provider)) logMap.set(log.provider, []);
      logMap.get(log.provider).push(log);
    });

    const insightByProvider = new Map(
      (persistedInsight.providers || []).map((provider) => [
        provider.provider,
        {
          profileScore: Number(provider.profileScore || 0),
          activityScore: Number(provider.activityScore || 0),
          confidence: Number(provider.confidence || 0),
          syncedAt: provider.syncedAt || null,
        },
      ]),
    );

    const providerSet = new Set([
      ...Array.from(logMap.keys()),
      ...Array.from(insightByProvider.keys()),
      // Public Kaggle resources have no scores. Historical scored insight/log rows
      // remain represented by the other sets without inventing connection defaults.
      ...connections
        .filter(
          (connection) =>
            !(
              connection.provider === 'kaggle' &&
              connection.metadata?.resourceObservation?.version === 'kaggle-resources-v1'
            ),
        )
        .map((connection) => connection.provider),
    ]);

    const cards = Array.from(providerSet.values())
      .map((provider) => {
        const providerLogs = logMap.get(provider) || [];
        const successfulLogs = providerLogs.filter((item) => item.status === 'success');
        const latest = successfulLogs[0] || null;
        const previous = successfulLogs[1] || null;
        const insight = insightByProvider.get(provider) || null;
        const connection = connections.find((item) => item.provider === provider) || null;

        const activityScore = latest
          ? Number(latest.activityScore || 0)
          : Number(insight?.activityScore || connection?.metadata?.activityScore || 0);
        const profileScore = latest
          ? Number(latest.profileScore || 0)
          : Number(insight?.profileScore || connection?.metadata?.profileScore || 0);
        const confidence = latest
          ? Number(latest.confidence || 0)
          : Number(insight?.confidence ?? 0);
        const trendDelta =
          latest && previous
            ? Number(
                (Number(latest.activityScore || 0) - Number(previous.activityScore || 0)).toFixed(
                  2,
                ),
              )
            : 0;
        const successCount = providerLogs.filter((item) => item.status === 'success').length;
        const successRate =
          providerLogs.length > 0
            ? Number(((successCount / providerLogs.length) * 100).toFixed(1))
            : 0;

        return {
          provider,
          activityScore,
          profileScore,
          confidence,
          trendDelta,
          successRate,
          syncCount: providerLogs.length,
          lastSyncedAt: latest?.createdAt || insight?.syncedAt || connection?.lastSyncedAt || null,
        };
      })
      .sort((a, b) => {
        const left = a.lastSyncedAt ? new Date(a.lastSyncedAt).getTime() : 0;
        const right = b.lastSyncedAt ? new Date(b.lastSyncedAt).getTime() : 0;
        return right - left || a.provider.localeCompare(b.provider);
      });

    res.json({
      days,
      cards,
      syncStatus: toFreshness(persistedInsight.updatedAt),
      updatedAt: persistedInsight.updatedAt || null,
    });
  } catch (error) {
    console.error('Dashboard integration analytics error:', error.message);
    res.status(500).json({ message: 'Failed to load integration analytics' });
  }
};

module.exports = {
  __test: {
    loadDefaultResumeAnalysis,
    deriveReadinessBreakdown,
    buildReadinessCenter,
    getCachedDashboardContext,
    normalizeLanguageMap,
    toFreshness,
    createEmptyAnalysis,
  },
  getDashboardSummary,
  getDashboardContributions,
  getDashboardLanguages,
  getDashboardSkills,
  getDashboardRecommendations,
  getDashboardIntegrationAnalytics,
  invalidateDashboardSummaryCache,
};
