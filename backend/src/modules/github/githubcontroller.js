const notificationPersistence = require('../notifications/services/notificationPersistenceService');
const developerContext = require('../../core/developer-context/developerContextService');
const Repository = require('./models/repository');
const Analysis = require('../skill-gap/models/analysis');
const User = require('../auth/models/user');
const GitHubSaveLock = require('./models/githubSaveLock');
const crypto = require('node:crypto');
const {
    ANALYSIS_VERSION,
    analyzeGitHubProfile,
    getCachedGitHubAnalysis,
    isRateLimitError,
    parseGitHubUsername,
    invalidateSkillGapCachesForGitHub
} = require('./services/githubservice');
const { invalidateDashboardSummaryCache } = require('../dashboard/dashboardcontroller');

const saveJobs = new Map();

const readSavedGitHubAnalysis = async (userId, username) =>
    (await getCachedGitHubAnalysis(username, { userId })).data;

const SAVE_LOCK_TTL_SECONDS = 30;
const SAVE_LOCK_WAIT_MS = 2500;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const acquireMongoSaveLock = async (key, ownerToken) => {
    try {
        return Boolean(
            await GitHubSaveLock.findOneAndUpdate(
                {
                    _id: key,
                    $or: [{ expiresAt: { $lte: new Date() } }, { expiresAt: { $exists: false } }]
                },
                {
                    $set: {
                        ownerToken,
                        expiresAt: new Date(Date.now() + SAVE_LOCK_TTL_SECONDS * 1000)
                    }
                },
                { upsert: true, returnDocument: 'after', maxTimeMS: 3000 }
            ).lean()
        );
    } catch (error) {
        if (error?.code === 11000) return false;
        throw error;
    }
};

const acquireSaveLock = async (userId) => {
    // A single durable authority prevents split ownership during a Redis outage.
    const key = `github-save:${String(userId)}`;
    const ownerToken = crypto.randomUUID();
    const deadline = Date.now() + SAVE_LOCK_WAIT_MS;
    let contended = false;
    do {
        if (await acquireMongoSaveLock(key, ownerToken)) return { key, ownerToken, contended };
        contended = true;
        if (Date.now() >= deadline) break;
        await sleep(100);
    } while (true);
    return null;
};

const renewSaveLock = async (lock, session) => {
    const now = new Date();
    const result = await GitHubSaveLock.updateOne(
        { _id: lock.key, ownerToken: lock.ownerToken, expiresAt: { $gt: now } },
        {
            $set: {
                expiresAt: new Date(now.getTime() + SAVE_LOCK_TTL_SECONDS * 1000)
            }
        },
        { session, maxTimeMS: 3000 }
    );
    if (!result.matchedCount) {
        throw Object.assign(new Error('GitHub synchronization lease expired. Please retry.'), {
            status: 409
        });
    }
};

const startSaveHeartbeat = (lock) => {
    let renewal = Promise.resolve();
    let lost = false;
    const timer = setInterval(() => {
        renewal = renewal
            .then(async () => {
                if (!lost) await renewSaveLock(lock);
            })
            .catch(() => {
                lost = true;
                clearInterval(timer);
            });
    }, 10000);
    timer.unref();
    return async () => {
        clearInterval(timer);
        await renewal;
        if (lost) {
            throw Object.assign(new Error('GitHub synchronization lease was lost. Please retry.'), {
                status: 409
            });
        }
    };
};

const releaseSaveLock = (lock) =>
    GitHubSaveLock.deleteOne({ _id: lock.key, ownerToken: lock.ownerToken });

const toForceRefresh = (req) =>
    String(req.body?.forceRefresh ?? req.query?.forceRefresh ?? '').toLowerCase() === 'true';

const sanitizeClientMessage = (error, fallback) => {
    const msg = String(error?.message || '').trim();
    if (!msg || msg.length > 300) return fallback;
    if (/[A-Za-z]:[\\/]|\\\\|\/(?:Users|home|root|var|tmp|opt|srv|etc)\//i.test(msg))
        return fallback;
    if (
        /node_modules|at\s+\S+\s+\(|api[_-]?key|bearer\s|github_pat_|gh[pousr]_|secret|password|token\s*[:=]|https?:\/\/[^\s/]+:[^\s/]+@/i.test(
            msg
        )
    )
        return fallback;
    if (/stack|traceback|ENOENT|EACCES/i.test(msg)) return fallback;
    return msg;
};

const respondGitHubError = (res, error, fallbackMessage) => {
    if (isRateLimitError(error)) {
        return res.status(429).json({
            message:
                'GitHub API rate limit exceeded. Please wait a few minutes and try again, or add a GITHUB_TOKEN to the backend .env for higher limits.'
        });
    }
    const status = Number(error?.status || 0);
    if (status === 404) {
        return res.status(404).json({
            message: sanitizeClientMessage(error, 'GitHub user not found.')
        });
    }
    if (status === 400) {
        return res.status(400).json({
            message: sanitizeClientMessage(error, 'Invalid GitHub username.')
        });
    }
    if (status === 413) {
        return res.status(413).json({
            message: sanitizeClientMessage(error, 'GitHub username is too large.')
        });
    }
    if (status === 409 || /already in progress/i.test(String(error?.message || ''))) {
        return res.status(409).json({
            message: sanitizeClientMessage(
                error,
                'GitHub analysis save is already in progress. Please retry.'
            )
        });
    }
    return res.status(500).json({
        message: error?.transient
            ? 'Failed to fetch GitHub data. Please try again.'
            : fallbackMessage
    });
};

const buildLanguageMap = (languageDistribution = []) => {
    const langMap = {};
    (Array.isArray(languageDistribution) ? languageDistribution : []).forEach((entry) => {
        if (entry?.language) langMap[entry.language] = Number(entry.percentage || 0);
    });
    return langMap;
};

const buildHistorySnapshot = (data = {}) => ({
    analyzedAt: data.fetchedAt || data.scoring?.calculatedAt || new Date(),
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

const replaceRepositoriesSafely = async (userId, repositories = [], session) => {
    const rows = Array.isArray(repositories) ? repositories : [];
    if (!rows.length) {
        await Repository.deleteMany({ ownerId: userId }, { session });
        return;
    }

    const uniqueRows = Array.from(
        new Map(
            rows
                .filter((repo) => String(repo?.name || '').trim())
                .map((repo) => [String(repo.name).trim(), repo])
        ).values()
    );
    const repoNames = uniqueRows.map((repo) => String(repo.name).trim());

    // Upsert every incoming row before removing stale rows.  A failed write
    // therefore leaves the prior repository set intact rather than empty.
    await Repository.bulkWrite(
        uniqueRows.map((repo) => ({
            updateOne: {
                filter: { ownerId: userId, repoName: String(repo.name).trim() },
                update: {
                    $set: {
                        language: repo.language,
                        stars: repo.stars == null ? null : Number(repo.stars),
                        forks: repo.forks == null ? null : Number(repo.forks),
                        commits: repo.commits == null ? null : Number(repo.commits),
                        lastUpdated: repo.updatedAt || repo.pushedAt || null
                    },
                    $setOnInsert: {
                        ownerId: userId,
                        repoName: String(repo.name).trim()
                    }
                },
                upsert: true
            }
        })),
        { ordered: true, session }
    );

    await Repository.deleteMany(
        {
            ownerId: userId,
            repoName: { $nin: repoNames }
        },
        { session }
    );
};

const persistGitHubAnalysis = async (user, githubUsername, forceRefresh) => {
    const lock = await acquireSaveLock(user._id);
    if (!lock) {
        const error = new Error('GitHub analysis save is already in progress. Please retry.');
        error.status = 409;
        throw error;
    }
    const stopHeartbeat = startSaveHeartbeat(lock);
    try {
        if (lock.contended || !forceRefresh) {
            const saved = await readSavedGitHubAnalysis(user._id, githubUsername);
            if (saved) return saved;
            if (lock.contended) {
                throw Object.assign(
                    new Error('No accepted GitHub result is available yet. Please retry.'),
                    {
                        status: 409
                    }
                );
            }
        }

        const data = await analyzeGitHubProfile(githubUsername, {
            forceRefresh
        });
        await stopHeartbeat();

        // Never persist a fallback/stale refresh result — keep the previous valid profile.
        if (
            data?.rateLimited ||
            data?.cache?.stale ||
            data?.cache?.source === 'stale-cache' ||
            data?.warning
        ) {
            const saved = await readSavedGitHubAnalysis(user._id, githubUsername);
            if (!saved) return data;
            return {
                ...saved,
                cache: { ...saved.cache, source: 'stale-cache', stale: true },
                warning: data.warning,
                rateLimited: data.rateLimited
            };
        }

        let analysis = await Analysis.findOne({ userId: user._id }).select(
            'userId githubScore githubStats githubAnalysisVersion githubSignals languageDistribution contributionActivity githubAnalysisHistory'
        );
        if (
            analysis?.githubSignals?.acceptedResult &&
            String(analysis.githubSignals.username || '').toLowerCase() ===
                githubUsername.toLowerCase() &&
            new Date(analysis.githubSignals.analyzedAt).getTime() >
                new Date(data.githubSignals?.analyzedAt).getTime()
        ) {
            return analysis.githubSignals.acceptedResult;
        }
        if (
            analysis?.githubSignals?.analyzedAt === data.githubSignals?.analyzedAt &&
            String(analysis?.githubSignals?.username || '').toLowerCase() ===
                githubUsername.toLowerCase()
        ) {
            const priorExpiry = new Date(
                analysis.githubSignals.acceptedResult?.cache?.expiresAt
            ).getTime();
            const nextExpiry = new Date(data.cache?.expiresAt || 0).getTime();
            if (analysis.githubSignals.acceptedResult && nextExpiry > (priorExpiry || 0)) {
                await Analysis.updateOne(
                    {
                        _id: analysis._id,
                        'githubSignals.username': analysis.githubSignals.username,
                        'githubSignals.analyzedAt': data.githubSignals.analyzedAt,
                        'githubSignals.acceptedResult.cache.expiresAt':
                            analysis.githubSignals.acceptedResult.cache?.expiresAt ?? null
                    },
                    {
                        $set: {
                            'githubSignals.acceptedResult.cache.expiresAt': data.cache.expiresAt
                        }
                    }
                );
            }
            return data;
        }
        if (!analysis) analysis = new Analysis({ userId: user._id });

        analysis.githubScore = Number(data.githubHealthScore || data.activityScore || 0);
        analysis.githubStats = {
            repos: Number(data.repoCount || 0),
            stars: Number(data.totalStars || 0),
            forks: Number(data.totalForks || 0),
            followers: Number(data.followers || 0)
        };
        analysis.githubAnalysisVersion = data.analysisVersion || ANALYSIS_VERSION;
        analysis.githubSignals = {
            ...data.githubSignals,
            acceptedResult: data
        };
        analysis.languageDistribution = buildLanguageMap(
            data.mainLanguageDistribution?.length
                ? data.mainLanguageDistribution
                : data.languageDistribution
        );
        // The analyzer supplies repository totals, not dated monthly evidence.
        // Never refresh or transfer a previous profile's monthly series with this save.
        analysis.contributionActivity = [];
        analysis.githubAnalysisHistory = [
            ...(Array.isArray(analysis.githubAnalysisHistory)
                ? analysis.githubAnalysisHistory
                : []),
            buildHistorySnapshot(data)
        ].slice(-12);
        analysis.updatedAt = new Date();
        const isNewAnalysis = analysis.isNew;
        await notificationPersistence.commit(
            user._id,
            async (session) => {
                await renewSaveLock(lock, session);
                const currentOwner = await User.findById(user._id).select(
                    'githubUsername activeGithubUsername'
                );
                if (
                    currentOwner &&
                    String(
                        developerContext.resolveGithubUsername(currentOwner) || ''
                    ).toLowerCase() !== githubUsername.toLowerCase()
                ) {
                    throw Object.assign(
                        new Error(
                            'GitHub profile changed during synchronization. Please retry from the current profile.'
                        ),
                        { status: 409 }
                    );
                }
                await replaceRepositoriesSafely(user._id, data.repositories, session);
                // Mongo may retry this callback after a transient transaction abort.
                // The first insert must remain an insert on each retry.
                if (isNewAnalysis) analysis.isNew = true;
                await analysis.save({ session });
                await User.findByIdAndUpdate(
                    user._id,
                    {
                        githubUsername: githubUsername.trim(),
                        activeGithubUsername: githubUsername.trim()
                    },
                    { session }
                );
            },
            {
                type: 'github_update',
                title: 'GitHub Profile Updated',
                message: `GitHub analysis refreshed for @${githubUsername.trim()}.`,
                dedupeKey: `github_update:${githubUsername.trim().toLowerCase()}`,
                dedupeWindowHours: 1,
                meta: { username: githubUsername.trim() }
            }
        );
        await invalidateSkillGapCachesForGitHub(githubUsername, user._id);
        invalidateDashboardSummaryCache(user._id);
        return data;
    } finally {
        await stopHeartbeat().catch(() => {});
        await releaseSaveLock(lock);
    }
};

// @desc    Publicly analyze any GitHub username
// @route   POST /api/github/analyze
// @access  Public
const analyzeGitHub = async (req, res) => {
    try {
        let githubUsername;
        try {
            githubUsername = parseGitHubUsername(req.body?.username);
        } catch (validationError) {
            return respondGitHubError(res, validationError, 'Invalid GitHub username.');
        }

        const data = await analyzeGitHubProfile(githubUsername, {
            forceRefresh: toForceRefresh(req)
        });
        res.json(data);
    } catch (error) {
        console.error(
            'GitHub Analyzer Error:',
            sanitizeClientMessage(error, 'Failed to analyze GitHub profile.')
        );
        return respondGitHubError(res, error, 'Failed to analyze GitHub profile.');
    }
};

// @desc    Analyze and persist results for the authenticated user
// @route   POST /api/github/analyze-save
// @access  Private
const analyzeAndSaveGitHubProfile = async (req, res) => {
    let saveKey;
    let job = null;
    try {
        if (!req.user?._id) {
            return res.status(401).json({ message: 'Not authorized.' });
        }

        const defaultGithubUsername = String(
            developerContext.resolveGithubUsername(req.user) || ''
        ).trim();
        if (!defaultGithubUsername)
            return res.status(400).json({
                message: 'Add a GitHub username to your profile before saving an analysis.'
            });
        const requestedRaw = String(req.body?.username || defaultGithubUsername).trim();
        let githubUsername = '';
        try {
            githubUsername = parseGitHubUsername(requestedRaw || defaultGithubUsername);
        } catch (validationError) {
            return respondGitHubError(res, validationError, 'Invalid GitHub username.');
        }

        const normalizedDefault = String(defaultGithubUsername || '')
            .trim()
            .replace(/^@/, '');
        if (normalizedDefault) {
            let parsedDefault;
            try {
                parsedDefault = parseGitHubUsername(normalizedDefault);
            } catch {
                return res.status(400).json({
                    message:
                        'Your saved GitHub username is invalid. Update your profile before analyzing.'
                });
            }
            if (parsedDefault && githubUsername.toLowerCase() !== parsedDefault.toLowerCase()) {
                return res.status(400).json({
                    message:
                        'Temporary GitHub analysis should use the analyzer preview flow and must not overwrite your saved profile.'
                });
            }
            githubUsername = parsedDefault;
        }

        if (req.body?.savedOnly === true) {
            const saved = await readSavedGitHubAnalysis(req.user._id, githubUsername);
            if (!saved)
                return res.status(404).json({
                    message: 'No saved GitHub analysis is available. Use Sync GitHub to create one.'
                });
            return res.json(saved);
        }

        saveKey = `${req.user._id}:${githubUsername.toLowerCase()}`;
        job = saveJobs.get(saveKey);
        if (!job) {
            job = persistGitHubAnalysis(req.user, githubUsername, toForceRefresh(req));
            saveJobs.set(saveKey, job);
        }
        const data = await job;

        res.json(data);
    } catch (error) {
        console.error(
            'GitHub Save Error:',
            sanitizeClientMessage(error, 'Failed to analyze and save GitHub profile.')
        );
        return respondGitHubError(res, error, 'Failed to analyze and save GitHub profile.');
    } finally {
        if (saveKey && job && saveJobs.get(saveKey) === job) {
            saveJobs.delete(saveKey);
        }
    }
};

// @desc    Get the default github username for analysis-driven components
// @route   GET /api/github/active-username
// @access  Private
const getActiveUsername = async (req, res) => {
    try {
        if (!req.user?._id) {
            return res.status(401).json({ message: 'Not authorized.' });
        }
        const user = await User.findById(req.user._id).select(
            'githubUsername activeGithubUsername'
        );
        const username = String(developerContext.resolveGithubUsername(user) || '').trim();
        res.json({
            username,
            isDefault: true,
            activeUsername: username
        });
    } catch (error) {
        res.status(500).json({ message: 'Failed to get active username' });
    }
};

module.exports = {
    analyzeGitHub,
    analyzeAndSaveGitHubProfile,
    getActiveUsername
};
