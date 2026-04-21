const Repository = require('../models/repository');
const Analysis = require('../models/analysis');
const User = require('../models/user');
const { analyzeGitHubProfile } = require('../services/githubservice');
const { createNotification } = require('../services/notificationService');

// @desc    Publicly analyze any GitHub username
// @route   POST /api/github/analyze
// @access  Public
const analyzeGitHub = async (req, res) => {
    try {
        const { username } = req.body;

        if (!username || !username.trim()) {
            return res.status(400).json({ message: 'GitHub username is required.' });
        }

        const data = await analyzeGitHubProfile(username.trim());
        res.json(data);
    } catch (error) {
        console.error('GitHub Analyzer Error:', error.message);
        const msg = error.message || '';
        if (
          error.response?.status === 403 ||
          error.response?.status === 429 ||
          msg.toLowerCase().includes('rate limit')
        ) {
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
        const githubUsername = req.body.username || req.user?.activeGithubUsername || req.user?.githubUsername;

        if (!githubUsername) {
            return res.status(400).json({ message: 'GitHub username is required.' });
        }

        const data = await analyzeGitHubProfile(githubUsername.trim());

        // Persist repositories
        await Repository.deleteMany({ ownerId: req.user._id });
        if (data.repositories.length > 0) {
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

        analysis.githubScore = data.activityScore;
        analysis.githubStats = {
            repos: data.repoCount,
            stars: data.totalStars,
            forks: data.totalForks,
            followers: 0
        };

        // Store language distribution as a plain object for Mongoose Map
        const langMap = {};
        data.languageDistribution.forEach(l => { langMap[l.language] = l.percentage; });
        analysis.languageDistribution = langMap;

        await analysis.save();

        // Save active username on the user context
        await User.findByIdAndUpdate(req.user._id, {
            activeGithubUsername: githubUsername.trim(),
            lastSearchedGithub: githubUsername.trim()
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

        res.json(data);
    } catch (error) {
        console.error('GitHub Save Error:', error.message);
        const msg = error.message || '';
        if (
          error.response?.status === 403 ||
          error.response?.status === 429 ||
          msg.toLowerCase().includes('rate limit')
        ) {
          return res.status(429).json({
            message: 'GitHub API rate limit exceeded. Please wait a few minutes and try again, or add a GITHUB_TOKEN to the backend .env for higher limits.'
          });
        }
        res.status(500).json({ message: msg || 'Failed to analyze and save GitHub profile.' });
    }
};

// @desc    Get the active github username for the analyzer (last searched or signup)
// @route   GET /api/github/active-username
// @access  Private
const getActiveUsername = async (req, res) => {
    try {
        const user = await User.findById(req.user._id).select('githubUsername activeGithubUsername');
        const activeUsername = user.activeGithubUsername || user.githubUsername;
        res.json({ username: activeUsername, isDefault: activeUsername === user.githubUsername });
    } catch (error) {
        res.status(500).json({ message: 'Failed to get active username' });
    }
};

module.exports = { analyzeGitHub, analyzeAndSaveGitHubProfile, getActiveUsername };
