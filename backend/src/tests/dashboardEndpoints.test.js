const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const jwt = require('jsonwebtoken');
const { performance } = require('node:perf_hooks');
const crypto = require('node:crypto');

const at = '2026-11-10T12:00:00.000Z';
const calls = [];
let failure = '';
let insightFailure = false;
let coverage = null;
let portfolioScore = 0;
let hasAnalysis = false;
let unstable = false;
let legacy = false;
let integrationTimeout = false;
const user = {
  _id: 'owner',
  name: 'Test Developer',
  githubUsername: 'dev',
  careerStack: 'Backend',
  experienceLevel: 'Student',
};
const chain = (value) => ({
  select(projection) {
    calls.at(-1).projection = projection;
    return this;
  },
  sort(sort) {
    calls.at(-1).sort = sort;
    return this;
  },
  limit() {
    return this;
  },
  lean: async () => value,
  then(resolve, reject) {
    return Promise.resolve(value).then(resolve, reject);
  },
});
const mock = (path, value) => {
  const id = require.resolve(path);
  require.cache[id] = { id, filename: id, loaded: true, exports: value };
};
const query = (model, filter, value) => {
  calls.push({ model, filter });
  if (failure === model) throw new Error('fixture storage unavailable');
  return chain(value);
};
mock('../models/user', {
  findById: (id) => query('User', { _id: id }, id === 'gone' ? null : { ...user, _id: id }),
});
mock('../models/analysis', {
  findOne: (filter) =>
    query(
      'Analysis',
      filter,
      hasAnalysis
        ? {
            userId: filter.userId,
            githubSignals: legacy ? {} : { username: 'dev' },
            githubScore: 80,
            readinessScore: 70,
            updatedAt: at,
            githubStats: { repos: 3 },
            languageDistribution: { TypeScript: 100 },
            contributionActivity: [{ month: 'Nov', count: 4 }],
          }
        : null,
    ),
});
const cacheValue = (filter) =>
  filter['analysisData.portfolioScore.overallScore']
    ? { analysisData: { portfolioScore: { overallScore: portfolioScore } }, updatedAt: at }
    : filter['analysisData.projects']
      ? null
      : { analysisData: { coverage, yourSkills: [], missingSkills: [] }, updatedAt: at };
mock('../models/analysisCache', {
  findOne: (filter) => query('AnalysisCache', filter, cacheValue(filter)),
  aggregate: (pipeline) => ({
    option: async () => [
      {
        ...Object.fromEntries(
          Object.entries(pipeline[1].$facet).map(([key, stages]) => {
            if (unstable) coverage = (coverage || 0) + 1;
            const filter = stages[0].$match;
            query('AnalysisCache', filter, null);
            const value = cacheValue(filter);
            return [key, value ? [value] : []];
          }),
        ),
      },
    ],
  }),
});
for (const [model, method, value] of [
  ['weeklyReport', 'findOne', null],
  ['careerSprint', 'findOne', null],
  ['jobCache', 'findOne', null],
  ['news', 'findOne', null],

  ['recommendation', 'find', []],

  ['integrationConnection', 'find', []],
])
  mock('../models/' + model, { [method]: (filter) => query(model, filter, value) });
mock('../models/userCourseProgress', {
  aggregate: () => ({ option: async () => [{ counts: [], recent: [] }] }),
  find: (filter) => query('userCourseProgress', filter, []),
});
const integrationLogSchema = require('../models/integrationSyncLog').schema;
mock('../models/integrationSyncLog', {
  schema: integrationLogSchema,
  aggregate: (pipeline) => ({
    option: async () => {
      if (integrationTimeout) {
        const error = new Error('Query timed out');
        error.code = 50;
        throw error;
      }
      query('integrationSyncLog', pipeline[0].$match, []);
      return [];
    },
  }),
});
mock('../services/developerContextService', {
  resolveGithubUsername: (row) => row?.activeGithubUsername || row?.githubUsername,
  resolveCareerStack: (row) => row?.careerStack,
  resolveExperienceLevel: (row) => row?.experienceLevel,
  loadUser: async () => user,
  resolveResumeAnalysis: async () => null,
});
mock('../services/developerSignalService', {
  getDeveloperSignals: async () => ({ skillGapSignals: { coverage } }),
  buildSignalHash: (value) =>
    crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'),
  buildResumeCacheIdentity: () => ({ resumeHash: 'no-resume', resumeAnalysisId: 'no-resume' }),
});
mock('../services/integrationInsightService', {
  getIntegrationInsight: async () => {
    if (insightFailure) throw new Error('fixture insight unavailable');
    return {
      integrationScore: 50,
      providers: [{ provider: 'github' }],
      mergedSkills: [],
      updatedAt: at,
    };
  },
});
const controller = require('../controllers/dashboardcontroller');
const endpoints = [
  'summary',
  'contributions',
  'languages',
  'skills',
  'recommendations',
  'integration-analytics',
];
let server;
let base;
let token;
const previousSecret = process.env.JWT_SECRET;
test.before(async () => {
  process.env.JWT_SECRET = 'dashboard-test-only-secret';
  token = jwt.sign({ id: 'owner' }, process.env.JWT_SECRET, {
    issuer: 'devinsight-api',
    audience: 'devinsight-web',
    expiresIn: '1h',
  });
  const app = express();
  app.use('/dashboard', require('../routes/dashboard.routes'));
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}/dashboard`;
});
test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});
test.beforeEach((t) => {
  t.mock.method(console, 'error', () => {});
  t.mock.method(console, 'warn', () => {});
  calls.length = 0;
  failure = '';
  insightFailure = false;
  coverage = null;
  portfolioScore = 0;
  hasAnalysis = false;
  unstable = false;
  legacy = false;
  integrationTimeout = false;
});
const request = (endpoint, headers = {}) =>
  fetch(`${base}/${endpoint}`, { headers: { Authorization: `Bearer ${token}`, ...headers } });

test('all six routes reject missing and invalid authentication before data retrieval', async () => {
  for (const endpoint of endpoints) {
    assert.equal((await fetch(`${base}/${endpoint}`)).status, 401);
    assert.equal((await request(endpoint, { Authorization: 'Bearer invalid' })).status, 401);
  }
  assert.equal(calls.length, 0);
});

test('all six authenticated endpoints preserve response contracts and scope owned reads to the authenticated user', async () => {
  const keys = [
    ['readinessScore', 'skillsSnapshot', 'sourceFreshness'],
    ['data', 'syncStatus'],
    ['data', 'source'],
    ['topSkills', 'coveragePercentage'],
    ['items', 'syncStatus'],
    ['days', 'cards'],
  ];
  for (const [index, endpoint] of endpoints.entries()) {
    const response = await request(endpoint + '?userId=someone-else');
    assert.equal(response.status, 200, endpoint);
    const body = await response.json();
    for (const key of keys[index]) assert.ok(Object.hasOwn(body, key), `${endpoint}.${key}`);
  }
  for (const call of calls) {
    if (
      [
        'Analysis',
        'AnalysisCache',
        'weeklyReport',
        'careerSprint',
        'userCourseProgress',
        'recommendation',
        'integrationSyncLog',
        'integrationConnection',
      ].includes(call.model)
    )
      assert.equal(call.filter.userId, 'owner', call.model);
  }
  const news = calls.find((call) => call.model === 'news');
  assert.equal(news.filter.cacheKey, 'news:v3:public:pool');
  assert.equal(news.projection, 'trendingTopics lastUpdated updatedAt');
  const portfolio = calls.find(
    (call) =>
      call.model === 'AnalysisCache' &&
      call.filter['analysisData.portfolioScore.overallScore'] &&
      !call.filter.updatedAt,
  );
  assert.equal(portfolio.filter.resumeHash, 'no-resume');
  assert.equal(portfolio.filter.resumeAnalysisId, 'no-resume');
  const job = calls.find((call) => call.model === 'jobCache');
  assert.equal(job.filter.hidden.$ne, true);
  assert.ok(job.filter.freshUntil.$gt instanceof Date);
});

test('expired sessions, deleted users and authentication storage outages fail closed', async () => {
  const sign = (id, expiresIn) =>
    jwt.sign({ id }, process.env.JWT_SECRET, {
      issuer: 'devinsight-api',
      audience: 'devinsight-web',
      expiresIn,
    });
  assert.equal(
    (await request('summary', { Authorization: 'Bearer ' + sign('owner', '-1s') })).status,
    401,
  );
  assert.equal(
    (await request('summary', { Authorization: 'Bearer ' + sign('gone', '1h') })).status,
    401,
  );
  failure = 'User';
  assert.equal((await request('summary')).status, 503);
});

test('missing GitHub evidence stays missing and undated; a measured zero portfolio score is not replaced by 70 or 80', async () => {
  let body = await (await request('summary')).json();
  assert.equal(body.sourceFreshness.github.available, false);
  assert.equal(body.sourceFreshness.github.status, 'missing');
  assert.equal(body.sourceFreshness.github.lastUpdated, null);
  assert.equal(body.skillsSnapshot.coveragePercentage, null);
  hasAnalysis = true;
  body = await (await request('summary')).json();
  assert.equal(body.readinessScore, 8); // Existing 85/15 blend, base evidence is exactly zero.
  assert.equal(body.scoreChangeFromLastMonth, null); // Expiring caches are not durable history.
});

test('summary supports strong, weak, list and wildcard validators without caching private responses publicly', async () => {
  const first = await request('summary');
  const etag = first.headers.get('etag');
  assert.ok(etag);
  assert.equal(first.headers.get('cache-control'), 'private, no-cache');
  for (const validator of [etag, `W/${etag}`, `"other", ${etag}`, '*']) {
    const response = await request('summary', { 'If-None-Match': validator });
    assert.equal(response.status, 304);
    assert.equal(await response.text(), '');
  }
  assert.equal((await request('summary', { 'If-None-Match': '"different"' })).status, 200);
});

test('new upstream measurements immediately change the summary and validator, including zero and explicit null', async () => {
  const first = await request('summary');
  const etag = first.headers.get('etag');
  coverage = 0;
  controller.invalidateDashboardSummaryCache('owner');
  const next = await request('summary', { 'If-None-Match': etag });
  assert.equal(next.status, 200);
  assert.notEqual(next.headers.get('etag'), etag);
  assert.equal((await next.json()).skillsSnapshot.coveragePercentage, 0);
  coverage = null;
  assert.equal((await (await request('skills')).json()).coveragePercentage, null);
});

test('integration failure degrades explicitly; required evidence storage failure returns 500 for every endpoint', async () => {
  insightFailure = true;
  const body = await (await request('summary')).json();
  assert.equal(body.sourceFreshness.integrations.available, false);
  assert.equal(body.sourceFreshness.integrations.status, 'missing');
  for (const endpoint of endpoints) {
    failure = {
      summary: 'AnalysisCache',
      contributions: 'Analysis',
      languages: 'Analysis',
      skills: 'Analysis',
      recommendations: 'recommendation',
      'integration-analytics': 'integrationSyncLog',
    }[endpoint];
    assert.equal((await request(endpoint)).status, 500, endpoint);
  }
});

test('analytics rejects invalid day windows instead of querying with Invalid Date', async () => {
  for (const value of ['nope', '0', '-1', '31', '1.5', 'Infinity'])
    assert.equal((await request('integration-analytics?days=' + value)).status, 400);
  assert.equal((await request('integration-analytics?days=30')).status, 200);
});

test('language percentages remain finite, nonnegative and total 100 for tiny buckets', () => {
  const result = controller.__test.normalizeLanguageMap({
    bad: Infinity,
    ...Object.fromEntries(Array.from({ length: 201 }, (_, index) => ['L' + index, 1])),
  });
  assert.equal(
    Object.values(result).reduce((sum, value) => sum + value, 0),
    100,
  );
  assert.ok(Object.values(result).every((value) => Number.isFinite(value) && value >= 0));
});

test('concurrent fixture HTTP summaries remain isolated and deterministic (not a real-database SLO test)', async () => {
  const start = performance.now();
  const responses = await Promise.all(Array.from({ length: 20 }, () => request('summary')));
  const payloads = await Promise.all(responses.map((response) => response.json()));
  assert.ok(responses.every((response) => response.status === 200));
  assert.equal(new Set(payloads.map((body) => JSON.stringify(body))).size, 1);
  console.log(
    JSON.stringify({
      fixtureConcurrency: 20,
      elapsedMs: Math.round(performance.now() - start),
      summaryBytes: Buffer.byteLength(JSON.stringify(payloads[0])),
      measurement: 'loopback HTTP, mocked database and developer signals',
    }),
  );
});

test('unstable source reads return retryable 409 without publishing a successful summary', async () => {
  unstable = true;
  const response = await request('summary');
  assert.equal(response.status, 409);
  assert.equal(response.headers.get('retry-after'), '1');
  assert.equal((await response.json()).code, 'DASHBOARD_EVIDENCE_CHANGED');
});
test('legacy GitHub evidence with unknown username stays unverified rather than measured zero', async () => {
  legacy = true;
  hasAnalysis = true;
  const body = await (await request('summary')).json();
  assert.equal(body.sourceFreshness.github.available, false);
  assert.equal(body.repositories, null);
  assert.deepEqual(body.activitySnapshot.data, []);
});
test('integration aggregation budget exhaustion returns unavailable, not truncated counts', async () => {
  integrationTimeout = true;
  assert.equal((await request('integration-analytics')).status, 503);
});
