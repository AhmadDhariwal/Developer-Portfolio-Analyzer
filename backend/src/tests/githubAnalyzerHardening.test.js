'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const { performance } = require('node:perf_hooks');

const servicePath = require.resolve('../services/githubservice');
const controllerPath = require.resolve('../controllers/githubcontroller');
const TOKEN = 'github_pat_acceptance_secret';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const copy = (value) => value == null ? value : structuredClone(value);
const thenable = (value) => ({ lean: async () => copy(value) });

const freshCounters = () => ({
  github: { profile: 0, repositories: 0, languages: 0, contributors: 0, content: 0, commits: 0 },
  ai: 0,
  cache: { reads: 0, writes: 0 },
  persistence: { jobs: 0, repositoryUpserts: 0, staleDeletes: 0, analysisFinds: 0, analysisSaves: 0, historyUpdates: 0, userUpdates: 0 },
  notifications: 0,
  invalidations: 0,
  locks: { redisAcquire: 0, redisRelease: 0, mongoAcquire: 0, mongoRelease: 0 }
});

const createHarness = () => {
  const state = {
    counters: freshCounters(),
    cache: new Map(),
    repositories: new Map(),
    analyses: new Map(),
    users: new Map(),
    notifications: [],
    redisLocks: new Map(),
    mongoLocks: new Map(),
    redisHealthy: true,
    repositoryFailure: false,
    githubFailure: null,
    optionalFailure: false,
    aiMode: 'success',
    delays: { github: 2, ai: 2, persistence: 2 },
    logs: []
  };

  const reposFor = (username) => Array.from({ length: 10 }, (_, index) => ({
    name: `${username}-repo-${index + 1}`,
    description: index === 0 ? 'React Node Docker production application' : 'Useful project',
    topics: index === 0 ? ['react', 'nodejs'] : [],
    language: index % 2 ? 'TypeScript' : 'JavaScript',
    stargazers_count: 20 - index,
    forks_count: index % 3,
    pushed_at: new Date(Date.now() - index * 86400000).toISOString(),
    updated_at: new Date(Date.now() - index * 86400000).toISOString(),
    created_at: '2024-01-01T00:00:00.000Z',
    fork: false,
    archived: false,
    size: 1000 + index
  }));

  const axios = {
    async get(url) {
      await delay(state.delays.github);
      if (url.includes(`/users/`) && !url.includes('/repos/')) {
        if (url.endsWith('/repos')) state.counters.github.repositories += 1;
        else state.counters.github.profile += 1;
      } else if (url.includes('/languages')) state.counters.github.languages += 1;
      else if (url.includes('/contributors')) state.counters.github.contributors += 1;
      else if (url.includes('/contents/')) state.counters.github.content += 1;
      else if (url.includes('/commits')) state.counters.github.commits += 1;

      const isFullRequest = /\/users\/[^/]+(?:\/repos)?$/.test(url);
      if (state.githubFailure && isFullRequest) {
        if (state.githubFailure === '404') {
          const error = new Error('remote missing');
          error.response = { status: 404, data: { message: 'Not Found' }, headers: {} };
          throw error;
        }
        if (state.githubFailure === '429') {
          const error = new Error('rate limit');
          error.response = { status: 429, data: { message: 'rate limit exceeded' }, headers: {} };
          throw error;
        }
        if (state.githubFailure === 'timeout') {
          throw new Error(`socket timeout ${TOKEN}`);
        }
      }
      if (state.optionalFailure && !isFullRequest) throw new Error('optional deep signal unavailable');

      if (/\/users\/[^/]+$/.test(url)) {
        const username = decodeURIComponent(url.split('/').pop());
        return { data: { login: username, followers: 7, following: 3, public_repos: 10, bio: 'Developer' }, headers: {} };
      }
      if (url.endsWith('/repos')) {
        const username = decodeURIComponent(url.split('/').at(-2));
        return { data: reposFor(username), headers: {} };
      }
      if (url.includes('/languages')) return { data: { JavaScript: 7500, TypeScript: 2500 }, headers: {} };
      if (url.includes('/contributors')) return { data: [{ login: 'developer', contributions: 12 }], headers: {} };
      if (url.includes('/contents/')) {
        const path = decodeURIComponent(url.split('/contents/')[1]);
        const content = path === 'README.md' ? '# Project\nDocumented application.' : '{"dependencies":{"react":"latest","express":"latest"}}';
        return { data: { encoding: 'base64', content: Buffer.from(content).toString('base64') }, headers: {} };
      }
      if (url.includes('/commits')) return { data: [], headers: {} };
      throw new Error(`Unexpected mocked GitHub URL: ${url}`);
    }
  };

  const aiService = {
    async runAIAnalysis(_prompt, fallback) {
      state.counters.ai += 1;
      await delay(state.delays.ai);
      if (state.aiMode === 'timeout') return fallback;
      if (state.aiMode === 'malformed') return { malformed: '{not-json' };
      return {
        strengths: ['Consistent delivery'],
        weakAreas: ['Add more tests'],
        summary: 'Deterministic mocked narrative.',
        explanation: 'Evidence-based mocked explanation.',
        scores: { healthScore: 999 }
      };
    },
    async invalidateCachePrefix() {}
  };

  const GitHubAnalysisCache = {
    collection: { async indexes() { return []; }, async dropIndex() {}, async createIndex() {} },
    findOne(query) {
      state.counters.cache.reads += 1;
      return thenable(state.cache.get(`${query.normalizedUsername}:${query.analysisVersion}`) || null);
    },
    findOneAndUpdate(query, update) {
      state.counters.cache.writes += 1;
      const key = `${query.normalizedUsername}:${query.analysisVersion}`;
      const previous = state.cache.get(key);
      const snapshots = [...(previous?.snapshots || []), ...copy(update.$push.snapshots.$each)].slice(-12);
      const row = { ...(previous || {}), ...copy(update.$set), snapshots, createdAt: previous?.createdAt || new Date(), updatedAt: new Date() };
      state.cache.set(key, row);
      return thenable(row);
    }
  };

  const Repository = {
    async bulkWrite(operations) {
      state.counters.persistence.jobs += 1;
      state.counters.persistence.repositoryUpserts += operations.length;
      await delay(state.delays.persistence);
      if (state.repositoryFailure) throw new Error('required repository upsert failed');
      for (const operation of operations) {
        const { filter, update } = operation.updateOne;
        state.repositories.set(`${filter.ownerId}:${filter.repoName}`, { ...copy(update.$setOnInsert), ...copy(update.$set) });
      }
    },
    async deleteMany(query) {
      state.counters.persistence.staleDeletes += 1;
      const keep = new Set(query.repoName?.$nin || []);
      for (const [key, row] of state.repositories) {
        if (String(row.ownerId) === String(query.ownerId) && (!query.repoName || !keep.has(row.repoName))) state.repositories.delete(key);
      }
    }
  };

  class Analysis {
    constructor(data) {
      Object.assign(this, data, { githubAnalysisHistory: [], contributionActivity: [] });
    }
    static findOne(query) {
      state.counters.persistence.analysisFinds += 1;
      return Promise.resolve(state.analyses.get(String(query.userId)) || null);
    }
    async save() {
      state.counters.persistence.analysisSaves += 1;
      state.counters.persistence.historyUpdates += 1;
      await delay(state.delays.persistence);
      state.analyses.set(String(this.userId), this);
      return this;
    }
  }

  const User = {
    async findByIdAndUpdate(id, update) {
      state.counters.persistence.userUpdates += 1;
      state.users.set(String(id), { ...(state.users.get(String(id)) || {}), ...copy(update) });
    },
    findById(id) {
      const row = state.users.get(String(id)) || null;
      return { select: async () => copy(row) };
    }
  };

  const GitHubSaveLock = {
    findOneAndUpdate(query, update) {
      state.counters.locks.mongoAcquire += 1;
      const key = query._id;
      const existing = state.mongoLocks.get(key);
      const available = !existing || new Date(existing.expiresAt).getTime() <= Date.now();
      if (available) state.mongoLocks.set(key, copy(update.$set));
      return thenable(available ? { _id: key, ...copy(update.$set) } : null);
    },
    async deleteOne(query) {
      state.counters.locks.mongoRelease += 1;
      const existing = state.mongoLocks.get(query._id);
      if (existing?.ownerToken === query.ownerToken) state.mongoLocks.delete(query._id);
    }
  };

  const redisService = {
    isRedisCacheEnabled: () => state.redisHealthy,
    async acquireCacheLock(key, token) {
      state.counters.locks.redisAcquire += 1;
      if (!state.redisHealthy) return null;
      if (state.redisLocks.has(key)) return false;
      state.redisLocks.set(key, token);
      return true;
    },
    async releaseCacheLock(key, token) {
      state.counters.locks.redisRelease += 1;
      if (state.redisLocks.get(key) === token) state.redisLocks.delete(key);
    }
  };

  const mocks = {
    axios,
    './aiservice': aiService,
    '../prompts/githubPrompt': { getGitHubPrompt: () => 'sanitized deterministic prompt' },
    './platformSettingsService': { getIntegrationSecretsSync: () => ({ githubEnabled: true }) },
    './redisCacheService': redisService,
    '../services/redisCacheService': redisService,
    '../models/githubAnalysisCache': GitHubAnalysisCache,
    '../models/analysisCache': { async deleteMany() { return { deletedCount: 0 }; } },
    '../models/repository': Repository,
    '../models/analysis': Analysis,
    '../models/user': User,
    '../models/githubSaveLock': GitHubSaveLock,
    '../services/notificationService': {
      async createNotification(payload) {
        state.counters.notifications += 1;
        state.notifications.push(copy(payload));
        return payload;
      }
    },
    './dashboardcontroller': {
      invalidateDashboardSummaryCache() { state.counters.invalidations += 1; }
    }
  };

  const loadInstance = () => {
    delete require.cache[servicePath];
    delete require.cache[controllerPath];
    const originalLoad = Module._load;
    Module._load = function mockedLoad(request, parent, isMain) {
      if (Object.prototype.hasOwnProperty.call(mocks, request)) return mocks[request];
      return originalLoad.call(this, request, parent, isMain);
    };
    try {
      const service = require(servicePath);
      mocks['../services/githubservice'] = service;
      delete require.cache[controllerPath];
      const controller = require(controllerPath);
      return { service, controller };
    } finally {
      Module._load = originalLoad;
    }
  };

  const reset = () => {
    state.counters = freshCounters();
    state.cache.clear();
    state.repositories.clear();
    state.analyses.clear();
    state.users.clear();
    state.notifications.length = 0;
    state.redisLocks.clear();
    state.mongoLocks.clear();
    state.redisHealthy = true;
    state.repositoryFailure = false;
    state.githubFailure = null;
    state.optionalFailure = false;
    state.aiMode = 'success';
    state.delays = { github: 2, ai: 2, persistence: 2 };
    state.logs.length = 0;
  };

  return { state, loadInstance, reset };
};

const invoke = async (handler, { username = 'octocat', userId = 'user-1', savedUsername = username, forceRefresh = false } = {}) => {
  const response = { statusCode: 200, body: undefined, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  const req = {
    body: { username, ...(forceRefresh ? { forceRefresh: true } : {}) },
    query: {},
    user: { _id: userId, githubUsername: savedUsername, activeGithubUsername: savedUsername }
  };
  await handler(req, response);
  return response;
};

const scoreSnapshot = (result) => copy({ scores: result.scores, githubHealthScore: result.githubHealthScore, activityScore: result.activityScore });
const assertScores = (result) => {
  for (const value of [...Object.values(result.scores || {}), result.githubHealthScore, result.activityScore]) {
    assert.equal(Number.isFinite(value), true);
    assert.ok(value >= 0 && value <= 100);
  }
};
const percentile = (values, percentileValue) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1)];
};

test('fresh analysis, cache hit, concurrency, force refresh, and username isolation', async () => {
  const harness = createHarness();
  const { state } = harness;
  const { service } = harness.loadInstance();
  const first = await service.analyzeGitHubProfile('Alpha');
  assert.equal(state.counters.github.profile, 1);
  assert.equal(state.counters.github.repositories, 1);
  assert.ok(state.counters.github.contributors <= 5);
  assert.ok(state.counters.github.languages <= 8);
  assert.ok(state.counters.github.content <= 12);
  assert.equal(state.counters.ai, 1);
  assertScores(first);

  const githubAfterFresh = copy(state.counters.github);
  const second = await service.analyzeGitHubProfile('alpha');
  assert.equal(second.cache.hit, true);
  assert.deepEqual(state.counters.github, githubAfterFresh);
  assert.equal(state.counters.ai, 1);

  harness.reset();
  const concurrent = await Promise.all(Array.from({ length: 5 }, () => service.analyzeGitHubProfile('Bravo')));
  assert.equal(state.counters.github.profile, 1);
  assert.equal(state.counters.github.repositories, 1);
  assert.equal(state.counters.ai, 1);
  assert.ok(concurrent.every((result) => result === concurrent[0]));

  const beforeRefresh = copy(state.counters.github);
  const aiBeforeRefresh = state.counters.ai;
  const refreshed = await Promise.all(Array.from({ length: 5 }, () => service.analyzeGitHubProfile('Bravo', { forceRefresh: true })));
  assert.equal(state.counters.github.profile - beforeRefresh.profile, 1);
  assert.equal(state.counters.github.repositories - beforeRefresh.repositories, 1);
  assert.equal(state.counters.ai - aiBeforeRefresh, 1);
  assert.ok(refreshed.every((result) => result === refreshed[0]));

  harness.reset();
  const [alpha, beta] = await Promise.all([service.analyzeGitHubProfile('alpha'), service.analyzeGitHubProfile('beta')]);
  assert.equal(state.counters.github.profile, 2);
  assert.equal(state.counters.ai, 2);
  assert.notEqual(alpha.repositories[0].name, beta.repositories[0].name);
});

const runCrossInstanceSave = async (redisHealthy) => {
  const harness = createHarness();
  const { state } = harness;
  state.redisHealthy = redisHealthy;
  state.delays = { github: 4, ai: 4, persistence: 4 };
  const first = harness.loadInstance();
  const second = harness.loadInstance();
  const handlers = [first.controller, second.controller, first.controller, second.controller, first.controller];
  const responses = await Promise.all(handlers.map(({ analyzeAndSaveGitHubProfile }) => invoke(analyzeAndSaveGitHubProfile, { username: 'shared', savedUsername: 'shared' })));
  assert.ok(responses.every((response) => response.statusCode === 200));
  assert.equal(state.counters.github.profile, 1);
  assert.equal(state.counters.github.repositories, 1);
  assert.equal(state.counters.ai, 1);
  assert.equal(state.counters.persistence.jobs, 1);
  assert.equal(state.counters.persistence.analysisSaves, 1);
  assert.equal(state.counters.persistence.historyUpdates, 1);
  assert.equal(state.counters.persistence.userUpdates, 1);
  assert.equal(state.counters.notifications, 1);
  assert.equal(state.counters.invalidations, 1);
  assert.equal(state.repositories.size, 10);
  assert.equal(state.analyses.get('user-1').githubAnalysisHistory.length, 1);
  assert.ok(responses.every((response) => response.body.githubHealthScore === responses[0].body.githubHealthScore));
  if (redisHealthy) {
    assert.ok(state.counters.locks.redisAcquire >= 2);
    assert.equal(state.counters.locks.mongoAcquire, 0);
  } else {
    assert.ok(state.counters.locks.mongoAcquire >= 2);
    assert.equal(state.counters.locks.redisAcquire, 0);
  }
  return { counters: state.counters, repositoryCount: state.repositories.size };
};

test('two instances deduplicate analyze-save with Redis authority', async () => {
  await runCrossInstanceSave(true);
});

test('two instances deduplicate analyze-save with Mongo fallback authority', async () => {
  await runCrossInstanceSave(false);
});

test('repository failure preserves old rows and prevents later commits', async () => {
  const harness = createHarness();
  const { state } = harness;
  const { controller } = harness.loadInstance();
  state.repositories.set('user-1:legacy', { ownerId: 'user-1', repoName: 'legacy', stars: 99 });
  state.repositoryFailure = true;
  const response = await invoke(controller.analyzeAndSaveGitHubProfile, { username: 'failure', savedUsername: 'failure' });
  assert.equal(response.statusCode, 500);
  assert.equal(state.counters.persistence.staleDeletes, 0);
  assert.equal(state.counters.persistence.analysisSaves, 0);
  assert.equal(state.counters.notifications, 0);
  assert.equal(state.counters.invalidations, 0);
  assert.equal(state.repositories.get('user-1:legacy').stars, 99);
});

test('AI timeout and malformed output preserve deterministic scoring', async () => {
  for (const mode of ['timeout', 'malformed']) {
    const harness = createHarness();
    harness.state.aiMode = mode;
    const { service } = harness.loadInstance();
    const result = await service.analyzeGitHubProfile(`ai-${mode}`);
    assertScores(result);
    assert.equal(harness.state.counters.ai, 1);
    assert.notEqual(result.githubHealthScore, 999);
    assert.equal(result.githubHealthScore, result.scores.healthScore);
    assert.match(result.summary, /Rule-based|Deterministic|unavailable/i);
  }
});

test('GitHub optional and full failures are sanitized and never cached', async () => {
  const originalToken = process.env.GITHUB_TOKEN;
  process.env.GITHUB_TOKEN = TOKEN;
  try {
    const optionalHarness = createHarness();
    optionalHarness.state.optionalFailure = true;
    const optional = optionalHarness.loadInstance();
    const optionalResult = await optional.service.analyzeGitHubProfile('optional');
    assert.equal(optionalResult.repoCount, 10);
    assertScores(optionalResult);

    for (const [failure, expectedStatus, expectedText] of [['404', 404, /not found/i], ['429', 429, /rate limit/i], ['timeout', 500, /failed to fetch/i]]) {
      const harness = createHarness();
      harness.state.githubFailure = failure;
      const { controller } = harness.loadInstance();
      const originalError = console.error;
      console.error = (...args) => harness.state.logs.push(args.join(' '));
      let response;
      try { response = await invoke(controller.analyzeGitHub, { username: `full-${failure}` }); }
      finally { console.error = originalError; }
      assert.equal(response.statusCode, expectedStatus);
      assert.match(response.body.message, expectedText);
      assert.equal(harness.state.counters.cache.writes, 0);
      const captured = JSON.stringify({ response: response.body, cache: [...harness.state.cache.values()], logs: harness.state.logs });
      assert.equal(captured.includes(TOKEN), false);
    }
  } finally {
    if (originalToken === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = originalToken;
  }
});

test('preview mode is side-effect free and save rejects mismatched usernames', async () => {
  const harness = createHarness();
  const { state } = harness;
  const { controller } = harness.loadInstance();
  const preview = await invoke(controller.analyzeGitHub, { username: 'preview' });
  assert.equal(preview.statusCode, 200);
  assert.deepEqual(state.counters.persistence, freshCounters().persistence);
  assert.equal(state.counters.notifications, 0);
  assert.equal(state.counters.invalidations, 0);
  const mismatch = await invoke(controller.analyzeAndSaveGitHubProfile, { username: 'other', savedUsername: 'saved' });
  assert.equal(mismatch.statusCode, 400);
  assert.equal(state.counters.persistence.jobs, 0);
});

test('deterministic timing benchmark', async (t) => {
  const previousTiming = process.env.GITHUB_TIMING;
  process.env.GITHUB_TIMING = '1';
  const harness = createHarness();
  const { state } = harness;
  state.delays = { github: 1, ai: 1, persistence: 1 };
  const { service, controller } = harness.loadInstance();
  const timings = { fresh: [], cache: [], forceRefresh: [], save: [] };
  const measure = async (bucket, operation) => {
    const start = performance.now();
    await operation();
    timings[bucket].push(performance.now() - start);
  };
  try {
    for (let index = 0; index < 5; index += 1) {
      const username = `benchmark-${index}`;
      await measure('fresh', () => service.analyzeGitHubProfile(username));
      await measure('cache', () => service.analyzeGitHubProfile(username));
      await measure('forceRefresh', () => service.analyzeGitHubProfile(username, { forceRefresh: true }));
      await measure('save', () => invoke(controller.analyzeAndSaveGitHubProfile, { username, savedUsername: username, userId: `benchmark-user-${index}` }));
    }
    assert.ok(percentile(timings.cache, 95) < 300);
    assert.ok(percentile(timings.save, 95) < 500);
    t.diagnostic(`TIMING fresh p50=${percentile(timings.fresh, 50).toFixed(1)}ms p95=${percentile(timings.fresh, 95).toFixed(1)}ms`);
    t.diagnostic(`TIMING cache p50=${percentile(timings.cache, 50).toFixed(1)}ms p95=${percentile(timings.cache, 95).toFixed(1)}ms`);
    t.diagnostic(`TIMING forceRefresh p50=${percentile(timings.forceRefresh, 50).toFixed(1)}ms p95=${percentile(timings.forceRefresh, 95).toFixed(1)}ms`);
    t.diagnostic(`TIMING analyze-save p50=${percentile(timings.save, 50).toFixed(1)}ms p95=${percentile(timings.save, 95).toFixed(1)}ms`);
    t.diagnostic(`COUNTS GitHub=${Object.values(state.counters.github).reduce((sum, value) => sum + value, 0)} AI=${state.counters.ai} persistence=${state.counters.persistence.jobs}`);
  } finally {
    if (previousTiming === undefined) delete process.env.GITHUB_TIMING;
    else process.env.GITHUB_TIMING = previousTiming;
  }
});
