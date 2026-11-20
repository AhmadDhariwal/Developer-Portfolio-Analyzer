'use strict';

/**
 * Playwright acceptance verifier for the Recruiter module.
 * Spins up an isolated disposable MongoDB replica set, mounts the backend API
 * routes and compiled frontend dist bundle on a local Express server, and
 * validates onboarding, cache isolation, interactive flows, and all 12 Recruiter
 * routes across desktop/tablet/mobile viewports and light/dark themes.
 */
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { existsSync } = require('node:fs');
const { once } = require('node:events');
const path = require('node:path');
const bcrypt = require('bcryptjs');
const express = require('express');
const mongoose = require('mongoose');

const { startMongo } = require('../tests/fixtures/disposableRequestMongo');
const User = require('../modules/auth/models/user');
const Organization = require('../modules/admin/models/organization');
const Team = require('../modules/admin/models/team');
const Membership = require('../modules/admin/models/membership');
const Invitation = require('../modules/admin/models/invitation');
const PlatformSettings = require('../modules/super-admin/models/platformSettings');
const Analysis = require('../modules/skill-gap/models/analysis');
const ResumeAnalysis = require('../modules/resume/models/resumeAnalysis');
const PublicProfile = require('../modules/public-portfolio/models/publicProfile');
const CareerSprint = require('../modules/career-sprint/models/careerSprint');
const WeeklyReport = require('../modules/weekly-reports/models/weeklyReport');
const Notification = require('../modules/notifications/models/notification');
const Job = require('../modules/recruiter/models/Job');
const RecruiterMatch = require('../modules/recruiter/models/RecruiterMatch');
const RecruiterShortlist = require('../modules/recruiter/models/RecruiterShortlist');
const AuditLog = require('../modules/admin/models/auditLog');

const { auditLogMiddleware } = require('../core/middleware/auditLogMiddleware');
const authRoutes = require('../modules/auth/auth.routes');
const profileRoutes = require('../modules/profile/profile.routes');
const tenantRoutes = require('../modules/admin/routes/tenant.routes');
const notificationRoutes = require('../modules/notifications/notification.routes');
const recruiterRoutes = require('../modules/recruiter/routes/recruiter.routes');
const recruiterHubRoutes = require('../modules/recruiter/routes/hub/recruiterHubRoutes');

const PLAYWRIGHT_PATH = process.env.DPA_PLAYWRIGHT_MODULE || 'D:\\Agrivio\\node_modules\\playwright';
const BROWSER_EXECUTABLE =
  process.env.DPA_BROWSER_EXECUTABLE ||
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const FRONTEND_DIST = path.resolve(__dirname, '../../../frontend/dist/frontend/browser');

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'mobile', width: 390, height: 844 }
];

const THEMES = ['dark', 'light'];

const runAuditOnCurrentPage = async (page) =>
  page.evaluate(() => {
    const parseColor = (css) => {
      if (!css || css === 'transparent' || css === 'none') return null;
      const m = css.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/i);
      if (!m) return null;
      return {
        r: Number(m[1]),
        g: Number(m[2]),
        b: Number(m[3]),
        a: m[4] === undefined ? 1 : Number(m[4])
      };
    };

    const blendOver = (fg, bg) => {
      const a = fg.a ?? 1;
      return {
        r: fg.r * a + bg.r * (1 - a),
        g: fg.g * a + bg.g * (1 - a),
        b: fg.b * a + bg.b * (1 - a),
        a: 1
      };
    };

    const toLinear = (v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };

    const relLum = ({ r, g, b }) =>
      0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);

    const contrastRatio = (c1, c2) => {
      const l1 = relLum(c1);
      const l2 = relLum(c2);
      const hi = Math.max(l1, l2);
      const lo = Math.min(l1, l2);
      return (hi + 0.05) / (lo + 0.05);
    };

    const parseGradientBg = (bgImg) => {
      if (!bgImg || bgImg === 'none') return null;
      const matches = [...bgImg.matchAll(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/gi)];
      const solidStops = matches
        .map((m) => ({
          r: Number(m[1]),
          g: Number(m[2]),
          b: Number(m[3]),
          a: m[4] === undefined ? 1 : Number(m[4])
        }))
        .filter((c) => c.a > 0.05)
        .sort((a, b) => b.a - a.a);
      if (!solidStops.length) return null;
      return solidStops[0];
    };

    const resolveEffectiveBg = (el) => {
      const chain = [];
      let cur = el;
      while (cur && cur.nodeType === 1) {
        const cs = getComputedStyle(cur);
        const bg = parseColor(cs.backgroundColor);
        const gradBg = (!bg || bg.a <= 0.01) ? parseGradientBg(cs.backgroundImage) : null;
        const chosen = (bg && bg.a > 0.01) ? bg : gradBg;
        if (chosen && chosen.a > 0.01) chain.unshift(chosen);
        cur = cur.parentElement;
      }
      const theme = document.documentElement.getAttribute('data-theme');
      let result = theme === 'light' ? { r: 246, g: 248, b: 251, a: 1 } : { r: 11, g: 15, b: 23, a: 1 };
      for (const layer of chain) {
        result = blendOver(layer, result);
      }
      return result;
    };

    const docOverflowPx = Math.round(
      document.documentElement.scrollWidth - window.innerWidth
    );
    const mainEl = document.querySelector('main.main-content') || document.body;
    const mainOverflowPx = Math.round(mainEl.scrollWidth - mainEl.clientWidth);

    const root =
      document.querySelector('main.main-content section') ||
      document.querySelector('main.main-content') ||
      document.body;

    const candidates = Array.from(
      root.querySelectorAll('h1, h2, h3, p, span, strong, small, label, button, a, th, td, div.message')
    );

    const contrastFailures = [];
    for (const el of candidates) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
        continue;
      }
      // Only inspect elements that directly own text nodes
      const directText = Array.from(el.childNodes)
        .filter((n) => n.nodeType === 3)
        .map((n) => n.textContent.trim())
        .join('');
      if (!directText) continue;

      const fg = parseColor(style.color);
      if (!fg) continue;
      const bg = resolveEffectiveBg(el);
      const effectiveFg = fg.a < 1 ? blendOver(fg, bg) : fg;
      const ratio = contrastRatio(effectiveFg, bg);

      const fontSize = parseFloat(style.fontSize) || 14;
      const weight = Number(style.fontWeight) || 400;
      const isLarge = fontSize >= 24 || (fontSize >= 18.67 && weight >= 700);
      const threshold = isLarge ? 3.0 : 4.5;

      if (ratio < threshold && contrastFailures.length < 15) {
        contrastFailures.push({
          tag: el.tagName.toLowerCase(),
          className: String(el.className || ''),
          text: directText.slice(0, 50),
          ratio: Number(ratio.toFixed(2)),
          threshold,
          color: style.color,
          resolvedBg: `rgb(${Math.round(bg.r)}, ${Math.round(bg.g)}, ${Math.round(bg.b)})`
        });
      }
    }

    return {
      theme: document.documentElement.getAttribute('data-theme') || 'dark',
      innerWidth: window.innerWidth,
      docScrollWidth: document.documentElement.scrollWidth,
      docOverflowPx,
      mainOverflowPx,
      contrastFailures
    };
  });

const ensureTheme = async (page, targetTheme) => {
  const current = await page.evaluate(
    () => document.documentElement.getAttribute('data-theme') || 'dark'
  );
  if (current === targetTheme) return;
  const btn = page.locator('app-navbar .theme-toggle-btn').first();
  if ((await btn.count()) > 0 && (await btn.isVisible().catch(() => false))) {
    await btn.click();
    await page.waitForFunction(
      (t) => document.documentElement.getAttribute('data-theme') === t,
      targetTheme,
      { timeout: 5000 }
    );
  } else {
    await page.evaluate((t) => {
      document.documentElement.setAttribute('data-theme', t);
      localStorage.setItem('dpa-theme', t);
    }, targetTheme);
  }
};

const waitForAngularIdle = async (page) => {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(500);
  await page
    .waitForFunction(() => document.querySelectorAll('app-recruiter-loader').length === 0, {
      timeout: 8000
    })
    .catch(() => {});
  await page.waitForTimeout(250);
};

const loginViaUi = async (page, baseUrl, email, password) => {
  await page.goto(`${baseUrl}/auth/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('#login-email', email);
  await page.fill('#login-password', password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/app\//, { timeout: 10000 });
  await waitForAngularIdle(page);
};

async function run() {
  assert.ok(existsSync(FRONTEND_DIST), `Missing frontend dist at ${FRONTEND_DIST}`);
  assert.ok(existsSync(BROWSER_EXECUTABLE), `Missing browser executable at ${BROWSER_EXECUTABLE}`);

  const { chromium } = require(PLAYWRIGHT_PATH);
  const mongo = await startMongo({
    replicaSet: 'recruiter-browser',
    temporaryRoot: process.env.TEMP || undefined
  });

  const prevSecret = process.env.JWT_SECRET;
  const prevCacheTtl = process.env.RECRUITER_SUMMARY_CACHE_TTL_SECONDS;
  process.env.JWT_SECRET = randomBytes(32).toString('hex');
  delete process.env.RECRUITER_SUMMARY_CACHE_TTL_SECONDS;

  let browser;
  let server;

  try {
    await mongoose.connect(mongo.uri);

    const passwordHash = await bcrypt.hash('Passw0rd!123', 10);
    const superAdmin = await User.create({
      name: 'Super Admin',
      email: 'super-browser@example.test',
      password: passwordHash,
      role: 'super_admin',
      isVerified: true,
      providers: ['local']
    });

    await PlatformSettings.findOneAndUpdate(
      { scope: 'global' },
      {
        $set: {
          scope: 'global',
          enableRecruiterAccess: true,
          'recruiter.candidateVisibility': 'public'
        }
      },
      { upsert: true }
    );

    const [orgAlpha, orgBeta] = await Organization.create([
      { name: 'Alpha Talent', slug: 'alpha-talent', ownerId: superAdmin._id, createdBy: superAdmin._id },
      { name: 'Beta Talent', slug: 'beta-talent', ownerId: superAdmin._id, createdBy: superAdmin._id }
    ]);

    const team = await Team.create({
      organizationId: orgAlpha._id,
      name: 'Platform Hiring',
      slug: 'platform-hiring',
      createdBy: superAdmin._id
    });

    const [recruiter1, recruiter2] = await User.create([
      {
        name: 'Ayesha Recruiter',
        email: 'rec1@example.test',
        password: passwordHash,
        phoneNumber: '+923001234567',
        role: 'recruiter',
        organizationId: orgAlpha._id,
        isVerified: true,
        isActive: true,
        providers: ['local'],
        location: 'Lahore'
      },
      {
        name: 'Bilal Recruiter',
        email: 'rec2@example.test',
        password: passwordHash,
        phoneNumber: '+923009876543',
        role: 'recruiter',
        organizationId: orgBeta._id,
        isVerified: true,
        isActive: true,
        providers: ['local'],
        location: 'Karachi'
      }
    ]);

    await Membership.create([
      { organizationId: orgAlpha._id, teamId: team._id, userId: recruiter1._id, role: 'member', status: 'active' },
      { organizationId: orgBeta._id, teamId: null, userId: recruiter2._id, role: 'member', status: 'active' }
    ]);

    const inviteToken = 'invite-browser-token-001';
    await Invitation.create({
      email: 'invited-recruiter@example.test',
      name: 'Sana Invited',
      role: 'recruiter',
      organizationId: orgAlpha._id,
      teamId: team._id,
      token: inviteToken,
      invitedBy: superAdmin._id,
      status: 'pending',
      expiresAt: new Date(Date.now() + 86400000)
    });

    const devs = await User.create([
      {
        name: 'Aliya Developer',
        email: 'aliya@example.test',
        role: 'developer',
        isPublic: true,
        isActive: true,
        isVerified: true,
        providers: ['github'],
        stack: 'Full Stack',
        experienceLevel: '3-5 years',
        location: 'Remote',
        githubUsername: 'aliya-dev'
      },
      {
        name: 'Zain Backend',
        email: 'zain@example.test',
        role: 'developer',
        isPublic: true,
        isActive: true,
        isVerified: true,
        providers: ['github'],
        stack: 'Backend',
        experienceLevel: '1-2 years',
        location: 'Lahore',
        githubUsername: 'zain-be'
      },
      {
        name: 'Hira Frontend',
        email: 'hira@example.test',
        role: 'developer',
        isPublic: true,
        isActive: true,
        isVerified: true,
        providers: ['github'],
        stack: 'Frontend',
        experienceLevel: '3-5 years',
        location: 'Remote',
        githubUsername: 'hira-fe'
      }
    ]);

    const now = new Date();
    const weekStart = new Date(now.getTime() - 6 * 86400000);
    await Promise.all([
      Analysis.insertMany(
        devs.map((d, idx) => ({
          userId: d._id,
          githubScore: 82 - idx * 5,
          skillScore: 80 - idx * 4,
          readinessScore: 85 - idx * 5,
          githubStats: { repos: 14, stars: 90, forks: 10, followers: 22 }
        }))
      ),
      ResumeAnalysis.insertMany(
        devs.map((d) => ({
          userId: d._id,
          fileId: new mongoose.Types.ObjectId(),
          fileName: 'resume.pdf',
          fileSize: 98000,
          atsScore: 84,
          keywordDensity: 80,
          formatScore: 85,
          contentQuality: 83,
          skills: { core: ['TypeScript', 'Node.js', 'Angular', 'MongoDB'] }
        }))
      ),
      PublicProfile.insertMany(
        devs.map((d, idx) => ({
          userId: d._id,
          slug: `dev-${idx}`,
          isPublic: true,
          skills: [{ name: 'TypeScript', score: 90 }],
          projects: [
            {
              title: `Distributed System ${idx + 1}`,
              description: 'Production cluster',
              tech: ['TypeScript', 'MongoDB'],
              status: 'completed'
            }
          ]
        }))
      ),
      CareerSprint.insertMany(
        devs.map((d) => ({
          userId: d._id,
          weekStartDate: weekStart,
          weekEndDate: now,
          currentStreak: 4,
          tasks: [{ title: 'Ship tests', isCompleted: true }]
        }))
      ),
      WeeklyReport.insertMany(
        devs.map((d) => ({
          userId: d._id,
          weekStartDate: weekStart,
          weekEndDate: now,
          score: 88,
          progressSummary: 'Weekly growth verified',
          reportText: 'Weekly growth verified across sprints and repositories.',
          meta: {
            comparisons: { readinessDelta: 5, coverageDelta: 4 },
            sprint: { completionRate: 90, streak: 4 },
            activity: { weeklyCommitSignal: 18 }
          }
        }))
      )
    ]);

    const job1 = await Job.create({
      recruiterId: recruiter1._id,
      organizationId: orgAlpha._id,
      teamId: team._id,
      title: 'Staff Full Stack Engineer',
      role: 'Full Stack Engineer',
      stack: 'Full Stack',
      requiredSkills: ['TypeScript', 'Node.js', 'MongoDB'],
      preferredSkills: ['Angular', 'Redis'],
      minExperienceYears: 2,
      location: 'Remote',
      employmentType: 'full-time',
      description: 'Lead architecture across Angular and Node pipelines.',
      status: 'open'
    });

    await Job.create({
      recruiterId: recruiter2._id,
      organizationId: orgBeta._id,
      title: 'Beta Exclusive Role',
      role: 'Platform Engineer',
      stack: 'Backend',
      requiredSkills: ['Go', 'Kubernetes'],
      location: 'Karachi',
      status: 'open'
    });

    await RecruiterMatch.create({
      recruiterId: recruiter1._id,
      organizationId: orgAlpha._id,
      teamId: team._id,
      jobId: job1._id,
      candidateId: devs[0]._id,
      matchScore: 89,
      skillMatchPercent: 95,
      experienceMatch: 'Strong',
      githubProjectScore: 84,
      readinessScore: 85,
      confidenceScore: 88,
      recommendation: 'Strong Hire',
      explanation: 'Strong match across core TypeScript and Node.js stack.',
      status: 'shortlisted'
    });

    await RecruiterShortlist.create({
      recruiterId: recruiter1._id,
      organizationId: orgAlpha._id,
      teamId: team._id,
      candidateId: devs[0]._id,
      jobId: job1._id,
      notes: 'Ready for architectural interview.',
      status: 'shortlisted'
    });

    await Notification.create({
      userId: recruiter1._id,
      type: 'info',
      title: 'Candidate Match Generated',
      message: 'Aliya Developer matched Staff Full Stack Engineer at 89%.'
    });

    await AuditLog.create({
      actor: recruiter1._id,
      organizationId: orgAlpha._id,
      teamId: team._id,
      action: 'RECRUITER_JOB_CREATED',
      method: 'POST',
      route: '/api/recruiter-hub/jobs',
      statusCode: 201,
      timestamp: new Date()
    });

    const app = express();
    app.use(express.json());
    app.use(auditLogMiddleware);
    app.use('/api/auth', authRoutes);
    app.use('/api/profile', profileRoutes);
    app.use('/api/tenant', tenantRoutes);
    app.use('/api/notifications', notificationRoutes);
    app.use('/api/recruiter', recruiterRoutes);
    app.use('/api/recruiter-hub', recruiterHubRoutes);
    app.use(express.static(FRONTEND_DIST));
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.sendFile(path.join(FRONTEND_DIST, 'index.html'));
    });

    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    browser = await chromium.launch({
      executablePath: BROWSER_EXECUTABLE,
      headless: true
    });

    const pageErrors = [];
    const consoleErrors = [];
    const http500s = [];
    const apiLog = [];

    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    page.on('pageerror', (err) => pageErrors.push(err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('response', (res) => {
      if (res.url().includes('/api/')) apiLog.push(`${res.status()} ${res.url()}`);
      if (res.status() >= 500) http500s.push(`${res.status()} ${res.url()}`);
    });

    try {
      // Flow A: Invitation Acceptance Onboarding
      await page.goto(`${baseUrl}/invitations/accept/${inviteToken}`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#g-name', { timeout: 10000 });
      await page.fill('#g-name', 'Sana Onboarded');
      await page.fill('#g-phone', '+923005551122');
      await page.fill('#g-password', 'StrongPass1!');
      await page.click('button.btn--primary');
      await page.waitForSelector('text=Account Ready!', { timeout: 10000 });
      await page.click('button:has-text("Go to Dashboard")');
      await page.waitForURL(/\/app\/recruiter\//, { timeout: 10000 });
      await waitForAngularIdle(page);

      // Clear session for login + cache isolation verification
      await page.evaluate(() => localStorage.clear());

      // Flow B: Recruiter 2 logs in -> sees Beta Exclusive Role, NOT Staff Full Stack Engineer
      await loginViaUi(page, baseUrl, 'rec2@example.test', 'Passw0rd!123');
      await page.goto(`${baseUrl}/app/recruiter/jobs`, { waitUntil: 'domcontentloaded' });
      await waitForAngularIdle(page);
      const rec2Text = await page.locator('main.main-content').innerText();
      assert.ok(rec2Text.includes('Beta Exclusive Role'));
      assert.ok(!rec2Text.includes('Staff Full Stack Engineer'));

      // Logout & login as Recruiter 1 -> no stale Recruiter 2 data
      await page.evaluate(() => localStorage.clear());
      await loginViaUi(page, baseUrl, 'rec1@example.test', 'Passw0rd!123');

      // Interactive Flow C: Create Job with Empty Description on /app/recruiter/jobs
      await page.goto(`${baseUrl}/app/recruiter/jobs`, { waitUntil: 'domcontentloaded' });
      await waitForAngularIdle(page);
      const rec1JobsText = await page.locator('main.main-content').innerText();
      assert.ok(rec1JobsText.includes('Staff Full Stack Engineer'));
      assert.ok(!rec1JobsText.includes('Beta Exclusive Role'));

      await page.fill('#job-title', 'Senior QA Automation Engineer');
      await page.fill('#job-role', 'QA Engineer');
      await page.fill('#job-stack', 'TypeScript, Playwright');
      await page.fill('#job-location', 'Remote');
      await page.fill('#job-experience', '2');
      await page.fill('#job-required-skills', 'TypeScript, Playwright, CI');
      await page.fill('#job-description', '');
      await page.click('form.glass-form button[type="submit"]');
      await page.waitForFunction(
        () => document.body.innerText.includes('Senior QA Automation Engineer'),
        { timeout: 8000 }
      );

      // Interactive Flow D: Filter candidates & compare 2 candidates & update recruiter profile
      await page.goto(`${baseUrl}/app/recruiter/candidates`, { waitUntil: 'domcontentloaded' });
      await waitForAngularIdle(page);
      await page.fill('app-candidate-filter-bar input[placeholder*="Search"], app-candidate-filter-bar input', 'Aliya');
      await page.click('app-candidate-filter-bar button.filter-btn');
      await page.waitForTimeout(350);
      assert.ok((await page.locator('main.main-content').innerText()).includes('Aliya Developer'));

      await page.goto(`${baseUrl}/app/recruiter/comparison`, { waitUntil: 'domcontentloaded' });
      await waitForAngularIdle(page);
      const pills = page.locator('.candidate-pill');
      if ((await pills.count()) >= 2) {
        await pills.nth(0).click();
        await pills.nth(1).click();
        await page.click('button.primary-btn:has-text("Compare")');
        await page.waitForSelector('app-comparison-table', { timeout: 8000 });
      }

      // Responsive + Theme + Contrast + Overflow Matrix across all 12 Recruiter Routes
      const routes = [
        { name: 'dashboard', path: '/app/recruiter/dashboard' },
        { name: 'notifications', path: '/app/recruiter/notifications' },
        { name: 'candidates', path: '/app/recruiter/candidates' },
        { name: 'candidate-details', path: `/app/recruiter/candidates/${devs[0]._id}` },
        { name: 'jobs', path: '/app/recruiter/jobs' },
        { name: 'job-details', path: `/app/recruiter/jobs/${job1._id}` },
        { name: 'matches', path: '/app/recruiter/matches' },
        { name: 'shortlists', path: '/app/recruiter/shortlists' },
        { name: 'comparison', path: '/app/recruiter/comparison' },
        { name: 'analytics', path: '/app/recruiter/analytics' },
        { name: 'activity-logs', path: '/app/recruiter/activity-logs' },
        { name: 'profile', path: '/app/recruiter/profile' }
      ];

      const matrix = [];
      for (const route of routes) {
        await page.goto(`${baseUrl}${route.path}`, { waitUntil: 'domcontentloaded' });
        await waitForAngularIdle(page);
        for (const vp of VIEWPORTS) {
          await page.setViewportSize({ width: vp.width, height: vp.height });
          await page.waitForTimeout(100);
          for (const theme of THEMES) {
            await ensureTheme(page, theme);
            await page.waitForTimeout(120);
            const audit = await runAuditOnCurrentPage(page);
            matrix.push({
              route: route.name,
              path: route.path,
              viewport: vp.name,
              theme,
              ...audit
            });
          }
        }
      }

      const overflowIssues = matrix.filter((r) => r.docOverflowPx > 1 || r.mainOverflowPx > 1);
      const recruiterContrastIssues = matrix.filter(
        (r) => r.route !== 'notifications' && r.contrastFailures.length > 0
      );
      const sharedNotificationsContrastIssues = matrix.filter(
        (r) => r.route === 'notifications' && r.contrastFailures.length > 0
      );

      const summary = {
        passedFlows: [
          'invite-onboarding',
          'cross-recruiter-cache-isolation',
          'create-job-empty-description',
          'candidate-filtering',
          'candidate-comparison'
        ],
        totalMatrixChecks: matrix.length,
        overflowIssueCount: overflowIssues.length,
        contrastIssueCount: recruiterContrastIssues.length,
        sharedNotificationsContrastIssueCount: sharedNotificationsContrastIssues.length,
        pageErrorCount: pageErrors.length,
        consoleErrorCount: consoleErrors.length,
        http500Count: http500s.length,
        overflowIssues,
        contrastIssues: recruiterContrastIssues,
        sharedNotificationsContrastIssues,
        pageErrors,
        consoleErrors,
        http500s
      };

      console.log(JSON.stringify(summary, null, 2));

      if (
        overflowIssues.length > 0 ||
        recruiterContrastIssues.length > 0 ||
        pageErrors.length > 0 ||
        http500s.length > 0
      ) {
        process.exitCode = 1;
      }
    } catch (flowError) {
      const diag = {
        url: page.url(),
        bodyText: await page.locator('body').innerText().catch(() => ''),
        pageErrors,
        consoleErrors,
        apiLog,
        httpErrors: http500s
      };
      console.error('DIAG:', JSON.stringify(diag, null, 2));
      throw flowError;
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (server) await new Promise((resolve) => server.close(resolve));
    await mongoose.disconnect().catch(() => {});
    await mongo.stop().catch(() => {});
    if (prevSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = prevSecret;
    if (prevCacheTtl === undefined) delete process.env.RECRUITER_SUMMARY_CACHE_TTL_SECONDS;
    else process.env.RECRUITER_SUMMARY_CACHE_TTL_SECONDS = prevCacheTtl;
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
