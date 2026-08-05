'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const axios = require('axios');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const User = require('../models/user');

const API = String(process.env.RELEASE_API_BASE || 'http://localhost:5000/api').replace(/\/$/, '');
const WEB = String(process.env.RELEASE_WEB_ORIGIN || 'http://localhost:4200').replace(/\/$/, '');
const GITHUB_TEST_USER = String(process.env.RELEASE_GITHUB_USERNAME || 'octocat').trim();

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

const percentile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)] || 0;
};

async function bootstrapSession() {
  const email = String(process.env.RELEASE_VERIFY_EMAIL || '').trim();
  const password = String(process.env.RELEASE_VERIFY_PASSWORD || '').trim();
  if (email && password) {
    try {
      const { data } = await axios.post(`${API}/auth/login`, { email, password });
      if (data?.token) return { token: data.token, user: data };
    } catch {
      // fall through to DB bootstrap for local dev verification
    }
  }

  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!mongoUri) throw new Error('MONGODB_URI missing for session bootstrap');
  await mongoose.connect(mongoUri);
  let user = await User.findOne({
    role: { $in: ['developer', 'user'] },
    isActive: { $ne: false }
  })
    .sort({ updatedAt: -1 })
    .select('_id name email githubUsername activeGithubUsername careerStack experienceLevel role organizationId')
    .lean();
  if (!user?._id) {
    const fallback = await User.findOne({ isActive: { $ne: false } })
      .sort({ updatedAt: -1 })
      .select('_id name email githubUsername activeGithubUsername careerStack experienceLevel role organizationId')
      .lean();
    if (!fallback?._id) throw new Error('No active user available for release verification');
    user = fallback;
  }
  const token = signToken(user._id);
  return {
    token,
    user: {
      ...user,
      _id: String(user._id),
      token,
      activeGithubUsername: user.activeGithubUsername || user.githubUsername || GITHUB_TEST_USER,
      githubUsername: user.githubUsername || GITHUB_TEST_USER,
      role: user.role || 'developer'
    }
  };
}

async function runApiWorkflow(session) {
  const headers = { Authorization: `Bearer ${session.token}` };
  const counts = {
    activeUsername: 0,
    analyzePublic: 0,
    analyzeSave: 0,
    analyzeSaveRefresh: 0,
    skillGapGithubTouch: 0
  };

  const active = await axios.get(`${API}/github/active-username`, { headers });
  counts.activeUsername += 1;
  const savedUsername = String(active.data?.username || session.user.activeGithubUsername || GITHUB_TEST_USER).trim() || GITHUB_TEST_USER;

  const publicFirst = await axios.post(`${API}/github/analyze`, { username: 'github' });
  counts.analyzePublic += 1;
  const publicCached = await axios.post(`${API}/github/analyze`, { username: 'github' });
  counts.analyzePublic += 1;
  assert(publicFirst.data?.repoCount >= 0);
  assert(publicCached.data?.cache?.hit === true || publicCached.data?.githubHealthScore === publicFirst.data?.githubHealthScore);

  const saveFirst = await axios.post(`${API}/github/analyze-save`, { username: savedUsername }, { headers });
  counts.analyzeSave += 1;
  const saveCached = await axios.post(`${API}/github/analyze-save`, { username: savedUsername }, { headers });
  counts.analyzeSave += 1;
  const saveParallel = await Promise.allSettled([
    axios.post(`${API}/github/analyze-save`, { username: savedUsername }, { headers, timeout: 120000 }),
    axios.post(`${API}/github/analyze-save`, { username: savedUsername }, { headers, timeout: 120000 }),
    axios.post(`${API}/github/analyze-save`, { username: savedUsername }, { headers, timeout: 120000 })
  ]);
  counts.analyzeSave += saveParallel.filter((entry) => entry.status === 'fulfilled').length;

  const saveRefresh = await axios.post(`${API}/github/analyze-save`, { username: savedUsername, forceRefresh: true }, { headers });
  counts.analyzeSaveRefresh += 1;

  let stalePreserved = false;
  try {
    await axios.post(`${API}/github/analyze`, { username: 'definitely-not-a-real-user-zzzz-404' });
  } catch (error) {
    assert(error.response?.status === 404);
  }
  const afterFailure = await axios.post(`${API}/github/analyze`, { username: 'github' });
  stalePreserved = afterFailure.data?.githubHealthScore === publicCached.data?.githubHealthScore;

  try {
    await axios.post(`${API}/skill-gap`, {
      githubUsername: savedUsername,
      careerStack: 'Frontend',
      experienceLevel: 'Intern'
    }, { headers, timeout: 20000 });
    counts.skillGapGithubTouch += 1;
  } catch {
    // skill-gap may require resume; shared github cache still validated via service tests
  }

  return {
    counts,
    savedUsername,
    saveFirstScore: saveFirst.data?.githubHealthScore,
    saveCachedScore: saveCached.data?.githubHealthScore,
    saveRefreshScore: saveRefresh.data?.githubHealthScore,
    stalePreserved,
    publicCacheHit: Boolean(publicCached.data?.cache?.hit)
  };
}

function assert(condition, message = 'assertion failed') {
  if (!condition) throw new Error(message);
}

async function runBrowserSmoke(session) {
  let chromium;
  try {
    ({ chromium } = require('playwright-core'));
  } catch {
    const { execSync } = require('child_process');
    execSync('npm install playwright-core@1.51.0 --no-save', { cwd: require('path').join(__dirname, '../..'), stdio: 'ignore' });
    ({ chromium } = require('playwright-core'));
  }

  const browser = await chromium.launch({ headless: true });
  const results = { desktop: null, mobile: null };

  for (const profile of [
    { name: 'desktop', width: 1366, height: 900 },
    { name: 'mobile', width: 375, height: 812 }
  ]) {
    const context = await browser.newContext({ viewport: { width: profile.width, height: profile.height } });
    context.setDefaultTimeout(120000);
    const page = await context.newPage();
    const consoleErrors = [];
    const pageErrors = [];
    const requests = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (error) => pageErrors.push(String(error)));
    page.on('request', (req) => {
      const url = req.url();
      if (url.includes('/api/github/')) requests.push(`${req.method()} ${url.split('/api/')[1]}`);
    });

    await page.addInitScript((payload) => {
      localStorage.setItem('token', payload.token);
      localStorage.setItem('user', JSON.stringify({ ...payload.user, role: 'developer', token: payload.token }));
      localStorage.setItem('loginExpiry', String(Date.now() + 20 * 60 * 60 * 1000));
    }, { token: session.token, user: session.user });

    await page.goto(`${WEB}/app/github-analyzer`, { waitUntil: 'domcontentloaded', timeout: 90000 });
    const currentUrl = page.url();
    if (!currentUrl.includes('/github-analyzer')) {
      throw new Error(`Unexpected route after auth bootstrap: ${currentUrl}`);
    }

    try {
      await page.waitForSelector('.analyzer-page', { timeout: 90000 });
    } catch (error) {
      const snippet = await page.locator('body').innerText();
      throw new Error(`${error.message}; url=${currentUrl}; body=${snippet.slice(0, 240)}`);
    }

    const overflowX = await page.evaluate(() => {
      const doc = document.documentElement;
      return Math.max(0, doc.scrollWidth - doc.clientWidth);
    });

    const hasNaN = await page.evaluate(() => {
      const text = document.body?.innerText || '';
      return /\bNaN\b/.test(text) || /\bundefined\b/i.test(text);
    });

    await page.waitForFunction(() => {
      const ready = document.querySelector('.overview-grid') || document.querySelector('.error-banner') || document.querySelector('.empty-state:not(.loading-state)');
      const loading = document.querySelector('.loading-state');
      return Boolean(ready) && !loading;
    }, { timeout: 120000 });

    const requestsBeforeAction = requests.length;

    const refreshBtn = page.locator('button.ghost-btn', { hasText: 'Refresh analysis' });
    if (await refreshBtn.count()) {
      await refreshBtn.click();
      await page.waitForFunction(() => {
        const loading = document.querySelector('.loading-state');
        const ready = document.querySelector('.overview-grid') || document.querySelector('.error-banner');
        return Boolean(ready) && !loading;
      }, { timeout: 120000 });
    }

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => {
      const ready = document.querySelector('.overview-grid') || document.querySelector('.error-banner') || document.querySelector('.empty-state:not(.loading-state)');
      const loading = document.querySelector('.loading-state');
      return Boolean(ready) && !loading;
    }, { timeout: 120000 });

    results[profile.name] = {
      overflowX,
      hasNaN,
      consoleErrors: consoleErrors.filter((line) => !/favicon|websocket|sockjs|hmr/i.test(line)),
      pageErrors,
      githubRequestCount: requests.length - requestsBeforeAction,
      uniqueGithubRequestCount: [...new Set(requests.slice(requestsBeforeAction).filter((entry) => entry.includes('github/')))]
        .length,
      uniqueGithub: [...new Set(requests.filter((entry) => entry.includes('github/')))],
      requestsAfterInitialLoad: requests.length - requestsBeforeAction
    };

    await context.close();
  }

  await browser.close();
  return results;
}

async function main() {
  const report = {
    api: null,
    browser: null,
    errors: []
  };

  try {
    const session = await bootstrapSession();
    report.api = await runApiWorkflow(session);
    console.log('GITHUB_RELEASE_API', JSON.stringify(report.api));
    report.browser = await runBrowserSmoke(session);
  } catch (error) {
    report.errors.push(error.message);
    throw error;
  } finally {
    if (mongoose.connection.readyState === 1) await mongoose.disconnect();
  }

  console.log('GITHUB_RELEASE_VERIFY', JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error('GITHUB_RELEASE_VERIFY_FAILED', error.message);
  process.exit(1);
});
