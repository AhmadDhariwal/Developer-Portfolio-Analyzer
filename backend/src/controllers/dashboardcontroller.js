const crypto = require('node:crypto');
const Analysis = require('../models/analysis');
const User = require('../models/user');
const Repository = require('../models/repository');
const AnalysisCache = require('../models/analysisCache');
const Recommendation = require('../models/recommendation');
const ResumeAnalysis = require('../models/resumeAnalysis');
const { ANALYSIS_VERSION: GITHUB_ANALYSIS_VERSION, analyzeGitHubProfile, fetchMonthlyCommitActivity } = require('../services/githubservice');
const { detectSkillGaps } = require('../utils/skilldetector');
const { createNotification } = require('../services/notificationService');
const { getIntegrationInsight } = require('../services/integrationInsightService');
const IntegrationSyncLog = require('../models/integrationSyncLog');
const IntegrationConnection = require('../models/integrationConnection');

const DASHBOARD_SUMMARY_TTL_MS = 2 * 60 * 1000;
const DASHBOARD_FRESH_MS = 24 * 60 * 60 * 1000;
const dashboardSummaryCache = new Map();

const isRateLimitError = (error) => {
  const message = String(error?.message || '').toLowerCase();
  return (
    error?.response?.status === 403 ||
    error?.response?.status === 429 ||
    message.includes('rate limit')
  );
};

const clamp = (value, min = 0, max = 100) => {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return min;
  return Math.max(min, Math.min(max, Math.round(numeric)));
};

const average = (values = []) => {
  if (!Array.isArray(values) || !values.length) return 0;
  return values.reduce((sum, value) => sum + Number(value || 0), 0) / values.length;
};

const emptyContributionActivity = () => {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
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
  return (Date.now() - date.getTime()) <= DASHBOARD_FRESH_MS ? 'fresh' : 'stale';
};

const toLanguageMap = (languageDistribution = {}) => {
  if (languageDistribution instanceof Map) return Object.fromEntries(languageDistribution);
  if (Array.isArray(languageDistribution)) {
    return languageDistribution.reduce((acc, item) => {
      if (item?.language) acc[item.language] = Number(item.percentage || 0);
      return acc;
    }, {});
  }
  return languageDistribution && typeof languageDistribution === 'object' ? languageDistribution : {};
};

const normalizeLanguageMap = (languageDistribution = {}) => {
  const rawMap = toLanguageMap(languageDistribution);
  const safeEntries = Object.entries(rawMap)
    .map(([language, value]) => [String(language || '').trim(), Number(value || 0)])
    .filter(([language, value]) => (
      Boolean(language) &&
      language.toLowerCase() !== 'null' &&
      language.toLowerCase() !== 'undefined' &&
      value > 0
    ));

  const total = safeEntries.reduce((sum, [, value]) => sum + value, 0);
  if (!total) return {};

  let remaining = 100;
  return safeEntries
    .sort((left, right) => right[1] - left[1])
    .reduce((acc, [language, value], index, list) => {
      const normalized = index === list.length - 1
        ? remaining
        : Math.max(0, Math.min(100, Math.round((value / total) * 100)));
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

const createEmptyAnalysis = (userId) => new Analysis({
  userId,
  githubScore: 0,
  readinessScore: 0,
  githubStats: { repos: 0, stars: 0, forks: 0, followers: 0 },
  languageDistribution: {},
  contributionActivity: emptyContributionActivity()
});

const persistRepositories = async (userId, repositories = []) => {
  await Repository.deleteMany({ ownerId: userId });
  if (!repositories.length) return;

  await Repository.insertMany(
    repositories.map((repo) => ({
      repoName: repo.name,
      language: repo.language,
      stars: repo.stars,
      forks: repo.forks,
      commits: repo.commits || 0,
      lastUpdated: repo.pushedAt ? new Date(repo.pushedAt) : new Date(),
      ownerId: userId
    }))
  );
};

const buildGithubHistorySnapshot = (githubResult = {}) => ({
  analyzedAt: new Date(),
  healthScore: Number(githubResult.githubHealthScore || githubResult.activityScore || 0),
  repos: Number(githubResult.repoCount || 0),
  stars: Number(githubResult.totalStars || 0),
  forks: Number(githubResult.totalForks || 0),
  followers: Number(githubResult.followers || 0),
  topLanguages: (githubResult.mainLanguageDistribution || githubResult.languageDistribution || [])
    .slice(0, 5)
    .map((entry) => entry.language),
  topTechnologies: (githubResult.technologies || [])
    .slice(0, 8)
    .map((tech) => tech.name || tech.technology || tech)
});

const persistGithubResultToAnalysis = async ({ userId, analysis, githubResult, monthlyActivity = null }) => {
  const nextAnalysis = analysis || createEmptyAnalysis(userId);
  nextAnalysis.githubScore = Number(githubResult.githubHealthScore || githubResult.activityScore || 0);
  nextAnalysis.githubStats = {
    repos: Number(githubResult.repoCount || 0),
    stars: Number(githubResult.totalStars || 0),
    forks: Number(githubResult.totalForks || 0),
    followers: Number(githubResult.followers || 0)
  };
  nextAnalysis.githubAnalysisVersion = githubResult.analysisVersion || GITHUB_ANALYSIS_VERSION;
  nextAnalysis.githubSignals = githubResult.githubSignals || {};
  nextAnalysis.languageDistribution = normalizeLanguageMap(
    Array.isArray(githubResult.mainLanguageDistribution) && githubResult.mainLanguageDistribution.length
      ? githubResult.mainLanguageDistribution
      : githubResult.languageDistribution
  );
  if (Array.isArray(monthlyActivity) && monthlyActivity.length) {
    nextAnalysis.contributionActivity = monthlyActivity;
  }
  nextAnalysis.githubAnalysisHistory = [
    ...(Array.isArray(nextAnalysis.githubAnalysisHistory) ? nextAnalysis.githubAnalysisHistory : []),
    buildGithubHistorySnapshot(githubResult)
  ].slice(-12);
  nextAnalysis.updatedAt = new Date();
  await nextAnalysis.save();
  await persistRepositories(userId, githubResult.repositories || []);
  return nextAnalysis;
};

const latestCacheByPredicate = async (userId, predicate) =>
  AnalysisCache.findOne({ userId, ...predicate }).sort({ updatedAt: -1 }).lean();

const loadDefaultResumeAnalysis = async (userId) => {
  const user = await User.findById(userId).select('defaultResumeFileId').lean();
  if (user?.defaultResumeFileId) {
    const analysis = await ResumeAnalysis.findOne({ userId, fileId: user.defaultResumeFileId })
      .sort({ analyzedAt: -1 })
      .lean();
    if (analysis) return analysis;
  }
  return ResumeAnalysis.findOne({ userId }).sort({ analyzedAt: -1 }).lean();
};

const getCachedDashboardContext = async (userId) => {
  const [latestPortfolioCache, latestSkillGapCache, latestRecommendationCache, latestResume] = await Promise.all([
    latestCacheByPredicate(userId, { 'analysisData.portfolioScore.overallScore': { $exists: true } }),
    latestCacheByPredicate(userId, { 'analysisData.missingSkills': { $exists: true } }),
    latestCacheByPredicate(userId, { 'analysisData.projects': { $exists: true } }),
    loadDefaultResumeAnalysis(userId)
  ]);

  return {
    latestPortfolioCache,
    latestSkillGapCache,
    latestRecommendationCache,
    latestResume
  };
};

const deriveReadinessBreakdown = ({ portfolioScore, analysis, resume, skillGapCache, integrationInsight }) => {
  const cachedBreakdown = portfolioScore?.breakdown || portfolioScore?.analysisData?.portfolioScore?.breakdown;
  if (cachedBreakdown) {
    return {
      codeQuality: clamp(cachedBreakdown.codeQuality),
      skillCoverage: clamp(cachedBreakdown.skillCoverage),
      industryReadiness: clamp(cachedBreakdown.industryReadiness),
      projectImpact: clamp(cachedBreakdown.projectImpact)
    };
  }

  const topSkillCount = Array.isArray(skillGapCache?.analysisData?.yourSkills) ? skillGapCache.analysisData.yourSkills.length : 0;
  const missingSkillCount = Array.isArray(skillGapCache?.analysisData?.missingSkills) ? skillGapCache.analysisData.missingSkills.length : 0;
  const totalSkills = topSkillCount + missingSkillCount;
  const coverage = totalSkills > 0 ? Math.round((topSkillCount / totalSkills) * 100) : 0;

  return {
    codeQuality: clamp(analysis?.githubScore || 0),
    skillCoverage: clamp(skillGapCache?.analysisData?.coverage || coverage),
    industryReadiness: clamp(average([
      resume?.atsScore,
      resume?.keywordDensity,
      resume?.contentQuality,
      resume?.formatScore
    ]) || analysis?.readinessScore || analysis?.githubScore || 0),
    projectImpact: clamp(average([
      analysis?.githubScore,
      integrationInsight?.integrationScore
    ]))
  };
};

const buildSummaryMeta = ({
  analysis,
  latestResume,
  latestSkillGapCache,
  latestRecommendationCache,
  integrationInsight,
  githubStatus,
  rateLimited,
  noUsername
}) => {
  const githubFreshness = toFreshness(analysis?.updatedAt || analysis?.createdAt);
  const resumeFreshness = toFreshness(latestResume?.analyzedAt);
  const skillGapFreshness = toFreshness(latestSkillGapCache?.updatedAt);
  const recommendationFreshness = toFreshness(latestRecommendationCache?.updatedAt);
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
      integrations: integrationFreshness
    },
    sourcesUsed: {
      github: { connected: !noUsername, available: Boolean(analysis?.githubStats?.repos || analysis?.languageDistribution), status: githubFreshness },
      resume: { connected: Boolean(latestResume), available: Boolean(latestResume), status: resumeFreshness },
      skillGap: { connected: Boolean(latestSkillGapCache), available: Boolean(latestSkillGapCache), status: skillGapFreshness },
      recommendations: { connected: Boolean(latestRecommendationCache), available: Boolean(latestRecommendationCache), status: recommendationFreshness },
      integrations: {
        connected: Array.isArray(integrationInsight?.providers) && integrationInsight.providers.length > 0,
        available: Boolean(integrationInsight),
        status: integrationFreshness
      }
    }
  };
};

const buildEtag = (payload) => `"dashboard-${crypto.createHash('sha1').update(JSON.stringify(payload)).digest('hex')}"`;

const maybeSendNotModified = (req, res, payload) => {
  const etag = buildEtag(payload);
  res.set('ETag', etag);
  if (req.headers['if-none-match'] === etag) {
    res.status(304).end();
    return true;
  }
  return false;
};

const ensureAnalysis = async (userId, githubUsername, options = {}) => {
  const { forceRefresh = false } = options;
  let analysis = await Analysis.findOne({ userId });

  if (!forceRefresh) {
    if (analysis) {
      return {
        analysis,
        rateLimited: false,
        noUsername: !githubUsername,
        githubStatus: analysis.githubStats?.repos > 0 ? toFreshness(analysis.updatedAt || analysis.createdAt) : 'stale',
        languageSource: 'cached_snapshot'
      };
    }

    if (githubUsername) {
      try {
        const githubResult = await analyzeGitHubProfile(githubUsername, { forceRefresh: false });
        analysis = await persistGithubResultToAnalysis({ userId, analysis, githubResult });
        return {
          analysis,
          rateLimited: Boolean(githubResult.rateLimited),
          noUsername: false,
          githubStatus: githubResult.cache?.hit ? 'fresh' : 'fresh',
          languageSource: githubResult.languageDistributionSource || githubResult.cache?.source || 'github_cache'
        };
      } catch (error) {
        console.warn('Dashboard cached GitHub hydrate failed:', error.message);
      }
    }

    return {
      analysis: createEmptyAnalysis(userId),
      rateLimited: false,
      noUsername: !githubUsername,
      githubStatus: 'missing',
      languageSource: 'missing'
    };
  }

  if (!githubUsername) {
    return {
      analysis: analysis || createEmptyAnalysis(userId),
      rateLimited: false,
      noUsername: true,
      githubStatus: 'missing',
      languageSource: 'missing'
    };
  }

  try {
    const githubResult = await analyzeGitHubProfile(githubUsername, { forceRefresh: true });
    const monthlyActivity = await fetchMonthlyCommitActivity(githubUsername, githubResult.repositories || []);
    analysis = await persistGithubResultToAnalysis({
      userId,
      analysis,
      githubResult,
      monthlyActivity: monthlyActivity.length ? monthlyActivity : emptyContributionActivity()
    });

    return {
      analysis,
      rateLimited: Boolean(githubResult.rateLimited),
      noUsername: false,
      githubStatus: 'fresh',
      languageSource: githubResult.languageDistributionSource || 'language_bytes'
    };
  } catch (error) {
    console.warn('Dashboard GitHub refresh failed:', error.message);
    return {
      analysis: analysis || createEmptyAnalysis(userId),
      rateLimited: isRateLimitError(error),
      noUsername: false,
      githubStatus: analysis ? 'stale' : 'missing',
      languageSource: 'cached_snapshot'
    };
  }
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
      sourceSignalsUsed: item.sourceSignalsUsed || []
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
      sourceSignalsUsed: item.sourceSignalsUsed || []
    }));
  }

  const projects = Array.isArray(recommendationData.projects) ? recommendationData.projects : [];
  return projects.slice(0, 4).map((project) => ({
    title: String(project.title || 'Recommendation').trim(),
    priority: 'High',
    priorityType: 'high',
    category: Array.isArray(project.tech) && project.tech.length ? project.tech.slice(0, 2).join(', ') : 'Project'
  }));
};

const summaryCacheKey = (userId) => `${userId}:cached`;
const invalidateDashboardSummaryCache = (userId) => {
  if (!userId) return;
  dashboardSummaryCache.delete(summaryCacheKey(String(userId)));
};

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
    const forceRefresh = String(req.query.refresh || '').toLowerCase() === 'true';
    const user = await User.findById(req.user._id).select('-password').lean();
    if (!user) return res.status(404).json({ message: 'User not found' });

    const cacheKey = summaryCacheKey(String(req.user._id));
    if (!forceRefresh) {
      const cachedEntry = dashboardSummaryCache.get(cacheKey);
      if (cachedEntry && cachedEntry.expiresAt > Date.now()) {
        if (maybeSendNotModified(req, res, cachedEntry.payload)) return;
        return res.json(cachedEntry.payload);
      }
    }

    const githubUsername = user.githubUsername || '';
    const [analysisState, cachedContext, integrationInsight] = await Promise.all([
      ensureAnalysis(req.user._id, githubUsername, { forceRefresh }),
      getCachedDashboardContext(req.user._id),
      safeGetIntegrationInsight(req.user._id)
    ]);

    const { analysis, rateLimited, noUsername, githubStatus, languageSource } = analysisState;
    const {
      latestPortfolioCache,
      latestSkillGapCache,
      latestRecommendationCache,
      latestResume
    } = cachedContext;

    const baseReadiness = Number(
      latestPortfolioCache?.analysisData?.portfolioScore?.overallScore ||
      analysis?.readinessScore ||
      analysis?.githubScore ||
      0
    );
    const integrationScore = Number(integrationInsight.integrationScore || 0);
    const readinessScore = integrationScore > 0
      ? Math.round((baseReadiness * 0.85) + (integrationScore * 0.15))
      : baseReadiness;

    const oneMonthAgo = new Date(Date.now() - (25 * 24 * 60 * 60 * 1000));
    const lastMonthReadiness = await AnalysisCache.findOne({
      userId: req.user._id,
      'analysisData.portfolioScore.overallScore': { $exists: true },
      updatedAt: { $lte: oneMonthAgo }
    }).sort({ updatedAt: -1 }).lean();

    const lastMonthScore = Number(lastMonthReadiness?.analysisData?.portfolioScore?.overallScore || 0);
    const scoreChangeFromLastMonth = lastMonthReadiness ? Math.round(readinessScore - lastMonthScore) : null;
    const readinessBreakdown = deriveReadinessBreakdown({
      portfolioScore: latestPortfolioCache?.analysisData?.portfolioScore,
      analysis,
      resume: latestResume,
      skillGapCache: latestSkillGapCache,
      integrationInsight
    });

    const meta = buildSummaryMeta({
      analysis,
      latestResume,
      latestSkillGapCache,
      latestRecommendationCache,
      integrationInsight,
      githubStatus,
      rateLimited,
      noUsername
    });

    const lastAnalyzedAt = latestTimestamp(
      analysis?.updatedAt,
      analysis?.createdAt,
      latestPortfolioCache?.updatedAt,
      latestResume?.analyzedAt,
      latestSkillGapCache?.updatedAt,
      latestRecommendationCache?.updatedAt
    );

    if (readinessScore > 0 && readinessScore < 60) {
      await createNotification({
        userId: req.user._id,
        type: 'low_score',
        title: 'Low Readiness Score Alert',
        message: `Your current readiness score is ${Math.round(readinessScore)}%. Consider improving missing skills and resume quality.`,
        dedupeKey: `low_score:${req.user._id}`,
        dedupeWindowHours: 24,
        meta: { readinessScore }
      }).catch(() => null);
    }

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
          syncedAt: provider.syncedAt || null
        })),
        mergedSkills: integrationInsight.mergedSkills || [],
        updatedAt: integrationInsight.updatedAt || null
      },
      resume: {
        analyzed: Boolean(latestResume),
        atsScore: Number(latestResume?.atsScore || 0),
        keywordDensity: Number(latestResume?.keywordDensity || 0),
        formatScore: Number(latestResume?.formatScore || 0),
        contentQuality: Number(latestResume?.contentQuality || 0),
        analyzedAt: latestResume?.analyzedAt || null
      },
      rateLimited: Boolean(rateLimited),
      noUsername: Boolean(noUsername),
      ...meta
    };

    if (!forceRefresh) {
      dashboardSummaryCache.set(cacheKey, {
        payload,
        expiresAt: Date.now() + DASHBOARD_SUMMARY_TTL_MS
      });
    }

    if (maybeSendNotModified(req, res, payload)) return;
    res.json(payload);
  } catch (error) {
    console.error('Dashboard summary error:', error);
    res.status(500).json({ message: 'Failed to load dashboard summary' });
  }
};

const getDashboardContributions = async (req, res) => {
  try {
    const forceRefresh = String(req.query.refresh || '').toLowerCase() === 'true';
    const user = await User.findById(req.user._id).select('githubUsername').lean();
    const githubUsername = user?.githubUsername || '';
    const { analysis, rateLimited } = await ensureAnalysis(req.user._id, githubUsername, { forceRefresh });
    const data = Array.isArray(analysis?.contributionActivity) && analysis.contributionActivity.length
      ? analysis.contributionActivity
      : emptyContributionActivity();

    res.json({
      data,
      syncStatus: rateLimited ? 'rate_limited' : toFreshness(analysis?.updatedAt || analysis?.createdAt),
      updatedAt: analysis?.updatedAt || analysis?.createdAt || null
    });
  } catch (error) {
    console.error('Dashboard contributions error:', error);
    res.status(500).json({ message: 'Failed to load contributions' });
  }
};

const getDashboardLanguages = async (req, res) => {
  try {
    const forceRefresh = String(req.query.refresh || '').toLowerCase() === 'true';
    const user = await User.findById(req.user._id).select('githubUsername').lean();
    const githubUsername = user?.githubUsername || '';
    const { analysis, rateLimited, languageSource } = await ensureAnalysis(req.user._id, githubUsername, { forceRefresh });

    res.json({
      data: normalizeLanguageMap(analysis?.languageDistribution),
      syncStatus: rateLimited ? 'rate_limited' : toFreshness(analysis?.updatedAt || analysis?.createdAt),
      updatedAt: analysis?.updatedAt || analysis?.createdAt || null,
      source: languageSource
    });
  } catch (error) {
    console.error('Dashboard languages error:', error);
    res.status(500).json({ message: 'Failed to load language distribution' });
  }
};

const getDashboardSkills = async (req, res) => {
  try {
    const forceRefresh = String(req.query.refresh || '').toLowerCase() === 'true';
    const user = await User.findById(req.user._id).select('githubUsername').lean();
    const githubUsername = user?.githubUsername || '';

    const [{ analysis, rateLimited }, integrationInsight, latestSkillGapCache] = await Promise.all([
      ensureAnalysis(req.user._id, githubUsername, { forceRefresh }),
      safeGetIntegrationInsight(req.user._id),
      latestCacheByPredicate(req.user._id, { 'analysisData.missingSkills': { $exists: true } })
    ]);

    const languageMap = normalizeLanguageMap(analysis?.languageDistribution);
    const derivedTopSkills = Object.keys(languageMap)
      .filter((key) => Number(languageMap[key] || 0) > 0)
      .concat(integrationInsight.mergedSkills || []);

    let topSkills = [];
    let missingSkills = [];
    let coveragePercentage = 0;

    if (latestSkillGapCache?.analysisData) {
      topSkills = Array.isArray(latestSkillGapCache.analysisData.yourSkills)
        ? latestSkillGapCache.analysisData.yourSkills.map((skill) => typeof skill === 'string' ? skill : skill?.name || skill?.skill).filter(Boolean)
        : [];
      missingSkills = Array.isArray(latestSkillGapCache.analysisData.missingSkills)
        ? latestSkillGapCache.analysisData.missingSkills.map((skill) => typeof skill === 'string' ? skill : skill?.name || skill?.skill).filter(Boolean)
        : [];
      coveragePercentage = clamp(latestSkillGapCache.analysisData.coverage || 0);
    } else {
      const detected = detectSkillGaps(derivedTopSkills);
      topSkills = derivedTopSkills;
      missingSkills = (detected.missingSkills || []).map((skill) => skill.name || skill).filter(Boolean);
      const total = topSkills.length + missingSkills.length;
      coveragePercentage = total > 0 ? Math.round((topSkills.length / total) * 100) : 0;
    }

    res.json({
      topSkills: [...new Set(topSkills.map((value) => String(value || '').trim()).filter(Boolean))].slice(0, 12),
      missingSkills: [...new Set(missingSkills.map((value) => String(value || '').trim()).filter(Boolean))].slice(0, 8),
      coveragePercentage,
      syncStatus: rateLimited ? 'rate_limited' : latestSkillGapCache ? toFreshness(latestSkillGapCache.updatedAt) : 'stale',
      updatedAt: latestSkillGapCache?.updatedAt || analysis?.updatedAt || null
    });
  } catch (error) {
    console.error('Dashboard skills error:', error);
    res.status(500).json({ message: 'Failed to load skills' });
  }
};

const getDashboardRecommendations = async (req, res) => {
  try {
    const [latestRecommendationCache, savedRecommendations] = await Promise.all([
      latestCacheByPredicate(req.user._id, { 'analysisData.projects': { $exists: true } }),
      Recommendation.find({ userId: req.user._id }).sort({ createdAt: -1 }).limit(4).lean()
    ]);

    const items = latestRecommendationCache?.analysisData
      ? buildRecommendationPreview(latestRecommendationCache.analysisData)
      : savedRecommendations.map((item) => ({
          title: item.title,
          priority: item.priority,
          priorityType: item.priorityType,
          category: item.category
        }));

    res.json({
      items,
      syncStatus: latestRecommendationCache ? toFreshness(latestRecommendationCache.updatedAt) : items.length ? 'stale' : 'queued',
      updatedAt: latestRecommendationCache?.updatedAt || savedRecommendations[0]?.createdAt || null
    });
  } catch (error) {
    console.error('Dashboard recommendations error:', error);
    res.status(500).json({ message: 'Failed to load recommendations' });
  }
};

const getDashboardIntegrationAnalytics = async (req, res) => {
  try {
    const days = Math.max(1, Math.min(30, Number.parseInt(String(req.query.days || '7'), 10)));
    const since = new Date(Date.now() - (days * 24 * 60 * 60 * 1000));

    const [logs, persistedInsight, connections] = await Promise.all([
      IntegrationSyncLog.find({
        userId: req.user._id,
        createdAt: { $gte: since }
      }).sort({ createdAt: -1 }).lean(),
      safeGetIntegrationInsight(req.user._id),
      IntegrationConnection.find({ userId: req.user._id, status: 'connected' })
        .select('provider lastSyncedAt metadata')
        .lean()
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
          syncedAt: provider.syncedAt || null
        }
      ])
    );

    const providerSet = new Set([
      ...Array.from(logMap.keys()),
      ...Array.from(insightByProvider.keys()),
      ...connections.map((connection) => connection.provider)
    ]);

    const cards = Array.from(providerSet.values()).map((provider) => {
      const providerLogs = logMap.get(provider) || [];
      const latest = providerLogs[0] || null;
      const previous = providerLogs[1] || null;
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
        : Number(insight?.confidence || (connection?.metadata?.totalSkillsDetected ? 65 : 45));
      const trendDelta = latest && previous
        ? Number((Number(latest.activityScore || 0) - Number(previous.activityScore || 0)).toFixed(2))
        : 0;
      const successCount = providerLogs.filter((item) => item.status === 'success').length;
      const successRate = providerLogs.length > 0
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
        lastSyncedAt: latest?.createdAt || insight?.syncedAt || connection?.lastSyncedAt || null
      };
    }).sort((a, b) => {
      const left = a.lastSyncedAt ? new Date(a.lastSyncedAt).getTime() : 0;
      const right = b.lastSyncedAt ? new Date(b.lastSyncedAt).getTime() : 0;
      return right - left;
    });

    res.json({
      days,
      cards,
      syncStatus: toFreshness(persistedInsight.updatedAt),
      updatedAt: persistedInsight.updatedAt || null
    });
  } catch (error) {
    console.error('Dashboard integration analytics error:', error.message);
    res.status(500).json({ message: 'Failed to load integration analytics' });
  }
};

module.exports = {
  getDashboardSummary,
  getDashboardContributions,
  getDashboardLanguages,
  getDashboardSkills,
  getDashboardRecommendations,
  getDashboardIntegrationAnalytics,
  invalidateDashboardSummaryCache
};
