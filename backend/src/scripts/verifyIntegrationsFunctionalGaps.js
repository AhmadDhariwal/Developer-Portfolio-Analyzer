'use strict';
// Opt-in isolated gap verification. Only Dev.to author metadata is fetched live once.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { startMongo } = require('./verifyIntegrationsRealProviders');
const mongoose = require('mongoose');
const express = require('express');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const cache = require('../services/redisCacheService');
const governance = require('../services/integrationGovernanceService');
const persistence = require('../services/integrationPersistenceService');
const sync = require('../services/integrationSyncService');
const { getAdapter } = require('../services/integrations');
const User = require('../models/user');
const Connection = require('../models/integrationConnection');
const Insight = require('../models/integrationInsight');
const Log = require('../models/integrationSyncLog');
const Linked = require('../models/integrationLinkedProfile');
const evidenceRoot = path.resolve(__dirname, '../../verification/integrations');
const replay = process.argv.includes('--replay-devto');
const outputOverride = process.argv.find((arg) => arg.startsWith('--output='))?.slice(9);
if (outputOverride) assert.match(outputOverride, /^[a-z0-9-]+\.json$/);
const output = path.join(
  evidenceRoot,
  outputOverride ||
    (replay ? 'functional-gaps-verified-2026-10-27.json' : 'functional-gaps-2026-10-27.json')
);
const read = (name) => JSON.parse(fs.readFileSync(path.join(evidenceRoot, name), 'utf8'));
const capturedDevto = replay ? read('functional-gaps-2026-10-27.json').liveRequests[0] : null;
const result = {
  checkedAt: new Date().toISOString(),
  applicationDatabaseUsed: false,
  liveRequests: [],
  checks: {},
  api: []
};
const source = read('kaggle-attribution-diagnostic-2026-10-27.json');
const leetcode = read('real-provider-live-followup.json').providers.find(
  (row) => row.provider === 'leetcode'
);
const kaggle = getAdapter('kaggle');
const blogs = getAdapter('devblogs');
const originalKaggle = kaggle.ingestData;
const originalBlogs = blogs.ingestData;
const originalBlogGet = blogs.get;
const kaggleResources = require('../services/integrations/kaggleResources');
const originalResourcePost = kaggleResources.post;
let runtime,
  server,
  liveAllowed = !replay;
const requestInterceptor = axios.interceptors.request.use((config) => {
  if (String(config.url).startsWith('https://')) {
    assert.equal(config.url, 'https://dev.to/api/articles?username=swyx&per_page=30');
    assert.ok(liveAllowed, 'No repeated provider reads');
    liveAllowed = false;
  }
  return config;
});
const responseInterceptor = axios.interceptors.response.use((response) => {
  if (String(response.config.url).startsWith('https://dev.to/')) {
    result.liveRequests.push({
      url: response.config.url,
      status: response.status,
      articles: response.data.map((row) => ({
        id: row.id,
        title: row.title,
        author: row.user?.username,
        tags: row.tag_list,
        reactions: row.positive_reactions_count ?? row.public_reactions_count,
        publishedAt: row.published_at || row.published_timestamp,
        ...(row.page_views_count !== undefined ? { views: row.page_views_count } : {})
      }))
    });
  }
  return response;
});
async function main() {
  assert.ok(!fs.existsSync(output), 'Keep existing evidence; do not repeat completed acceptance');
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
  for (const key of [
    'GITHUB_TOKEN',
    'GROQ_API_KEY',
    'OPENAI_API_KEY',
    'GEMINI_API_KEY',
    'ANTHROPIC_API_KEY',
    'OPENROUTER_API_KEY',
    'SENDGRID_API_KEY',
    'SMTP_PASS'
  ])
    delete process.env[key];
  assert.ok(await cache.initRedisCache({ silent: true, probeOnly: true }));
  const redis = cache.getRedisCacheClient({ commandTimeoutMs: 1000 });
  assert.equal(await redis.ping(), 'PONG');
  result.checks.upstashPing = 'PASS';
  runtime = await startMongo();
  await mongoose.connect(runtime.uri, { autoIndex: false });
  for (const model of [User, Connection, Insight, Log, Linked]) await model.createCollection();
  await Connection.collection.createIndex({ userId: 1, provider: 1 }, { unique: true });
  await Insight.collection.createIndex({ userId: 1 }, { unique: true });
  await Linked.collection.createIndex({ userId: 1, provider: 1 }, { unique: true });
  const owners = [
    new mongoose.Types.ObjectId(),
    new mongoose.Types.ObjectId(),
    new mongoose.Types.ObjectId()
  ];
  for (const owner of owners)
    await User.collection.insertOne({
      _id: owner,
      name: 'Disposable acceptance user',
      isActive: true,
      role: 'developer',
      careerStack: 'Frontend',
      activeCareerStack: 'Frontend',
      experienceLevel: 'Mid-level',
      activeExperienceLevel: 'Mid-level',
      notifications: { weeklyScoreReport: false }
    });
  const auth = owners.map((owner) =>
    jwt.sign({ id: String(owner) }, process.env.JWT_SECRET, {
      issuer: process.env.JWT_ISSUER || 'devinsight-api',
      audience: process.env.JWT_AUDIENCE || 'devinsight-web',
      expiresIn: '10m'
    })
  );
  require('../services/aiservice').runAIAnalysis = async (_prompt, fallback) => fallback;
  const app = express();
  app.use(express.json());
  for (const [prefix, route] of [
    ['integrations', 'integrations.routes'],
    ['dashboard', 'dashboard.routes'],
    ['simulator', 'scenarioSimulator.routes'],
    ['career-sprint', 'careerSprint.routes'],
    ['weekly-reports', 'weeklyReport.routes'],
    ['analysis', 'analysis.routes'],
    ['skillgap', 'skillGap.routes']
  ])
    app.use('/api/' + prefix, require('../routes/' + route));
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port + '/api/';
  async function call(index, method, endpoint, body, expected = 200) {
    const response = await fetch(origin + endpoint, {
      method,
      headers: { Authorization: 'Bearer ' + auth[index], 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    const data = await response.json();
    result.api.push({ owner: index, method, endpoint, status: response.status });
    assert.equal(response.status, expected, endpoint + ': ' + response.status);
    return data;
  }
  if (replay) {
    result.devtoSourceEvidence = 'functional-gaps-2026-10-27.json';
    blogs.get = async () =>
      capturedDevto.articles.map((row) => ({
        id: row.id,
        title: row.title,
        user: { username: row.author },
        tag_list: row.tags,
        positive_reactions_count: row.reactions,
        published_at: row.publishedAt,
        ...(row.views === undefined ? {} : { page_views_count: row.views })
      }));
  }
  // Fresh Dev.to read fills the older sanitized evidence's missing author field.
  await call(2, 'POST', 'integrations/manual/connect', {
    provider: 'devblogs',
    externalUsername: 'devto@swyx'
  });
  const live = capturedDevto || result.liveRequests[0];
  assert.equal(live.status, 200);
  assert.ok(live.articles.length > 0 && live.articles.length <= 30);
  assert.ok(live.articles.every((row) => row.author?.toLowerCase() === 'swyx'));
  const devInsight = (await call(2, 'GET', 'integrations/insights')).providers.find(
    (row) => row.provider === 'devblogs'
  );
  assert.equal(devInsight.normalized.profile.totalArticles, live.articles.length);
  assert.equal(
    devInsight.normalized.profile.totalReactions,
    live.articles.reduce((sum, row) => sum + row.reactions, 0)
  );
  assert.equal(devInsight.normalized.profile.totalViews, null);
  assert.equal(
    devInsight.normalized.activity.recentArticles[0].publishedAt,
    live.articles[0].publishedAt
  );
  const expectedTags = new Map();
  for (const row of live.articles)
    for (const tag of row.tags || [])
      expectedTags.set(tag.toLowerCase(), (expectedTags.get(tag.toLowerCase()) || 0) + 1);
  assert.deepEqual(
    devInsight.normalized.activity.topTags,
    [...expectedTags]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map((row) => row[0])
  );
  assert.equal(devInsight.ownershipVerified, false);
  const realBlogPayload = {
    provider: 'devblogs',
    ...devInsight.normalized,
    inferredSkills: devInsight.inferredSkills
  };
  blogs.ingestData = async () => realBlogPayload;
  await call(2, 'POST', 'integrations/sync-now', { provider: 'devblogs' });
  assert.equal(await Connection.countDocuments({ userId: owners[2], provider: 'devblogs' }), 1);
  await call(2, 'DELETE', 'integrations/connections/devblogs');
  result.checks.devtoAuthorMetadata = replay
    ? 'PASS: replay of retained one-request author metadata'
    : 'PASS: one fresh request; subsequent sync replays captured normalized observation';
  // A real retained scored provider is the control baseline; no invented scores.
  const attempt = await persistence.beginManual(owners[0], 'leetcode');
  await persistence.connect(
    owners[0],
    'leetcode',
    {
      status: 'connected',
      externalUsername: 'lee215',
      ownershipVerified: false,
      accessToken: '',
      refreshToken: '',
      scopes: ['public_profile'],
      metadata: {},
      lastSyncedAt: new Date(leetcode.persisted.syncedAt)
    },
    leetcode.persisted,
    attempt.oauthAttempt
  );
  const historic = JSON.stringify(await Insight.collection.findOne({ userId: owners[0] }));
  const portfolioBody = {
    username: 'isolated-resource-control',
    githubAnalysis: {
      scores: { codeQuality: 0, skillCoverage: 0, industryReadiness: 0, projectImpact: 0 },
      healthScore: 0,
      repoCount: 0,
      languages: []
    },
    resumeAnalysis: { skills: [], atsScore: 0 }
  };
  async function consumers() {
    const portfolio = await call(0, 'POST', 'analysis/portfolio-score', portfolioBody);
    const dashboard = await call(0, 'GET', 'dashboard/integration-analytics');
    const scenario = (await call(0, 'GET', 'simulator/context')).context;
    const sprint = await call(0, 'GET', 'career-sprint/current');
    const weekly = await call(0, 'POST', 'weekly-reports/generate', { forceRefresh: true });
    const gap = await call(0, 'POST', 'skillgap/skill-gap', {});
    return {
      portfolioInput: portfolio.scoring.evidence.inputs.integration,
      dashboard,
      inferredSkills: scenario.signals?.inferredSkills,
      demonstratedSkills: scenario.signals?.demonstratedSkills,
      sprintProviders: sprint.signalsUsed.integrations.usedProviders,
      weekly: weekly.meta.snapshot.integrations,
      gap: gap.signalsUsed.integrations,
      provenSkills: gap.provenSkills
    };
  }
  const before = await consumers();
  // Replay retained officially fetched resource fields through current extraction/validation.
  kaggleResources.post = async (url) =>
    url.includes('Kernels')
      ? { kernels: structuredClone(source.notebooks.resources) }
      : { datasets: structuredClone(source.datasets.resources) };
  await call(0, 'POST', 'integrations/manual/connect', {
    provider: 'kaggle',
    externalUsername: 'dansbecker'
  });
  const market = await call(0, 'GET', 'integrations/marketplace');
  const card = market.integrations.find((row) => row.provider === 'kaggle');
  assert.equal(card.status, 'connected');
  assert.equal(card.resourceSummary.ownershipVerified, false);
  assert.equal(card.resourceSummary.notebooks, source.notebooks.resources.length);
  assert.equal(card.resourceSummary.datasets, source.datasets.resources.length);
  const resource = (await call(0, 'GET', 'integrations/insights')).publicResources[0];
  assert.equal(resource.ownershipVerified, false);
  assert.equal(resource.evidenceKind, 'public-resources');
  assert.deepEqual(resource.activity.notebooks.resources, source.notebooks.resources);
  assert.deepEqual(resource.activity.datasets.resources, source.datasets.resources);
  const after = await consumers();
  result.kaggleDownstream = {
    before,
    after,
    scoredHistoryUnchanged:
      JSON.stringify(await Insight.collection.findOne({ userId: owners[0] })) === historic
  };
  assert.equal(result.kaggleDownstream.scoredHistoryUnchanged, true);
  for (const field of [
    'portfolioInput',
    'inferredSkills',
    'demonstratedSkills',
    'sprintProviders',
    'provenSkills'
  ])
    assert.deepEqual(after[field], before[field]);
  assert.equal(after.weekly.integrationScore, before.weekly.integrationScore);
  assert.deepEqual(after.weekly.strongestProof, before.weekly.strongestProof);
  assert.ok(after.weekly.connectedProviders.includes('kaggle'));
  assert.equal(after.gap.score, before.gap.score);
  assert.deepEqual(after.gap.providers, before.gap.providers);
  assert.ok(
    after.gap.publicResources?.length === 1,
    'Skill Gap must retain the additive non-scoring resource observation'
  );
  result.kaggleDownstream.dashboardResourceCard =
    after.dashboard.cards.find((row) => row.provider === 'kaggle') || null;
  // Report observed unsupported analytics rather than inventing a resource score.
  if (result.kaggleDownstream.dashboardResourceCard)
    result.checks.dashboardResourceMetrics =
      'FAIL: resource-only connection gets fallback numeric scores/confidence';
  else
    result.checks.dashboardResourceMetrics =
      'PASS: no fabricated scored analytics for resource-only connection';
  assert.deepEqual((await call(1, 'GET', 'integrations/insights')).publicResources, []);
  await call(1, 'DELETE', 'integrations/connections/kaggle');
  assert.equal((await call(0, 'GET', 'integrations/insights')).publicResources.length, 1);
  const sanitizedConnections = await call(0, 'GET', 'integrations/connections');
  assert.ok(!/accessToken|refreshToken|oauthState/.test(JSON.stringify(sanitizedConnections)));
  result.checks.ownerIsolation =
    'PASS: other user reads/disconnect do not reveal or mutate owner observations';
  await Connection.updateOne(
    { userId: owners[0], provider: 'kaggle' },
    { $set: { nextSyncAt: new Date(0) } }
  );
  await sync.syncDueConnections();
  assert.ok(
    (await Connection.findOne({ userId: owners[0], provider: 'kaggle' }).lean()).nextSyncAt >
      new Date()
  );
  result.checks.backgroundSync =
    'PASS: real scheduler, Mongo lease/commit and retained response replay';
  let entered, release;
  const enteredPromise = new Promise((resolve) => (entered = resolve));
  const gate = new Promise((resolve) => (release = resolve));
  kaggle.ingestData = async (connection) => {
    entered();
    await gate;
    return originalKaggle.call(kaggle, connection);
  };
  const inFlight = sync.syncProviderForUser(owners[0], 'kaggle');
  await enteredPromise;
  const duplicate = await sync.syncProviderForUser(owners[0], 'kaggle');
  assert.equal(duplicate.status, 409);
  await call(0, 'DELETE', 'integrations/connections/kaggle');
  release();
  assert.equal((await inFlight).status, 409);
  assert.deepEqual((await call(0, 'GET', 'integrations/insights')).publicResources, []);
  assert.equal(JSON.stringify(await Insight.collection.findOne({ userId: owners[0] })), historic);
  result.checks.concurrentSyncDisconnect =
    'PASS: one lease; disconnected observation cannot be resurrected; scored history unchanged';
  kaggle.ingestData = originalKaggle;
  const oldClient = cache.getRedisCacheClient;
  cache.getRedisCacheClient = () => null;
  try {
    await call(0, 'POST', 'integrations/sync-now', { provider: 'kaggle' }, 503);
    await call(0, 'DELETE', 'integrations/connections/kaggle');
  } finally {
    cache.getRedisCacheClient = oldClient;
  }
  result.checks.controlOutage =
    'PASS: injected Redis unavailability blocks mutation; disconnect remains available';
  blogs.ingestData = originalBlogs;
  const retiredOwner = owners[1];
  const op = await persistence.beginManual(retiredOwner, 'devblogs');
  await persistence.connect(
    retiredOwner,
    'devblogs',
    {
      status: 'connected',
      externalUsername: 'hashnode@writer',
      accessToken: '',
      refreshToken: '',
      ownershipVerified: false,
      metadata: {}
    },
    null,
    op.oauthAttempt
  );
  assert.equal((await sync.syncProviderForUser(retiredOwner, 'devblogs')).ok, false);
  assert.equal(
    (await Connection.findOne({ userId: retiredOwner, provider: 'devblogs' }).lean()).status,
    'connected'
  );
  assert.equal(
    (await Connection.findOne({ userId: retiredOwner, provider: 'devblogs' }).lean()).lastSyncError,
    'Provider sync failed.'
  );
  await assert.rejects(
    getAdapter('hackerrank').ingestData({ externalUsername: 'public-reference' }),
    /unavailable/
  );
  assert.equal(result.liveRequests.length, replay ? 0 : 1);
  result.checks.retiredIngestion =
    'PASS: Hashnode sync and HackerRank extraction rejected without HTTP';
  // Real Upstash admission counters use a unique synthetic provider; no provider quota resets.
  const name = 'acceptance-' + crypto.randomUUID();
  const originalLimit = process.env.INTEGRATION_USER_PROVIDER_REQUESTS_PER_MIN;
  process.env.INTEGRATION_USER_PROVIDER_REQUESTS_PER_MIN = '1';
  let lease;
  try {
    lease = await governance.reserve(name, owners[1], 2000);
    await assert.rejects(
      governance.reserve(name, owners[1], 2000),
      (error) => error.status === 429
    );
  } finally {
    if (lease) await governance.finish(lease);
    if (originalLimit === undefined) delete process.env.INTEGRATION_USER_PROVIDER_REQUESTS_PER_MIN;
    else process.env.INTEGRATION_USER_PROVIDER_REQUESTS_PER_MIN = originalLimit;
  }
  result.checks.sharedAdmission =
    'PASS: real Upstash admission rejects second per-account request; synthetic keys expire normally';
  const cacheKey = 'integrations:functional:' + crypto.randomUUID();
  await redis.set(cacheKey, JSON.stringify({ disposable: true }), { EX: 30 });
  assert.deepEqual(JSON.parse(await redis.get(cacheKey)), { disposable: true });
  result.checks.sharedCache = 'PASS: real Upstash round-trip; task key expires after 30 seconds';
  result.status = Object.values(result.checks).some((value) => String(value).startsWith('FAIL'))
    ? 'FAIL'
    : 'PASS';
}
main()
  .catch((error) => {
    result.status = 'FAIL';
    result.failure = { type: error.name, message: String(error.message).slice(0, 220) };
    process.exitCode = 1;
  })
  .finally(async () => {
    kaggle.ingestData = originalKaggle;
    blogs.ingestData = originalBlogs;
    blogs.get = originalBlogGet;
    kaggleResources.post = originalResourcePost;
    axios.interceptors.request.eject(requestInterceptor);
    axios.interceptors.response.eject(responseInterceptor);
    if (server) await new Promise((resolve) => server.close(resolve));
    await cache.closeRedisCache();
    await mongoose.disconnect();
    if (runtime) result.cleanup = await runtime.stop();
    if (!fs.existsSync(output))
      fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
    console.log(
      JSON.stringify({
        status: result.status,
        checks: result.checks,
        liveRequests: result.liveRequests.length,
        failure: result.failure,
        cleanup: result.cleanup
      })
    );
  });
