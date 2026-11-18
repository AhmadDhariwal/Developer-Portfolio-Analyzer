const { languagePresentation } = require('../github/services/githubLanguagePresentation');
const { normalizeDashboardActivity } = require('./utils/dashboardActivity');
const portfolioScoring = require('../../core/scoring/portfolioScore');
const {
  buildCachePipeline,
  buildIntegrationPipeline,
} = require('./services/dashboardQueryService');
const { readStableDashboard } = require('./services/dashboardConsistencyService');
const { loadReadinessHistory } = require('./services/dashboardHistoryService');
const { buildDashboardProgress } = require('./services/dashboardProgressService');
const mongoose = require('mongoose');
const { buildReadinessCenter } = require('./services/dashboardMetricsService');
const { clampScore: clamp, numeric, safeAverage } = require('../../core/scoring/math');
const developerContext = require('../../core/developer-context/developerContextService');
const skillGapContract = require('../skill-gap/services/skillGapCacheContract');
const crypto = require('node:crypto');
const Analysis = require('../skill-gap/models/analysis');
const User = require('../auth/models/user');
const AnalysisCache = require('../skill-gap/models/analysisCache');
const {
  RECOMMENDATION_ANALYSIS_VERSION,
} = require('../recommendations/services/recommendationService');
const ResumeAnalysis = require('../resume/models/resumeAnalysis');
const WeeklyReport = require('../weekly-reports/models/weeklyReport');
const CareerSprint = require('../career-sprint/models/careerSprint');
const JobCache = require('../jobs/models/jobCache');
const NewsCache = require('../news/models/news');
const UserCourseProgress = require('../courses/models/userCourseProgress');
const { buildResumeCacheIdentity } = require('../../core/developer-context/developerSignalService');
const { getIntegrationInsight } = require('../integrations/services/integrationInsightService');
const IntegrationSyncLog = require('../integrations/models/integrationSyncLog');
const IntegrationConnection = require('../integrations/models/integrationConnection');

const DASHBOARD_FRESH_MS = 24 * 60 * 60 * 1000;

const safeDate = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const toFreshness = (value, maxAgeMs = DASHBOARD_FRESH_MS) => {
  const date = safeDate(value);
  if (!date) return 'missing';
  const age = Date.now() - date.getTime();
  return age >= 0 && age <= maxAgeMs ? 'fresh' : 'stale';
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
  maxAgeMs = DASHBOARD_FRESH_MS,
  policy = '',
} = {}) => {
  const baseStatus = !safeDate(updatedAt)
    ? 'missing'
    : stale
      ? 'stale'
      : toFreshness(updatedAt, maxAgeMs);
  const status = available ? baseStatus : 'missing';
  return {
    connected: Boolean(connected || available),
    available: Boolean(available),
    lastUpdated: updatedAt || null,
    status,
    policy: policy || (Number.isFinite(maxAgeMs) ? 'age-and-dependencies' : 'durable-record'),
    label: statusLabel(status),
    refreshRecommended: status !== 'fresh',
    reason: reason || (status === 'fresh' ? '' : 'Analysis refresh recommended'),
  };
};

const normalizeLanguageMap = (fallback, rawBytes) =>
  Object.fromEntries(
    languagePresentation(rawBytes, fallback).mainLanguageDistribution.map(
      ({ language, percentage }) => [language, percentage],
    ),
  );

const recordedGithubAt = (analysis) =>
  safeDate(analysis?.githubSignals?.analyzedAt) ||
  analysis?.createdAt ||
  analysis?.updatedAt ||
  null;

const languagesFromAnalysis = (analysis) =>
  normalizeLanguageMap(
    analysis?.githubSignals?.languages?.normalized || analysis?.languageDistribution,
    analysis?.githubSignals?.languages?.rawBytes,
  );

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
  contributionActivity: [],
  createdAt: null,
  updatedAt: null,
});

const recommendationScope = {
  analysisVersion: RECOMMENDATION_ANALYSIS_VERSION,
  'analysisData.projects': { $exists: true },
  'analysisData.cacheMetadata.temporary': { $ne: true },
  'analysisData.sourceFingerprint': { $type: 'string' },
};

const latestCacheByPredicate = async (userId, predicate) =>
  AnalysisCache.findOne({ userId, ...predicate })
    .sort({ updatedAt: -1, _id: -1 })
    .lean();

const loadDefaultResumeAnalysis = (userId) =>
  developerContext.resolveResumeAnalysis(userId, undefined, {
    User,
    ResumeAnalysis,
    defaultOnly: true,
  });

const selectedResumeIdentity = (user, resumeAnalysis) =>
  buildResumeCacheIdentity({
    resumeAnalysis,
    defaultResumeFileId: developerContext.resolveDefaultResumeFileId(user),
  });

const getCachedDashboardContext = async (
  userId,
  careerStack,
  experienceLevel,
  user,
  compact = false,
  asOf = new Date(),
) => {
  const context = user || (await developerContext.loadUser(userId, { User }));
  const scopedCache = {
    careerStack,
    experienceLevel,
    githubUsername: developerContext.resolveGithubUsername(context) || '',
  };
  const currentResume = await developerContext.resolveResumeAnalysis(userId, context, {
    ResumeAnalysis,
    defaultOnly: true,
  });
  Object.assign(scopedCache, selectedResumeIdentity(context, currentResume));
  const skillGapScope = skillGapContract.buildScope({
    userId,
    user: context,
    resumeIdentity: selectedResumeIdentity(context, currentResume),
  });
  scopedCache.githubUsername = skillGapScope.githubUsername;
  const cachePredicates = [
    { ...scopedCache, 'analysisData.portfolioScore.overallScore': { $exists: true } },
    { ...skillGapScope, 'analysisData.missingSkills': { $exists: true } },
    { ...scopedCache, ...recommendationScope },
  ];
  let caches;
  if (compact) {
    const [result] = await AnalysisCache.aggregate(
      buildCachePipeline(userId, careerStack, experienceLevel, cachePredicates),
    ).option({ maxTimeMS: 1500, allowDiskUse: false });
    caches = [0, 1, 2].map((index) => result?.[String(index)]?.[0] || null);
  } else
    caches = await Promise.all(
      cachePredicates.map((predicate) => latestCacheByPredicate(userId, predicate)),
    );
  const [latestPortfolioCache, latestSkillGapCache, latestRecommendationCache] = caches;
  const [
    latestResume,
    latestWeeklyReport,
    latestCareerSprint,
    latestJob,
    latestNews,
    learningProgress,
  ] = await Promise.all([
    Promise.resolve(currentResume),
    WeeklyReport.findOne({ userId })
      .select('weekEndDate createdAt updatedAt')
      .sort({ weekEndDate: -1, updatedAt: -1, _id: -1 })
      .lean(),
    CareerSprint.findOne({
      userId,
      $or: [
        { sprintStartDate: { $lte: asOf }, sprintEndDate: { $gte: asOf } },
        {
          sprintStartDate: null,
          sprintEndDate: null,
          weekStartDate: { $lte: asOf },
          weekEndDate: { $gte: asOf },
        },
      ],
    })
      .select(
        'tasks._id tasks.title tasks.points tasks.priority tasks.isCompleted tasks.completedAt sprintStartDate sprintEndDate weekStartDate weekEndDate updatedAt __v goalStack goalExperienceLevel',
      )
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
    compact
      ? UserCourseProgress.aggregate([
          {
            $match: {
              userId: mongoose.isValidObjectId(userId)
                ? new mongoose.Types.ObjectId(String(userId))
                : userId,
            },
          },
          {
            $facet: {
              counts: [
                {
                  $group: { _id: '$status', count: { $sum: 1 }, updatedAt: { $max: '$updatedAt' } },
                },
              ],
              recent: [
                { $match: { status: 'completed' } },
                { $sort: { completedAt: -1, _id: -1 } },
                { $limit: 5 },
                { $project: { status: 1, 'course.title': 1, completedAt: 1, updatedAt: 1 } },
              ],
            },
          },
        ]).option({ maxTimeMS: 1500, allowDiskUse: false })
      : UserCourseProgress.find({ userId })
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
    learningProgress: compact
      ? learningProgress[0]?.recent || []
      : Array.isArray(learningProgress)
        ? learningProgress
        : [],
    learningTotals: compact ? learningProgress[0]?.counts || [] : null,
  };
};

const deriveReadinessBreakdown = ({
  portfolioScore,
  analysis,
  resume,
  skillGapCache,
  integrationInsight,
}) => {
  const score = (value) => (numeric(value) === null ? null : clamp(value));
  const saved =
    portfolioScore?.breakdown || portfolioScore?.analysisData?.portfolioScore?.breakdown;
  const canonical = portfolioScore?.scoring?.breakdown;
  const dimension = (key) => (canonical?.[key] ? score(canonical[key].value) : score(saved?.[key]));
  return {
    codeQuality: saved
      ? dimension('codeQuality')
      : analysis?.updatedAt
        ? score(analysis.githubScore)
        : null,
    skillCoverage:
      saved && skillGapCache
        ? dimension('skillCoverage')
        : skillGapContract.coverage(skillGapCache?.analysisData?.coverage),
    industryReadiness: saved
      ? dimension('industryReadiness')
      : resume
        ? score(
            safeAverage([
              resume.atsScore,
              resume.keywordDensity,
              resume.contentQuality,
              resume.formatScore,
            ]),
          )
        : null,
    projectImpact: saved
      ? dimension('projectImpact')
      : (() => {
          const githubImpact = analysis?.updatedAt
            ? numeric(
                analysis.githubSignals?.scoring?.breakdown?.projectImpact?.value ??
                  analysis.githubSignals?.scoring?.inputs?.projectImpact,
              )
            : null;
          const githubConsistency = analysis?.updatedAt
            ? numeric(
                analysis.githubSignals?.scoring?.breakdown?.consistency?.value ??
                  analysis.githubSignals?.scoring?.inputs?.consistency,
              )
            : null;
          const githubContribution = analysis?.updatedAt
            ? numeric(
                analysis.githubSignals?.scoring?.breakdown?.contribution?.value ??
                  analysis.githubSignals?.scoring?.inputs?.contribution,
              )
            : null;
          const integrationImpact =
            Array.isArray(integrationInsight?.providers) && integrationInsight.providers.length > 0
              ? numeric(integrationInsight.integrationScore)
              : null;
          const avg = safeAverage([
            githubImpact,
            githubConsistency,
            githubContribution,
            integrationImpact,
          ]);
          return score(avg);
        })(),
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
  const githubFreshness = toFreshness(recordedGithubAt(analysis));
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
        maxAgeMs: safeDate(analysis?.githubSignals?.acceptedResult?.cache?.expiresAt)
          ? Number.POSITIVE_INFINITY
          : DASHBOARD_FRESH_MS,
        policy: 'github-cache-expiry',
        available: Boolean(recordedGithubAt(analysis)),
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
        reason: latestWeeklyReport ? '' : 'No weekly report has been saved.',
        status: weeklyFreshness,
      },
      careerSprint: {
        connected: Boolean(latestCareerSprint),
        available: Boolean(latestCareerSprint),
        reason: latestCareerSprint ? '' : 'There is no active Career Sprint in this UTC window.',
        status: careerSprintFreshness,
      },
      jobs: {
        connected: Boolean(latestJob),
        available: Boolean(latestJob),
        reason: latestJob ? '' : 'No current Jobs Hub results in the saved feed.',
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
        reason: integrationInsight?.providers?.length
          ? toFreshness(integrationInsight.updatedAt) === 'stale'
            ? 'Open Integrations to check the latest provider sync.'
            : ''
          : 'No supported integration evidence is available.',
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
    .select(
      'githubScore readinessScore githubStats githubSignals.username githubSignals.scoring githubSignals.analyzedAt githubSignals.languages.rawBytes githubSignals.languages.normalized githubSignals.acceptedResult.cache.expiresAt languageDistribution contributionActivity updatedAt createdAt',
    )
    .sort({ updatedAt: -1, createdAt: -1, _id: -1 })
    .lean();
  if (
    analysis &&
    safeDate(analysis.updatedAt) &&
    analysis.githubSignals?.username &&
    analysis.githubSignals.username.toLowerCase() === String(githubUsername).toLowerCase()
  ) {
    return {
      analysis,
      rateLimited: false,
      noUsername: !githubUsername,
      githubStatus: safeDate(analysis.githubSignals?.acceptedResult?.cache?.expiresAt)
        ? safeDate(analysis.githubSignals.acceptedResult.cache.expiresAt) > new Date()
          ? 'fresh'
          : 'stale'
        : toFreshness(recordedGithubAt(analysis)),
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

const isCacheOlderThan = (cache, ...values) => {
  const cacheDate = safeDate(cache?.updatedAt || cache?.createdAt);
  if (!cacheDate) return false;
  return values
    .map((value) => safeDate(value))
    .filter(Boolean)
    .some((date) => date.getTime() > cacheDate.getTime());
};

const sourceChanged = (reference, timestamp) =>
  Boolean(reference) &&
  (safeDate(reference.timestamp)?.getTime() ?? null) !== (safeDate(timestamp)?.getTime() ?? null);

const skillGapIsStale = (cache, analysis, resume, integration, profile) => {
  if (!cache) return false;
  const sources = cache.analysisData?.sourceReferences || [];
  const githubAt = recordedGithubAt(analysis);
  const resumeAt = resume?.analyzedAt || resume?.createdAt;
  return (
    sourceChanged(
      sources.find((source) => source.type === 'github'),
      githubAt,
    ) ||
    sourceChanged(
      sources.find((source) => source.type === 'resume'),
      resumeAt,
    ) ||
    (Boolean(profile?.updatedAt) &&
      sourceChanged(
        sources.find((source) => source.type === 'profile'),
        profile.updatedAt,
      )) ||
    isCacheOlderThan(cache, githubAt, resumeAt, integration?.updatedAt)
  );
};

const recommendationsAreStale = (cache, analysis, resume, skillGap, profile) => {
  if (!cache) return false;
  const sources = cache.analysisData?.sourceMetadata;
  const githubAt = recordedGithubAt(analysis);
  const resumeAt = resume?.analyzedAt || resume?.createdAt;
  return (
    sourceChanged(sources?.github, githubAt) ||
    sourceChanged(sources?.resume, resumeAt) ||
    isCacheOlderThan(cache, githubAt, resumeAt, skillGap?.updatedAt, profile?.updatedAt)
  );
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
      value: firstString(
        highDemandSkills,
        firstString(missingSkills, 'Open Skill Gap to identify priorities'),
      ),
      source: 'Skill Gap',
      route: '/app/skill-gap',
    },
    {
      key: 'skillGap',
      label: 'Top Skill Gap',
      value: firstString(missingSkills, 'No current Skill Gap evidence'),
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
    const asOf = new Date();
    const captured = await readStableDashboard(async () => {
      const user = await User.findById(req.user._id)
        .select(
          'name githubUsername activeGithubUsername careerStack activeCareerStack experienceLevel activeExperienceLevel activeResumeFileId defaultResumeFileId updatedAt __v',
        )
        .lean();
      if (!user) {
        const error = new Error('User not found');
        error.status = 404;
        throw error;
      }
      const githubUsername = developerContext.resolveGithubUsername(user) || '';
      const careerStack = developerContext.resolveCareerStack(user) || 'Full Stack';
      const experienceLevel = developerContext.resolveExperienceLevel(user) || 'Student';
      const [analysisState, cachedContext, integrationInsight] = await Promise.all([
        ensureAnalysis(req.user._id, githubUsername),
        getCachedDashboardContext(req.user._id, careerStack, experienceLevel, user, true, asOf),
        safeGetIntegrationInsight(req.user._id),
      ]);
      return {
        user,
        githubUsername,
        careerStack,
        experienceLevel,
        analysisState,
        cachedContext,
        integrationInsight,
      };
    });
    const {
      user,
      githubUsername,
      careerStack,
      experienceLevel,
      analysisState,
      cachedContext,
      integrationInsight,
    } = captured;
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
      learningTotals,
    } = cachedContext;
    const learningRecords = Array.isArray(learningProgress) ? learningProgress : [];
    const learningUpdatedAt = latestTimestamp(
      ...(learningTotals || []).map((row) => row.updatedAt),
      learningRecords[0]?.updatedAt,
      learningRecords[0]?.createdAt,
    );
    const learningCount = (status) =>
      learningTotals
        ? learningTotals
            .filter((row) => !status || row._id === status)
            .reduce((sum, row) => sum + row.count, 0)
        : learningRecords.filter((row) => !status || row.status === status).length;
    const learningSnapshot = {
      totalTracked: learningCount(),
      savedCount: learningCount('saved'),
      inProgressCount: learningCount('in_progress'),
      completedCount: learningCount('completed'),
      progressSource: 'user-entered',
      completionSource: 'self-reported',
      updatedAt: learningUpdatedAt,
    };

    // Versioned Dashboard identity must never overwrite the canonical shared
    // developer-signal hash, which has a different owner and dependency set.
    const dependencySignalHash = ''; // Not resolved here; only its owning service may publish it.
    const signalHash = captured.revision;
    const contextVersion = `dashboard-v2:${signalHash.slice(0, 16)}`;
    const identity = {
      userId: String(req.user._id),
      githubUsername,
      careerStack,
      experienceLevel,
      ...selectedResumeIdentity(user, latestResume),
    };
    const history = await loadReadinessHistory(
      req.user._id,
      identity,
      latestPortfolioCache?.analysisData?.portfolioScore?.scoring?.ruleVersion,
      asOf,
    );

    const missingSkillGapReason =
      !analysis?.githubSignals?.username && !latestResume
        ? 'No saved GitHub analysis or selected resume analysis. Sync GitHub or analyze a resume, then open Skill Gap.'
        : 'No saved Skill Gap assessment for this profile. Open Skill Gap to assess the available evidence.';

    const staleFlags = {
      portfolio: Boolean(
        latestPortfolioCache &&
        isCacheOlderThan(
          latestPortfolioCache,
          recordedGithubAt(analysis),
          latestResume?.analyzedAt,
          latestSkillGapCache?.updatedAt,
          integrationInsight?.updatedAt,
          user.updatedAt,
        ),
      ),
      skillGap: skillGapIsStale(
        latestSkillGapCache,
        analysis,
        latestResume,
        integrationInsight,
        user,
      ),
      recommendations: recommendationsAreStale(
        latestRecommendationCache,
        analysis,
        latestResume,
        latestSkillGapCache,
        user,
      ),
      dashboard: false,
    };
    staleFlags.dashboard = Boolean(
      staleFlags.portfolio || staleFlags.skillGap || staleFlags.recommendations,
    );

    const currentSkillGapCache = staleFlags.skillGap ? null : latestSkillGapCache;
    const currentPortfolioCache = staleFlags.portfolio ? null : latestPortfolioCache;
    const currentRecommendationCache = staleFlags.recommendations
      ? null
      : latestRecommendationCache;

    const baseReadiness =
      numeric(currentPortfolioCache?.analysisData?.portfolioScore?.overallScore) ??
      (analysis?.updatedAt ? numeric(analysis.githubScore) : null);
    const integrationScore = integrationInsight.providers?.length
      ? clamp(integrationInsight.integrationScore)
      : 0;
    const readinessScore =
      baseReadiness === null
        ? null
        : integrationScore > 0
          ? Math.round(clamp(baseReadiness) * 0.85 + integrationScore * 0.15)
          : clamp(baseReadiness);

    const scoreChangeFromLastMonth = null; // No monthly cache-derived comparison.
    const readinessBreakdown = deriveReadinessBreakdown({
      portfolioScore: currentPortfolioCache?.analysisData?.portfolioScore,
      analysis,
      resume: latestResume,
      skillGapCache: currentSkillGapCache,
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
      recordedGithubAt(analysis),
      latestPortfolioCache?.updatedAt,
      latestResume?.analyzedAt,
      latestSkillGapCache?.updatedAt,
      latestRecommendationCache?.updatedAt,
    );
    const lastUpdated = latestTimestamp(
      lastAnalyzedAt,
      latestWeeklyReport?.updatedAt ||
        latestWeeklyReport?.createdAt ||
        latestWeeklyReport?.weekEndDate,
      latestCareerSprint?.updatedAt,
      latestJob?.lastSynced || latestJob?.updatedAt,
      latestNews?.lastUpdated || latestNews?.updatedAt,
      learningUpdatedAt,
      integrationInsight?.updatedAt,
    );

    const recommendationSnapshot = {
      items: currentRecommendationCache?.analysisData
        ? buildRecommendationPreview(currentRecommendationCache.analysisData)
        : [],
      stale: staleFlags.recommendations,
      status: staleFlags.recommendations
        ? 'stale'
        : toFreshness(latestRecommendationCache?.updatedAt),
      updatedAt: latestRecommendationCache?.updatedAt || null,
      message: staleFlags.recommendations
        ? 'Inputs changed. Open Recommendations to refresh the evidence-based cards.'
        : currentRecommendationCache?.analysisData?.aiRefreshRecommended
          ? 'AI Refresh Recommended. Evidence-based recommendations reflect the saved inputs.'
          : '',
    };

    const sourceFreshness = {
      github: freshnessEntry({
        updatedAt: recordedGithubAt(analysis) || null,
        maxAgeMs: safeDate(analysis.githubSignals?.acceptedResult?.cache?.expiresAt)
          ? Number.POSITIVE_INFINITY
          : DASHBOARD_FRESH_MS,
        policy: 'module-expiry',
        connected: !noUsername,
        available: Boolean(recordedGithubAt(analysis)),
        stale: githubStatus === 'stale' || rateLimited,
        reason: !recordedGithubAt(analysis)
          ? noUsername
            ? 'Connect a GitHub profile to analyze repositories.'
            : 'Sync GitHub to save repository evidence.'
          : githubStatus === 'stale'
            ? 'The saved GitHub evidence has expired. Sync GitHub for current evidence.'
            : '',
      }),
      resume: freshnessEntry({
        maxAgeMs: Number.POSITIVE_INFINITY,
        updatedAt: latestResume?.analyzedAt || null,
        available: Boolean(latestResume),
        reason: latestResume ? '' : 'Analyze the selected resume to add resume evidence.',
      }),
      skillGap: freshnessEntry({
        maxAgeMs: 7 * 86400000,
        updatedAt: latestSkillGapCache?.updatedAt || null,
        available: Boolean(latestSkillGapCache),
        stale: staleFlags.skillGap,
        reason: latestSkillGapCache
          ? staleFlags.skillGap
            ? 'Saved assessment uses older evidence. Open Skill Gap to reassess.'
            : ''
          : missingSkillGapReason,
      }),
      recommendations: freshnessEntry({
        updatedAt: latestRecommendationCache?.updatedAt || null,
        available: Boolean(latestRecommendationCache),
        stale: staleFlags.recommendations,
        reason:
          recommendationSnapshot.message ||
          (latestRecommendationCache
            ? ''
            : 'Open Recommendations to build a plan from your saved evidence.'),
      }),
      weeklyReports: freshnessEntry({
        maxAgeMs: Number.POSITIVE_INFINITY,
        updatedAt:
          latestWeeklyReport?.updatedAt ||
          latestWeeklyReport?.createdAt ||
          latestWeeklyReport?.weekEndDate ||
          null,
        available: Boolean(latestWeeklyReport),
        reason: latestWeeklyReport ? '' : 'No weekly report has been saved.',
      }),
      jobs: freshnessEntry({
        maxAgeMs: Number.POSITIVE_INFINITY,
        policy: 'module-expiry',
        updatedAt: latestJob?.lastSynced || latestJob?.updatedAt || null,
        available: Boolean(latestJob),
        reason: latestJob ? '' : 'No current Jobs Hub results in the saved feed.',
      }),
      news: freshnessEntry({
        maxAgeMs: 20 * 60000,
        updatedAt: latestNews?.lastUpdated || latestNews?.updatedAt || null,
        available: Boolean(latestNews),
        reason: !latestNews
          ? 'No current Tech News feed snapshot.'
          : toFreshness(latestNews.lastUpdated || latestNews.updatedAt, 20 * 60000) === 'stale'
            ? 'Check the Tech News feed for newer articles.'
            : '',
      }),
      careerSprint: freshnessEntry({
        maxAgeMs: Number.POSITIVE_INFINITY,
        updatedAt: latestCareerSprint?.updatedAt || null,
        available: Boolean(latestCareerSprint),
        reason: latestCareerSprint ? '' : 'There is no active Career Sprint in this UTC window.',
      }),
      learning: freshnessEntry({
        maxAgeMs: Number.POSITIVE_INFINITY,
        updatedAt: learningUpdatedAt,
        available: learningCount() > 0,
        reason: learningCount() ? '' : 'No course progress has been recorded.',
      }),
      integrations: freshnessEntry({
        updatedAt: integrationInsight?.updatedAt || null,
        connected:
          Array.isArray(integrationInsight?.providers) && integrationInsight.providers.length > 0,
        available: Boolean(integrationInsight?.providers?.length),
        reason: integrationInsight?.providers?.length
          ? toFreshness(integrationInsight.updatedAt) === 'stale'
            ? 'Open Integrations to check the latest provider sync.'
            : ''
          : 'No supported integration evidence is available.',
      }),
    };
    sourceFreshness.weekly = sourceFreshness.weeklyReports;
    // One canonical freshness result drives badges, metadata and completeness.
    for (const [key, source] of Object.entries(sourceFreshness)) {
      if (key === 'weekly') continue;
      meta.dataFreshness[key] = source.status;
      meta.sourcesUsed[key] = {
        connected: source.connected,
        available: source.available,
        status: source.status,
      };
    }

    const scopedSkillGapData = currentSkillGapCache?.analysisData || {};
    const skillsSnapshot = {
      topSkills: skillNamesFromCache(scopedSkillGapData.yourSkills || [], 24),
      missingSkills: skillNamesFromCache(scopedSkillGapData.missingSkills || [], 20),
      coveragePercentage: skillGapContract.coverage(scopedSkillGapData.coverage),
      stale: staleFlags.skillGap,
      updatedAt: latestSkillGapCache?.updatedAt || null,
    };

    const readinessCenter = buildReadinessCenter({
      readinessScore,
      latestResume,
      latestPortfolioCache: currentPortfolioCache,
      latestSkillGapCache: currentSkillGapCache,
      latestRecommendationCache: currentRecommendationCache,
      latestCareerSprint,
      latestWeeklyReport,
      latestJob,
      integrationScore: integrationInsight.providers?.length ? integrationScore : null,
    });

    const commandCenter = buildCommandCenter({
      latestSkillGapCache: currentSkillGapCache,
      latestRecommendationCache: currentRecommendationCache,
      latestCareerSprint,
      latestJob,
      latestNews,
    });

    const payload = {
      score: analysis?.updatedAt ? numeric(analysis.githubScore) : null,
      readinessScore,
      readinessMeasurement: {
        value: currentPortfolioCache || analysis?.updatedAt ? readinessScore : null,
        basis: currentPortfolioCache ? 'portfolio' : analysis?.updatedAt ? 'github' : 'missing',
      },
      readinessBreakdown,
      readinessModel: {
        weights: currentPortfolioCache?.analysisData?.portfolioScore?.scoring?.breakdown
          ? Object.fromEntries(
              Object.entries(
                currentPortfolioCache.analysisData.portfolioScore.scoring.breakdown,
              ).map(([key, value]) => [key, value.weight]),
            )
          : portfolioScoring.getWeights(careerStack),
        basis: currentPortfolioCache?.analysisData?.portfolioScore?.scoring?.breakdown
          ? 'recorded'
          : 'nominal',
      },
      scoreChangeFromLastMonth,
      repositories: analysis?.updatedAt ? Number(analysis.githubStats?.repos ?? 0) : null,
      stars: analysis?.updatedAt ? Number(analysis.githubStats?.stars ?? 0) : null,
      forks: analysis?.updatedAt ? Number(analysis.githubStats?.forks ?? 0) : null,
      followers: analysis?.updatedAt ? Number(analysis.githubStats?.followers ?? 0) : null,
      userName: user.name || 'Developer',
      githubHandle: githubUsername,
      lastAnalyzedAt,
      updatedAt: lastUpdated,
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
        atsScore: numeric(latestResume?.atsScore),
        keywordDensity: numeric(latestResume?.keywordDensity),
        formatScore: numeric(latestResume?.formatScore),
        contentQuality: numeric(latestResume?.contentQuality),
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
      activitySnapshot: {
        data: normalizeDashboardActivity(analysis?.contributionActivity),
        available: normalizeDashboardActivity(analysis?.contributionActivity).length > 0,
      },
      languageSnapshot: {
        data: languagesFromAnalysis(analysis),
        available: Object.keys(languagesFromAnalysis(analysis)).length > 0,
      },
      progress: buildDashboardProgress(
        {
          analysis,
          latestCareerSprint,
          latestSkillGapCache: currentSkillGapCache,
          learningProgress: learningRecords,
          sourceFreshness,
          history,
        },
        asOf,
      ),
      consistency: {
        policy: 'dashboard-source-revisions-v1',
        revision: captured.revision,
        identity,
        validation: 'two-equal-reads',
        maxAttempts: 2,
      },
      dashboardContext: {
        signalHash,
        dependencySignalHash,
        sourceRevisionPolicy: 'dashboard-source-revisions-v1',
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
        sourceRevisionPolicy: 'dashboard-source-revisions-v1',
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
    if (error.status === 409) {
      res.set('Retry-After', '1');
      return res.status(409).json({ code: error.code, message: error.message });
    }
    if (error.status === 404) return res.status(404).json({ message: 'User not found' });
    if (error.code === 50) {
      res.set('Retry-After', '1');
      return res.status(503).json({
        code: 'DASHBOARD_QUERY_BUDGET',
        message: 'Dashboard evidence reads exceeded the query budget. Please retry.',
      });
    }
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
    const { analysis, rateLimited, githubStatus } = await ensureAnalysis(
      req.user._id,
      githubUsername,
    );
    const data = normalizeDashboardActivity(analysis?.contributionActivity);

    res.json({
      data,
      syncStatus: rateLimited
        ? 'rate_limited'
        : recordedGithubAt(analysis)
          ? githubStatus
          : 'missing',
      updatedAt: recordedGithubAt(analysis) || null,
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
    const { analysis, rateLimited, githubStatus, languageSource } = await ensureAnalysis(
      req.user._id,
      githubUsername,
    );

    res.json({
      data: languagesFromAnalysis(analysis),
      syncStatus: rateLimited
        ? 'rate_limited'
        : recordedGithubAt(analysis)
          ? githubStatus
          : 'missing',
      updatedAt: recordedGithubAt(analysis) || null,
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
        'githubUsername activeGithubUsername activeCareerStack careerStack activeExperienceLevel experienceLevel activeResumeFileId defaultResumeFileId updatedAt',
      )
      .lean();
    const githubUsername = developerContext.resolveGithubUsername(user) || '';

    const resume = await developerContext.resolveResumeAnalysis(req.user._id, user, {
      ResumeAnalysis,
      defaultOnly: true,
    });
    const [{ analysis, rateLimited }, integrationInsight, latestSkillGapCache] = await Promise.all([
      ensureAnalysis(req.user._id, githubUsername),
      safeGetIntegrationInsight(req.user._id),
      latestCacheByPredicate(
        req.user._id,
        skillGapContract.buildScope({
          userId: req.user._id,
          user,
          resumeIdentity: selectedResumeIdentity(user, resume),
        }),
      ),
    ]);

    const languageMap = languagesFromAnalysis(analysis);
    const derivedTopSkills = Object.keys(languageMap)
      .filter((key) => Number(languageMap[key] || 0) > 0)
      .concat(integrationInsight.mergedSkills || []);

    let topSkills = [];
    let missingSkills = [];
    let coveragePercentage = null;

    const stale = skillGapIsStale(latestSkillGapCache, analysis, resume, integrationInsight, user);
    if (!stale && latestSkillGapCache?.analysisData) {
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
      topSkills = derivedTopSkills;
      missingSkills = []; // Only Skill Gap owns canonical target-role gap detection.

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
        : latestSkillGapCache && !stale
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
        'githubUsername activeGithubUsername activeCareerStack careerStack activeExperienceLevel experienceLevel activeResumeFileId defaultResumeFileId updatedAt',
      )
      .lean();
    const careerStack = developerContext.resolveCareerStack(user) || 'Full Stack';
    const experienceLevel = developerContext.resolveExperienceLevel(user) || 'Student';
    const resume = await developerContext.resolveResumeAnalysis(req.user._id, user, {
      ResumeAnalysis,
      defaultOnly: true,
    });
    const resumeIdentity = selectedResumeIdentity(user, resume);
    const scope = skillGapContract.buildScope({ userId: req.user._id, user, resumeIdentity });
    const [{ analysis }, latestRecommendationCache, latestSkillGapCache] = await Promise.all([
      ensureAnalysis(req.user._id, scope.githubUsername),
      latestCacheByPredicate(req.user._id, {
        githubUsername: scope.githubUsername,
        careerStack,
        experienceLevel,
        ...resumeIdentity,
        ...recommendationScope,
      }),
      latestCacheByPredicate(req.user._id, scope),
    ]);
    const stale = recommendationsAreStale(
      latestRecommendationCache,
      analysis,
      resume,
      latestSkillGapCache,
      user,
    );
    const items =
      !stale && latestRecommendationCache?.analysisData
        ? buildRecommendationPreview(latestRecommendationCache.analysisData)
        : [];

    res.json({
      items,
      syncStatus: stale
        ? 'stale'
        : latestRecommendationCache
          ? toFreshness(latestRecommendationCache.updatedAt)
          : 'queued',
      updatedAt: latestRecommendationCache?.updatedAt || null,
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
      IntegrationSyncLog.aggregate(buildIntegrationPipeline(req.user._id, since)).option({
        maxTimeMS: 1500,
        allowDiskUse: false,
      }),
      safeGetIntegrationInsight(req.user._id),
      IntegrationConnection.find({ userId: req.user._id, status: 'connected' })
        .select('provider lastSyncedAt metadata')
        .lean(),
    ]);

    const logMap = new Map(logs.map((row) => [row._id, row.recent]));
    const logStats = new Map(logs.map((row) => [row._id, row]));

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
        const syncCount = logStats.get(provider)?.count || 0;
        const successCount = logStats.get(provider)?.successes || 0;
        const successRate =
          syncCount > 0 ? Number(((successCount / syncCount) * 100).toFixed(1)) : 0;

        return {
          provider,
          activityScore,
          profileScore,
          confidence,
          trendDelta,
          successRate,
          syncCount,
          successfulSyncCount: successCount,
          trendAvailable: Boolean(latest && previous),
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
      connectivity: {
        connectedCount: connections.length,
        providers: connections.map((connection) => connection.provider).sort(),
        syncCount: logs.reduce((sum, row) => sum + row.count, 0),
        failedSyncCount: logs.reduce((sum, row) => sum + row.count - row.successes, 0),
        days,
        lastSyncedAt: latestTimestamp(...connections.map((connection) => connection.lastSyncedAt)),
      },
      cards,
      syncStatus: toFreshness(persistedInsight.updatedAt),
      updatedAt: persistedInsight.updatedAt || null,
    });
  } catch (error) {
    if (error.code === 50)
      return res
        .status(503)
        .json({ message: 'Integration analytics query budget exceeded; retry a shorter window.' });
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
require('../integrations/services/integrationPersistenceService').registerCacheInvalidator?.(
  invalidateDashboardSummaryCache,
);
