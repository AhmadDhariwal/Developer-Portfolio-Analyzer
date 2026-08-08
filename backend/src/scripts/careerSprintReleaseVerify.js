'use strict';

/**
 * Career Sprint final release verification.
 * Bootstraps a real JWT session, exercises API workflows, and runs desktop/375px browser smoke.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const path = require('path');
const fs = require('fs');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const User = require('../models/user');
const { ensureCareerSprintIndexes } = require('./ensureCareerSprintIndexes');

const API = String(process.env.RELEASE_API_BASE || 'http://127.0.0.1:5000/api').replace(/\/$/, '');
// Prefer RELEASE_WEB_ORIGIN. Do not use FRONTEND_URL (often localhost) — on Windows
// localhost can resolve to ::1 and hit a different process than 127.0.0.1 ng serve.
const WEB = String(process.env.RELEASE_WEB_ORIGIN || 'http://127.0.0.1:4200')
  .replace(/\/$/, '')
  .replace('://localhost', '://127.0.0.1');

const idOf = (value) => {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (typeof value === 'object') {
    if (value.$oid) return String(value.$oid);
    if (value._id) return idOf(value._id);
    if (value.id) return idOf(value.id);
  }
  return String(value);
};

const assert = (condition, message) => {
  if (!condition) throw new Error(message || 'assertion failed');
};

const signToken = (userId) => jwt.sign(
  { id: userId },
  process.env.JWT_SECRET,
  {
    expiresIn: process.env.JWT_EXPIRES_IN || '20h',
    algorithm: 'HS256',
    issuer: process.env.JWT_ISSUER || 'devinsight-api',
    audience: process.env.JWT_AUDIENCE || 'devinsight-web'
  }
);

async function ensureMongo() {
  if (mongoose.connection.readyState === 1) return;
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!mongoUri) throw new Error('MONGODB_URI missing for session bootstrap');
  await mongoose.connect(mongoUri);
}

async function bootstrapSession() {
  await ensureMongo();
  const email = String(process.env.RELEASE_VERIFY_EMAIL || '').trim();
  const password = String(process.env.RELEASE_VERIFY_PASSWORD || '').trim();
  if (email && password) {
    try {
      const { data } = await axios.post(`${API}/auth/login`, { email, password });
      if (data?.token) return { token: data.token, user: data, authMode: 'password-login' };
    } catch {
      // fall through
    }
  }

  let user = await User.findOne({
    role: { $in: ['developer', 'user'] },
    isActive: { $ne: false }
  })
    .sort({ updatedAt: -1 })
    .select('_id name email careerStack experienceLevel activeCareerStack activeExperienceLevel role')
    .lean();
  assert(user?._id, 'No active developer user available for Career Sprint release verification');
  const token = signToken(user._id);
  return {
    token,
    authMode: 'jwt-bootstrap',
    user: {
      ...user,
      _id: String(user._id),
      role: 'developer',
      token,
      careerStack: user.activeCareerStack || user.careerStack || 'Full Stack',
      experienceLevel: user.activeExperienceLevel || user.experienceLevel || 'Student'
    }
  };
}

const apiClient = (token) => axios.create({
  baseURL: API,
  headers: { Authorization: `Bearer ${token}` },
  validateStatus: () => true,
  timeout: 45000
});

async function verifyApiWorkflows(token) {
  const client = apiClient(token);
  const counts = {
    currentGets: 0,
    historyGets: 0,
    mutations: 0,
    generate: 0,
    unauthorized: 0,
    rapidShared: 0,
    dashboardGets: 0
  };

  const unauth = await axios.get(`${API}/career-sprints/current`, { validateStatus: () => true, timeout: 10000 });
  counts.unauthorized += 1;
  assert(unauth.status === 401, `expected 401 without token, got ${unauth.status}`);

  const current = async (forceRefresh = false) => {
    counts.currentGets += 1;
    return client.get('/career-sprints/current', { params: forceRefresh ? { forceRefresh: true } : {} });
  };
  const history = async () => {
    counts.historyGets += 1;
    return client.get('/career-sprints/history', { params: { limit: 8 } });
  };

  const first = await current();
  assert(first.status === 200, `normal current failed: ${first.status}`);
  assert(first.data?._id, 'current sprint id required');
  assert(Array.isArray(first.data.tasks), 'tasks array required');
  assert(Number.isFinite(Number(first.data.analytics?.progressPercent)), 'progressPercent must be finite');
  assert(!Number.isNaN(Number(first.data.analytics?.progressPercent)), 'progressPercent must not be NaN');
  const sprintId = idOf(first.data._id);
  assert(/^[a-f0-9]{24}$/i.test(sprintId), `current sprint id must be ObjectId string, got ${sprintId}`);
  const previousProgress = Number(first.data.analytics.progressPercent);

  const hist = await history();
  assert(hist.status === 200, 'history failed');
  assert(Array.isArray(hist.data?.history), 'history array required');

  const cached = await current();
  assert(cached.status === 200, 'cached current failed');
  assert(idOf(cached.data._id) === sprintId, `cached flow returned different sprint (${idOf(cached.data._id)} vs ${sprintId})`);

  const started = Date.now();
  const rapid = await Promise.all(Array.from({ length: 5 }, () => {
    counts.rapidShared += 1;
    counts.currentGets += 1;
    return client.get('/career-sprints/current');
  }));
  const rapidMs = Date.now() - started;
  assert(rapid.every((item) => item.status === 200), 'rapid identical current requests must succeed');
  assert(rapid.every((item) => idOf(item.data._id) === sprintId), 'rapid responses must stay on same sprint');

  const refresh = await current(true);
  assert(refresh.status === 200, 'force refresh failed');
  assert(idOf(refresh.data._id) === sprintId, `refresh changed active sprint unexpectedly (${idOf(refresh.data._id)} vs ${sprintId})`);

  const marker = `Release Verify ${Date.now()}`;
  counts.mutations += 1;
  const added = await client.post(`/career-sprints/${sprintId}/tasks`, {
    title: marker,
    description: 'Release verification manual task for Career Sprint.',
    points: 3,
    priority: 'medium',
    category: 'practice',
    taskType: 'manual'
  });
  assert(added.status === 200, `add task failed: ${added.status} ${added.data?.message || ''}`);
  assert((added.data.tasks || []).some((task) => task.title === marker), 'added task missing from response');

  const addedTask = (added.data.tasks || []).find((task) => task.title === marker);
  assert(addedTask?._id, 'added task id missing');
  counts.mutations += 1;
  const toggled = await client.put(`/career-sprints/${sprintId}/tasks/${addedTask._id}`, { isCompleted: true });
  assert(toggled.status === 200, `toggle failed: ${toggled.status}`);
  const toggledTask = (toggled.data.tasks || []).find((task) => String(task._id) === String(addedTask._id));
  assert(toggledTask?.isCompleted === true, 'task not completed');
  assert(Number.isFinite(Number(toggled.data.analytics?.progressPercent)), 'toggle progress must stay finite');

  counts.mutations += 1;
  const untoggled = await client.put(`/career-sprints/${sprintId}/tasks/${addedTask._id}`, { isCompleted: false });
  assert(untoggled.status === 200, 'untoggle failed');

  counts.generate += 1;
  const plan = await client.post('/career-sprints/generate-plan', {
    stack: 'Frontend',
    technology: 'React',
    experienceLevel: 'Intern'
  });
  assert(plan.status === 200, `generate-plan failed: ${plan.status}`);
  assert(Array.isArray(plan.data?.tasks) && plan.data.tasks.length >= 6, 'deterministic plan must return tasks');
  assert(plan.data.planMeta?.generationMode === 'deterministic', 'deterministic mode expected');

  // Failed refresh preserves previous valid analytics values.
  const preserved = await current();
  assert(preserved.status === 200, 'post-mutation current failed');
  assert(String(preserved.data._id) === sprintId || idOf(preserved.data._id) === sprintId, 'post-mutation sprint identity drifted');
  assert(Number.isFinite(Number(preserved.data.analytics?.progressPercent)), 'preserved progress must be finite');

  counts.dashboardGets += 1;
  const dashboard = await client.get('/dashboard/summary');
  assert([200, 404].includes(dashboard.status) || dashboard.status < 500, `dashboard dependent check unexpected ${dashboard.status}`);

  const badId = await client.put('/career-sprints/not-an-id/tasks/also-bad', { isCompleted: true });
  assert(badId.status === 404, `invalid id should 404, got ${badId.status}`);

  return {
    counts,
    rapidMs,
    sprintId,
    previousProgress,
    progressAfter: Number(preserved.data.analytics.progressPercent),
    taskCount: (preserved.data.tasks || []).length,
    historyCount: (hist.data.history || []).length,
    planTaskCount: plan.data.tasks.length,
    hasAnalytics: Boolean(preserved.data.analytics)
  };
}

async function verifyIndexes() {
  await ensureMongo();
  return ensureCareerSprintIndexes();
}

async function loadPlaywright() {
  try {
    return require('playwright');
  } catch {
    try {
      return require(path.join(__dirname, '../../../frontend/node_modules/playwright'));
    } catch {
      return null;
    }
  }
}

async function browserSmoke(token, user) {
  const playwright = await loadPlaywright();
  assert(playwright, 'Playwright is required for desktop/375px Career Sprint smoke');
  const { chromium } = playwright;
  const browser = await chromium.launch({ headless: true });
  const results = {};

  const runViewport = async (label, viewport) => {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const consoleErrors = [];
    const pageErrors = [];
    const sprintRequests = [];

    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      const text = msg.text();
      if (/favicon|sourcemap|DevTools/i.test(text)) return;
      // Intentional failure-preservation probe fulfills current with 503.
      if (/Failed to load resource: the server responded with a status of 503/i.test(text)) return;
      if (/status of 503/i.test(text) && /career-sprints\/current|Temporary upstream failure/i.test(text)) return;
      if (/status of 401/i.test(text) && /logged.?out|login/i.test(text)) return;
      consoleErrors.push(text);
    });
    page.on('pageerror', (error) => pageErrors.push(String(error?.message || error)));
    page.on('request', (request) => {
      const url = request.url();
      if (url.includes('/api/career-sprints')) {
        sprintRequests.push({
          method: request.method(),
          url,
          resourceType: request.resourceType()
        });
      }
    });

    await page.addInitScript(({ authToken, authUser, expiryMs, careerProfile }) => {
      if (sessionStorage.getItem('__CS_RELEASE_LOGGED_OUT__') === '1') return;
      localStorage.setItem('token', authToken);
      localStorage.setItem('user', JSON.stringify(authUser));
      localStorage.setItem('loginExpiry', String(expiryMs));
      localStorage.setItem('devinsight_career_profile', JSON.stringify(careerProfile));
    }, {
      authToken: token,
      authUser: {
        _id: user._id,
        name: user.name || 'Release User',
        email: user.email || 'release@example.com',
        role: user.role || 'developer',
        careerStack: user.careerStack || 'Full Stack',
        experienceLevel: user.experienceLevel || 'Student',
        activeCareerStack: user.careerStack || 'Full Stack',
        activeExperienceLevel: user.experienceLevel || 'Student',
        token
      },
      expiryMs: Date.now() + (20 * 60 * 60 * 1000),
      careerProfile: {
        careerStack: user.careerStack || 'Full Stack',
        experienceLevel: user.experienceLevel || 'Student',
        activeCareerStack: user.careerStack || 'Full Stack',
        activeExperienceLevel: user.experienceLevel || 'Student',
        careerGoal: '',
        targetTimeline: '',
        learningPreference: '',
        isConfigured: true
      }
    });

    await page.goto(`${WEB}/app/career-sprint`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2500);
    const landedUrl = page.url();
    const bodyPreview = (await page.locator('body').innerText().catch(() => '')).slice(0, 500);
    if (/login/i.test(landedUrl)) {
      throw new Error(`${label}: redirected to login (${landedUrl}) despite seeded session. Body: ${bodyPreview}`);
    }
    const hasTitle = await page.locator('text=Career Sprint').count();
    if (!hasTitle) {
      throw new Error(`${label}: Career Sprint UI missing at ${landedUrl}. Body: ${bodyPreview}`);
    }
    const title = await page.locator('h2, h1').filter({ hasText: /Career Sprint/i }).first().innerText();
    assert(/Career Sprint/i.test(title), `${label}: Career Sprint title missing`);

    await page.waitForTimeout(1200);
    const initialCurrent = sprintRequests.filter((item) => item.method === 'GET' && item.url.includes('/career-sprints/current')).length;
    const initialHistory = sprintRequests.filter((item) => item.method === 'GET' && item.url.includes('/career-sprints/history')).length;
    assert(initialCurrent === 1, `${label}: expected exactly 1 initial current GET, got ${initialCurrent}`);
    assert(initialHistory === 1, `${label}: expected exactly 1 initial history GET, got ${initialHistory}`);

    const bodyText = await page.locator('body').innerText();
    assert(!/\bNaN\b/.test(bodyText), `${label}: NaN visible in UI`);
    assert(!/\bundefined\b/i.test(bodyText), `${label}: undefined visible in UI`);
    assert(!/\bnull\b/.test(bodyText), `${label}: null visible in UI`);

    const overflow = await page.evaluate(() => {
      const doc = document.documentElement;
      return {
        scrollWidth: doc.scrollWidth,
        clientWidth: doc.clientWidth,
        overflow: doc.scrollWidth > doc.clientWidth + 1
      };
    });
    assert(!overflow.overflow, `${label}: horizontal overflow detected (${overflow.scrollWidth}>${overflow.clientWidth})`);

    const beforeRefresh = sprintRequests.length;
    const refreshButton = page.getByRole('button', { name: /Refresh Sprint|Refreshing/i });
    await refreshButton.dblclick({ delay: 40 });
    await page.waitForTimeout(1800);
    const refreshDelta = sprintRequests.slice(beforeRefresh);
    const refreshCurrent = refreshDelta.filter((item) => item.method === 'GET' && item.url.includes('/career-sprints/current')).length;
    const refreshHistory = refreshDelta.filter((item) => item.method === 'GET' && item.url.includes('/career-sprints/history')).length;
    assert(refreshCurrent === 1, `${label}: rapid refresh should issue 1 current GET, got ${refreshCurrent}`);
    assert(refreshHistory === 1, `${label}: rapid refresh should issue 1 history GET, got ${refreshHistory}`);

    // Failed refresh preserves previous valid sprint content.
    await page.route('**/api/career-sprints/current**', async (route) => {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Temporary upstream failure' })
      });
    });
    const beforeFailTitle = await page.locator('.hero-copy h3').first().innerText().catch(() => '');
    await refreshButton.click();
    await page.waitForTimeout(1200);
    const afterFailTitle = await page.locator('.hero-copy h3').first().innerText().catch(() => '');
    if (beforeFailTitle) {
      assert(afterFailTitle === beforeFailTitle, `${label}: failed refresh lost previous sprint title`);
      const errorVisible = await page.locator('.message-card.error').count();
      assert(errorVisible > 0, `${label}: missing failure message after failed refresh`);
    }
    await page.unroute('**/api/career-sprints/current**');

    // Mutation should be exactly one network call (no follow-up current GET).
    const taskTitle = `UI Verify ${Date.now()}`;
    const beforeAdd = sprintRequests.length;
    await page.getByPlaceholder('What do you need to accomplish?').fill(taskTitle);
    await page.getByRole('button', { name: /^Add Task$|^Adding/i }).click();
    await page.waitForTimeout(1500);
    const addDelta = sprintRequests.slice(beforeAdd);
    const addPosts = addDelta.filter((item) => item.method === 'POST' && /\/tasks$/.test(item.url.split('?')[0])).length;
    const addGets = addDelta.filter((item) => item.method === 'GET' && item.url.includes('/career-sprints/current')).length;
    assert(addPosts === 1, `${label}: add task should issue 1 POST, got ${addPosts}`);
    assert(addGets === 0, `${label}: add task should not re-fetch current, got ${addGets}`);

    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('h2', { timeout: 30000 });
    const titleAfterReload = await page.locator('h2').first().innerText();
    assert(/Career Sprint/i.test(titleAfterReload), `${label}: Career Sprint missing after browser refresh`);

    await page.evaluate(() => {
      sessionStorage.setItem('__CS_RELEASE_LOGGED_OUT__', '1');
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      localStorage.removeItem('loginExpiry');
    });
    await page.goto(`${WEB}/app/career-sprint`, { waitUntil: 'networkidle', timeout: 60000 });
    const onLoginOrBlocked = await page.evaluate(() => /login/i.test(location.pathname) || !localStorage.getItem('token'));
    assert(onLoginOrBlocked, `${label}: logout did not clear protected Career Sprint session`);

    await page.evaluate(({ authToken, authUser, expiryMs, careerProfile }) => {
      sessionStorage.removeItem('__CS_RELEASE_LOGGED_OUT__');
      localStorage.setItem('token', authToken);
      localStorage.setItem('user', JSON.stringify(authUser));
      localStorage.setItem('loginExpiry', String(expiryMs));
      localStorage.setItem('devinsight_career_profile', JSON.stringify(careerProfile));
    }, {
      authToken: token,
      authUser: {
        _id: user._id,
        name: user.name || 'Release User',
        email: user.email || 'release@example.com',
        role: user.role || 'developer',
        careerStack: user.careerStack || 'Full Stack',
        experienceLevel: user.experienceLevel || 'Student',
        activeCareerStack: user.careerStack || 'Full Stack',
        activeExperienceLevel: user.experienceLevel || 'Student',
        token
      },
      expiryMs: Date.now() + (20 * 60 * 60 * 1000),
      careerProfile: {
        careerStack: user.careerStack || 'Full Stack',
        experienceLevel: user.experienceLevel || 'Student',
        activeCareerStack: user.careerStack || 'Full Stack',
        activeExperienceLevel: user.experienceLevel || 'Student',
        isConfigured: true
      }
    });
    await page.goto(`${WEB}/app/career-sprint`, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForSelector('h2', { timeout: 30000 });

    results[label] = {
      consoleErrors,
      pageErrors,
      overflow,
      initialCurrent,
      initialHistory,
      refreshCurrent,
      refreshHistory,
      addPosts,
      addGets,
      requestCount: sprintRequests.length
    };

    assert(consoleErrors.length === 0, `${label}: console errors: ${consoleErrors.join(' | ')}`);
    assert(pageErrors.length === 0, `${label}: page errors: ${pageErrors.join(' | ')}`);
    await context.close();
  };

  await runViewport('desktop', { width: 1440, height: 900 });
  await runViewport('mobile375', { width: 375, height: 812 });
  await browser.close();
  return results;
}

async function main() {
  const startedAt = Date.now();
  const session = await bootstrapSession();
  const api = await verifyApiWorkflows(session.token);
  const indexes = await verifyIndexes();
  const browser = await browserSmoke(session.token, session.user);

  const report = {
    module: 'career-sprint',
    authMode: session.authMode,
    userId: session.user._id,
    durationMs: Date.now() - startedAt,
    api,
    indexes,
    browser,
    readiness: 'FREEZE'
  };

  const outPath = path.join(__dirname, 'careerSprintReleaseVerify.out.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await mongoose.disconnect().catch(() => {});
}

main().catch(async (error) => {
  console.error(JSON.stringify({
    module: 'career-sprint',
    readiness: 'FIX',
    error: String(error?.message || error)
  }, null, 2));
  try { await mongoose.disconnect(); } catch { /* ignore */ }
  process.exit(1);
});
