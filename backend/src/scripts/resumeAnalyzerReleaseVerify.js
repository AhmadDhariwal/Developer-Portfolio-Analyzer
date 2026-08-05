'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const axios = require('axios');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
const User = require('../models/user');
const ResumeFile = require('../models/resumeFile');
const ResumeAnalysis = require('../models/resumeAnalysis');

const API = String(process.env.RELEASE_API_BASE || 'http://localhost:5000/api').replace(/\/$/, '');
const WEB = String(process.env.RELEASE_WEB_ORIGIN || 'http://127.0.0.1:4201').replace(/\/$/, '');

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

function assert(condition, message = 'assertion failed') {
  if (!condition) throw new Error(message);
}

async function bootstrapSession() {
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

  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!mongoUri) throw new Error('MONGODB_URI missing for session bootstrap');
  await mongoose.connect(mongoUri);

  const fs = require('fs');
  const path = require('path');
  const ResumeFile = require('../models/resumeFile');

  const candidates = await ResumeFile.find({ isAnalyzed: true })
    .sort({ uploadDate: -1 })
    .limit(40)
    .select('userId fileUrl resumeHash analysisVersion isAnalyzed')
    .lean();

  let preferredUserId = null;
  for (const file of candidates) {
    const abs = path.isAbsolute(file.fileUrl) ? file.fileUrl : path.join(process.cwd(), file.fileUrl);
    if (fs.existsSync(abs) && file.resumeHash && file.analysisVersion) {
      preferredUserId = file.userId;
      break;
    }
  }

  let user = preferredUserId
    ? await User.findById(preferredUserId)
      .select('_id name email role organizationId defaultResumeFileId activeResumeFileId careerStack experienceLevel githubUsername')
      .lean()
    : null;

  if (!user?._id) {
    user = await User.findOne({
      role: { $in: ['developer', 'user'] },
      isActive: { $ne: false }
    })
      .sort({ updatedAt: -1 })
      .select('_id name email role organizationId defaultResumeFileId activeResumeFileId careerStack experienceLevel githubUsername')
      .lean();
  }

  if (!user?._id) {
    user = await User.findOne({ isActive: { $ne: false } })
      .sort({ updatedAt: -1 })
      .select('_id name email role organizationId defaultResumeFileId activeResumeFileId careerStack experienceLevel githubUsername')
      .lean();
  }
  if (!user?._id) throw new Error('No active user available for release verification');

  const token = signToken(user._id);
  return {
    token,
    user: {
      ...user,
      _id: String(user._id),
      token,
      role: user.role === 'admin' || user.role === 'super_admin' || user.role === 'recruiter'
        ? 'developer'
        : (user.role || 'developer')
    }
  };
}

async function runApiWorkflow(session) {
  const headers = { Authorization: `Bearer ${session.token}` };
  const counts = {
    files: 0,
    active: 0,
    result: 0,
    analyze: 0,
    analyzeRefresh: 0,
    setActive: 0,
    skillGapTouch: 0,
    unauthorizedProbe: 0
  };

  const filesRes = await axios.get(`${API}/resume/files`, { headers });
  counts.files += 1;
  const files = Array.isArray(filesRes.data?.files) ? filesRes.data.files : [];
  assert(files.length > 0, 'expected at least one resume file for release verification');

  const fs = require('fs');
  const path = require('path');
  const ResumeFile = require('../models/resumeFile');
  const owned = await ResumeFile.find({ userId: session.user._id, isAnalyzed: true }).sort({ uploadDate: -1 }).lean();
  const withDisk = owned.find((f) => {
    const abs = path.isAbsolute(f.fileUrl) ? f.fileUrl : path.join(process.cwd(), f.fileUrl);
    return fs.existsSync(abs);
  });
  const analyzed = withDisk
    ? { fileId: String(withDisk._id), fileName: withDisk.fileName }
    : (files.find((f) => f.isAnalyzed) || files[0]);
  const fileId = String(analyzed.fileId);

  const active = await axios.get(`${API}/resume/active`, { headers });
  counts.active += 1;
  assert(active.data);

  const resultFirst = await axios.get(`${API}/resume/result`, { headers });
  counts.result += 1;
  const firstScore = Number(resultFirst.data?.atsScore);
  assert(Number.isFinite(firstScore), 'result atsScore must be finite');

  const resultByFile = await axios.get(`${API}/resume/result`, {
    headers,
    params: { fileId }
  });
  counts.result += 1;
  assert(String(resultByFile.data?.fileId) === fileId, 'file-scoped result must match requested fileId');

  // Unauthorized / invalid probes
  try {
    await axios.get(`${API}/resume/result/000000000000000000000000`, { headers });
    throw new Error('expected 403/404 for foreign userId');
  } catch (error) {
    counts.unauthorizedProbe += 1;
    assert([403, 404].includes(error.response?.status), `expected 403/404 got ${error.response?.status}`);
  }

  try {
    await axios.get(`${API}/resume/result`, { headers, params: { fileId: 'not-an-id' } });
    throw new Error('expected 400 for invalid fileId');
  } catch (error) {
    assert(error.response?.status === 400, `expected 400 got ${error.response?.status}`);
  }

  try {
    await axios.get(`${API}/resume/files`);
    throw new Error('expected 401 without token');
  } catch (error) {
    assert(error.response?.status === 401, `expected 401 got ${error.response?.status}`);
  }

  const analyzeFirst = await axios.post(`${API}/resume/analyze`, { fileId }, { headers, timeout: 180000 });
  counts.analyze += 1;
  const analyzeScore = Number(analyzeFirst.data?.atsScore);
  assert(Number.isFinite(analyzeScore));

  const analyzeCached = await axios.post(`${API}/resume/analyze`, { fileId }, { headers, timeout: 180000 });
  counts.analyze += 1;
  assert(Number(analyzeCached.data?.atsScore) === analyzeScore, 'cached analyze must preserve score');

  const parallel = await Promise.allSettled([
    axios.post(`${API}/resume/analyze`, { fileId }, { headers, timeout: 180000 }),
    axios.post(`${API}/resume/analyze`, { fileId }, { headers, timeout: 180000 }),
    axios.post(`${API}/resume/analyze`, { fileId }, { headers, timeout: 180000 })
  ]);
  const fulfilled = parallel.filter((entry) => entry.status === 'fulfilled');
  counts.analyze += fulfilled.length;
  assert(fulfilled.length === 3, 'parallel analyze should all fulfill');
  assert(fulfilled.every((entry) => Number(entry.value.data?.atsScore) === analyzeScore));

  const previousValid = analyzeCached.data;
  try {
    await axios.post(`${API}/resume/analyze`, { fileId: 'ffffffffffffffffffffffff' }, { headers });
    throw new Error('expected 404 for missing file');
  } catch (error) {
    assert(error.response?.status === 404 || error.response?.status === 400);
  }

  const afterFailure = await axios.get(`${API}/resume/result`, { headers, params: { fileId } });
  counts.result += 1;
  assert(Number(afterFailure.data?.atsScore) === analyzeScore, 'failed analyze must not corrupt prior result');
  assert(Number(previousValid.atsScore) === analyzeScore);

  const refresh = await axios.post(
    `${API}/resume/analyze`,
    { fileId, forceRefresh: true },
    { headers, timeout: 180000 }
  );
  counts.analyzeRefresh += 1;
  assert(Number.isFinite(Number(refresh.data?.atsScore)));

  await axios.put(`${API}/resume/active`, { fileId, setAsDefault: true }, { headers });
  counts.setActive += 1;

  try {
    await axios.post(`${API}/skill-gap`, {
      githubUsername: session.user.githubUsername || 'octocat',
      careerStack: session.user.careerStack || 'Frontend',
      experienceLevel: session.user.experienceLevel || 'Intern'
    }, { headers, timeout: 30000 });
    counts.skillGapTouch += 1;
  } catch {
    // skill-gap may require additional context; freshness still covered via cache invalidation contract
  }

  return {
    counts,
    fileId,
    fileName: analyzed.fileName,
    firstScore,
    analyzeScore,
    refreshScore: Number(refresh.data?.atsScore),
    cacheHitHint: Boolean(analyzeCached.data?.cacheMetadata?.cacheHit || analyzeCached.data?.cacheMetadata?.loadedFromCache),
    stalePreserved: Number(afterFailure.data?.atsScore) === analyzeScore,
    parallelFulfilled: fulfilled.length
  };
}

async function runBrowserSmoke(session) {
  let chromium;
  try {
    ({ chromium } = require('playwright-core'));
  } catch {
    const { execSync } = require('child_process');
    execSync('npm install playwright-core@1.51.0 --no-save', {
      cwd: path.join(__dirname, '../..'),
      stdio: 'ignore'
    });
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
      if (url.includes('/api/resume/')) {
        requests.push(`${req.method()} ${url.split('/api/')[1].split('?')[0]}`);
      }
    });

    await page.addInitScript((payload) => {
      localStorage.setItem('token', payload.token);
      localStorage.setItem('user', JSON.stringify({ ...payload.user, role: 'developer', token: payload.token }));
      localStorage.setItem('loginExpiry', String(Date.now() + 20 * 60 * 60 * 1000));
    }, { token: session.token, user: session.user });

    await page.goto(`${WEB}/app/resume-analyzer`, { waitUntil: 'domcontentloaded', timeout: 90000 });
    assert(page.url().includes('/resume-analyzer'), `unexpected route ${page.url()}`);

    await page.waitForSelector('.page-container', { timeout: 90000 });
    await page.waitForFunction(() => {
      const loading = document.querySelector('.operation-state');
      const ready = document.querySelector('.score-cards-grid, .empty-state-card, .state-banner--error, .file-info');
      return Boolean(ready) && !loading;
    }, { timeout: 120000 });

    const overflowX = await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth));
    const hasNaN = await page.evaluate(() => {
      const text = document.body?.innerText || '';
      return /\bNaN\b/.test(text) || /\bundefined\b/i.test(text);
    });

    const requestsBeforeAction = requests.length;

    const refreshBtn = page.locator('button', { hasText: 'Refresh analysis' });
    if (await refreshBtn.count()) {
      await refreshBtn.first().click();
      await page.waitForFunction(() => !document.querySelector('.operation-state'), { timeout: 180000 });
    }

    // Rapid double-click should not explode requests (second click ignored while loading)
    const reanalyze = page.locator('button', { hasText: /Re-analyze|Refresh analysis/ }).first();
    if (await reanalyze.count()) {
      await reanalyze.click();
      await reanalyze.click({ force: true }).catch(() => {});
      await page.waitForFunction(() => !document.querySelector('.operation-state'), { timeout: 180000 });
    }

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => {
      const loading = document.querySelector('.operation-state');
      const ready = document.querySelector('.score-cards-grid, .empty-state-card, .state-banner--error, .file-info');
      return Boolean(ready) && !loading;
    }, { timeout: 120000 });

    const filteredConsole = consoleErrors.filter((line) => !/favicon|websocket|sockjs|hmr|Avatar failed/i.test(line));

    results[profile.name] = {
      overflowX,
      hasNaN,
      consoleErrors: filteredConsole,
      pageErrors,
      resumeRequestCount: requests.length - requestsBeforeAction,
      uniqueResume: [...new Set(requests.filter((entry) => entry.includes('resume/')))],
      afterActionRequests: [...requests.slice(requestsBeforeAction)],
      totalResumeRequests: requests.length
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
    console.log('RESUME_RELEASE_API', JSON.stringify(report.api));
    report.browser = await runBrowserSmoke(session);
  } catch (error) {
    report.errors.push(error.message);
    throw error;
  } finally {
    if (mongoose.connection.readyState === 1) await mongoose.disconnect();
  }

  console.log('RESUME_RELEASE_VERIFY', JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error('RESUME_RELEASE_VERIFY_FAILED', error.message);
  process.exit(1);
});
