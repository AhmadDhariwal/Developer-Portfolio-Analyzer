'use strict';

// Controlled source documents, real MongoDB, actual authenticated routes and Angular.
// No recommendation, Sprint, persistence, auth or signal services are mocked.
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
for (const key of [
  'GROQ_API_KEY',
  'OPENAI_API_KEY',
  'GEMINI_API_KEY',
  'ANTHROPIC_API_KEY',
  'OPENROUTER_API_KEY',
  'SENDGRID_API_KEY',
  'EMAIL_PASS',
  'TWILIO_TOKEN',
])
  process.env[key] = '';
const mongoose = require('mongoose');
const express = require('express');
const jwt = require('jsonwebtoken');
const { chromium } = require('playwright');
const User = require('../models/user');
const ResumeFile = require('../models/resumeFile');
const ResumeAnalysis = require('../models/resumeAnalysis');
const GitHubAnalysisCache = require('../models/githubAnalysisCache');
const AnalysisCache = require('../models/analysisCache');
const Recommendation = require('../models/recommendation');
const CareerSprint = require('../models/careerSprint');
const engine = require('../services/recommendationEngineService');
const signalService = require('../services/developerSignalService');
const controller = require('../controllers/recommendationscontroller');
const aiService = require('../services/aiservice');
const redis = require('../services/redisCacheService');
const output = path.resolve(__dirname, '../../../frontend/verification/recommendations');
const webRoot = path.resolve(__dirname, '../../../frontend/dist/frontend/browser');
const database = `devinsight_rec_e2e_${crypto.randomBytes(6).toString('hex')}`;
const results = {
  controlledSources: true,
  realHttp: true,
  realMongo: true,
  mockedServices: [],
  externalAiDisabledForFailureTest: true,
  database,
  checks: [],
  traces: [],
  browser: [],
  cleanup: {},
};
const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
let server, browser;
const record = (name, detail = {}) => {
  results.checks.push({ name, pass: true, ...detail });
  console.log(`PASS ${name}`);
};
const identity = (result) => result.cacheMetadata.signalHash;
const authoritative = (result) =>
  result.recommendations.map((card) => ({
    id: card.id,
    priority: card.priority,
    evidence: card.evidence,
    reason: card.reason,
  }));
async function connect() {
  await mongoose.connect(uri, { dbName: database, serverSelectionTimeoutMS: 5000 });
}
async function main() {
  assert.ok(uri && process.env.JWT_SECRET, 'MongoDB and JWT configuration are required.');
  await connect();
  assert.equal(
    (await mongoose.connection.db.listCollections().toArray()).length,
    0,
    'Verification database must be newly owned.',
  );
  await Promise.all([
    Recommendation.init(),
    AnalysisCache.init(),
    GitHubAnalysisCache.init(),
    CareerSprint.init(),
  ]);
  const owner = new mongoose.Types.ObjectId(),
    foreign = new mongoose.Types.ObjectId();
  const username = `rec-${owner.toString().slice(-12)}`;
  const stamp = new Date();
  await User.create([
    {
      _id: owner,
      name: 'Controlled E2E Developer',
      email: `${owner}@recommendation.test`,
      password: 'verification-only',
      role: 'developer',
      activeGithubUsername: username,
      activeCareerStack: 'Backend',
      activeExperienceLevel: 'Intern',
    },
    {
      _id: foreign,
      name: 'Foreign E2E Developer',
      email: `${foreign}@recommendation.test`,
      password: 'verification-only',
      role: 'developer',
      activeCareerStack: 'Backend',
      activeExperienceLevel: 'Intern',
    },
  ]);
  const files = await ResumeFile.create(
    ['a', 'b'].map((name) => ({
      userId: owner,
      fileName: `${name}.pdf`,
      fileUrl: `/verification/${name}`,
      fileSize: 1,
    })),
  );
  const analyses = await ResumeAnalysis.create(
    files.map((file, index) => ({
      userId: owner,
      fileId: file._id,
      fileName: file.fileName,
      fileSize: 1,
      analyzedAt: stamp,
      scoring: { score: index ? 0 : null, ruleVersion: 'resume-overall-score-v1' },
      resumeSignals: {
        analysisVersion: 'resume-v3',
        skills: [index ? 'Docker' : 'SQL'],
        warnings: [
          {
            code: 'missing_metrics',
            severity: 'high',
            message: 'No quantified achievements in the controlled source.',
          },
        ],
      },
    })),
  );
  await User.updateOne({ _id: owner }, { activeResumeFileId: files[0]._id });
  const github = {
    repoCount: 1,
    repositories: [{ name: 'controlled-api', hasReadme: false, hasTests: true }],
    fetchedAt: stamp.toISOString(),
    scoring: { score: 0, ruleVersion: 'github-health-score-v1' },
    githubSignals: {
      analyzedAt: stamp.toISOString(),
      username,
      scoring: { score: 0, ruleVersion: 'github-health-score-v1' },
    },
  };
  await GitHubAnalysisCache.create({
    githubUsername: username,
    normalizedUsername: username,
    result: github,
    analysisVersion: 'github-v2',
    expiresAt: new Date(Date.now() + 3600000),
  });
  const resumeIdentity = signalService.buildResumeCacheIdentity({
    resumeAnalysis: analyses[0].toObject(),
  });
  const skillGap = {
    ruleVersion: engine.SKILL_RULE,
    coverage: 0,
    calculatedAt: stamp.toISOString(),
    requiredSkills: [
      {
        name: 'SQL',
        status: 'CLAIMED_ONLY',
        requirement: 'REQUIRED',
        evidenceConfidence: 'LOW',
        priority: 'High',
      },
    ],
    skills: [
      {
        name: 'SQL',
        status: 'CLAIMED_ONLY',
        requirement: 'REQUIRED',
        evidenceConfidence: 'LOW',
        priority: 'High',
      },
    ],
    sourceReferences: Object.values(
      engine.sourceMetadata({
        username,
        githubData: github,
        resumeAnalysis: analyses[0].toObject(),
      }),
    ),
  };
  const gap = await AnalysisCache.create({
    userId: owner,
    githubUsername: username,
    careerStack: 'Backend',
    experienceLevel: 'Intern',
    ...resumeIdentity,
    analysisVersion: 'v6-skill-intelligence',
    analysisData: skillGap,
  });
  await CareerSprint.create({
    userId: owner,
    title: 'Controlled E2E Sprint',
    weekStartDate: new Date(Date.now() - 86400000),
    weekEndDate: new Date(Date.now() + 6 * 86400000),
    tasks: [],
  });
  await redis.initRedisCache({ silent: true });
  results.redis = {
    configured: Boolean(process.env.REDIS_URL || process.env.UPSTASH_REDIS_TOKEN),
    connected: redis.isRedisCacheEnabled(),
    ping: await redis.pingRedisCache(),
  };
  const app = express();
  app.use(express.json());
  for (const [route, file] of [
    ['recommendations', 'recommendations.routes'],
    ['career-sprints', 'careerSprint.routes'],
    ['profile', 'profile.routes'],
    ['resume', 'resume.routes'],
    ['github', 'github.routes'],
    ['skillgap', 'skillgap.routes'],
    ['courses', 'courseRoutes'],
    ['notifications', 'notification.routes'],
  ])
    app.use(`/api/${route}`, require(`../routes/${file}`));
  app.use('/api', (_req, res) =>
    res.status(404).json({ message: 'Endpoint is outside the Recommendations verification host.' }),
  );
  const verificationHtml = fs
    .readFileSync(path.join(webRoot, 'index.html'), 'utf8')
    .replace(
      /window\.__DEVINSIGHT_API_ORIGIN__\s*=\s*'[^']*';/,
      'window.__DEVINSIGHT_API_ORIGIN__ = window.location.origin;',
    );
  app.use(express.static(webRoot, { index: false }));
  app.use((_req, res) => res.type('html').send(verificationHtml));
  server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const tokenFor = (id) =>
    jwt.sign({ id: String(id) }, process.env.JWT_SECRET, {
      algorithm: 'HS256',
      issuer: process.env.JWT_ISSUER || 'devinsight-api',
      audience: process.env.JWT_AUDIENCE || 'devinsight-web',
      expiresIn: '30m',
    });
  const token = tokenFor(owner),
    foreignToken = tokenFor(foreign);
  async function request(
    route,
    body,
    { method = body === undefined ? 'GET' : 'POST', auth = token, status = 200 } = {},
  ) {
    const response = await fetch(`${origin}/api/${route}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30000),
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    assert.equal(
      response.status,
      status,
      `${method} ${route}: ${JSON.stringify(data).slice(0, 300)}`,
    );
    return data;
  }
  const rec = (body) => request('recommendations', body || {});
  await request('recommendations', {}, { auth: null, status: 401 });
  await request('recommendations', { username: 'someone-else' }, { status: 400 });
  const first = await rec();
  assert.equal(first.username, username);
  assert.equal(first.careerStack, 'Backend');
  assert.equal(first.experienceLevel, 'Intern');
  assert.equal(first.sourceScores.resumeOverall, null);
  assert.equal(first.sourceScores.githubHealth, 0);
  assert.equal(first.sourceScores.skillEvidenceCoverage, 0);
  assert.ok(Object.values(first.recommendationScores).every((value) => value === null));
  assert.deepEqual(first.recommendations, engine.rank(first.recommendations));
  assert.equal(
    new Set(first.recommendations.map((card) => card.id)).size,
    first.recommendations.length,
  );
  const snapshot = await Recommendation.findOne({
    userId: owner,
    contextHash: identity(first),
  }).lean();
  assert.ok(snapshot);
  assert.deepEqual(authoritative(snapshot.result), authoritative(first));
  record(
    'Authenticated first generation, active context, ranking, null versus zero and stored snapshot',
    { count: first.recommendations.length, signalHash: identity(first) },
  );
  for (const category of ['learning', 'projects', 'resume']) {
    const card = first.recommendations.find((item) => item.category === category);
    assert.ok(card && card.priority === 'High' && card.evidence.length);
    results.traces.push({
      category,
      id: card.id,
      title: card.title,
      sourceFacts: card.evidence,
      evidenceStatus: card.evidenceStatus,
      finalPriority: card.priority,
      rank: first.recommendations.indexOf(card) + 1,
      explanation: card.reason,
      nextStep: card.actionableNextStep,
      rule:
        category === 'learning'
          ? 'Required SQL CLAIMED_ONLY with recorded High priority; claims do not demonstrate implementation.'
          : category === 'projects'
            ? 'Recorded hasReadme=false yields High priority documentation action.'
            : 'Recorded missing_metrics warning with high severity yields High priority resume action.',
      tieBreak: 'High before Medium before Low; equal impact/null then stable ID ascending.',
    });
  }
  const cached = await rec();
  assert.equal(identity(cached), identity(first));
  assert.deepEqual(authoritative(cached), authoritative(first));
  record('Cached reload retains identity and authoritative content', {
    cacheLayer: cached.cacheMetadata.cacheLayer,
  });
  const concurrent = await Promise.all(Array.from({ length: 5 }, () => rec()));
  assert.ok(concurrent.every((data) => identity(data) === identity(first)));
  assert.equal(
    await Recommendation.countDocuments({ userId: owner, contextHash: identity(first) }),
    1,
  );
  record('Concurrent HTTP requests share one persisted snapshot');
  await new Promise((resolve) => setTimeout(resolve, 250));
  controller.clearRecommendationMemoryCache();
  aiService.memoryCache.clear();
  redis.clearMemoryCache();
  const sharedReload = await rec();
  assert.deepEqual(authoritative(sharedReload), authoritative(first));
  record('Real shared-cache lookup preserves authoritative content', {
    connected: results.redis.connected,
    cacheLayer: sharedReload.cacheMetadata.cacheLayer,
  });
  controller.clearRecommendationMemoryCache();
  aiService.memoryCache.clear();
  await redis.closeRedisCache();
  redis.clearMemoryCache();
  const mongoReload = await rec();
  assert.equal(mongoReload.cacheMetadata.cacheLayer, 'mongo');
  assert.deepEqual(authoritative(mongoReload), authoritative(first));
  record('Real Mongo reload after application cache clear and Redis disconnect', {
    cacheLayer: mongoReload.cacheMetadata.cacheLayer,
  });
  const other = await request('recommendations', {}, { auth: foreignToken });
  assert.equal(other.sourceMetadata.resume.available, false);
  assert.equal(other.sourceMetadata.github.available, false);
  assert.equal(
    (await request('recommendations/history', undefined, { auth: foreignToken })).snapshots.some(
      (row) => row.contextHash === identity(first),
    ),
    false,
  );
  await request(
    'resume/active',
    { fileId: String(files[0]._id) },
    { method: 'PUT', auth: foreignToken, status: 404 },
  );
  record('JWT ownership prevents foreign context, history and resume selection');

  browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.VERIFY_CHROMIUM_PATH ||
      'C:/Users/ahmad.hassan/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe',
  });
  async function browserSession(theme) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      colorScheme: theme,
    });
    await context.addInitScript(
      ({ token, owner, username, theme }) => {
        localStorage.setItem('token', token);
        localStorage.setItem(
          'user',
          JSON.stringify({
            _id: owner,
            role: 'developer',
            name: 'Controlled E2E Developer',
            activeGithubUsername: username,
          }),
        );
        localStorage.setItem(
          'devinsight_career_profile',
          JSON.stringify({
            careerStack: 'Backend',
            activeCareerStack: 'Backend',
            experienceLevel: 'Intern',
            activeExperienceLevel: 'Intern',
            activeGithubUsername: username,
            isConfigured: true,
          }),
        );
        localStorage.setItem('devinsight_theme', theme);
      },
      { token, owner: String(owner), username, theme },
    );
    const page = await context.newPage(),
      errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const responsePromise = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/recommendations') && response.request().method() === 'POST',
    );
    await page.goto(`${origin}/app/recommendations`, { waitUntil: 'domcontentloaded' });
    const response = await responsePromise;
    const data = await response.json();
    assert.equal(response.status(), 200, `Browser API: ${JSON.stringify(data).slice(0, 300)}`);
    const top = page.locator('section[aria-labelledby="top-title"]');
    await top.waitFor();
    assert.deepEqual(
      await top.locator('h3').allTextContents(),
      data.recommendations.slice(0, 3).map((card) => card.title),
    );
    for (const [index, card] of data.recommendations.slice(0, 3).entries()) {
      const evidenceRow = top.locator('app-recommendation-row').nth(index);
      await evidenceRow.getByText(card.reason || card.description, { exact: true }).waitFor();
      await evidenceRow.locator('summary').click();
      for (const fact of card.evidence)
        await evidenceRow.getByText(fact, { exact: true }).waitFor();
      await evidenceRow.locator('summary').click();
    }
    await page.evaluate(() => {
      document.querySelector('.main-content').scrollTop = 0;
    });
    await page.evaluate(() => document.fonts.ready);
    return { context, page, errors, top, data };
  }
  const live = await browserSession('light');
  await live.page.screenshot({ path: path.join(output, 'e2e-live-light-desktop.png') });
  const chosen = live.data.recommendations[0];
  const row = live.top.locator('app-recommendation-row').first();
  await row.locator('summary').click();
  await row.getByText(chosen.evidence[0], { exact: true }).waitFor();
  const handoffPromise = live.page.waitForResponse((response) =>
    response.url().includes(`/recommendations/${chosen.id}/career-sprint`),
  );
  await row.getByRole('button', { name: 'Add to Career Sprint', exact: true }).click();
  const handoffResponse = await handoffPromise;
  assert.equal(handoffResponse.status(), 200);
  const handoff = await handoffResponse.json();
  assert.equal(handoff.alreadyAdded, false);
  await row.getByText('Added to your Career Sprint.', { exact: true }).waitFor();
  const storedSprint = await CareerSprint.findOne({ userId: owner }).lean();
  assert.equal(storedSprint.tasks.filter((task) => task.title === chosen.title).length, 1);
  await row.getByRole('link', { name: 'Open Career Sprint', exact: true }).click();
  await live.page.waitForURL('**/app/career-sprint');
  await live.page.getByText(chosen.title, { exact: true }).first().waitFor();
  assert.deepEqual(live.errors, []);
  results.browser.push({
    theme: 'light',
    realApi: true,
    topOrder: true,
    evidence: true,
    sprintCreatedAndVisible: true,
    errors: live.errors,
  });
  await live.context.close();
  record(
    'Angular uses real authenticated recommendations and creates a database-backed visible Sprint task',
  );
  const reload = await browserSession('dark');
  await reload.page.screenshot({ path: path.join(output, 'e2e-live-dark-desktop.png') });
  const duplicateRow = reload.page
    .locator('app-recommendation-row')
    .filter({ has: reload.page.getByRole('heading', { name: chosen.title, exact: true }) })
    .first();
  const duplicateResponse = reload.page.waitForResponse((response) =>
    response.url().includes(`/recommendations/${chosen.id}/career-sprint`),
  );
  await duplicateRow.getByRole('button', { name: 'Add to Career Sprint', exact: true }).click();
  const duplicateHttp = await duplicateResponse;
  assert.equal(duplicateHttp.status(), 200);
  assert.equal((await duplicateHttp.json()).alreadyAdded, true);
  await duplicateRow.getByText('Already in your Career Sprint.', { exact: true }).waitFor();
  assert.equal(await CareerSprint.countDocuments({ userId: owner }), 1);
  assert.equal(
    (await CareerSprint.findOne({ userId: owner }).lean()).tasks.filter(
      (task) => task.title === chosen.title,
    ).length,
    1,
  );
  const skillAction = reload.data.recommendations.find((card) => card.targetSkill);
  if (skillAction) {
    await reload.page
      .getByRole('link', { name: `Browse courses for ${skillAction.targetSkill}`, exact: true })
      .first()
      .click();
    await reload.page.waitForURL(
      (url) =>
        url.pathname === '/app/courses' &&
        url.searchParams.get('skill') === skillAction.targetSkill,
    );
    await reload.page.goBack();
    await reload.top.waitFor();
    record('Skill-specific Courses navigation retains the backend target skill', {
      skill: skillAction.targetSkill,
    });
  }
  for (const [name, destination] of [
    ['Browse learning resources', '/app/courses'],
    ['Inspect Skill Gap evidence', '/app/skill-gap'],
    ['Inspect GitHub analysis', '/app/github-analyzer'],
    ['Inspect Resume analysis', '/app/resume-analyzer'],
  ]) {
    await reload.page.getByRole('link', { name, exact: true }).click();
    await reload.page.waitForURL(`**${destination}`);
    await reload.page.goBack();
    await reload.top.waitFor();
  }
  assert.deepEqual(reload.errors, []);
  results.browser.push({
    theme: 'dark',
    freshBrowserStorage: true,
    persistenceReload: true,
    duplicateHandoff: true,
    coursesAndAnalyzersNavigation: true,
    errors: reload.errors,
  });
  await reload.context.close();
  record(
    'Fresh Angular session reloads persisted data, repeated handoff is idempotent and Courses/analyzers navigate',
  );

  let before = await rec();
  await request('resume/active', { fileId: String(files[1]._id) }, { method: 'PUT' });
  const switched = await rec();
  assert.notEqual(identity(switched), identity(before));
  assert.equal(switched.resumeInsights.analysisId, String(analyses[1]._id));
  assert.equal(switched.sourceScores.resumeOverall, 0);
  assert.equal(switched.sourceScores.skillEvidenceCoverage, null);
  record('Actual active Resume API invalidates context without borrowing Skill Gap evidence');
  await request('resume/active', { fileId: String(files[0]._id) }, { method: 'PUT' });
  before = await rec();
  await AnalysisCache.updateOne(
    { _id: gap._id },
    {
      'analysisData.coverage': 100,
      'analysisData.skills.0.status': 'DEMONSTRATED',
      'analysisData.requiredSkills.0.status': 'DEMONSTRATED',
      'analysisData.calculatedAt': new Date().toISOString(),
    },
  );
  const recalculated = await rec();
  assert.notEqual(identity(recalculated), identity(before));
  assert.equal(
    recalculated.recommendations.some((card) => card.targetSkill === 'SQL'),
    false,
  );
  record('Controlled Skill Gap recalculation invalidates cache and suppresses resolved SQL work');
  before = recalculated;
  await GitHubAnalysisCache.updateOne(
    { normalizedUsername: username },
    {
      'result.repositories.0.hasReadme': true,
      'result.githubSignals.analyzedAt': new Date(Date.now() + 1000).toISOString(),
    },
  );
  const reanalyzed = await rec();
  assert.notEqual(identity(reanalyzed), identity(before));
  assert.equal(
    reanalyzed.projects.some((card) => card.title === 'Document controlled-api'),
    false,
  );
  assert.equal(reanalyzed.sourceScores.skillEvidenceCoverage, null);
  record(
    'Controlled GitHub reanalysis invalidates cache, clears resolved documentation and incompatible Skill Gap',
  );
  await GitHubAnalysisCache.updateOne(
    { normalizedUsername: username },
    {
      'result.repositories.0.hasReadme': false,
      'result.cache.stale': true,
      expiresAt: new Date(0),
    },
  );
  const stale = await rec();
  assert.equal(stale.sourceMetadata.github.freshness, 'STALE');
  assert.ok(stale.projects.every((card) => card.priority === 'Low'));
  await GitHubAnalysisCache.updateOne(
    { normalizedUsername: username },
    {
      'result.cache.stale': false,
      expiresAt: new Date(Date.now() + 3600000),
      'result.githubSignals.analyzedAt': new Date(Date.now() + 2000).toISOString(),
    },
  );
  const recovered = await rec();
  assert.equal(recovered.sourceMetadata.github.freshness, 'RECORDED');
  assert.notEqual(identity(recovered), identity(stale));
  record('Stale GitHub evidence is low priority and recovers after a fresh source snapshot');
  await request(
    'profile/career/active',
    { careerStack: 'Frontend', experienceLevel: 'Student' },
    { method: 'PUT' },
  );
  const changed = await rec();
  assert.equal(changed.careerStack, 'Frontend');
  assert.equal(changed.experienceLevel, 'Student');
  assert.notEqual(identity(changed), identity(recovered));
  record('Actual active career-context API invalidates recommendation identity');
  // Resume-only refresh exercises actual no-provider fallback without fetching a synthetic GitHub account.
  await User.updateOne({ _id: owner }, { activeGithubUsername: '', githubUsername: '' });
  before = await rec();
  const refreshes = await Promise.all(Array.from({ length: 5 }, () => rec({ forceRefresh: true })));
  assert.ok(
    refreshes.every((result) => result.aiUsed === false && result.recommendations.length > 0),
  );
  assert.ok(refreshes.every((result) => identity(result) === identity(refreshes[0])));
  assert.deepEqual(authoritative(refreshes[0]), authoritative(before));
  record(
    'Concurrent explicit refresh with real AI no-provider failure preserves authoritative facts/ranking',
  );
  const history = await request('recommendations/history');
  assert.ok(history.snapshots.length > 1 && history.snapshots.every((row) => row.historical));
  record('History remains distinguishable from current snapshots', {
    snapshots: history.snapshots.length,
  });
  results.status = 'VERIFIED';
}
(async () => {
  fs.mkdirSync(output, { recursive: true });
  try {
    await main();
  } catch (error) {
    results.status = 'BLOCKED';
    results.error = { name: error.name, message: error.message, stack: error.stack };
    process.exitCode = 1;
    console.error(error);
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => setTimeout(resolve, 300));
    await redis.closeRedisCache();
    if (mongoose.connection.readyState === 1) {
      assert.equal(mongoose.connection.name, database);
      assert.match(database, /^devinsight_rec_e2e_[a-f0-9]{12}$/);
      await mongoose.connection.dropDatabase();
      results.cleanup.ownedDatabaseRemoved = true;
      await mongoose.disconnect();
    }
    fs.writeFileSync(
      path.join(output, 'final-live-e2e.json'),
      JSON.stringify(results, null, 2) + '\n',
    );
    console.log(
      JSON.stringify({
        status: results.status,
        checks: results.checks.length,
        traces: results.traces.length,
        browserSessions: results.browser.length,
        cleanup: results.cleanup,
      }),
    );
  }
})().catch((error) => {
  console.error(error.name);
  process.exitCode = 1;
});
