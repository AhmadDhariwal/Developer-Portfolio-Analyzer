const Repository = require('../models/repository');
const Analysis = require('../models/analysis');
const User = require('../models/user');
const GitHubSaveLock = require('../models/githubSaveLock');
const crypto = require('node:crypto');
const { ANALYSIS_VERSION, analyzeGitHubProfile, isRateLimitError } = require('../services/githubservice');
const { acquireCacheLock, releaseCacheLock, isRedisCacheEnabled } = require('../services/redisCacheService');
const { createNotification } = require('../services/notificationService');
const { invalidateDashboardSummaryCache } = require('./dashboardcontroller');

const saveJobs = new Map();
const SAVE_LOCK_TTL_SECONDS = 30;
const SAVE_LOCK_WAIT_MS = 2500;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const acquireMongoSaveLock = async (key, ownerToken) => {
    try {
        return Boolean(await GitHubSaveLock.findOneAndUpdate(
            { _id: key, $or: [{ expiresAt: { $lte: new Date() } }, { expiresAt: { $exists: false } }] },
            { $set: { ownerToken, expiresAt: new Date(Date.now() + SAVE_LOCK_TTL_SECONDS * 1000) } },
            { upsert: true, new: true }
        ).lean());
    } catch (error) {
        if (error?.code === 11000) return false;
        throw error;
    }
};

const acquireSaveLock = async (userId, username) => {
    const key = `github-save:${String(userId)}:${String(username).toLowerCase()}`;
    const ownerToken = crypto.randomUUID();
    let contended = false;
    for (let waited = 0; waited <= SAVE_LOCK_WAIT_MS; waited += 100) {
        const redisLocked = isRedisCacheEnabled()
            ? await acquireCacheLock(key, ownerToken, SAVE_LOCK_TTL_SECONDS)
            : null;
        const acquired = redisLocked === true || (redisLocked === null && await acquireMongoSaveLock(key, ownerToken));
        if (acquired) return { key, ownerToken, source: redisLocked === true ? 'redis' : 'mongo', contended };
        contended = true;
        await sleep(100);
    }
    return null;
};

const releaseSaveLock = async (lock) => {
    if (!lock) return;
    if (lock.source === 'redis') return releaseCacheLock(lock.key, lock.ownerToken);
    await GitHubSaveLock.deleteOne({ _id: lock.key, ownerToken: lock.ownerToken });
};

const toForceRefresh = (req) =>
    String(req.body?.forceRefresh ?? req.query?.forceRefresh ?? '').toLowerCase() === 'true';

const buildLanguageMap = (languageDistribution = []) => {
    const langMap = {};
    (Array.isArray(languageDistribution) ? languageDistribution : []).forEach((entry) => {
        if (entry?.language) langMap[entry.language] = Number(entry.percentage || 0);
    });
    return langMap;
};

const buildHistorySnapshot = (data = {}) => ({
    analyzedAt: new Date(),
    healthScore: Number(data.githubHealthScore || data.activityScore || 0),
    repos: Number(data.repoCount || 0),
    stars: Number(data.totalStars || 0),
    forks: Number(data.totalForks || 0),
    followers: Number(data.followers || 0),
    topLanguages: (data.mainLanguageDistribution || data.languageDistribution || [])
        .slice(0, 5)
        .map((entry) => entry.language),
    topTechnologies: (data.technologies || [])
        .slice(0, 8)
        .map((tech) => tech.name || tech.technology || tech)
});

const replaceRepositoriesSafely = async (userId, repositories = []) => {
    const rows = Array.isArray(repositories) ? repositories : [];
    if (!rows.length) {
        await Repository.deleteMany({ ownerId: userId });
        return;
    }

    const uniqueRows = Array.from(new Map(rows
        .filter((repo) => String(repo?.name || '').trim())
        .map((repo) => [String(repo.name).trim(), repo]))
        .values());
    const repoNames = uniqueRows.map((repo) => String(repo.name).trim());
    const now = new Date();

    // Upsert every incoming row before removing stale rows.  A failed write
    // therefore leaves the prior repository set intact rather than empty.
    await Repository.bulkWrite(uniqueRows.map((repo) => ({
        updateOne: {
            filter: { ownerId: userId, repoName: String(repo.name).trim() },
            update: {
                $set: {
                    language: repo.language,
                    stars: Number(repo.stars || 0),
                    forks: Number(repo.forks || 0),
                    commits: Number(repo.commits || 0),
                    lastUpdated: now
                },
                $setOnInsert: { ownerId: userId, repoName: String(repo.name).trim() }
            },
            upsert: true
        }
    })), { ordered: true });

    await Repository.deleteMany({ ownerId: userId, repoName: { $nin: repoNames } });
};

const persistGitHubAnalysis = async (user, githubUsername, forceRefresh) => {
    const lock = await acquireSaveLock(user._id, githubUsername);
    if (!lock) throw new Error('GitHub analysis save is already in progress. Please retry.');
    try {
    // A different application instance completed this save while this request
    // waited. Its analysis is now in the shared cache and its writes are
    // durable, so returning that result avoids replaying persistence work.
    if (lock.contended) return analyzeGitHubProfile(githubUsername);

    const data = await analyzeGitHubProfile(githubUsername, { forceRefresh });

    await replaceRepositoriesSafely(user._id, data.repositories);

    let analysis = await Analysis.findOne({ userId: user._id });
    if (!analysis) analysis = new Analysis({ userId: user._id });

    analysis.githubScore = Number(data.githubHealthScore || data.activityScore || 0);
    analysis.githubStats = {
        repos: Number(data.repoCount || 0),
        stars: Number(data.totalStars || 0),
        forks: Number(data.totalForks || 0),
        followers: Number(data.followers || 0)
    };
    analysis.githubAnalysisVersion = data.analysisVersion || ANALYSIS_VERSION;
    analysis.githubSignals = data.githubSignals || {};
    analysis.languageDistribution = buildLanguageMap(data.mainLanguageDistribution?.length ? data.mainLanguageDistribution : data.languageDistribution);
    analysis.contributionActivity = Array.isArray(data.monthlyCommitActivity) ? data.monthlyCommitActivity : analysis.contributionActivity;
    analysis.githubAnalysisHistory = [
        ...(Array.isArray(analysis.githubAnalysisHistory) ? analysis.githubAnalysisHistory : []),
        buildHistorySnapshot(data)
    ].slice(-12);
    analysis.updatedAt = new Date();
    await analysis.save();

    await User.findByIdAndUpdate(user._id, {
        githubUsername: githubUsername.trim(),
        activeGithubUsername: githubUsername.trim()
    });

    await createNotification({
        userId: user._id,
        type: 'github_update',
        title: 'GitHub Profile Updated',
        message: `GitHub analysis refreshed for @${githubUsername.trim()}.`,
        dedupeKey: `github_update:${githubUsername.trim().toLowerCase()}`,
        meta: { username: githubUsername.trim() },
        dedupeWindowHours: 1
    });
    invalidateDashboardSummaryCache(user._id);
    return data;
    } finally {
        await releaseSaveLock(lock);
    }
};

// @desc    Publicly analyze any GitHub username
// @route   POST /api/github/analyze
// @access  Public
const analyzeGitHub = async (req, res) => {
    try {
        const { username } = req.body;

        if (!username || !username.trim()) {
            return res.status(400).json({ message: 'GitHub username is required.' });
        }

        const data = await analyzeGitHubProfile(username.trim(), { forceRefresh: toForceRefresh(req) });
        res.json(data);
    } catch (error) {
        console.error('GitHub Analyzer Error:', error.message);
        const msg = error.message || '';
        if (isRateLimitError(error)) {
          return res.status(429).json({
            message: 'GitHub API rate limit exceeded. Please wait a few minutes and try again, or add a GITHUB_TOKEN to the backend .env for higher limits.'
          });
        }
        if (error.status === 404) return res.status(404).json({ message: msg });
        res.status(500).json({ message: msg || 'Failed to analyze GitHub profile.' });
    }
};

// @desc    Analyze and persist results for the authenticated user
// @route   POST /api/github/analyze-save
// @access  Private
const analyzeAndSaveGitHubProfile = async (req, res) => {
    try {
        const defaultGithubUsername = String(req.user?.activeGithubUsername || req.user?.githubUsername || '').trim();
        const requestedUsername = String(req.body.username || defaultGithubUsername).trim();
        const githubUsername = defaultGithubUsername || requestedUsername;

        if (!githubUsername) {
            return res.status(400).json({ message: 'GitHub username is required.' });
        }

        if (requestedUsername && defaultGithubUsername && requestedUsername.toLowerCase() !== defaultGithubUsername.toLowerCase()) {
            return res.status(400).json({
                message: 'Temporary GitHub analysis should use the analyzer preview flow and must not overwrite your saved profile.'
            });
        }

        const saveKey = String(req.user._id);
        let job = saveJobs.get(saveKey);
        if (!job) {
            job = persistGitHubAnalysis(req.user, githubUsername.trim(), toForceRefresh(req));
            saveJobs.set(saveKey, job);
        }
        const data = await job;

        res.json(data);
    } catch (error) {
        console.error('GitHub Save Error:', error.message);
        const msg = error.message || '';
        if (isRateLimitError(error)) {
          return res.status(429).json({
            message: 'GitHub API rate limit exceeded. Please wait a few minutes and try again, or add a GITHUB_TOKEN to the backend .env for higher limits.'
          });
        }
        if (error.status === 404) return res.status(404).json({ message: msg });
        res.status(500).json({ message: msg || 'Failed to analyze and save GitHub profile.' });
    } finally {
        const saveKey = String(req.user?._id || '');
        if (saveKey && saveJobs.get(saveKey)) saveJobs.delete(saveKey);
    }
};

// @desc    Get the default github username for analysis-driven components
// @route   GET /api/github/active-username
// @access  Private
const getActiveUsername = async (req, res) => {
    try {
        const user = await User.findById(req.user._id).select('githubUsername activeGithubUsername');
        const defaultUsername = String(user?.githubUsername || '').trim();
        const activeUsername = String(user?.activeGithubUsername || '').trim();
        res.json({
            username: activeUsername || defaultUsername,
            isDefault: true,
            activeUsername: activeUsername || defaultUsername
        });
    } catch (error) {
        res.status(500).json({ message: 'Failed to get active username' });
    }
};

module.exports = { analyzeGitHub, analyzeAndSaveGitHubProfile, getActiveUsername };
