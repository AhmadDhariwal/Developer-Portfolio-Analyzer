'use strict';
/** Real local HTTP/JWT/Mongo + production Angular verification. Never uses an existing user. */
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { once } = require('node:events');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const express = require('express');
const { chromium } = require('playwright');
const uri =
  process.env.LEARNING_VERIFICATION_MONGO_URI ||
  'mongodb://127.0.0.1:27018/devinsight_learning_browser';
const parsed = new URL(uri);
assert.ok(
  ['127.0.0.1', 'localhost'].includes(parsed.hostname) &&
    parsed.pathname.startsWith('/devinsight_learning_'),
  'Use an isolated local devinsight_learning_* database.',
);
process.env.REDIS_URL = '';
process.env.UPSTASH_REDIS_TOKEN = '';
const liveYoutubeKey = process.env.YOUTUBE_API_KEY;
process.env.YOUTUBE_API_KEY = '';
const User = require('../models/user');
const ResumeFile = require('../models/resumeFile');
const ResumeAnalysis = require('../models/resumeAnalysis');
const GitHubCache = require('../models/githubAnalysisCache');
const AnalysisCache = require('../models/analysisCache');
const Progress = require('../models/userCourseProgress');
const CareerSprint = require('../models/careerSprint');
const PublicProfile = require('../models/publicProfile');
const signals = require('../services/developerSignalService');
const engine = require('../services/recommendationEngineService');
const ai = require('../services/aiservice');
let aiCalls = 0;
const originalAI = ai.runAIAnalysis;
ai.runAIAnalysis = async () => {
  aiCalls++;
  throw new Error('Ordinary learning reads must not invoke AI.');
};
const output = path.resolve(__dirname, '../../verification/courses/final');
const screenshotOutput = path.resolve(__dirname, '../../../frontend/verification/courses/final');
const webRoot = path.resolve(__dirname, '../../../frontend/dist/frontend/browser');
const owner = new mongoose.Types.ObjectId(),
  foreign = new mongoose.Types.ObjectId();
const username = 'lh-final-' + owner.toString().slice(-10);
const profile = {
  careerStack: 'Backend',
  activeCareerStack: 'Backend',
  experienceLevel: 'Intern',
  activeExperienceLevel: 'Intern',
  activeGithubUsername: username,
  isConfigured: true,
};
let server, browser;
const result = {
  startedAt: new Date().toISOString(),
  bundle: fs.readdirSync(webRoot).find((file) => /^main-.*\.js$/.test(file)),
  fixtureOwners: [String(owner), String(foreign)],
  environment:
    'Real local MongoDB, real JWT middleware, production course/progress/Sprint/profile HTTP handlers, production Angular bundle. Owned seeded evidence, no pre-existing users. Redis configured off.',
  traces: [],
  security: [],
  journeys: [],
  screenshots: [],
  pageErrors: [],
};
const token = (id, expiresIn = '10m') =>
  jwt.sign({ id: String(id) }, process.env.JWT_SECRET, {
    algorithm: 'HS256',
    issuer: process.env.JWT_ISSUER || 'devinsight-api',
    audience: process.env.JWT_AUDIENCE || 'devinsight-web',
    expiresIn,
  });
async function uiSettled(page) {
  await page.waitForFunction(() => {
    const shell = document.querySelector('.shell-body');
    return !shell || shell.classList.contains('shell-body--mobile') === innerWidth <= 768;
  });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise(requestAnimationFrame);
    await Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => {})),
    );
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  });
}
async function capture(page, name) {
  await page.locator('app-courses h1').evaluate((el) => {
    for (let node = el; node; node = node.parentElement) node.scrollTop = 0;
    window.scrollTo(0, 0);
  });
  await uiSettled(page);
  const bounds = await page.locator('.courses-page').evaluate((el) => ({
    left: el.getBoundingClientRect().left,
    right: el.getBoundingClientRect().right,
    viewport: innerWidth,
    overflow: el.scrollWidth > el.clientWidth + 1,
  }));
  assert.ok(
    bounds.left >= 0 && bounds.right <= bounds.viewport && !bounds.overflow,
    'Capture only a settled, unclipped Learning Hub layout',
  );
  await page.screenshot({ path: path.join(screenshotOutput, name) });
  result.screenshots.push(name);
}
(async () => {
  fs.mkdirSync(output, { recursive: true });
  fs.mkdirSync(screenshotOutput, { recursive: true });
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  const { migrateCourseIndexes } = require('./migrateCourseIndexes');
  const freshCollection = mongoose.connection.db.collection('learning_migration_probe_' + owner);
  try {
    const firstMigration = await migrateCourseIndexes({ collection: freshCollection });
    assert.ok(firstMigration.results.every((index) => index.action === 'created'));
    const repeatedMigration = await migrateCourseIndexes({ collection: freshCollection });
    assert.ok(repeatedMigration.results.every((index) => index.action === 'exists'));
    result.freshNamespaceMigration = {
      created: firstMigration.results,
      repeated: repeatedMigration.results,
    };
  } finally {
    await freshCollection.drop().catch((error) => {
      if (error.code !== 26) throw error;
    });
  }
  await migrateCourseIndexes(AnalysisCache, Progress);
  await User.create([
    {
      _id: owner,
      name: 'Learning Verification',
      email: owner + '@learning.test',
      password: 'isolated-test-password',
      ...profile,
    },
    {
      _id: foreign,
      name: 'Other Verification',
      email: foreign + '@learning.test',
      password: 'isolated-test-password',
      activeCareerStack: 'Frontend',
      activeExperienceLevel: 'Student',
    },
  ]);
  const file = await ResumeFile.create({
    userId: owner,
    fileName: 'owned-verification.pdf',
    fileUrl: '/verification-only',
    fileSize: 1,
  });
  await User.updateOne({ _id: owner }, { activeResumeFileId: file._id });
  const resume = await ResumeAnalysis.create({
    userId: owner,
    fileId: file._id,
    fileName: file.fileName,
    fileSize: 1,
    analyzedAt: new Date(),
    resumeSignals: {
      skills: ['Node.js'],
      scoring: { score: null, ruleVersion: 'resume-overall-score-v1' },
    },
  });
  const githubData = {
    fetchedAt: new Date().toISOString(),
    repositories: [{ name: 'owned-verification', hasReadme: true }],
    dataAvailability: { repositories: 'complete' },
  };
  await GitHubCache.create({
    githubUsername: username,
    normalizedUsername: username,
    result: githubData,
    expiresAt: new Date(Date.now() + 3600000),
  });
  const evidence = {
    ruleVersion: engine.SKILL_RULE,
    coverage: null,
    sourceReferences: Object.values(
      engine.sourceMetadata({ username, githubData, resumeAnalysis: resume.toObject() }),
    ),
    skills: [
      { name: 'SQL', status: 'CLAIMED_ONLY', requirement: 'REQUIRED' },
      { name: 'Docker', status: 'PARTIAL', requirement: 'REQUIRED' },
      { name: 'Testing', status: 'UNKNOWN', requirement: 'REQUIRED' },
      { name: 'React', status: 'NOT_EVIDENCED', requirement: 'OPTIONAL' },
      { name: 'Node.js', status: 'DEMONSTRATED', requirement: 'REQUIRED' },
    ],
  };
  const snapshot = await AnalysisCache.create({
    userId: owner,
    githubUsername: username,
    careerStack: 'Backend',
    experienceLevel: 'Intern',
    ...signals.buildResumeCacheIdentity({ resumeAnalysis: resume.toObject() }),
    analysisVersion: 'v8-skill-evidence-coverage',
    signalHash: 'owned-final-verification',
    analysisData: evidence,
  });
  const app = express();
  app.use(express.json({ limit: '16kb' }));
  app.use('/api/courses', require('../routes/courseRoutes'));
  app.use('/api/career-sprints', require('../routes/careerSprint.routes'));
  app.use('/api/profile', require('../routes/profile.routes'));
  app.use('/api', (_req, res) =>
    res.status(404).json({ message: 'Background endpoint outside verification harness' }),
  );
  app.use(express.static(webRoot));
  app.get('/{*splat}', (_req, res) => res.sendFile(path.join(webRoot, 'index.html')));
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = async (route, method = 'GET', body, userId = owner, authOverride) => {
    const response = await fetch(origin + '/api' + route, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(userId ? { Authorization: 'Bearer ' + (authOverride || token(userId)) } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return {
      status: response.status,
      cache: response.headers.get('cache-control'),
      body: response.status === 204 ? null : await response.json(),
    };
  };
  const first = await request('/courses?limit=20');
  assert.equal(first.status, 200);
  assert.equal(first.body.personalization.status, 'evidence-informed');
  const second = await request('/courses?limit=20&page=2');
  const catalog = [...first.body.courses, ...second.body.courses];
  assert.equal(catalog.length, 27);
  assert.equal(new Set(catalog.map((course) => course.id)).size, 27);
  assert.deepEqual(first.body.recommendedBasedOn.skillGapsUsed, [
    'SQL',
    'Docker',
    'Testing',
    'React',
  ]);
  result.initial = {
    total: first.body.total,
    source: first.body.recommendedBasedOn.source,
    personalization: first.body.personalization,
    signalHash: first.body.cacheMetadata.signalHash,
    aiCalls,
  };
  result.catalog = catalog.map((course) => ({
    id: course.id,
    relevanceScore: course.relevanceScore,
    finalScore: course.finalScore,
    whyRecommended: course.whyRecommended,
  }));
  assert.equal((await request('/courses/my-learning', 'GET', undefined, null)).status, 401);
  assert.equal(
    (await request('/courses/my-learning', 'GET', undefined, owner, token(owner, '-1s'))).status,
    401,
  );
  assert.equal((await request('/courses?platform=Udemy&platform=Coursera')).status, 400);
  const bracketQuery = await request('/courses?platform[$ne]=All');
  assert.equal(bracketQuery.status, 200);
  assert.equal(bracketQuery.body.total, 27);
  assert.equal((await request('/courses/bad-id/progress', 'PUT', { status: 'saved' })).status, 400);
  assert.equal(
    (
      await request('/courses/fb_u2/progress', 'PUT', {
        status: 'saved',
        url: 'https://evil.test',
        userId: String(foreign),
      })
    ).status,
    400,
  );
  result.security.push(
    'Missing/expired real JWT rejected; duplicate scalar query and invalid IDs/metadata rejected; Express bracket-notation keys are ignored rather than interpreted as database operators.',
  );

  browser = await chromium.launch({
    headless: true,
    executablePath:
      'C:/Users/ahmad.hassan/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe',
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(
    ({ auth, id, profile, origin }) => {
      Object.defineProperty(window, '__DEVINSIGHT_API_ORIGIN__', {
        value: origin,
        writable: false,
      });
      localStorage.setItem('token', auth);
      localStorage.setItem(
        'user',
        JSON.stringify({
          _id: id,
          name: 'Learning Verification',
          role: 'developer',
          activeGithubUsername: profile.activeGithubUsername,
        }),
      );
      localStorage.setItem('devinsight_career_profile', JSON.stringify(profile));
      localStorage.setItem('devinsight_theme', 'light');
    },
    { auth: token(owner), id: String(owner), profile, origin },
  );
  const page = await context.newPage();
  page.on('pageerror', (error) => result.pageErrors.push(error.message));
  // Only unrelated shell calls and neighboring-module smoke data use fixtures. Learning/profile/Sprint HTTP remains real.
  const relatedModes = { skillGap: false, recommendations: false };
  await page.route('**/api/**', (route) => {
    const url = new URL(route.request().url());
    if (/^\/api\/(courses|profile|career-sprints)(\/|$)/.test(url.pathname))
      return route.continue();
    if (url.pathname === '/api/skillgap/skill-gap' && relatedModes.skillGap)
      return route.fulfill({
        json: {
          ...require('../../../frontend/scripts/skill-gap-browser-fixture.cjs').fixture(),
          username,
          careerStack: 'Backend',
          experienceLevel: 'Intern',
        },
      });
    if (url.pathname.startsWith('/api/recommendations') && relatedModes.recommendations)
      return route.fulfill({
        json: {
          ...require('../../../frontend/scripts/recommendations-browser-fixture.cjs').fixture(),
          username,
          careerStack: 'Backend',
          experienceLevel: 'Intern',
        },
      });
    if (url.pathname.includes('active-username')) return route.fulfill({ json: { username } });
    return route.fulfill({
      json: {
        data: [],
        notifications: [],
        resumes: [],
        integrations: [],
        organizations: [],
        teams: [],
        profile: {},
        user: { _id: String(owner), role: 'developer' },
      },
    });
  });
  await page.goto(origin + '/app/courses');
  await page.getByRole('button', { name: 'Save for Later', exact: true }).first().waitFor();
  await uiSettled(page);
  await page.getByText('Backend · Intern', { exact: true }).waitFor();
  for (const theme of ['light', 'dark']) {
    if (theme === 'dark') await page.getByRole('button', { name: /Current theme is/ }).click();
    for (const width of [1440, 375]) {
      await page.setViewportSize({ width, height: width === 375 ? 900 : 1000 });
      await capture(page, `real-${theme}-${width}.png`);
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  // Independent manual arithmetic for three different evidence situations; backend remains unchanged.
  const cases = [
    {
      id: 'fb_c5',
      skill: 'SQL',
      status: 'CLAIMED_ONLY',
      terms: { base: 25, target: 18, known: 0, career: 10, level: 12 },
      expected: 65,
    },
    {
      id: 'fb_u3',
      skill: 'Docker',
      status: 'PARTIAL',
      terms: { base: 25, target: 18, known: 0, career: 10, level: 0 },
      expected: 53,
    },
    {
      id: 'fb_u2',
      skill: 'Node.js',
      status: 'DEMONSTRATED',
      terms: { base: 25, target: 0, known: 4, career: 10, level: 0 },
      expected: 39,
    },
  ];
  for (const example of cases) {
    const course = catalog.find((course) => course.id === example.id);
    assert.ok(course);
    assert.equal(course.relevanceScore, example.expected);
    assert.equal(course.finalScore, Math.round(example.expected * 0.55));
    assert.equal(course.rating, null);
    assert.equal(course.duration, null);
    await page.goto(origin + '/app/courses?skill=' + encodeURIComponent(example.skill));
    const title = page.getByRole('heading', { name: course.title, exact: true });
    await title.waitFor();
    const card = page.locator('app-course-card').filter({ has: title });
    await card.getByText('Provider rating unavailable', { exact: true }).waitFor();
    const filtered = await request(
      '/courses?skill=' + encodeURIComponent(example.skill) + '&limit=20',
    );
    const dto = filtered.body.courses.find((course) => course.id === example.id);
    assert.ok(dto);
    assert.equal(dto.relevanceScore, example.expected + 14);
    assert.ok((await card.innerText()).includes(dto.whyRecommended));
    result.traces.push({
      ...example,
      title: course.title,
      source: course.provenance,
      unfiltered: {
        relevanceScore: course.relevanceScore,
        finalScore: course.finalScore,
        reason: course.whyRecommended,
      },
      deepLink: {
        topicBonus: 14,
        relevanceScore: dto.relevanceScore,
        finalScore: dto.finalScore,
        reason: dto.whyRecommended,
      },
      uiTitle: await title.innerText(),
      uiReason: dto.whyRecommended,
      sourceHash: filtered.body.cacheMetadata.signalHash,
    });
  }
  const nodeTitle = catalog.find((course) => course.id === 'fb_u2').title;
  const nodeCard = page
    .locator('app-course-card')
    .filter({ has: page.getByRole('heading', { name: nodeTitle, exact: true }) });
  // Warm the existing Sprint client cache before the handoff, as a returning user would.
  const warmSprint = page.waitForResponse(
    (response) =>
      response.url().includes('/api/career-sprints/current') && response.status() === 200,
  );
  await page
    .locator('.related-links')
    .getByRole('link', { name: 'Career Sprint', exact: false })
    .click();
  await warmSprint;
  await uiSettled(page);
  await page.goBack();
  await nodeCard.getByRole('button', { name: 'Save for Later', exact: true }).waitFor();
  await nodeCard.getByRole('button', { name: 'Save for Later', exact: true }).click();
  await nodeCard.getByLabel('Learning status').waitFor();
  assert.equal(
    (await Progress.findOne({ userId: owner, courseId: 'fb_u2' }).lean()).status,
    'saved',
  );
  await nodeCard.getByLabel('Learning status').selectOption('in_progress');
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('app-course-card')]
        .find((card) => card.querySelector('h3')?.textContent.includes('Node.js, Express'))
        ?.querySelector('select')?.value === 'in_progress',
  );
  await nodeCard.getByText('Notes and progress', { exact: true }).click();
  await nodeCard
    .getByLabel('Private learning notes')
    .fill('Owned end-to-end note <script>not executable</script>');
  await nodeCard.getByLabel('Progress %').fill('0');
  await nodeCard.getByRole('button', { name: 'Save notes and progress' }).click();
  await nodeCard.getByText('0% · user-entered progress', { exact: true }).waitFor();
  await nodeCard.getByRole('button', { name: 'Add to Sprint', exact: true }).click();
  await nodeCard.getByRole('link', { name: 'Open Career Sprint' }).waitFor();
  const sprint = await CareerSprint.findOne({ userId: owner }).lean();
  assert.equal(sprint.tasks.length, 1);
  assert.match(sprint.tasks[0].description, /Course: fb_u2\nSkill: Node.js/);
  assert.equal(sprint.tasks[0].points, 3);
  const duplicates = await Promise.all(
    Array.from({ length: 5 }, () => request('/courses/fb_u2/career-sprint', 'POST', {})),
  );
  assert.ok(duplicates.every((response) => response.status === 200 && response.body.alreadyAdded));
  assert.equal(
    (await request('/courses/fb_u2/career-sprint', 'POST', { targetSkill: 'Express' })).status,
    409,
  );
  assert.equal((await request('/courses/fb_u2/career-sprint', 'POST', {}, foreign)).status, 404);
  await nodeCard.getByRole('link', { name: 'Open Career Sprint' }).click();
  await page.waitForURL('**/app/career-sprint');
  await page.getByText(sprint.tasks[0].title, { exact: true }).waitFor({ timeout: 5000 });
  result.journeys.push(
    'Browser Save → real Mongo In Progress/notes/0% → atomic Sprint task → visible in real Career Sprint UI; duplicate/conflict/ownership checks passed.',
  );
  await page.goto(origin + '/app/courses?skill=Node.js');
  await page.getByRole('button', { name: 'My Learning', exact: true }).click();
  const savedCard = page.locator('app-my-learning app-course-card').first();
  await savedCard.getByLabel('Learning status').waitFor();
  assert.equal(await savedCard.getByLabel('Learning status').inputValue(), 'in_progress');
  await savedCard.getByText('Notes and progress', { exact: true }).click();
  assert.match(
    await savedCard.getByLabel('Private learning notes').inputValue(),
    /Owned end-to-end note/,
  );
  await savedCard.getByLabel('Learning status').selectOption('completed');
  await savedCard.getByText(/Completed · self-reported/).waitFor();
  const completed = await Progress.findOne({ userId: owner, courseId: 'fb_u2' }).lean();
  assert.equal(completed.status, 'completed');
  assert.equal(completed.progressPercent, 0);
  assert.equal((await request('/courses/fb_u2/career-sprint', 'POST', {})).status, 409);
  assert.deepEqual((await AnalysisCache.findById(snapshot._id).lean()).analysisData, evidence);
  assert.equal(await PublicProfile.countDocuments({ userId: owner }), 0);
  assert.equal((await request('/courses/my-learning', 'GET', undefined, foreign)).body.total, 0);
  // A transient real-handler persistence failure must leave both Mongo and the rendered status unchanged.
  const updateOne = Progress.findOneAndUpdate;
  Progress.findOneAndUpdate = () => ({
    lean: async () => {
      throw new Error('Controlled transient storage outage');
    },
  });
  try {
    await savedCard.getByLabel('Learning status').selectOption('saved');
    await savedCard
      .getByText('Learning progress is temporarily unavailable. Please retry.', { exact: true })
      .waitFor();
    assert.equal(await savedCard.getByLabel('Learning status').inputValue(), 'completed');
    assert.equal(
      (await Progress.findOne({ userId: owner, courseId: 'fb_u2' }).lean()).status,
      'completed',
    );
  } finally {
    Progress.findOneAndUpdate = updateOne;
  }
  if (!(await savedCard.getByLabel('Private learning notes').isVisible()))
    await savedCard.getByText('Notes and progress', { exact: true }).click();
  await savedCard.getByRole('button', { name: 'Remove from My Learning' }).click();
  await page.getByText('Your learning list starts here', { exact: true }).waitFor();
  assert.equal(await Progress.countDocuments({ userId: owner }), 0);
  assert.equal((await CareerSprint.findOne({ userId: owner }).lean()).tasks.length, 1);
  result.journeys.push(
    'Reload persisted status/notes; self-reported completion retains 0%; transient storage failure retained status/data; removal persisted; skill snapshot and public portfolio unchanged.',
  );
  for (const [module, url] of [
    ['skillGap', '/app/skill-gap'],
    ['recommendations', '/app/recommendations'],
  ]) {
    relatedModes[module] = true;
    await page.goto(origin + url);
    const link = page.locator('a[href*="/app/courses?"]').first();
    await link.waitFor();
    const href = await link.getAttribute('href');
    await link.click();
    await page.waitForURL('**/app/courses?**');
    await page.locator('app-course-card h3').first().waitFor();
    result.journeys.push(
      `${module} UI smoke with existing synthetic neighboring-module fixture: actual ${href} link opens real personalized Courses API/UI.`,
    );
  }
  // Prove new source identity invalidates warm personalized results.
  await AnalysisCache.updateOne(
    { _id: snapshot._id },
    { $set: { 'analysisData.skills.0.status': 'DEMONSTRATED' } },
  );
  const changed = await request('/courses?limit=20');
  assert.notEqual(changed.body.cacheMetadata.signalHash, first.body.cacheMetadata.signalHash);
  assert.ok(!changed.body.recommendedBasedOn.skillGapsUsed.includes('SQL'));
  await AnalysisCache.updateOne(
    { _id: snapshot._id },
    { $set: { 'analysisData.ruleVersion': 'legacy' } },
  );
  const incompatible = await request('/courses?limit=20');
  assert.equal(incompatible.body.personalization.status, 'career-context-only');
  assert.deepEqual(incompatible.body.recommendedBasedOn.skillGapsUsed, []);
  result.sourceFreshness = { changedFingerprint: true, incompatibleEvidenceExcluded: true };
  // Browser session expiry is verified by real JWT middleware, not an intercepted 401.
  await page.evaluate((auth) => localStorage.setItem('token', auth), token(owner, '-1s'));
  await page.getByRole('button', { name: 'Refresh courses', exact: true }).click();
  await page.waitForURL('**/auth/login**');
  assert.equal(aiCalls, 0);
  assert.deepEqual(result.pageErrors, []);
  result.aiCalls = aiCalls;
  result.status = 'VERIFIED';
  console.log(
    JSON.stringify({
      status: result.status,
      traces: result.traces.length,
      journeys: result.journeys.length,
      screenshots: result.screenshots.length,
      aiCalls,
    }),
  );
})()
  .catch((error) => {
    result.status = 'BLOCKED';
    result.error = error.stack;
    console.error(error.stack);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (browser) await browser.close();
    if (server) await new Promise((resolve) => server.close(resolve));
    if (mongoose.connection.readyState === 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      await Promise.all([
        User.deleteMany({ _id: { $in: [owner, foreign] } }),
        ...[ResumeFile, ResumeAnalysis, AnalysisCache, Progress, CareerSprint, PublicProfile].map(
          (model) => model.deleteMany({ userId: { $in: [owner, foreign] } }),
        ),
        GitHubCache.deleteMany({ normalizedUsername: username }),
      ]);
      result.cleanup = {
        ownedUsersRemaining: await User.countDocuments({ _id: { $in: [owner, foreign] } }),
        ownedProgressRemaining: await Progress.countDocuments({
          userId: { $in: [owner, foreign] },
        }),
      };
      await mongoose.disconnect();
    }
    await require('../services/redisCacheService').closeRedisCache();
    ai.runAIAnalysis = originalAI;
    if (liveYoutubeKey === undefined) delete process.env.YOUTUBE_API_KEY;
    else process.env.YOUTUBE_API_KEY = liveYoutubeKey;
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, 'end-to-end.json'), JSON.stringify(result, null, 2) + '\n');
  });
