const Analysis = require('../models/analysis');
const User     = require('../models/user');
const Repository = require('../models/repository');
const AnalysisCache = require('../models/analysisCache');
const { analyzeGitHubProfile, fetchGitHubUser, fetchMonthlyCommitActivity, fetchGitHubRepos } = require('../services/githubservice');
const { detectSkillGaps } = require('../utils/skilldetector');
const { createNotification } = require('../services/notificationService');
const { getIntegrationInsight } = require('../services/integrationInsightService');
const IntegrationSyncLog = require('../models/integrationSyncLog');
const IntegrationConnection = require('../models/integrationConnection');

// ── Helper: detect GitHub rate-limit errors ───────────────────────────────
const isRateLimitError = (err) => {
  const msg = (err?.message || '').toLowerCase();
  return (
    err?.response?.status === 403 ||
    err?.response?.status === 429 ||
    msg.includes('rate limit') ||
    msg.includes('api rate limit')
  );
};

const getOrCreateAnalysis = (analysis, userId) => analysis || new Analysis({ userId });

const fetchGitHubUserSafe = async (githubUsername) => {
  try {
    return await fetchGitHubUser(githubUsername);
  } catch {
    return {};
  }
};

const toLanguageMap = (languageDistribution = []) => {
  const langMap = {};
  languageDistribution.forEach((item) => {
    langMap[item.language] = item.percentage;
  });
  return langMap;
};

const buildContributionActivity = (repositories = []) => {
  // Fallback: if we have no real commit data, return 6 zero-filled months
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const now = new Date();
  const result = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    result.push({ month: months[d.getMonth()], count: 0 });
  }
  return result;
};

const persistRepositories = async (userId, repositories = []) => {
  await Repository.deleteMany({ ownerId: userId });
  if (repositories.length === 0) return;

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

// ── Helper: ensure we have fresh GitHub data for this user ────────────────
const ensureAnalysis = async (userId, githubUsername) => {
  let analysis = await Analysis.findOne({ userId });

  // If we already have data with repos > 0, return cached (don't re-fetch every request)
  if (analysis && analysis.githubStats && analysis.githubStats.repos > 0) {
    return { analysis, rateLimited: false };
  }

  // No cached data — try to fetch from GitHub
  if (!githubUsername) {
    // No username configured — return empty shell
    analysis = getOrCreateAnalysis(analysis, userId);
    return { analysis, rateLimited: false, noUsername: true };
  }

  try {
    const data = await analyzeGitHubProfile(githubUsername);
    const userData = await fetchGitHubUserSafe(githubUsername);

    analysis = getOrCreateAnalysis(analysis, userId);

    analysis.githubScore = data.activityScore;
    analysis.githubStats = {
      repos:     data.repoCount,
      stars:     data.totalStars,
      forks:     data.totalForks,
      followers: userData.followers || 0
    };

    analysis.languageDistribution = toLanguageMap(data.languageDistribution);

    // Fetch real monthly commit activity from GitHub stats API
    const monthlyActivity = await fetchMonthlyCommitActivity(githubUsername, data.repositories);
    analysis.contributionActivity = monthlyActivity.length > 0
      ? monthlyActivity
      : buildContributionActivity();

    await persistRepositories(userId, data.repositories);

    await analysis.save();
    return { analysis, rateLimited: false };
  } catch (err) {
    console.warn('GitHub fetch failed:', err.message);
    // If rate-limited but we have some cached analysis, use it
    if (isRateLimitError(err)) {
      analysis = getOrCreateAnalysis(analysis, userId);
      return { analysis, rateLimited: true };
    }
    // Other error — return empty shell gracefully
    analysis = getOrCreateAnalysis(analysis, userId);
    return { analysis, rateLimited: false, fetchError: err.message };
  }
};

/* ─────────────────────────────────────────────
   GET /api/dashboard/summary
   ───────────────────────────────────────────── */
const getDashboardSummary = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-password');
    if (!user) return res.status(404).json({ message: 'User not found' });

    const activeGithubUsername = user.activeGithubUsername || user.githubUsername;
    const { analysis, rateLimited, noUsername } = await ensureAnalysis(user._id, activeGithubUsername);

    const latestReadiness = await AnalysisCache.findOne({
      userId: user._id,
      'analysisData.portfolioScore.overallScore': { $exists: true }
    }).sort({ updatedAt: -1 }).lean();

    const baseReadiness = latestReadiness?.analysisData?.portfolioScore?.overallScore || analysis.readinessScore || analysis.githubScore || 0;

    // ── Month-over-month score change ─────────────────────────────────────
    // Find the most recent cache entry that is at least 25 days old (last month's snapshot)
    const oneMonthAgo = new Date(Date.now() - 25 * 24 * 60 * 60 * 1000);
    const lastMonthReadiness = await AnalysisCache.findOne({
      userId: user._id,
      'analysisData.portfolioScore.overallScore': { $exists: true },
      updatedAt: { $lte: oneMonthAgo }
    }).sort({ updatedAt: -1 }).lean();

    const lastMonthScore = lastMonthReadiness?.analysisData?.portfolioScore?.overallScore ?? null;
    const scoreChangeFromLastMonth = lastMonthScore !== null
      ? Math.round(Number(baseReadiness) - Number(lastMonthScore))
      : null; // null means no prior data to compare against
    const integrationInsight = await getIntegrationInsight(user._id);
    const integrationScore = Number(integrationInsight.integrationScore || 0);
    const readinessScore = integrationScore > 0
      ? Math.round((Number(baseReadiness || 0) * 0.85) + (integrationScore * 0.15))
      : Number(baseReadiness || 0);
    const lastAnalyzedAt = latestReadiness?.updatedAt || analysis.updatedAt || analysis.createdAt || null;

    if (Number(readinessScore) > 0 && Number(readinessScore) < 60) {
      await createNotification({
        userId: user._id,
        type: 'low_score',
        title: 'Low Readiness Score Alert',
        message: `Your current readiness score is ${Math.round(Number(readinessScore))}%. Consider improving missing skills and resume quality.`,
        dedupeKey: `low_score:${user._id}`,
        dedupeWindowHours: 24,
        meta: { readinessScore }
      });
    }

    res.json({
      score:        analysis.githubScore || 0,
      readinessScore,
      scoreChangeFromLastMonth,
      repositories: analysis.githubStats?.repos     || 0,
      stars:        analysis.githubStats?.stars      || 0,
      forks:        analysis.githubStats?.forks      || 0,
      followers:    analysis.githubStats?.followers  || 0,
      userName:     user.name,
      githubHandle: activeGithubUsername,
      lastAnalyzedAt,
      integration: {
        score: integrationScore,
        providers: (integrationInsight.providers || []).map((p) => ({
          provider: p.provider,
          profileScore: p.profileScore,
          activityScore: p.activityScore,
          syncedAt: p.syncedAt
        })),
        mergedSkills: integrationInsight.mergedSkills || [],
        updatedAt: integrationInsight.updatedAt || null
      },
      rateLimited:  rateLimited || false,
      noUsername:   noUsername  || false
    });
  } catch (err) {
    console.error('Dashboard summary error:', err);
    res.status(500).json({ message: 'Failed to load dashboard summary' });
  }
};

/* ─────────────────────────────────────────────
   GET /api/dashboard/contributions
   ───────────────────────────────────────────── */
const getDashboardContributions = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('githubUsername activeGithubUsername');
    const githubUsername = user.activeGithubUsername || user.githubUsername;
    const { analysis } = await ensureAnalysis(req.user._id, githubUsername);

    // If we have real contribution data already stored, return it immediately
    const stored = analysis?.contributionActivity || [];
    const hasRealData = stored.length > 0 && stored.some(m => m.count > 0);
    if (hasRealData) {
      return res.json(stored);
    }

    // No real data yet — fetch directly from GitHub using the reliable /commits endpoint
    if (!githubUsername) {
      return res.json(buildContributionActivity());
    }

    // Fetch the user's repos to know which were active in the last 6 months
    let rawRepos = [];
    try {
      rawRepos = await fetchGitHubRepos(githubUsername);
    } catch {
      return res.json(buildContributionActivity());
    }

    const repos = rawRepos.map(r => ({ name: r.name, pushed_at: r.pushed_at }));
    const monthlyActivity = await fetchMonthlyCommitActivity(githubUsername, repos);

    // Persist so the next request is instant
    if (analysis && monthlyActivity.some(m => m.count > 0)) {
      analysis.contributionActivity = monthlyActivity;
      await analysis.save();
    }

    return res.json(monthlyActivity.length > 0 ? monthlyActivity : buildContributionActivity());
  } catch (err) {
    console.error('Dashboard contributions error:', err);
    res.status(500).json({ message: 'Failed to load contributions' });
  }
};

/* ─────────────────────────────────────────────
   GET /api/dashboard/languages
   ───────────────────────────────────────────── */
const getDashboardLanguages = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('githubUsername activeGithubUsername');
    const { analysis } = await ensureAnalysis(req.user._id, user.activeGithubUsername || user.githubUsername);

    if (analysis?.languageDistribution) {
      const dist = analysis.languageDistribution instanceof Map
        ? Object.fromEntries(analysis.languageDistribution)
        : analysis.languageDistribution;
      if (Object.keys(dist).length > 0) return res.json(dist);
    }
    res.json({});
  } catch (err) {
    console.error('Dashboard languages error:', err);
    res.status(500).json({ message: 'Failed to load language distribution' });
  }
};

/* ─────────────────────────────────────────────
   GET /api/dashboard/skills
   ───────────────────────────────────────────── */
const getDashboardSkills = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('githubUsername activeGithubUsername');
    const { analysis } = await ensureAnalysis(req.user._id, user.activeGithubUsername || user.githubUsername);

    // Derive skills from language distribution
    const langDist = analysis.languageDistribution instanceof Map
      ? Object.fromEntries(analysis.languageDistribution)
      : (analysis.languageDistribution || {});

    const integrationInsight = await getIntegrationInsight(req.user._id);
    const topSkills = Object.keys(langDist)
      .filter(k => langDist[k] > 0)
      .concat(integrationInsight.mergedSkills || []);
    const { missingSkills } = detectSkillGaps(topSkills);

    res.json({ topSkills, missingSkills });
  } catch (err) {
    console.error('Dashboard skills error:', err);
    res.status(500).json({ message: 'Failed to load skills' });
  }
};

/* ─────────────────────────────────────────────
   GET /api/dashboard/recommendations
   ───────────────────────────────────────────── */
const getDashboardRecommendations = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('githubUsername activeGithubUsername');
    const { analysis } = await ensureAnalysis(req.user._id, user.activeGithubUsername || user.githubUsername);

    // Derive skills and build recommendations based on real gaps
    const langDist = analysis.languageDistribution instanceof Map
      ? Object.fromEntries(analysis.languageDistribution)
      : (analysis.languageDistribution || {});
    const integrationInsight = await getIntegrationInsight(req.user._id);
    const topSkills = Object.keys(langDist)
      .filter(k => langDist[k] > 0)
      .concat(integrationInsight.mergedSkills || []);
    const { missingSkills } = detectSkillGaps(topSkills);

    const iconTypes = ['project', 'certification', 'opensource', 'technology'];
    const categoryMap = { project: 'Project', certification: 'Certification', opensource: 'Open Source', technology: 'Technology' };

    const recs = missingSkills.slice(0, 4).map((skill, i) => {
      const iconKey = iconTypes[i % iconTypes.length];
      return {
        title:        `Learn ${skill.name || skill}`,
        priority:     i < 2 ? 'High' : 'Medium',
        priorityType: i < 2 ? 'high' : 'medium',
        category:     categoryMap[iconKey],
        icon:         iconKey
      };
    });

    res.json(recs.length > 0 ? recs : []);
  } catch (err) {
    console.error('Dashboard recommendations error:', err);
    res.status(500).json({ message: 'Failed to load recommendations' });
  }
};

/* ─────────────────────────────────────────────
   GET /api/dashboard/integration-analytics
   ───────────────────────────────────────────── */
const getDashboardIntegrationAnalytics = async (req, res) => {
  try {
    const days = Math.max(1, Math.min(30, Number.parseInt(String(req.query.days || '7'), 10)));
    const since = new Date(Date.now() - (days * 24 * 60 * 60 * 1000));

    const logs = await IntegrationSyncLog.find({
      userId: req.user._id,
      createdAt: { $gte: since }
    })
      .sort({ createdAt: -1 })
      .lean();

    const map = new Map();
    logs.forEach((log) => {
      const key = log.provider;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(log);
    });

    const persistedInsight = await getIntegrationInsight(req.user._id);
    const insightByProvider = new Map(
      (persistedInsight.providers || []).map((p) => [
        p.provider,
        {
          profileScore: Number(p.profileScore || 0),
          activityScore: Number(p.activityScore || 0),
          confidence: Number(p.confidence || 0),
          syncedAt: p.syncedAt || null
        }
      ])
    );

    const connections = await IntegrationConnection.find({ userId: req.user._id, status: 'connected' })
      .select('provider lastSyncedAt metadata')
      .lean();

    const providerSet = new Set([
      ...Array.from(map.keys()),
      ...Array.from(insightByProvider.keys()),
      ...connections.map((connection) => connection.provider)
    ]);

    const cards = Array.from(providerSet.values()).map((provider) => {
      const providerLogs = map.get(provider) || [];
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
      const hasDetectedSkills = Boolean(connection?.metadata?.totalSkillsDetected);
      const connectionConfidence = hasDetectedSkills ? 65 : 45;
      let fallbackConfidence = Number(connectionConfidence);
      if (insight?.confidence) {
        fallbackConfidence = Number(insight.confidence);
      }
      const confidence = latest
        ? Number(latest.confidence || 0)
        : fallbackConfidence;
      const delta = latest && previous
        ? Number((Number(latest.activityScore || 0) - Number(previous.activityScore || 0)).toFixed(2))
        : 0;

      const success = providerLogs.filter((item) => item.status === 'success').length;
      const successRate = providerLogs.length > 0
        ? Number(((success / providerLogs.length) * 100).toFixed(1))
        : 0;

      return {
        provider,
        activityScore,
        profileScore,
        confidence,
        trendDelta: delta,
        successRate,
        syncCount: providerLogs.length,
        lastSyncedAt: latest?.createdAt || insight?.syncedAt || connection?.lastSyncedAt || null
      };
    }).sort((a, b) => {
      const aTs = a.lastSyncedAt ? new Date(a.lastSyncedAt).getTime() : 0;
      const bTs = b.lastSyncedAt ? new Date(b.lastSyncedAt).getTime() : 0;
      return bTs - aTs;
    });

    res.json({ days, cards });
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
  getDashboardIntegrationAnalytics
};
