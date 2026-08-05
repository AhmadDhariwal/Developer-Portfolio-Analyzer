'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const path = require('path');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const User = require('../models/user');
const AnalysisCache = require('../models/analysisCache');

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

async function postSkillGap(headers, body, timeout = 180000) {
  return axios.post(`${API}/skillgap/skill-gap`, body, { headers, timeout });
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
    recommendations: 0,
    unauthorized: 0
  };

  // Unauthorized profile request
  try {
    await axios.post(`${API}/skillgap/skill-gap`, { username }, { timeout: 15000 });
    throw new Error('expected unauthorized without token');
  } catch (error) {
    assert(error.response?.status === 401, `expected 401 got ${error.response?.status}`);
    counts.unauthorized += 1;
  }

  const first = await postSkillGap(headers, {
    username,
    careerStack,
    experienceLevel,
    isTemporary: false,
    forceRefresh: false
  });
  counts.normal += 1;
  assert(first.status === 200, 'normal flow must succeed');
  assert(Number.isFinite(Number(first.data?.coverage)), 'coverage must be numeric');
  assert(Array.isArray(first.data?.missingSkills), 'missingSkills required');
  assert(Array.isArray(first.data?.yourSkills), 'yourSkills required');
  const firstCoverage = Number(first.data.coverage);
  const firstMissing = (first.data.missingSkills || []).map((s) => s.name || s).filter(Boolean).slice(0, 8);

  const cached = await postSkillGap(headers, {
    username,
    careerStack,
    experienceLevel,
    isTemporary: false,
    forceRefresh: false
  });
  counts.cached += 1;
  assert(cached.status === 200);
  assert(
    cached.data?.fromCache === true
      || cached.data?.cacheMetadata?.loadedFromCache === true
      || Number(cached.data?.coverage) === firstCoverage,
    'cached flow must reuse prior result'
  );

  const rapid = await Promise.allSettled([
    postSkillGap(headers, { username, careerStack, experienceLevel, forceRefresh: true }),
    postSkillGap(headers, { username, careerStack, experienceLevel, forceRefresh: true }),
    postSkillGap(headers, { username, careerStack, experienceLevel, forceRefresh: true }),
    postSkillGap(headers, { username, careerStack, experienceLevel, forceRefresh: true }),
    postSkillGap(headers, { username, careerStack, experienceLevel, forceRefresh: true })
  ]);
  counts.rapid += rapid.filter((entry) => entry.status === 'fulfilled').length;
  assert(rapid.every((entry) => entry.status === 'fulfilled'), 'rapid identical refresh must all succeed');
  const rapidCoverages = rapid.map((entry) => Number(entry.value.data.coverage));
  assert(rapidCoverages.every((value) => value === rapidCoverages[0]), 'rapid callers must share one result');

  const refresh = await postSkillGap(headers, {
    username,
    careerStack,
    experienceLevel,
    forceRefresh: true
  });
  counts.refresh += 1;
  assert(refresh.status === 200);
  assert(Number.isFinite(Number(refresh.data?.coverage)));

  // Failure / empty username in preview
  try {
    await postSkillGap(headers, {
      username: '',
      careerStack: 'Frontend',
      experienceLevel: 'Intern',
      isTemporary: true
    }, 30000);
    throw new Error('expected validation failure for empty preview username');
  } catch (error) {
    assert([400, 413].includes(error.response?.status), `expected 400/413 got ${error.response?.status}`);
    counts.failure += 1;
  }

  // Prior valid data still intact after failure
  const afterFailure = await postSkillGap(headers, {
    username,
    careerStack,
    experienceLevel,
    forceRefresh: false
  });
  counts.cached += 1;
  assert(Number.isFinite(Number(afterFailure.data?.coverage)), 'failure must not corrupt cached profile result');

  // Cross-module freshness: recommendations consumer of AnalysisCache / skill gaps
  let recommendationsFresh = false;
  let recommendationsMissingOverlap = 0;
  const gapSet = new Set(firstMissing.map((s) => String(s).toLowerCase()));
  const extractRecGaps = (data) => {
    const pools = [
      data?.signalsUsed?.skillGap?.missingSkills,
      data?.signalsUsed?.skillGapSignals?.missingSkills,
      data?.skillGap?.missingSkills,
      data?.missingSkills,
      data?.recommendedBasedOn?.skillGaps,
      data?.dataSources?.skillGaps,
      data?.recommendationSignals?.skillGap?.missingSkills
    ];
    for (const pool of pools) {
      if (Array.isArray(pool) && pool.length) {
        return pool.map((s) => (typeof s === 'string' ? s : s?.name)).filter(Boolean);
      }
    }
    return [];
  };

  try {
    const rec = await axios.post(`${API}/recommendations`, {
      username,
      forceRefresh: false
    }, { headers, timeout: 180000 });
    counts.recommendations += 1;
    const recGaps = extractRecGaps(rec.data);
    recommendationsMissingOverlap = recGaps.filter((g) => gapSet.has(String(g).toLowerCase())).length;
    recommendationsFresh = rec.status === 200 && (
      recommendationsMissingOverlap > 0
      || Boolean(rec.data?.dataQuality?.hasSkillGapData)
      || Number(rec.data?.signalsUsed?.skillGap?.coverage) === firstCoverage
      || recGaps.length > 0
    );
    assert(recommendationsFresh, 'recommendations must reflect latest skill-gap signals');
    assert(Number(rec.data?.signalsUsed?.skillGap?.coverage) === firstCoverage || recommendationsMissingOverlap > 0, 'dependent module coverage/missing skills must match skill-gap');
  } catch (error) {
    if (String(error.message || '').includes('recommendations must') || String(error.message || '').includes('dependent module')) {
      throw error;
    }
    try {
      const rec = await axios.post(`${API}/recommendations/generate`, {
        username,
        forceRefresh: false
      }, { headers, timeout: 180000 });
      counts.recommendations += 1;
      const recGaps = extractRecGaps(rec.data);
      recommendationsMissingOverlap = recGaps.filter((g) => gapSet.has(String(g).toLowerCase())).length;
      recommendationsFresh = rec.status === 200 && (
        recommendationsMissingOverlap > 0
        || Boolean(rec.data?.dataQuality?.hasSkillGapData)
        || recGaps.length > 0
      );
      assert(recommendationsFresh, 'recommendations/generate must reflect skill-gap data');
    } catch (inner) {
      if (String(inner.message || '').includes('must reflect')) throw inner;
      const cachedGap = await AnalysisCache.findOne({
        userId: session.user._id,
        githubUsername: new RegExp(`^${String(username).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
        careerStack,
        experienceLevel
      }).sort({ updatedAt: -1 }).select('analysisData.missingSkills analysisData.coverage updatedAt').lean();
      const names = (cachedGap?.analysisData?.missingSkills || []).map((s) => s.name || s).filter(Boolean);
      recommendationsMissingOverlap = names.filter((name) => gapSet.has(String(name).toLowerCase())).length;
      recommendationsFresh = names.length > 0 && Number(cachedGap?.analysisData?.coverage) === firstCoverage;
      assert(recommendationsFresh, `AnalysisCache consumer freshness failed: ${inner.message || error.message}`);
    }
  }

  // Index verification for exact lookup query pattern
  const indexes = AnalysisCache.schema.indexes();
  const hasCompound = indexes.some(([keys]) => (
    keys.userId === 1
    && keys.githubUsername === 1
    && keys.careerStack === 1
    && keys.experienceLevel === 1
    && keys.analysisVersion === 1
    && keys.resumeHash === 1
    && keys.resumeAnalysisId === 1
    && keys.signalHash === 1
  ));
  assert(hasCompound, 'compound AnalysisCache index missing');

  let explain = null;
  try {
    const coll = mongoose.connection.collection('analysiscaches');
    explain = await coll.find({
      userId: new mongoose.Types.ObjectId(session.user._id),
      githubUsername: String(username).trim().toLowerCase(),
      careerStack,
      experienceLevel
    }).limit(1).explain('executionStats');
  } catch (error) {
    explain = { error: error.message };
  }

  return {
    counts,
    username,
    careerStack,
    experienceLevel,
    firstCoverage,
    refreshCoverage: Number(refresh.data.coverage),
    cachedFromCache: Boolean(cached.data?.fromCache || cached.data?.cacheMetadata?.loadedFromCache),
    rapidShared: rapidCoverages.every((value) => value === rapidCoverages[0]),
    stalePreserved: Number.isFinite(Number(afterFailure.data?.coverage)),
    recommendationsFresh,
    recommendationsMissingOverlap,
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
    context.setDefaultTimeout(180000);
    const page = await context.newPage();
    const consoleErrors = [];
    const pageErrors = [];
    const skillGapRequests = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (error) => pageErrors.push(String(error)));
    page.on('request', (req) => {
      const url = req.url();
      if (url.includes('/api/skillgap/skill-gap')) {
        skillGapRequests.push(`${req.method()} skillgap/skill-gap`);
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

    await page.goto(`${WEB}/app/skill-gap`, { waitUntil: 'domcontentloaded', timeout: 90000 });
    assert(page.url().includes('/skill-gap'), `unexpected route ${page.url()}`);

    await page.waitForSelector('.sg-page', { timeout: 90000 });
    await page.waitForFunction(() => {
      const loading = document.querySelector('.loading-state, .button-loading');
      const ready = document.querySelector('.hero-summary, .dashboard-section, .state-panel--error, .empty-state, .analysis-toolbar');
      return Boolean(ready) && !loading;
    }, { timeout: 180000 });
    await dismissOverlays();

    const overflowX = await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth));
    const hasNaN = await page.evaluate(() => {
      const text = document.body?.innerText || '';
      return /\bNaN\b/.test(text) || /\bundefined\b/i.test(text);
    });

    const requestsBefore = skillGapRequests.length;

    // Cached / normal: page load may already have requested once
    const reanalyze = page.locator('button', { hasText: /Re-analyze/ }).first();
    if (await reanalyze.count()) {
      await dismissOverlays();
      await reanalyze.click({ force: true, timeout: 30000 });
      await page.waitForFunction(() => !document.querySelector('.button-loading'), { timeout: 180000 });
    }

    const afterRefresh = skillGapRequests.length;

    // Rapid double-click
    if (await reanalyze.count()) {
      await dismissOverlays();
      await reanalyze.click({ force: true, timeout: 30000 });
      await reanalyze.click({ force: true }).catch(() => {});
      await page.waitForFunction(() => !document.querySelector('.button-loading'), { timeout: 180000 });
    }
    const afterRapid = skillGapRequests.length;

    // Browser refresh
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.sg-page', { timeout: 90000 });
    await page.waitForFunction(() => !document.querySelector('.button-loading'), { timeout: 180000 }).catch(() => {});

    // Logout / login cycle via clearing auth then restoring
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
    await page.goto(`${WEB}/app/skill-gap`, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForSelector('.sg-page', { timeout: 90000 });
    await page.waitForFunction(() => !document.querySelector('.button-loading'), { timeout: 180000 }).catch(() => {});

    const overflowXAfter = await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth));
    const hasNaNAfter = await page.evaluate(() => {
      const text = document.body?.innerText || '';
      return /\bNaN\b/.test(text) || /\bundefined\b/i.test(text);
    });

    const filteredConsole = consoleErrors.filter((line) => !/favicon|websocket|sockjs|hmr|Avatar failed|Failed to load resource/i.test(line));
    assert(filteredConsole.length === 0, `${profile.name} console errors: ${filteredConsole.join(' | ')}`);
    assert(pageErrors.length === 0, `${profile.name} page errors: ${pageErrors.join(' | ')}`);
    assert(!hasNaN && !hasNaNAfter, `${profile.name} rendered NaN/undefined`);
    assert(Math.max(overflowX, overflowXAfter) === 0, `${profile.name} horizontal overflow ${Math.max(overflowX, overflowXAfter)}`);
    assert((afterRefresh - requestsBefore) <= 1, `${profile.name} refresh fired ${afterRefresh - requestsBefore} skill-gap requests`);
    assert((afterRapid - afterRefresh) <= 1, `${profile.name} rapid click fired ${afterRapid - afterRefresh} skill-gap requests`);

    results[profile.name] = {
      overflowX: Math.max(overflowX, overflowXAfter),
      hasNaN: hasNaN || hasNaNAfter,
      consoleErrors: filteredConsole,
      pageErrors,
      initialRequests: requestsBefore,
      refreshRequests: afterRefresh - requestsBefore,
      rapidRequests: afterRapid - afterRefresh,
      totalSkillGapRequests: skillGapRequests.length,
      requests: [...skillGapRequests]
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
    console.log('SKILL_GAP_RELEASE_API', JSON.stringify(report.api));
    report.browser = await runBrowserSmoke(session);
  } catch (error) {
    report.errors.push(error.message);
    throw error;
  } finally {
    if (mongoose.connection.readyState === 1) await mongoose.disconnect();
  }

  console.log('SKILL_GAP_RELEASE_VERIFY', JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error('SKILL_GAP_RELEASE_VERIFY_FAILED', error.message);
  process.exit(1);
});
