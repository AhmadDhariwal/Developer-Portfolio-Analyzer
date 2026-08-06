'use strict';

/**
 * Baseline / after measurement harness for recommendations performance.
 * Run: node src/tests/recommendationsPerfMeasure.js
 */
const path = require('node:path');
const { performance } = require('node:perf_hooks');

const root = path.resolve(__dirname, '..');
const resolve = (relative) => require.resolve(path.join(root, relative));
const mock = (relative, exports) => {
  const filename = resolve(relative);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
};
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const percentile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return 0;
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)];
};
const chain = (value, ms = 0) => ({
  select() { return this; },
  sort() { return this; },
  lean: async () => {
    if (ms) await delay(ms);
    return value;
  }
});

const parseGitHubUsername = (raw = '') => {
  const trimmed = String(raw || '').trim().replace(/^@/, '');
  if (!trimmed) {
    const error = new Error('GitHub username is required.');
    error.status = 400;
    throw error;
  }
  if (trimmed.length > 200) {
    const error = new Error('GitHub username is too large.');
    error.status = 413;
    throw error;
  }
  return trimmed;
};

const createHarness = ({
  redisDelayMs = 8,
  mongoDelayMs = 20,
  githubDelayMs = 35,
  aiDelayMs = 45,
  resumeDelayMs = 18,
  signalsDelayMs = 40,
  notificationDelayMs = 30
} = {}) => {
  const shared = new Map();
  const mongo = new Map();
  const counters = {
    github: 0,
    ai: 0,
    resume: 0,
    signals: 0,
    redisGets: 0,
    redisSets: 0,
    mongoReads: 0,
    mongoWrites: 0,
    notifications: 0,
    persistence: 0
  };

  const githubPayload = {
    repoCount: 4,
    developerLevel: 'Junior',
    strengths: ['Node.js'],
    weakAreas: ['SQL'],
    languageDistribution: [{ language: 'JavaScript', percentage: 80 }],
    repositories: [{ name: 'api', description: 'Node SQL API', language: 'JavaScript' }],
    scores: { healthScore: 70, activity: 65 },
    cache: { cachedAt: '2026-08-05T00:00:00.000Z', expiresAt: '2026-08-06T00:00:00.000Z', source: 'cache' }
  };

  mock('services/githubservice.js', {
    parseGitHubUsername,
    analyzeGitHubProfile: async () => {
      counters.github += 1;
      await delay(githubDelayMs);
      return githubPayload;
    }
  });

  mock('services/aiservice.js', {
    getSharedCache: async (key, namespace) => {
      counters.redisGets += 1;
      await delay(redisDelayMs);
      return shared.get(`${namespace}:${key}`) || null;
    },
    setSharedCache: async (key, value, _ttl, namespace) => {
      counters.redisSets += 1;
      counters.persistence += 1;
      shared.set(`${namespace}:${key}`, value);
    },
    runAIAnalysis: async (_prompt, fallback, retries = 0, opts = {}) => {
      counters.ai += 1;
      await delay(aiDelayMs);
      const value = {
        analysisSummary: 'Backend Intern progress should prioritize SQL proof through a focused Node.js project.',
        projectNarratives: [],
        technologyNarratives: [],
        careerPathNarratives: [],
        portfolioRecommendations: [],
        resumeRecommendations: [],
        learningActions: [],
        interviewReadinessActions: []
      };
      if (opts.returnMeta) return { ok: true, value };
      return value;
    }
  });

  mock('models/analysisCache.js', {
    findOne: (query) => {
      counters.mongoReads += 1;
      const exact = mongo.get(JSON.stringify(query));
      if (exact) return chain(exact, mongoDelayMs);
      // soft match by userId+version for previous-recommendation style queries
      for (const [key, row] of mongo.entries()) {
        try {
          const parsed = JSON.parse(key);
          if (String(parsed.userId) === String(query.userId)
            && parsed.analysisVersion === query.analysisVersion
            && (!query.signalHash || parsed.signalHash === query.signalHash)
            && (!query.resumeHash || parsed.resumeHash === query.resumeHash)
            && (!query.githubUsername || parsed.githubUsername === query.githubUsername)
            && (!query.careerStack || parsed.careerStack === query.careerStack)) {
            return chain(row, mongoDelayMs);
          }
        } catch (_) { /* ignore */ }
      }
      return chain(null, mongoDelayMs);
    },
    findOneAndUpdate: async (query, update) => {
      counters.mongoWrites += 1;
      counters.persistence += 1;
      await delay(mongoDelayMs);
      const key = JSON.stringify(query);
      const row = {
        ...query,
        analysisData: update.$set.analysisData,
        userId: update.$set.userId || query.userId,
        updatedAt: new Date(),
        createdAt: new Date()
      };
      mongo.set(key, row);
      return row;
    }
  });

  mock('models/resumeAnalysis.js', {
    findOne: () => {
      counters.resume += 1;
      return chain({
        fileId: 'default',
        fileName: 'default.pdf',
        technicalSkills: ['Node.js', 'JavaScript'],
        skills: ['Node.js', 'JavaScript'],
        atsScore: 72,
        keywordDensity: 60,
        formatScore: 70,
        contentQuality: 68,
        analyzedAt: new Date('2026-08-01')
      }, resumeDelayMs);
    }
  });

  mock('models/githubAnalysisCache.js', {
    findOne: () => chain(null, 5)
  });

  mock('models/user.js', {
    findById: () => ({
      select() { return this; },
      lean: async () => ({ defaultResumeFileId: 'default' })
    })
  });

  mock('models/savedPreview.js', {
    find: () => ({ sort() { return this; }, limit() { return this; }, lean: async () => [] }),
    findOneAndUpdate: async () => ({}),
    findOne: () => ({ lean: async () => null }),
    findOneAndDelete: async () => null
  });

  mock('services/aiVersionService.js', { createVersion: async () => {} });
  mock('services/notificationService.js', {
    createNotification: async () => {
      counters.notifications += 1;
      await delay(notificationDelayMs);
    }
  });
  mock('prompts/recommendationPrompt.js', { getRecommendationPrompt: () => 'prompt' });
  mock('services/developerSignalService.js', {
    getDeveloperSignals: async () => {
      counters.signals += 1;
      await delay(signalsDelayMs);
      return {
        githubSignals: { present: false, repoCount: 0 },
        resumeSignals: { analyzed: true, atsScore: 72, skills: ['Node.js'], weaknesses: [], missingSections: [] },
        skillGapSignals: { present: true, coverage: 55, knownSkills: ['Node.js'], missingSkills: ['SQL'], weakSkills: ['SQL'], highDemandSkills: ['SQL'], immediateSkills: ['SQL'] },
        careerSprintSignal: { present: false, consistencyScore: 40, completedSkillSignals: [], repeatedIncompleteSkills: [] },
        weeklyReportSignal: { present: false, weeklyProgressScore: 40, skillsImprovedThisWeek: [], repeatedWeakAreas: [] },
        portfolioSignal: { present: false, completenessScore: 40, listedProjects: 0, liveLinks: 0, githubLinks: 0, portfolioSkills: [] },
        integrationSignal: { present: false, usedProviders: [], integrationScore: 20, detectedSkills: [], certifications: [], strongestProof: [], weakProof: [] },
        careerProfileSignal: { present: true, careerStack: 'Backend', experienceLevel: 'Intern' },
        jobsDemandSignal: { present: true, sampledJobs: 12, topSkills: [{ name: 'SQL', demandScore: 80, postings: 10 }] }
      };
    },
    buildSignalHash: (signals) => `hash-${signals?.skillGapSignals?.coverage || 0}`,
    buildSignalsUsedSummary: () => ({ github: { connected: true, repoCount: 0 }, resume: { analyzed: true, atsScore: 72 }, skillGap: { present: true } }),
    buildResumeAnalysisSignals: (value, level) => ({
      analyzed: true,
      skills: value?.technicalSkills || [],
      technicalSkills: value?.technicalSkills || [],
      atsScore: value?.atsScore || 0,
      keywordDensity: value?.keywordDensity || 0,
      formatScore: value?.formatScore || 0,
      contentQuality: value?.contentQuality || 0,
      experienceLevel: level,
      statusMessage: 'Saved resume',
      weaknesses: [],
      missingSections: [],
      keyAchievements: []
    }),
    buildResumeCacheIdentity: () => ({ resumeHash: 'a'.repeat(64), resumeAnalysisId: 'default' }),
    buildAnalysisBasedOn: () => ({ githubUsername: 'dev', resumeAnalyzed: true, resumeStatus: 'ok', careerStack: 'Backend', experienceLevel: 'Intern' }),
    getPublicJobMarketSignal: async () => ({ present: true, sampledJobs: 12, topSkills: [{ name: 'SQL', demandScore: 80 }] })
  });
  mock('services/previewResumeCacheService.js', {
    resolvePreviewResume: async () => ({
      resumeInsights: {
        analyzed: true,
        skills: ['React'],
        technicalSkills: ['React'],
        atsScore: 60,
        statusMessage: 'Preview resume',
        weaknesses: [],
        missingSections: [],
        keyAchievements: []
      },
      resumeCacheIdentity: { resumeHash: 'b'.repeat(64), resumeAnalysisId: 'preview' }
    })
  });
  mock('utils/skilldetector.js', {
    extractSkillsFromRepositories: () => ['JavaScript', 'Node.js'],
    canonicalizeSkillName: (v) => String(v || '').trim(),
    detectSkillGaps: (known) => ({
      currentSkills: known.map((name) => ({ name })),
      missingSkills: [{ name: 'SQL', priority: 'High' }, { name: 'Docker', priority: 'High' }]
    })
  });

  // Clear controller and dependents that may have been loaded
  for (const key of Object.keys(require.cache)) {
    if (key.includes(`${path.sep}controllers${path.sep}recommendationscontroller`)
      || key.includes(`${path.sep}prompts${path.sep}recommendationPrompt`)) {
      delete require.cache[key];
    }
  }

  const controllerPath = resolve('controllers/recommendationscontroller.js');
  delete require.cache[controllerPath];
  const controller = require(controllerPath);
  if (typeof controller.clearRecommendationMemoryCache === 'function') {
    controller.clearRecommendationMemoryCache();
  }

  const callProfile = async ({ forceRefresh = false } = {}) => {
    const out = { status: 200 };
    const res = {
      status: (code) => { out.status = code; return res; },
      json: (payload) => {
        out.body = payload;
        out.timings = payload?.cacheMetadata?.stageTimingsMs || {};
        return res;
      }
    };
    await controller.getRecommendations({
      body: { forceRefresh },
      user: {
        _id: 'u-perf-1',
        activeGithubUsername: 'backend-dev',
        careerStack: 'Backend',
        experienceLevel: 'Intern',
        defaultResumeFileId: 'default'
      }
    }, res);
    return out;
  };

  const callPreview = async ({ forceRefresh = false } = {}) => {
    const out = { status: 200 };
    const res = {
      status: (code) => { out.status = code; return res; },
      json: (payload) => {
        out.body = payload;
        out.timings = payload?.cacheMetadata?.stageTimingsMs || {};
        return res;
      }
    };
    await controller.generateRecommendations({
      body: {
        githubUsername: 'preview-dev',
        careerStack: 'Frontend',
        experienceLevel: 'Student',
        isTemporary: true,
        forceRefresh
      },
      user: null
    }, res);
    return out;
  };

  const snapshot = () => ({ ...counters });

  return {
    callProfile,
    callPreview,
    counters,
    snapshot,
    shared,
    mongo,
    controller
  };
};

const measure = async (label, fn, runs = 8) => {
  const samples = [];
  let last;
  for (let i = 0; i < runs; i += 1) {
    const at = performance.now();
    last = await fn();
    samples.push(performance.now() - at);
  }
  return {
    label,
    p50: Number(percentile(samples, 50).toFixed(2)),
    p95: Number(percentile(samples, 95).toFixed(2)),
    last
  };
};

const main = async () => {
  const h = createHarness();
  const beforeCounters = h.snapshot();

  // Cold path
  const cold = await measure('cold', async () => h.callProfile({ forceRefresh: true }), 5);

  // Seed caches with a normal run
  await h.callProfile({ forceRefresh: false });
  const afterCold = h.snapshot();

  // Redis / mongo hit path (memory cleared if available)
  if (typeof h.controller.clearRecommendationMemoryCache === 'function') {
    h.controller.clearRecommendationMemoryCache();
  }
  const redisOrMongo = await measure('redis_or_mongo', async () => h.callProfile({ forceRefresh: false }), 8);

  // Memory hit path
  const memory = await measure('memory', async () => h.callProfile({ forceRefresh: false }), 10);

  // Concurrency
  const concurrentBefore = h.snapshot();
  const concurrent = await Promise.all(Array.from({ length: 5 }, () => h.callProfile({ forceRefresh: true })));
  const concurrentAfter = h.snapshot();

  const report = {
    label: process.env.REC_PERF_LABEL || 'measure',
    timings: {
      cold,
      redis_or_mongo: redisOrMongo,
      memory,
      concurrentWallMs: Number((concurrentAfter && concurrent[0] ? concurrent.reduce((max, item, idx, arr) => max, 0) : 0).toFixed?.(2) || 0)
    },
    counts: {
      coldDelta: {
        github: afterCold.github - beforeCounters.github,
        ai: afterCold.ai - beforeCounters.ai,
        signals: afterCold.signals - beforeCounters.signals,
        mongoReads: afterCold.mongoReads - beforeCounters.mongoReads,
        mongoWrites: afterCold.mongoWrites - beforeCounters.mongoWrites,
        redisGets: afterCold.redisGets - beforeCounters.redisGets,
        redisSets: afterCold.redisSets - beforeCounters.redisSets,
        notifications: afterCold.notifications - beforeCounters.notifications
      },
      concurrentDelta: {
        github: concurrentAfter.github - concurrentBefore.github,
        ai: concurrentAfter.ai - concurrentBefore.ai,
        signals: concurrentAfter.signals - concurrentBefore.signals,
        persistence: concurrentAfter.persistence - concurrentBefore.persistence,
        notifications: concurrentAfter.notifications - concurrentBefore.notifications
      },
      totals: concurrentAfter
    },
    sampleStageTimings: {
      cold: cold.last?.timings || {},
      redis_or_mongo: redisOrMongo.last?.timings || {},
      memory: memory.last?.timings || {}
    },
    correctness: {
      coldStatus: cold.last?.status,
      hasProjects: Array.isArray(cold.last?.body?.projects) && cold.last.body.projects.length > 0,
      memoryFromCache: Boolean(memory.last?.body?.fromCache || memory.last?.body?.cacheMetadata?.loadedFromCache)
    }
  };

  // Proper concurrent wall clock
  const cAt = performance.now();
  if (typeof h.controller.clearRecommendationMemoryCache === 'function') {
    h.controller.clearRecommendationMemoryCache();
  }
  const wallBefore = h.snapshot();
  await Promise.all(Array.from({ length: 5 }, () => h.callProfile({ forceRefresh: true })));
  const wallAfter = h.snapshot();
  report.timings.concurrentWallMs = Number((performance.now() - cAt).toFixed(2));
  report.counts.concurrentDelta = {
    github: wallAfter.github - wallBefore.github,
    ai: wallAfter.ai - wallBefore.ai,
    signals: wallAfter.signals - wallBefore.signals,
    persistence: wallAfter.persistence - wallBefore.persistence,
    notifications: wallAfter.notifications - wallBefore.notifications
  };

  console.log(JSON.stringify(report, null, 2));
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
