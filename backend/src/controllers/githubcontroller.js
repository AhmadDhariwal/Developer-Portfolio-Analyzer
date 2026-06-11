const Repository = require('../models/repository');
const Analysis = require('../models/analysis');
const User = require('../models/user');
const { ANALYSIS_VERSION, analyzeGitHubProfile, isRateLimitError } = require('../services/githubservice');
const { createNotification } = require('../services/notificationService');
const { invalidateDashboardSummaryCache } = require('./dashboardcontroller');

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
        res.status(500).json({ message: msg || 'Failed to analyze GitHub profile.' });
    }
};

// @desc    Analyze and persist results for the authenticated user
// @route   POST /api/github/analyze-save
// @access  Private
const analyzeAndSaveGitHubProfile = async (req, res) => {
    try {
        const defaultGithubUsername = String(req.user?.githubUsername || '').trim();
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

        const data = await analyzeGitHubProfile(githubUsername.trim(), { forceRefresh: toForceRefresh(req) });

        // Persist repositories
        await Repository.deleteMany({ ownerId: req.user._id });
        if (Array.isArray(data.repositories) && data.repositories.length > 0) {
            await Repository.insertMany(
                data.repositories.map(r => ({
                    repoName: r.name,
                    language: r.language,
                    stars: r.stars,
                    forks: r.forks,
                    commits: r.commits || 0,
                    lastUpdated: new Date(),
                    ownerId: req.user._id
                }))
            );
        }

        // Persist analysis
        let analysis = await Analysis.findOne({ userId: req.user._id });
        if (!analysis) analysis = new Analysis({ userId: req.user._id });

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

        // Refresh the saved default profile only; temporary analysis is handled locally in the UI.
        await User.findByIdAndUpdate(req.user._id, {
            githubUsername: githubUsername.trim(),
            activeGithubUsername: githubUsername.trim()
        });

        await createNotification({
            userId: req.user._id,
            type: 'github_update',
            title: 'GitHub Profile Updated',
            message: `GitHub analysis refreshed for @${githubUsername.trim()}.`,
            dedupeKey: `github_update:${githubUsername.trim().toLowerCase()}`,
            meta: { username: githubUsername.trim() },
            dedupeWindowHours: 1
        });

        invalidateDashboardSummaryCache(req.user._id);

        res.json(data);
    } catch (error) {
        console.error('GitHub Save Error:', error.message);
        const msg = error.message || '';
        if (isRateLimitError(error)) {
          return res.status(429).json({
            message: 'GitHub API rate limit exceeded. Please wait a few minutes and try again, or add a GITHUB_TOKEN to the backend .env for higher limits.'
          });
        }
        res.status(500).json({ message: msg || 'Failed to analyze and save GitHub profile.' });
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
            username: defaultUsername,
            isDefault: true,
            activeUsername: activeUsername || defaultUsername
        });
    } catch (error) {
        res.status(500).json({ message: 'Failed to get active username' });
    }
};

module.exports = { analyzeGitHub, analyzeAndSaveGitHubProfile, getActiveUsername };
