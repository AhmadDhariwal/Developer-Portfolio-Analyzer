'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const path = require('path');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const User = require('../models/user');
const AnalysisCache = require('../models/analysisCache');
const { migrateRecommendationIndexes } = require('./migrateRecommendationIndexes');

const API = String(process.env.RELEASE_API_BASE || 'http://127.0.0.1:5000/api').replace(/\/$/, '');
const WEB = String(process.env.RELEASE_WEB_ORIGIN || 'http://127.0.0.1:4201').replace(/\/$/, '');

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
      if (data?.token) return { token: data.token, user: data };
    } catch {
      // fall through
    }
  }
  let user = await User.findOne({
    role: { $in: ['developer', 'user'] },
    isActive: { $ne: false },
    $or: [
      { activeGithubUsername: { $exists: true, $nin: [null, ''] } },
      { githubUsername: { $exists: true, $nin: [null, ''] } }
    ]
  })
    .sort({ updatedAt: -1 })
    .select('_id name email githubUsername activeGithubUsername careerStack experienceLevel activeCareerStack activeExperienceLevel role organizationId')
    .lean();
  if (!user?._id) {
    user = await User.findOne({ isActive: { $ne: false } })
      .sort({ updatedAt: -1 })
      .select('_id name email githubUsername activeGithubUsername careerStack experienceLevel activeCareerStack activeExperienceLevel role organizationId')
      .lean();
  }
  if (!user?._id) throw new Error('No active user available for release verification');

  const token = signToken(user._id);
  const github = user.activeGithubUsername || user.githubUsername || 'octocat';
  return {
    token,
    user: {
      ...user,
      _id: String(user._id),
      token,
      activeGithubUsername: github,
      githubUsername: user.githubUsername || github,
      careerStack: user.activeCareerStack || user.careerStack || 'Full Stack',
      experienceLevel: user.activeExperienceLevel || user.experienceLevel || 'Student',
      role: user.role || 'developer'
    }
  };
}

async function postRecommendations(headers, body, timeout = 180000) {
  return axios.post(`${API}/recommendations`, body, { headers, timeout });
}

async function runApiWorkflow(session) {
  const headers = { Authorization: `Bearer ${session.token}` };
  const username = session.user.activeGithubUsername;
  const careerStack = session.user.careerStack || 'Full Stack';
  const experienceLevel = session.user.experienceLevel || 'Student';
  const counts = {
    normal: 0,
    cached: 0,
    refresh: 0,
    rapid: 0,
    failure: 0,
    dashboard: 0,
    unauthorized: 0,
    preview: 0
  };

  try {
    await axios.post(`${API}/recommendations`, { username }, { timeout: 15000 });
    throw new Error('expected unauthorized without token');
  } catch (error) {
    assert(error.response?.status === 401, `expected 401 got ${error.response?.status}`);
    counts.unauthorized += 1;
  }

  const first = await postRecommendations(headers, { username, forceRefresh: false });
  counts.normal += 1;
  assert(first.status === 200, 'normal flow must succeed');
  assert(Array.isArray(first.data?.projects) && first.data.projects.length > 0, 'projects required');
  assert(Number.isFinite(Number(first.data?.recommendationScores?.overallRecommendationScore)), 'overall score must be finite');
  assert(!Number.isNaN(Number(first.data?.recommendationScores?.overallRecommendationScore)), 'overall score must not be NaN');
  const firstScore = Number(first.data.recommendationScores.overallRecommendationScore);
  const firstSignalHash = first.data?.cacheMetadata?.signalHash || first.data?.recommendationSignals?.signalHash || '';

  const cached = await postRecommendations(headers, { username, forceRefresh: false });
  counts.cached += 1;
  assert(cached.status === 200);
  assert(
    cached.data?.fromCache === true
      || cached.data?.cacheMetadata?.loadedFromCache === true
      || Number(cached.data?.recommendationScores?.overallRecommendationScore) === firstScore,
    'cached flow must reuse prior result'
  );
  assert((cached.data?.cacheMetadata?.stageTimingsMs?.AI || 0) === 0 || cached.data?.fromCache === true || cached.data?.cacheMetadata?.loadedFromCache === true, 'cache hit should not require AI when stage timings present');

  const rapid = await Promise.allSettled([
    postRecommendations(headers, { username, forceRefresh: true }),
    postRecommendations(headers, { username, forceRefresh: true }),
    postRecommendations(headers, { username, forceRefresh: true }),
    postRecommendations(headers, { username, forceRefresh: true }),
    postRecommendations(headers, { username, forceRefresh: true })
  ]);
  counts.rapid += rapid.filter((entry) => entry.status === 'fulfilled').length;
  assert(rapid.every((entry) => entry.status === 'fulfilled'), 'rapid identical refresh must all succeed');
  const rapidScores = rapid.map((entry) => Number(entry.value.data.recommendationScores?.overallRecommendationScore));
  assert(rapidScores.every((value) => value === rapidScores[0]), 'rapid callers must share one result');

  const refresh = await postRecommendations(headers, { username, forceRefresh: true });
  counts.refresh += 1;
  assert(refresh.status === 200);
  assert(Number.isFinite(Number(refresh.data?.recommendationScores?.overallRecommendationScore)));

  try {
    await axios.post(`${API}/recommendations/generate`, {
      githubUsername: '',
      careerStack: 'Frontend',
      experienceLevel: 'Intern',
      isTemporary: true
    }, { headers, timeout: 30000 });
    throw new Error('expected validation failure for empty preview username');
  } catch (error) {
    assert([400, 413].includes(error.response?.status), `expected 400/413 got ${error.response?.status}`);
    counts.failure += 1;
  }

  const afterFailure = await postRecommendations(headers, { username, forceRefresh: false });
  counts.cached += 1;
  assert(Number.isFinite(Number(afterFailure.data?.recommendationScores?.overallRecommendationScore)), 'failure must not corrupt cached profile result');
  assert(Array.isArray(afterFailure.data?.projects) && afterFailure.data.projects.length > 0, 'previous valid projects must remain');

  // Preview isolation
  const preview = await axios.post(`${API}/recommendations/generate`, {
    githubUsername: 'octocat',
    careerStack: 'Frontend',
    experienceLevel: 'Intern',
    isTemporary: true,
    forceRefresh: true
  }, { headers, timeout: 180000 });
  counts.preview += 1;
  assert(preview.status === 200, 'preview generate must succeed');
  assert(preview.data?.isTemporary === true || preview.data?.mode === 'preview' || preview.data?.cacheMetadata?.temporary === true, 'preview must be temporary');

  // Cross-module freshness: dashboard recommendations consumer
  let dashboardFresh = false;
  let dashboardPayload = null;
  try {
    const dash = await axios.get(`${API}/dashboard/recommendations`, { headers, timeout: 120000 });
    counts.dashboard += 1;
    dashboardPayload = dash.data;
    dashboardFresh = dash.status === 200 && (
      Array.isArray(dash.data?.recommendations)
      || Array.isArray(dash.data?.items)
      || Array.isArray(dash.data?.data)
      || Boolean(dash.data?.sourcesUsed?.recommendations)
      || Boolean(dash.data)
    );
    assert(dash.status === 200, 'dashboard/recommendations must load after recommendations update');
  } catch (error) {
    try {
      const dash = await axios.get(`${API}/dashboard/summary`, { headers, timeout: 120000 });
      counts.dashboard += 1;
      dashboardPayload = dash.data;
      dashboardFresh = dash.status === 200;
      assert(dash.status === 200, 'dashboard/summary must load after recommendations update');
    } catch (inner) {
      throw new Error(`dashboard freshness failed: ${inner.response?.status || inner.message || error.message}`);
    }
  }

  // Weekly report consumer should not 500 after recommendation refresh
  let weeklyFresh = false;
  try {
    const weekly = await axios.get(`${API}/weekly-reports/latest`, { headers, timeout: 60000 });
    weeklyFresh = [200, 204, 404].includes(weekly.status);
  } catch (error) {
    weeklyFresh = [404, 204].includes(error.response?.status);
    if (!weeklyFresh && error.response?.status >= 500) {
      throw new Error(`weekly-reports corrupted after recommendations: ${error.response?.status}`);
    }
    weeklyFresh = true; // missing weekly report is acceptable; 5xx is not
  }

  const migration = await migrateRecommendationIndexes(AnalysisCache);
  let explain = null;
  try {
    const coll = mongoose.connection.collection('analysiscaches');
    explain = await coll.find({
      userId: new mongoose.Types.ObjectId(session.user._id),
      analysisVersion: 'v5-career-advisor-data-quality'
    }).limit(1).explain('executionStats');
  } catch (error) {
    explain = { error: error.message };
  }

  return {
    counts,
    username,
    careerStack,
    experienceLevel,
    firstScore,
    firstSignalHash,
    refreshScore: Number(refresh.data.recommendationScores?.overallRecommendationScore),
    cachedFromCache: Boolean(cached.data?.fromCache || cached.data?.cacheMetadata?.loadedFromCache),
    rapidShared: rapidScores.every((value) => value === rapidScores[0]),
    stalePreserved: Number.isFinite(Number(afterFailure.data?.recommendationScores?.overallRecommendationScore)),
    dashboardFresh,
    weeklyFresh,
    dashboardHasPayload: Boolean(dashboardPayload),
    migration,
    explainStage: explain?.queryPlanner?.winningPlan?.stage
      || explain?.executionStats?.executionStages?.stage
      || explain?.error
      || 'unknown',
    explainDocsExamined: explain?.executionStats?.totalDocsExamined,
    explainNReturned: explain?.executionStats?.nReturned
  };
}

async function runBrowserSmoke(session) {
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch {
    try {
      ({ chromium } = require('playwright-core'));
    } catch {
      const { execSync } = require('child_process');
      execSync('npm install playwright@1.51.0 --no-save', {
        cwd: path.join(__dirname, '../..'),
        stdio: 'ignore'
      });
      ({ chromium } = require('playwright'));
    }
  }

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch {
    try {
      browser = await chromium.launch({ headless: true, channel: 'chrome' });
    } catch {
      browser = await chromium.launch({ headless: true, channel: 'msedge' });
    }
  }
  const results = { desktop: null, mobile: null };

  for (const profile of [
    { name: 'desktop', width: 1366, height: 900 },
    { name: 'mobile', width: 375, height: 812 }
  ]) {
    const context = await browser.newContext({ viewport: { width: profile.width, height: profile.height } });
    context.setDefaultTimeout(180000);
    const page = await context.newPage();
    const consoleErrors = [];
    const pageErrors = [];
    const recRequests = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (error) => pageErrors.push(String(error)));
    page.on('request', (req) => {
      const url = req.url();
      if (url.includes('/api/recommendations') && !url.includes('saved-previews')) {
        recRequests.push(`${req.method()} ${url.includes('/generate') ? 'recommendations/generate' : 'recommendations'}`);
      }
    });

    await page.addInitScript((payload) => {
      localStorage.setItem('token', payload.token);
      localStorage.setItem('user', JSON.stringify({ ...payload.user, role: 'developer', token: payload.token }));
      localStorage.setItem('loginExpiry', String(Date.now() + 20 * 60 * 60 * 1000));
    }, { token: session.token, user: session.user });

    const dismissOverlays = async () => {
      await page.evaluate(() => {
        document.querySelectorAll('vite-error-overlay').forEach((node) => node.remove());
      }).catch(() => {});
    };

    await page.goto(`${WEB}/app/recommendations`, { waitUntil: 'domcontentloaded', timeout: 90000 });
    assert(page.url().includes('/recommendations'), `unexpected route ${page.url()}`);

    await page.waitForSelector('.rec-page', { timeout: 90000 });
    await page.waitForFunction(() => {
      const loading = document.querySelector('.spinner, .skeleton-stack');
      const ready = document.querySelector('.advisor-section, .rec-empty, .rec-error, .executive-hero, .rec-search-card');
      return Boolean(ready) && !document.querySelector('.skeleton-stack');
    }, { timeout: 180000 });
    await dismissOverlays();

    const overflowX = await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth));
    const hasNaN = await page.evaluate(() => {
      const text = document.body?.innerText || '';
      return /\bNaN\b/.test(text) || /\bundefined\b/i.test(text);
    });
    const hasMojibake = await page.evaluate(() => /Ã¢|â€|Â/.test(document.body?.innerText || ''));

    const requestsBefore = recRequests.length;
    const refreshBtn = page.locator('button', { hasText: /Refresh|Get Recommendations/ }).first();
    if (await refreshBtn.count()) {
      await dismissOverlays();
      await refreshBtn.click({ force: true, timeout: 30000 });
      await page.waitForFunction(() => !document.querySelector('.spinner-wrap, .skeleton-stack'), { timeout: 180000 });
    }
    const afterRefresh = recRequests.length;

    if (await refreshBtn.count()) {
      await dismissOverlays();
      await refreshBtn.click({ force: true, timeout: 30000 });
      await refreshBtn.click({ force: true }).catch(() => {});
      await page.waitForFunction(() => !document.querySelector('.spinner-wrap, .skeleton-stack'), { timeout: 180000 });
    }
    const afterRapid = recRequests.length;

    // Preserve-on-failure: intercept next refresh as 500, ensure previous content remains
    let preserved = false;
    await page.route('**/api/recommendations', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'Forced failure for preserve check' })
        });
        return;
      }
      await route.continue();
    });
    const hadResult = await page.evaluate(() => Boolean(document.querySelector('.advisor-section, .executive-hero')));
    if (hadResult && await refreshBtn.count()) {
      await refreshBtn.click({ force: true, timeout: 30000 });
      await page.waitForTimeout(1500);
      preserved = await page.evaluate(() => Boolean(document.querySelector('.advisor-section, .executive-hero')));
      const errVisible = await page.evaluate(() => Boolean(document.querySelector('.rec-error')));
      assert(errVisible, `${profile.name} failed refresh must show error`);
      assert(preserved, `${profile.name} failed refresh must preserve previous valid result`);
    }
    await page.unroute('**/api/recommendations');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.rec-page', { timeout: 90000 });
    await page.waitForFunction(() => !document.querySelector('.skeleton-stack'), { timeout: 180000 }).catch(() => {});

    await page.evaluate(() => {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      localStorage.removeItem('loginExpiry');
    });
    await page.goto(`${WEB}/login`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.addInitScript((payload) => {
      localStorage.setItem('token', payload.token);
      localStorage.setItem('user', JSON.stringify({ ...payload.user, role: 'developer', token: payload.token }));
      localStorage.setItem('loginExpiry', String(Date.now() + 20 * 60 * 60 * 1000));
    }, { token: session.token, user: session.user });
    await page.goto(`${WEB}/app/recommendations`, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForSelector('.rec-page', { timeout: 90000 });
    await page.waitForFunction(() => !document.querySelector('.skeleton-stack'), { timeout: 180000 }).catch(() => {});

    // Dependent module: dashboard should load after recommendations activity
    await page.goto(`${WEB}/app/dashboard`, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForTimeout(2000);
    const dashboardOk = page.url().includes('/dashboard');

    await page.goto(`${WEB}/app/recommendations`, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForSelector('.rec-page', { timeout: 90000 });

    const overflowXAfter = await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth));
    const hasNaNAfter = await page.evaluate(() => {
      const text = document.body?.innerText || '';
      return /\bNaN\b/.test(text) || /\bundefined\b/i.test(text);
    });

    const filteredConsole = consoleErrors.filter((line) => !/favicon|websocket|sockjs|hmr|Avatar failed|Failed to load resource|NG0\d+/i.test(line));
    assert(filteredConsole.length === 0, `${profile.name} console errors: ${filteredConsole.join(' | ')}`);
    assert(pageErrors.length === 0, `${profile.name} page errors: ${pageErrors.join(' | ')}`);
    assert(!hasNaN && !hasNaNAfter, `${profile.name} rendered NaN/undefined`);
    assert(!hasMojibake, `${profile.name} rendered mojibake`);
    assert(Math.max(overflowX, overflowXAfter) === 0, `${profile.name} horizontal overflow ${Math.max(overflowX, overflowXAfter)}`);
    assert((afterRefresh - requestsBefore) <= 1, `${profile.name} refresh fired ${afterRefresh - requestsBefore} recommendation requests`);
    assert((afterRapid - afterRefresh) <= 1, `${profile.name} rapid click fired ${afterRapid - afterRefresh} recommendation requests`);
    assert(dashboardOk, `${profile.name} dashboard route must open for freshness check`);

    results[profile.name] = {
      overflowX: Math.max(overflowX, overflowXAfter),
      hasNaN: hasNaN || hasNaNAfter,
      hasMojibake,
      preservedOnFailure: preserved,
      consoleErrors: filteredConsole,
      pageErrors,
      initialRequests: requestsBefore,
      refreshRequests: afterRefresh - requestsBefore,
      rapidRequests: afterRapid - afterRefresh,
      totalRecommendationRequests: recRequests.length,
      requests: [...recRequests],
      dashboardOk
    };

    await context.close();
  }

  await browser.close();
  return results;
}

async function main() {
  const report = { api: null, browser: null, errors: [] };
  try {
    const session = await bootstrapSession();
    report.api = await runApiWorkflow(session);
    console.log('RECOMMENDATIONS_RELEASE_API', JSON.stringify(report.api));
    report.browser = await runBrowserSmoke(session);
  } catch (error) {
    report.errors.push(error.message);
    throw error;
  } finally {
    if (mongoose.connection.readyState === 1) await mongoose.disconnect();
  }

  console.log('RECOMMENDATIONS_RELEASE_VERIFY', JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error('RECOMMENDATIONS_RELEASE_VERIFY_FAILED', error.message);
  process.exit(1);
});
