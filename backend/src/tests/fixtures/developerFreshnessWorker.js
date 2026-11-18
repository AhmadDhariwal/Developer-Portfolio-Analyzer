'use strict';

const express = require('express');
const mongoose = require('mongoose');
const axios = require('axios');

async function boot() {
  const aiCalls = { count: 0 };
  const githubCalls = { count: 0 };
  let githubScenario = {
    version: 1,
    fail: false,
    delayMs: 0,
    repos: [
      {
        name: 'node-api',
        description: 'Node.js TypeScript service with tests',
        language: 'TypeScript',
        stargazers_count: 15,
        forks_count: 3,
        pushed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        created_at: '2024-01-01T00:00:00.000Z',
        fork: false,
        archived: false,
        size: 1200,
        topics: ['nodejs', 'typescript']
      }
    ]
  };

  axios.get = async (url) => {
    const clean = String(url || '');
    if (clean.includes('api.github.com')) {
      if (clean.endsWith('/repos') || /api\.github\.com\/users\/[^/]+$/.test(clean)) {
        githubCalls.count += 1;
      }
      if (githubScenario.delayMs > 0) {
        await new Promise((r) => setTimeout(r, githubScenario.delayMs));
      }
      if (githubScenario.fail) {
        const err = new Error('GitHub provider unavailable');
        err.response = { status: 503, data: { message: 'Service Unavailable' }, headers: {} };
        throw err;
      }
      const match = clean.match(/\/users\/([^/]+)$/);
      if (match) {
        const login = decodeURIComponent(match[1]);
        return {
          data: {
            login,
            public_repos: githubScenario.repos.length,
            followers: 10 + githubScenario.version,
            created_at: '2022-01-01T00:00:00.000Z',
            updated_at: new Date().toISOString()
          }
        };
      }
      if (clean.includes('/users/') && clean.endsWith('/repos')) {
        return { data: githubScenario.repos };
      }
      if (clean.includes('/languages')) {
        return { data: { TypeScript: 12000, JavaScript: 3000 } };
      }
      if (clean.includes('/contributors')) {
        return { data: [{ login: 'fixture', contributions: 25 }] };
      }
      if (clean.includes('/commits')) {
        return { data: [{ sha: 'abc123', commit: { author: { date: new Date().toISOString() } } }] };
      }
      return { data: [] };
    }
    throw new Error(`Unexpected HTTP call in worker: ${clean}`);
  };

  await mongoose.connect(process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 5000,
    autoIndex: true
  });
  await require('../../modules/integrations/services/integrationMongoGovernanceService').initialize();

  const redisCache = require('../../core/cache/redisCacheService');
  await redisCache.initRedisCache({ silent: true, probeOnly: true });

  const aiService = require('../../core/ai/aiservice');
  const originalRunAi = aiService.runAIAnalysis;
  aiService.runAIAnalysis = async (prompt, fallback, retries, opts = {}) => {
    aiCalls.count += 1;
    const text = String(prompt || '');
    const isRecommendations = /recommendation/i.test(text) || /learningActions/i.test(text);
    const value = isRecommendations
      ? {
          analysisSummary:
            'Backend Intern progress should prioritize SQL, Docker, and Testing through Node.js workflows.',
          projectNarratives: [],
          technologyNarratives: [],
          careerPathNarratives: [],
          portfolioRecommendations: [],
          resumeRecommendations: [],
          learningActions: [
            'Build a SQL and Testing suite for Backend Node.js workflows',
            'Practice Docker deployment and API design with Node.js'
          ],
          interviewReadinessActions: []
        }
      : {
          summary: 'Grounded deterministic narrative summary for Backend developer.',
          analysisSummary: 'Backend evidence summary grounded in Node.js and TypeScript.',
          levelAssessment: 'Intern alignment shows practical Backend progress.'
        };
    return opts?.returnMeta ? { ok: true, value } : value;
  };
  aiService.originalRunAi = originalRunAi;

  const app = express();
  app.use(express.json());
  app.use('/api/github', require('../../modules/github/github.routes'));
  app.use('/api/skillgap', require('../../modules/skill-gap/skillgap.routes'));
  app.use('/api/recommendations', require('../../modules/recommendations/recommendations.routes'));
  app.use('/api/analysis', require('../../modules/workflows/analysis.routes'));
  app.use('/api/dashboard', require('../../modules/dashboard/dashboard.routes'));
  app.use('/api/resume', require('../../modules/resume/resume.routes'));
  app.use('/api/profile', require('../../modules/profile/profile.routes'));

  app.post('/__control/state', async (req, res) => {
    if (req.body?.githubScenario) {
      githubScenario = { ...githubScenario, ...req.body.githubScenario };
    }
    if (req.body?.resetCounters) {
      aiCalls.count = 0;
      githubCalls.count = 0;
    }
    if (req.body?.redisUrl) {
      process.env.REDIS_URL = req.body.redisUrl;
      await redisCache.closeRedisCache().catch(() => {});
      await redisCache.initRedisCache({ silent: true, probeOnly: true }).catch(() => {});
    }
    if (req.body?.clearMemory) {
      redisCache.clearMemoryCache();
      require('../../modules/skill-gap/skillgapcontroller').clearSkillGapMemoryCache?.();
      require('../../modules/recommendations/recommendationscontroller').clearRecommendationMemoryCache?.();
      require('../../modules/github/services/githubservice').clearMemoryAnalysisCache?.();
    }
    res.json({
      aiCalls: aiCalls.count,
      githubCalls: githubCalls.count,
      redisEnabled: redisCache.isRedisCacheEnabled()
    });
  });

  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });

  process.on('message', async (msg) => {
    if (msg === 'stop') {
      await redisCache.closeRedisCache().catch(() => {});
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
      await mongoose.disconnect().catch(() => {});
      process.exit(0);
    }
  });

  process.send({ ready: true, port: server.address().port });
}

boot().catch((error) => {
  process.send?.({ error: error.message });
  process.exit(1);
});

