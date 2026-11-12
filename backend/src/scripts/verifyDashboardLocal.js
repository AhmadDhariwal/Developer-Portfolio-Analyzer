// Local synthetic acceptance only. Never loads .env or uses an existing database.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const { fork } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { AsyncLocalStorage } = require('node:async_hooks');
const { performance } = require('node:perf_hooks');
const mongoose = require('mongoose');

const output = path.resolve(__dirname, '../../verification/dashboard');
const modelNames = [
  'user',
  'analysis',
  'analysisCache',
  'resumeFile',
  'resumeAnalysis',
  'weeklyReport',
  'careerSprint',
  'jobCache',
  'news',
  'userCourseProgress',
  'integrationInsight',
  'integrationConnection',
  'integrationSyncLog',
  'publicProfile',
  'recommendation',
  'scenarioSimulation',
];

async function worker() {
  assert.match(
    process.env.DASHBOARD_FIXTURE_URI || '',
    /^mongodb:\/\/127\.0\.0\.1:\d+\/integration_live_acceptance\?replicaSet=dashboard-local$/,
  );
  await mongoose.connect(process.env.DASHBOARD_FIXTURE_URI, { autoIndex: false, maxPoolSize: 10 });
  const express = require('express');
  const app = express();
  app.use(express.json());
  const queryContext = new AsyncLocalStorage();
  mongoose.set('debug', () => {
    const context = queryContext.getStore();
    if (context) context.count += 1;
  });
  app.use('/api/dashboard', (_req, res, next) =>
    queryContext.run({ count: 0 }, () => {
      const json = res.json.bind(res);
      res.json = (body) => {
        res.set('X-Dashboard-Fixture-Queries', String(queryContext.getStore().count));
        return json(body);
      };
      next();
    }),
  );
  app.use('/api/dashboard', require('../routes/dashboard.routes'));
  app.get('/api/profile/me', async (_req, res) => {
    const user = await require('../models/user')
      .findById(process.env.DASHBOARD_FIXTURE_OWNER)
      .lean();
    res.json({ ...user, isConfigured: true });
  });
  app.use('/api', (_req, res) =>
    res.json({
      organizations: [],
      teams: [],
      items: [],
      settings: {},
      notifications: [],
      unreadCount: 0,
      maintenanceMode: false,
    }),
  );
  const dist = path.resolve(__dirname, '../../../frontend/dist/frontend/browser');
  app.use(express.static(dist));
  app.get('/{*path}', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  const server = app.listen(0, '127.0.0.1', () => process.send({ port: server.address().port }));
  process.on('message', async (message) => {
    if (message !== 'stop') return;
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await mongoose.disconnect();
    process.exit(0);
  });
}

async function main() {
  await fs.mkdir(output, { recursive: true });
  const report = {
    synthetic: true,
    productionDataUsed: false,
    checks: [],
    performance: {},
    plans: {},
    browser: {},
    cleanup: null,
  };
  const { startMongo } = require('../tests/fixtures/disposableRequestMongo');
  const runtime = await startMongo({ replicaSet: 'dashboard-local', temporaryRoot: output });
  const workers = [];
  let browser;
  try {
    await mongoose.connect(runtime.uri, { autoIndex: false, maxPoolSize: 10 });
    const models = Object.fromEntries(
      modelNames.map((name) => [name, require('../models/' + name)]),
    );
    for (const Model of Object.values(models)) {
      await Model.createCollection();
      await Model.createIndexes();
    }
    const now = new Date();
    const owner = await models.user.create({
      name: 'Dashboard Local Verification',
      email: 'dashboard-owner@example.test',
      providers: ['google'],
      role: 'developer',
      githubUsername: 'fixture-dev',
      activeGithubUsername: 'fixture-dev',
      careerStack: 'Backend',
      activeCareerStack: 'Backend',
      experienceLevel: 'Student',
      activeExperienceLevel: 'Student',
      careerProfileSetAt: now,
    });
    const other = await models.user.create({
      name: 'Other User',
      email: 'dashboard-other@example.test',
      providers: ['google'],
      role: 'developer',
      careerStack: 'Frontend',
      experienceLevel: 'Intern',
    });
    await models.analysis.create({
      userId: owner._id,
      githubScore: 80,
      readinessScore: 0,
      githubStats: { repos: 12, stars: 25 },
      githubSignals: { username: 'fixture-dev' },
      languageDistribution: { TypeScript: 70, JavaScript: 30 },
      contributionActivity: [
        { month: 'Oct', count: 12 },
        { month: 'Nov', count: 4 },
      ],
      updatedAt: now,
    });
    await models.analysis.create({
      userId: other._id,
      githubScore: 99,
      githubStats: { repos: 999 },
      updatedAt: now,
    });
    const { ANALYSIS_VERSION, buildScope } = require('../services/skillGapCacheContract');
    const scope = buildScope({
      userId: owner._id,
      user: owner,
      resumeIdentity: { resumeHash: 'no-resume', resumeAnalysisId: 'no-resume' },
    });
    const skillData = { yourSkills: ['TypeScript'], missingSkills: ['Testing'], coverage: 50 };
    for (const [key, value] of Object.entries(scope))
      if (key.startsWith('analysisData.') && typeof value === 'string')
        skillData[key.slice(13)] = value;
    const identity = {
      userId: owner._id,
      githubUsername: 'fixture-dev',
      careerStack: 'Backend',
      experienceLevel: 'Student',
      resumeHash: 'no-resume',
      resumeAnalysisId: 'no-resume',
    };
    await models.analysisCache.create({
      ...identity,
      analysisVersion: ANALYSIS_VERSION,
      analysisData: skillData,
    });
    await models.analysisCache.create({
      ...identity,
      analysisVersion: 'fixture-portfolio',
      analysisData: {
        portfolioScore: {
          overallScore: 0,
          breakdown: {
            codeQuality: 80,
            skillCoverage: 50,
            industryReadiness: 0,
            projectImpact: 25,
          },
        },
      },
    });
    await models.careerSprint.collection.insertOne({
      userId: owner._id,
      tasks: [
        {
          _id: new mongoose.Types.ObjectId(),
          title: 'High-value completed task',
          points: 9,
          isCompleted: true,
        },
        {
          _id: new mongoose.Types.ObjectId(),
          title: 'Remaining task',
          points: 1,
          isCompleted: false,
        },
      ],
      updatedAt: now,
    });
    await models.userCourseProgress.collection.insertOne({
      userId: owner._id,
      courseId: 'fixture-course',
      status: 'completed',
      updatedAt: now,
    });
    await models.news.collection.insertMany(
      Array.from({ length: 500 }, (_, index) => ({
        cacheKey: index === 0 ? 'news:v3:public:pool' : 'obsolete-fixture-' + index,
        trendingTopics: [index === 0 ? 'TypeScript' : 'Other'],
        lastUpdated: now,
        updatedAt: now,
        expiresAt: new Date(Date.now() + 3600000),
        allItems: [],
      })),
    );
    // History comes from another profile and must not become the owner's trend.
    await models.analysisCache.collection.insertOne({
      ...identity,
      careerStack: 'Frontend',
      analysisData: { portfolioScore: { overallScore: 99 } },
      createdAt: now,
      updatedAt: new Date(Date.now() - 30 * 86400000),
    });
    process.env.JWT_SECRET = randomBytes(32).toString('hex');
    const token = require('../utils/authSessionToken').sign(owner, '1h');
    const otherToken = require('../utils/authSessionToken').sign(other, '1h');
    for (let index = 0; index < 2; index++) {
      const child = fork(__filename, ['--worker'], {
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
        env: {
          ...process.env,
          DASHBOARD_FIXTURE_URI: runtime.uri,
          DASHBOARD_FIXTURE_OWNER: String(owner._id),
        },
      });
      child.stderr.on('data', () => {}); // Do not print connection strings on unexpected driver errors.
      workers.push(child);
      const port = await new Promise((resolve, reject) => {
        child.once('message', (message) => resolve(message.port));
        child.once('exit', (code) => reject(Error('Fixture API exited before readiness: ' + code)));
      });
      child.base = `http://127.0.0.1:${port}`;
    }
    const read = async (base, endpoint, auth = token, extra = {}) =>
      fetch(`${base}/api/dashboard/${endpoint}`, {
        headers: { Authorization: `Bearer ${auth}`, ...extra },
      });
    const first = await read(workers[0].base, 'summary');
    assert.equal(first.status, 200);
    report.summaryQueryCount = Number(first.headers.get('x-dashboard-fixture-queries'));
    const etag = first.headers.get('etag');
    const summary = await first.json();
    assert.equal(summary.repositories, 12);
    assert.equal(summary.readinessScore, 0);
    assert.equal(summary.scoreChangeFromLastMonth, null);
    assert.equal(summary.skillsSnapshot.coveragePercentage, 50);
    assert.equal(summary.learningSnapshot.completedCount, 1);
    assert.equal(summary.readinessCenter.find((item) => item.key === 'sprint').value, 90);
    assert.equal(summary.commandCenter.find((item) => item.key === 'news').value, 'TypeScript');
    assert.equal(
      (await (await read(workers[0].base, 'summary', otherToken)).json()).repositories,
      999,
    );
    assert.equal(
      (await read(workers[1].base, 'summary', token, { 'If-None-Match': etag })).status,
      304,
    );
    report.apiEndpoints = {};
    for (const endpoint of [
      'summary',
      'contributions',
      'languages',
      'skills',
      'recommendations',
      'integration-analytics',
    ]) {
      const started = performance.now();
      const response = await read(workers[0].base, endpoint);
      const bytes = (await response.arrayBuffer()).byteLength;
      report.apiEndpoints[endpoint] = {
        status: response.status,
        elapsedMs: Math.round(performance.now() - started),
        bytes,
        queries: Number(response.headers.get('x-dashboard-fixture-queries')),
      };
      assert.equal(response.status, 200);
    }
    report.checks.push(
      'real JWT, two users isolated, canonical skill scope, zero portfolio, no cross-stack trend, weighted sprint, learning progress, canonical news, cross-process 304',
    );
    await models.analysisCache.updateOne(
      { ...identity, analysisVersion: 'fixture-portfolio' },
      { $set: { 'analysisData.portfolioScore.overallScore': 42 } },
    );
    for (const child of workers) {
      const response = await read(child.base, 'summary', token, { 'If-None-Match': etag });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).readinessScore, 42);
    }
    report.checks.push('upstream write visible immediately in both independent API processes');
    const durations = [];
    for (let batch = 0; batch < 3; batch++)
      await Promise.all(
        Array.from({ length: 10 }, async (_, index) => {
          const started = performance.now();
          const response = await read(
            workers[index % 2].base,
            'summary',
            index % 3 ? token : otherToken,
          );
          assert.equal(response.status, 200);
          await response.arrayBuffer();
          durations.push(performance.now() - started);
        }),
      );
    durations.sort((a, b) => a - b);
    report.performance = {
      sampleCount: durations.length,
      concurrency: 10,
      users: 2,
      apiProcesses: 2,
      maxPoolSizePerProcess: 10,
      p50Ms: Math.round(durations[Math.floor(durations.length * 0.5)]),
      p95Ms: Math.round(durations[Math.ceil(durations.length * 0.95) - 1]),
      maxMs: Math.round(durations.at(-1)),
      summaryBytes: Buffer.byteLength(JSON.stringify(summary)),
      limitation:
        'Synthetic loopback, single-member disposable replica set, not representative staging load',
    };
    const newsFilter = { cacheKey: 'news:v3:public:pool', expiresAt: { $gt: new Date() } };
    for (const [name, cursor] of [
      [
        'newsCanonical',
        models.news.collection
          .find(newsFilter)
          .project({ trendingTopics: 1, lastUpdated: 1, updatedAt: 1 })
          .limit(1),
      ],
      [
        'newsLegacy',
        models.news.collection
          .find({ expiresAt: { $gt: new Date() } })
          .sort({ lastUpdated: -1, updatedAt: -1 })
          .limit(1),
      ],
      [
        'portfolioCurrent',
        models.analysisCache.collection
          .find({ ...identity, 'analysisData.portfolioScore.overallScore': { $exists: true } })
          .sort({ updatedAt: -1, _id: -1 })
          .limit(1),
      ],
    ]) {
      const explained = await cursor.explain('executionStats');
      report.plans[name] = {
        winningPlan: explained.queryPlanner.winningPlan,
        keysExamined: explained.executionStats.totalKeysExamined,
        documentsExamined: explained.executionStats.totalDocsExamined,
        returned: explained.executionStats.nReturned,
      };
    }
    report.plans.declaredIndexes = {};
    for (const name of [
      'analysisCache',
      'news',
      'analysis',
      'userCourseProgress',
      'integrationSyncLog',
    ])
      report.plans.declaredIndexes[name] = await models[name].collection.indexes();

    if (process.env.DASHBOARD_PLAYWRIGHT_MODULE) {
      const { chromium } = require(process.env.DASHBOARD_PLAYWRIGHT_MODULE);
      browser = await chromium.launch({
        headless: true,
        executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
      });
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      const base = workers[0].base;
      await context.route('**/*', (route) =>
        route.request().url().startsWith(base) ? route.continue() : route.abort(),
      );
      await context.addInitScript(
        ({ token, user }) => {
          localStorage.setItem('token', token);
          localStorage.setItem('user', JSON.stringify(user));
          localStorage.setItem('loginExpiry', String(Date.now() + 3600000));
          if (!localStorage.getItem('devinsight_theme'))
            localStorage.setItem('devinsight_theme', 'light');
          localStorage.setItem(
            'devinsight_career_profile',
            JSON.stringify({
              ownerId: user._id,
              activeCareerStack: 'Backend',
              activeExperienceLevel: 'Student',
              careerStack: 'Backend',
              experienceLevel: 'Student',
              isConfigured: true,
            }),
          );
        },
        { token, user: { ...owner.toObject(), isConfigured: true } },
      );
      const page = await context.newPage();
      const errors = [];
      const requests = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('request', (request) => {
        if (request.url().includes('/api/dashboard/'))
          requests.push(new URL(request.url()).pathname);
      });
      await page.goto(base + '/app/dashboard');
      await page.getByRole('heading', { name: 'Learning Progress' }).waitFor();
      await page.getByRole('button', { name: 'Refresh dashboard' }).waitFor();
      await page.waitForFunction(
        () => !document.querySelector('app-dashboard button.reanalyze-btn')?.disabled,
      );
      await page.waitForFunction(
        () => document.querySelectorAll('app-dashboard canvas').length === 3,
      );
      await page.waitForTimeout(500);
      assert.deepEqual(
        requests.slice().sort(),
        [
          '/api/dashboard/summary',
          '/api/dashboard/contributions',
          '/api/dashboard/languages',
          '/api/dashboard/integration-analytics',
        ].sort(),
      );
      assert.equal(
        (await page.locator('app-dashboard').getByText('Unavailable', { exact: true }).count()) > 0,
        true,
      );
      report.browser.requestPaths = [...requests];
      assert.equal(
        (
          await page
            .getByLabel('Career Stack', { exact: true })
            .locator('option:checked')
            .textContent()
        ).trim(),
        'Backend',
      );
      for (const theme of ['light', 'dark']) {
        // Trigger the same DOM theme signal observed by charts, without changing app settings.
        await page.evaluate(
          (theme) => document.documentElement.setAttribute('data-theme', theme),
          theme,
        );
        await page.screenshot({ path: path.join(output, `desktop-${theme}.png`), fullPage: true });
      }
      await page.evaluate(() => localStorage.setItem('devinsight_theme', 'system'));
      await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
      await page.reload();
      await page.waitForFunction(
        () => document.documentElement.getAttribute('data-theme') === 'dark',
      );
      await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
      await page.waitForFunction(
        () => document.documentElement.getAttribute('data-theme') === 'light',
      );
      await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
      await page.waitForFunction(
        () => document.documentElement.getAttribute('data-theme') === 'dark',
      );
      await page.getByRole('heading', { name: 'Learning Progress' }).waitFor();
      await page.waitForFunction(
        () => !document.querySelector('app-dashboard button.reanalyze-btn')?.disabled,
      );
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: path.join(output, 'mobile-dark.png'), fullPage: true });
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
        'mobile horizontal overflow',
      );
      await page.getByRole('button', { name: 'Refresh dashboard' }).click();
      await page.waitForFunction(
        () => !document.querySelector('app-dashboard button.reanalyze-btn')?.disabled,
      );
      assert.equal(requests.filter((entry) => entry.endsWith('/summary')).length, 3);
      assert.deepEqual(errors, []);
      report.browser = {
        ...report.browser,
        status: 'PASS',
        themes: ['light', 'dark', 'system'],
        mobileWidth: 390,
        consoleErrors: errors,
        screenshots: ['desktop-light.png', 'desktop-dark.png', 'mobile-dark.png'],
        limitation: 'Synthetic authenticated local fixture, including System preference changes',
      };
    } else
      report.browser = { status: 'BLOCKED', reason: 'DASHBOARD_PLAYWRIGHT_MODULE not provided' };
    report.status = 'PASS';
  } catch (error) {
    report.status = 'FAIL';
    report.error = error.message;
    process.exitCode = 1;
  } finally {
    await browser?.close();
    for (const child of workers) {
      if (child.exitCode !== null) continue;
      await new Promise((resolve) => {
        child.once('exit', resolve);
        child.send('stop');
      });
    }
    await mongoose.disconnect();
    report.cleanup = await runtime.stop();
    await fs.writeFile(
      path.join(output, 'local-acceptance.json'),
      JSON.stringify(report, null, 2) + '\n',
    );
    console.log(
      JSON.stringify({
        status: report.status,
        performance: report.performance,
        browser: report.browser.status,
        error: report.error,
        cleanup: report.cleanup,
      }),
    );
  }
}

if (process.argv.includes('--worker')) worker().catch(() => process.exit(1));
else
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
