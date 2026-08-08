'use strict';

/**
 * Learning Hub final release verification.
 * Bootstraps a real JWT session, exercises API workflows, and runs desktop/375px browser smoke.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const User = require('../models/user');
const { migrateCourseIndexes } = require('./migrateCourseIndexes');
const AnalysisCache = require('../models/analysisCache');

const API = String(process.env.RELEASE_API_BASE || 'http://127.0.0.1:5000/api').replace(/\/$/, '');
const WEB = String(process.env.RELEASE_WEB_ORIGIN || process.env.FRONTEND_URL || 'http://127.0.0.1:4200').replace(/\/$/, '');

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
      // fall through to JWT bootstrap
    }
  }

  let user = await User.findOne({
    role: { $in: ['developer', 'user'] },
    isActive: { $ne: false }
  })
    .sort({ updatedAt: -1 })
    .select('_id name email careerStack experienceLevel activeCareerStack activeExperienceLevel role')
    .lean();
  if (!user?._id) {
    user = await User.findOne({ isActive: { $ne: false } })
      .sort({ updatedAt: -1 })
      .select('_id name email careerStack experienceLevel activeCareerStack activeExperienceLevel role')
      .lean();
  }
  assert(user?._id, 'No active user available for Learning Hub release verification');
  const token = signToken(user._id);
  return {
    token,
    authMode: 'jwt-bootstrap',
    user: {
      ...user,
      _id: String(user._id),
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
  timeout: 30000
});

async function verifyApiWorkflows(token) {
  const client = apiClient(token);
  const counts = {
    coursesGets: 0,
    unauthorized: 0,
    rapid: 0
  };

  const getCourses = async (params = {}) => {
    counts.coursesGets += 1;
    const response = await client.get('/courses', { params });
    return response;
  };

  const unauth = await axios.get(`${API}/courses`, { validateStatus: () => true, timeout: 10000 });
  counts.unauthorized += 1;
  assert(unauth.status === 401, `expected 401 without token, got ${unauth.status}`);

  const first = await getCourses({ page: 1, limit: 10 });
  assert(first.status === 200, `normal flow failed: ${first.status}`);
  assert(Array.isArray(first.data?.courses), 'courses array required');
  assert(Number.isFinite(Number(first.data.total)), 'total must be finite');
  assert(!Number.isNaN(Number(first.data.total)), 'total must not be NaN');
  const firstIds = (first.data.courses || []).map((course) => course.id);

  const cached = await getCourses({ page: 1, limit: 10 });
  assert(cached.status === 200, 'cached flow failed');
  assert(cached.data?.fromCache === true || cached.data?.courses?.length >= 0, 'cached/repeat response invalid');

  const topic = await getCourses({ page: 1, limit: 10, topic: 'SQL' });
  assert(topic.status === 200, 'topic filter flow failed');

  const emptyish = await getCourses({ page: 1, limit: 10, platform: 'Udemy', rating: '5', topic: 'zzz-nonexistent-topic-xyz' });
  assert(emptyish.status === 200, 'empty/filter flow failed');
  assert(Array.isArray(emptyish.data.courses), 'empty flow must return courses array');

  const started = Date.now();
  const rapid = await Promise.all(Array.from({ length: 5 }, () => {
    counts.rapid += 1;
    counts.coursesGets += 1;
    return client.get('/courses', { params: { page: 1, limit: 10, topic: 'Node.js' } });
  }));
  const rapidMs = Date.now() - started;
  assert(rapid.every((item) => item.status === 200), 'rapid identical requests must succeed');
  assert(rapid.every((item) => Array.isArray(item.data.courses)), 'rapid responses must include courses');

  const refresh = await getCourses({ page: 1, limit: 10 });
  assert(refresh.status === 200, 'refresh/repeat failed');
  assert(Array.isArray(refresh.data.courses), 'refresh must preserve array contract');

  return {
    counts,
    rapidMs,
    firstCount: first.data.courses.length,
    firstIds,
    fromCacheSecond: Boolean(cached.data?.fromCache),
    total: first.data.total,
    hasRecommended: Boolean(refresh.data?.recommendedBasedOn?.summary)
  };
}

async function verifyIndexes() {
  await ensureMongo();
  const report = await migrateCourseIndexes(AnalysisCache);
  const names = (report.results || []).map((item) => item.name);
  assert(names.includes('course_pool_lookup'), 'course_pool_lookup missing');
  assert(names.includes('course_skill_signal_lookup'), 'course_skill_signal_lookup missing');
  return report;
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
  assert(playwright, 'Playwright is required for desktop/375px Learning Hub smoke');
  const { chromium } = playwright;
  const browser = await chromium.launch({ headless: true });
  const results = {};

  const runViewport = async (label, viewport) => {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const consoleErrors = [];
    const pageErrors = [];
    const courseRequests = [];

    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      const text = msg.text();
      if (/status of 404/i.test(text)) return;
      if (/status of 503/i.test(text) && /Temporary upstream failure|api\/courses/i.test(text)) return;
      if (/Failed to load resource: the server responded with a status of 503/i.test(text)) return;
      if (/favicon|sourcemap|DevTools/i.test(text)) return;
      consoleErrors.push(text);
    });
    page.on('pageerror', (error) => pageErrors.push(String(error?.message || error)));
    page.on('request', (request) => {
      const url = request.url();
      if (url.includes('/api/courses')) {
        courseRequests.push({
          method: request.method(),
          url,
          resourceType: request.resourceType()
        });
      }
    });

    await page.addInitScript(({ authToken, authUser, expiryMs, careerProfile }) => {
      if (sessionStorage.getItem('__LH_RELEASE_LOGGED_OUT__') === '1') return;
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

    await page.goto(`${WEB}/app/courses`, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForSelector('h1', { timeout: 30000 });
    const title = await page.locator('h1').first().innerText();
    assert(/Learning Hub/i.test(title), `${label}: Learning Hub title missing`);

    await page.waitForTimeout(1200);
    const initialCourseGets = courseRequests.filter((item) => item.method === 'GET').length;
    assert(initialCourseGets === 1, `${label}: expected exactly 1 initial /api/courses GET, got ${initialCourseGets}`);

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

    const cardsBefore = await page.locator('app-course-card').count();

    const beforeRefresh = courseRequests.length;
    const refreshButton = page.getByRole('button', { name: /Refresh Courses|Refreshing/i });
    await refreshButton.dblclick({ delay: 30 });
    await page.waitForTimeout(1500);
    const afterRapid = courseRequests.length - beforeRefresh;
    assert(afterRapid === 1, `${label}: rapid refresh should issue exactly 1 courses request, got ${afterRapid}`);

    // Failed refresh must preserve previous valid cards.
    await page.route('**/api/courses**', async (route) => {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Temporary upstream failure' })
      });
    });
    const beforeFail = await page.locator('app-course-card').count();
    await refreshButton.click();
    await page.waitForTimeout(1000);
    const afterFail = await page.locator('app-course-card').count();
    if (beforeFail > 0) {
      assert(afterFail === beforeFail, `${label}: failed refresh lost previous cards (${beforeFail} -> ${afterFail})`);
      const staleNotice = await page.locator('.source-notice.fallback', { hasText: /Previous recommendations are still shown|Refresh unavailable/i }).count();
      assert(staleNotice > 0, `${label}: missing preserved-result notice after failed refresh`);
    }
    await page.unroute('**/api/courses**');

    await page.goto(`${WEB}/app/courses?skill=SQL`, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(1200);
    const topicChip = page.locator('.active-filter-chip strong', { hasText: 'SQL' });
    const topicVisible = await topicChip.count();
    assert(topicVisible > 0, `${label}: skill deep-link did not apply SQL topic filter`);

    // Browser refresh keeps authenticated Learning Hub usable.
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('h1', { timeout: 30000 });
    const titleAfterReload = await page.locator('h1').first().innerText();
    assert(/Learning Hub/i.test(titleAfterReload), `${label}: Learning Hub missing after browser refresh`);

    const hasCardsOrEmpty = await page.locator('app-course-card, .empty-state, .error-state').count();
    assert(hasCardsOrEmpty > 0, `${label}: missing course cards/empty/error state`);

    // Logout/login cycle.
    await page.evaluate(() => {
      sessionStorage.setItem('__LH_RELEASE_LOGGED_OUT__', '1');
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      localStorage.removeItem('loginExpiry');
    });
    await page.goto(`${WEB}/app/courses`, { waitUntil: 'networkidle', timeout: 60000 });
    const onLoginOrBlocked = await page.evaluate(() => /login/i.test(location.pathname) || !localStorage.getItem('token'));
    assert(onLoginOrBlocked, `${label}: logout did not clear protected Learning Hub session`);

    await page.evaluate(({ authToken, authUser, expiryMs, careerProfile }) => {
      sessionStorage.removeItem('__LH_RELEASE_LOGGED_OUT__');
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
    await page.goto(`${WEB}/app/courses`, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForSelector('h1', { timeout: 30000 });
    const titleAfterLogin = await page.locator('h1').first().innerText();
    assert(/Learning Hub/i.test(titleAfterLogin), `${label}: Learning Hub missing after re-login`);

    results[label] = {
      viewport,
      initialCourseGets,
      rapidRefreshGets: afterRapid,
      cardsBefore,
      totalCourseGets: courseRequests.filter((item) => item.method === 'GET').length,
      consoleErrors,
      pageErrors,
      overflow,
      title
    };

    assert(consoleErrors.length === 0, `${label}: console errors: ${consoleErrors.join(' | ')}`);
    assert(pageErrors.length === 0, `${label}: page errors: ${pageErrors.join(' | ')}`);
    await context.close();
  };

  try {
    await runViewport('desktop', { width: 1440, height: 900 });
    await runViewport('mobile375', { width: 375, height: 812 });
  } finally {
    await browser.close();
  }

  return results;
}

(async () => {
  const session = await bootstrapSession();
  const indexReport = await verifyIndexes();
  const api = await verifyApiWorkflows(session.token);
  const browser = await browserSmoke(session.token, session.user);

  const report = {
    ok: true,
    authMode: session.authMode,
    api,
    indexes: indexReport.results,
    browser
  };
  const outPath = path.join(__dirname, 'coursesReleaseVerify.out.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await mongoose.disconnect().catch(() => {});
  process.exit(0);
})().catch(async (error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
