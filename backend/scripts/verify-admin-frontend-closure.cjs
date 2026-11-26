// Compiled Angular -> real Express routes -> disposable replica-set MongoDB.
// This verifier never reads .env, existing databases or external providers.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { once } = require('node:events');
const express = require('express');
const mongoose = require('mongoose');
const { startMongo } = require('../src/tests/fixtures/disposableRequestMongo');

process.env.NODE_ENV = 'test';
process.env.REDIS_URL = '';
process.env.JWT_SECRET = randomBytes(32).toString('hex');
mongoose.set('bufferCommands', false);
mongoose.set('autoCreate', false);
mongoose.set('autoIndex', false);

const root = path.resolve(__dirname, '../..');
const output = path.join(root, 'frontend/verification/admin/p1.6b.1');
const baseline = process.argv.includes('--baseline');
const layoutProbe = process.argv.includes('--layout-probe');
const mobileProbe = process.argv.includes('--mobile-probe');
const phase = mobileProbe
  ? 'final-mobile-probe'
  : layoutProbe
    ? 'baseline-layout'
    : baseline
      ? 'baseline'
      : 'final';
const dist = path.join(output, baseline ? 'baseline-build/browser' : 'build/browser');
const result = {
  phase,
  apiMocks: false,
  productionDataUsed: false,
  checks: {},
  profiles: [],
  requests: [],
  streamRequests: 0,
  offlineExternalAssets: [],
  consoleErrors: [],
  runtimeErrors: [],
  badHttp: [],
  expectedFaults: [],
  maxConcurrentStreams: 0
};
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function runtime() {
  const candidates = [process.env.PLAYWRIGHT_MODULE, 'playwright', 'playwright-core'].filter(
    Boolean
  );
  const cache = path.join(process.env.LOCALAPPDATA || '', 'npm-cache/_npx');
  if (fs.existsSync(cache))
    for (const entry of fs.readdirSync(cache))
      candidates.push(path.join(cache, entry, 'node_modules/playwright-core'));
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch {
      /* Try the next installed runtime. */
    }
  }
  throw new Error(
    'Installed Playwright runtime required; dependencies are never installed by this verifier.'
  );
}

async function main() {
  assert.ok(
    fs.existsSync(path.join(dist, 'index.html')),
    'Build this phase before running the verifier'
  );
  fs.mkdirSync(path.join(output, 'screenshots'), { recursive: true });
  const mongo = await startMongo({ replicaSet: 'admin-frontend-closure', readinessAttempts: 200 });
  let browser,
    server,
    expectedFault = false;
  const delays = { overview: 0, teams: 0, audit: 0, developers: 0 };
  const settings = require('../src/modules/super-admin/services/platformSettingsService');
  const streams = require('../src/modules/notifications/services/notificationStreamService');
  try {
    await mongoose.connect(mongo.uri);
    const User = require('../src/modules/auth/models/user');
    const Org = require('../src/modules/admin/models/organization');
    const Team = require('../src/modules/admin/models/team');
    const Membership = require('../src/modules/admin/models/membership');
    const Audit = require('../src/modules/admin/models/auditLog');
    const Job = require('../src/modules/recruiter/models/Job');
    const notificationService = require('../src/modules/notifications/services/notificationService');
    const { sign } = require('../src/modules/auth/utils/authSessionToken');
    for (const Model of Object.values(mongoose.models)) {
      await Model.createCollection();
      await Model.createIndexes();
    }
    const admin = await User.create({
      name: 'Closure Admin',
      email: 'admin@closure.test',
      role: 'admin',
      isVerified: true,
      providers: ['github']
    });
    const org = await Org.create({
      name: 'Closure Organization',
      slug: 'frontend-closure',
      ownerId: admin._id,
      createdBy: admin._id
    });
    admin.organizationId = org._id;
    await admin.save();
    await Membership.create({
      userId: admin._id,
      organizationId: org._id,
      teamId: null,
      role: 'admin'
    });
    const team = await Team.create({
      name: 'Closure Platform Engineering and Developer Experience',
      slug: 'closure-team',
      organizationId: org._id,
      createdBy: admin._id
    });
    await settings.startSettingsSynchronization();
    await User.insertMany(
      Array.from({ length: 14 }, (_, i) => ({
        name: `Closure Candidate ${String(i).padStart(2, '0')}`,
        email: `candidate-${i}@closure.test`,
        role: 'developer',
        isVerified: true,
        isActive: true,
        isPublic: true,
        providers: ['github'],
        careerStack: i % 2 ? 'Backend' : 'Frontend',
        activeCareerStack: i % 2 ? 'Backend' : 'Frontend',
        experienceLevel: 'Student',
        createdAt: new Date(2026, 10, 26, 0, i)
      }))
    );
    await Job.create({
      title: 'Closure Engineer',
      recruiterId: admin._id,
      organizationId: org._id,
      teamId: team._id,
      status: 'open',
      requiredSkills: ['TypeScript']
    });
    await Audit.insertMany(
      Array.from({ length: 25 }, (_, i) => ({
        actor: admin._id,
        organizationId: org._id,
        action: `TEAM_UPDATED_${i}`,
        method: 'PATCH',
        route: '/api/tenant/teams/fixture',
        statusCode: 200,
        timestamp: new Date(Date.now() - i * 60000)
      }))
    );
    await notificationService.createNotification({
      userId: admin._id,
      type: 'info',
      title: 'Closure notice',
      message: 'Synthetic workspace notice',
      eventId: 'frontend-closure-notice'
    });
    const app = express();
    app.use(express.json());
    let activeStreams = 0;
    app.use(async (req, res, next) => {
      const startedAt = Date.now();
      if (req.path.startsWith('/api/'))
        res.once('finish', () =>
          result.requests.push({
            path: req.path,
            method: req.method,
            status: res.statusCode,
            startedAt,
            finishedAt: Date.now()
          })
        );
      if (req.path === '/api/notifications/stream') {
        result.streamRequests++;
        activeStreams++;
        result.maxConcurrentStreams = Math.max(result.maxConcurrentStreams, activeStreams);
        res.once('close', () => activeStreams--);
      }
      const delay =
        req.path === '/api/admin-console/overview'
          ? delays.overview
          : /\/api\/tenant\/organizations\/[^/]+\/teams$/.test(req.path)
            ? delays.teams
            : req.path === '/api/audit-logs'
              ? delays.audit
              : req.path === '/api/admin/developers'
                ? req.query.search === 'Closure Candidate 0'
                  ? 1200
                  : delays.developers
                : 0;
      if (delay) await wait(delay);
      next();
    });
    for (const [prefix, module] of [
      ['admin', 'admin/routes/admin.routes'],
      ['admin-console', 'admin/routes/adminConsole.routes'],
      ['tenant', 'admin/routes/tenant.routes'],
      ['audit-logs', 'admin/routes/audit.routes'],
      ['profile', 'profile/profile.routes'],
      ['notifications', 'notifications/notification.routes'],
      ['auth', 'auth/auth.routes'],
      ['resume', 'resume/resume.routes']
    ])
      app.use(`/api/${prefix}`, require(`../src/modules/${module}`));
    app.use(express.static(dist));
    app.use((req, res) =>
      req.path.startsWith('/api/')
        ? res.status(404).json({ message: 'Verifier route missing' })
        : res.sendFile(path.join(dist, 'index.html'))
    );
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const origin = `http://127.0.0.1:${server.address().port}`;
    const chrome = [
      'C:/Program Files/Google/Chrome/Application/chrome.exe',
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
    ].find((file) => fs.existsSync(file));
    browser = await runtime().chromium.launch({
      headless: true,
      ...(chrome && { executablePath: chrome })
    });
    async function context(profile) {
      const ctx = await browser.newContext({
        viewport: { width: profile.width, height: profile.height },
        colorScheme: profile.scheme || 'light',
        reducedMotion: 'reduce'
      });
      await ctx.addInitScript(
        ({ token, actor, tenant, theme }) => {
          localStorage.setItem('token', token);
          localStorage.setItem('user', JSON.stringify(actor));
          localStorage.setItem('loginExpiry', String(Date.now() + 3600000));
          localStorage.setItem('devinsight_tenant_context', JSON.stringify(tenant));
          localStorage.setItem('devinsight_theme', theme);
          localStorage.setItem('devinsight_resume_prompt_permanent_dismiss', 'true');
        },
        {
          token: sign(admin),
          actor: {
            _id: admin.id,
            name: admin.name,
            email: admin.email,
            role: 'admin',
            organizationId: org.id,
            isVerified: true
          },
          tenant: {
            organizationId: org.id,
            organizationName: org.name,
            myRole: 'admin',
            teamId: '',
            teamName: ''
          },
          theme: profile.theme
        }
      );
      const page = await ctx.newPage();
      page.setDefaultTimeout(12000);
      // Keep optional external fonts/images offline without failed-resource noise.
      // No application API request is intercepted or substituted.
      await page.route('**/*', (route) => {
        if (new URL(route.request().url()).origin === origin) return route.continue();
        const asset = new URL(route.request().url());
        result.offlineExternalAssets.push(asset.origin + asset.pathname);
        return route.fulfill({
          status: 200,
          contentType: route.request().resourceType() === 'stylesheet' ? 'text/css' : 'text/plain',
          body: ''
        });
      });
      page.on('console', (message) => {
        if (message.type() === 'error')
          (expectedFault ? result.expectedFaults : result.consoleErrors).push(message.text());
      });
      page.on('pageerror', (error) => result.runtimeErrors.push(error.message));
      page.on('response', (response) => {
        if (response.url().includes('/api/') && response.status() >= 400)
          (expectedFault ? result.expectedFaults : result.badHttp).push({
            path: new URL(response.url()).pathname,
            status: response.status()
          });
      });
      return { ctx, page };
    }
    const shot = (page, name) =>
      page.screenshot({
        path: path.join(output, 'screenshots', `${phase}-${name}.png`),
        fullPage: true
      });
    const go = async (page, route) => {
      await page.goto(origin + route, { waitUntil: 'domcontentloaded' });
      await page.locator('app-main-layout').waitFor();
      const selector = route.includes('performance-statistics')
        ? '.ps-shell'
        : route.includes('/console')
          ? '.oc-shell'
          : route.includes('/developers')
            ? 'app-admin-developers-page'
            : route.includes('/jobs')
              ? 'app-admin-jobs-page'
              : route.includes('/teams')
                ? 'app-admin-teams-page'
                : route.includes('/recruiters')
                  ? 'app-admin-recruiters-page'
                  : 'app-admin-activity-logs';
      await page.locator(selector).waitFor();
    };
    const settled = async (page) => {
      await page.waitForFunction(
        () =>
          !document.querySelector(
            '.oc-loading-bar, .ps-loading-bar, .shared-loader, .logs-loading'
          ),
        null,
        { timeout: 12000 }
      );
    };
    const { ctx, page } = await context({
      width: mobileProbe ? 390 : 1440,
      height: mobileProbe ? 844 : 900,
      theme: mobileProbe ? 'dark' : 'light'
    });
    if (mobileProbe) {
      await go(page, '/app/admin/recruiters');
      await page.waitForFunction(() => document.querySelector('#direct-team')?.options.length > 1);
      result.checks.recruiterActionBounds = await page
        .locator('.console-card__actions button')
        .evaluateAll((elements) =>
          elements.map((el) => ({
            left: el.getBoundingClientRect().left,
            right: el.getBoundingClientRect().right,
            viewport: innerWidth
          }))
        );
      assert.ok(
        result.checks.recruiterActionBounds.every(
          (box) => box.left >= 0 && box.right <= box.viewport
        )
      );
      await shot(page, 'recruiters-dark');
      result.status = 'passed';
      return;
    }
    if (layoutProbe) {
      await go(page, '/app/admin/console/performance-statistics');
      await page.waitForFunction(() => document.querySelector('.ps-select')?.options.length > 1);
      result.checks.performanceBack = await page.locator('a.ps-btn-ghost').evaluate((el) => ({
        backTop: el.getBoundingClientRect().top,
        filterTops: [...el.parentElement.children]
          .filter((child) => child !== el)
          .map((child) => child.getBoundingClientRect().top)
      }));
      await shot(page, 'performance-long-label');
      result.status = 'passed';
      return;
    }
    delays.developers = 200;
    await go(page, '/app/admin/developers');
    await page
      .locator('.developer-card')
      .first()
      .waitFor({ timeout: 10000 })
      .catch(() => {});
    result.checks.initialDeveloperCards = await page.locator('.developer-card').count();
    if (baseline && !result.checks.initialDeveloperCards)
      await page.locator('#developer-search').click();
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await wait(700);
    result.checks.pageTwoAutomatic = await page
      .locator('.results-bar')
      .textContent()
      .catch(() => '')
      .then((text) => text.includes('11-14'));
    await shot(page, 'developers-page-two');
    if (!baseline) {
      assert.equal(result.checks.pageTwoAutomatic, true);
      await page.getByRole('button', { name: 'Previous', exact: true }).click();
      await page.waitForFunction(() =>
        document.querySelector('.results-bar')?.textContent.includes('1-10')
      );
      await page.locator('#developer-search').fill('Closure Candidate 0');
      await wait(350);
      await page.locator('#developer-search').fill('Closure Candidate 13');
      await page.waitForFunction(
        () => document.querySelector('.developer-card h3')?.textContent === 'Closure Candidate 13'
      );
      await wait(1400);
      assert.equal(await page.locator('.developer-card h3').textContent(), 'Closure Candidate 13');
      result.checks.latestSearchOnly = true;
      await page.locator('#developer-search').fill('No matching closure candidate');
      await page.getByText('No developers match the current filters', { exact: true }).waitFor();
      await page.getByRole('button', { name: 'Reset Filters', exact: true }).click();
      await page.locator('.developer-card').first().waitFor();
      await page.locator('#stack-filter').selectOption('Backend');
      await page.waitForFunction(() =>
        document.querySelector('.results-bar')?.textContent.includes('of 7 developers')
      );
      assert.equal(await page.locator('.developer-card').count(), 7);
      result.checks.filtersEmptyAndPrevious = true;
      expectedFault = true;
      await mongoose.disconnect();
      await page.locator('#stack-filter').selectOption('Frontend');
      await page.getByRole('button', { name: 'Retry', exact: true }).waitFor();
      await mongoose.connect(mongo.uri);
      await page.getByRole('button', { name: 'Retry', exact: true }).click();
      await page.locator('.developer-card').first().waitFor();
      await wait(1800);
      expectedFault = false;
      result.checks.developerDatabaseFailureRetry = true;
    }
    for (const order of ['overview-first', 'teams-first']) {
      delays.overview = order === 'overview-first' ? 50 : 700;
      delays.teams = order === 'teams-first' ? 50 : 700;
      await go(page, '/app/admin/console?tab=overview');
      await wait(1300);
      result.checks[`console-${order}`] = {
        progressbars: await page.locator('.oc-loading-bar').count(),
        overview: await page.locator('.oc-org-card').count()
      };
      await shot(page, `console-${order}`);
      if (!baseline) assert.equal(result.checks[`console-${order}`].progressbars, 0);
    }
    delays.overview = delays.teams = 0;
    if (!baseline) {
      result.checks.consoleFaultRecovery = [];
      for (const failure of ['teams', 'overview', 'both']) {
        expectedFault = true;
        delays.overview = failure === 'overview' ? 1800 : 0;
        delays.teams = failure === 'teams' ? 1800 : 0;
        if (failure === 'both') await mongoose.disconnect();
        const firstSuccess =
          failure === 'both'
            ? null
            : page.waitForResponse(
                (response) =>
                  response.status() === 200 &&
                  (failure === 'teams'
                    ? new URL(response.url()).pathname === '/api/admin-console/overview'
                    : /\/api\/tenant\/organizations\/[^/]+\/teams$/.test(
                        new URL(response.url()).pathname
                      ))
              );
        await go(page, '/app/admin/console?tab=overview');
        if (firstSuccess) {
          await firstSuccess;
          await mongoose.disconnect();
        }
        await settled(page);
        const errorVisible = await page.locator('.oc-tab-error, .oc-alert--error').count();
        await mongoose.connect(mongo.uri);
        delays.overview = delays.teams = 0;
        await page.getByRole('button', { name: 'Refresh page data', exact: true }).click();
        await settled(page);
        await page.locator('.oc-org-card').waitFor();
        result.checks.consoleFaultRecovery.push({
          failure,
          errorVisible,
          recovered: (await page.locator('.oc-loading-bar').count()) === 0
        });
        await wait(1800);
        expectedFault = false;
      }
      const beforeNavigation = result.streamRequests;
      for (let i = 0; i < 3; i++) {
        await page.locator('app-sidebar a[href="/app/admin/developers"]').click();
        await page.locator('.developer-card').first().waitFor();
        await page.locator('app-sidebar a[href="/app/admin/console"]').click();
        await page.locator('.oc-org-card').waitFor();
        await settled(page);
      }
      result.checks.rapidNavigationStreamDelta = result.streamRequests - beforeNavigation;
      assert.equal(result.checks.rapidNavigationStreamDelta, 0);
    }
    await go(page, '/app/admin/console/performance-statistics');
    await page.locator('.ps-select').first().waitFor();
    await wait(900);
    result.checks.performanceBack = await page.locator('a.ps-btn-ghost').evaluate((el) => {
      const box = el.getBoundingClientRect();
      const peers = [...el.parentElement.children]
        .filter((child) => child !== el)
        .map((child) => child.getBoundingClientRect());
      return {
        top: box.top,
        rowTops: peers.map((peer) => peer.top),
        width: box.width,
        height: box.height
      };
    });
    await shot(page, 'performance');
    if (!baseline) {
      assert.ok(
        result.checks.performanceBack.rowTops.every(
          (top) => Math.abs(top - result.checks.performanceBack.top) < 2
        )
      );
      await page.keyboard.press('Tab');
      await page.locator('.ps-select').first().focus();
      result.checks.performanceFocus = await page
        .locator('.ps-select')
        .first()
        .evaluate((el) => ({
          outline: getComputedStyle(el).outlineStyle,
          width: getComputedStyle(el).outlineWidth,
          shadow: getComputedStyle(el).boxShadow
        }));
      assert.equal(result.checks.performanceFocus.outline, 'solid');
      assert.equal(result.checks.performanceFocus.width, '2px');
      await shot(page, 'performance-focus');
      await go(page, '/app/admin/teams');
      const button = page.getByRole('button', {
        name: `View details for ${team.name}`,
        exact: true
      });
      await button.waitFor();
      for (const key of ['Enter', 'Space']) {
        await button.focus();
        await page.keyboard.press(key);
        await page.locator('.drawer').waitFor();
        assert.equal(await page.locator('.drawer').count(), 1);
        assert.equal(await page.locator('.drawer__title').textContent(), team.name);
        await page.getByRole('button', { name: 'Close drawer', exact: true }).click();
      }
      result.checks.nativeTeamEnterAndSpace = true;
      await page.getByRole('button', { name: 'Table view', exact: true }).click();
      await button.focus();
      await page.keyboard.press('Space');
      await page.locator('.drawer').waitFor();
      result.checks.nativeTeamTableSpace = (await page.locator('.drawer').count()) === 1;
      await page.getByRole('button', { name: 'Close drawer', exact: true }).click();
    }
    await go(page, '/app/admin/jobs');
    const create = page.getByRole('button', { name: 'Create Job', exact: true });
    await create.waitFor();
    await create.scrollIntoViewIfNeeded();
    await create.click();
    await wait(200);
    result.checks.jobsError = await page
      .getByText('Job title is required.', { exact: true })
      .first()
      .evaluate((el) => ({
        top: el.getBoundingClientRect().top,
        viewport: innerHeight,
        inCreatePanel: !!el.closest('.create-panel'),
        role: el.closest('[role]')?.getAttribute('role')
      }));
    await shot(page, 'jobs-error');
    if (!baseline) {
      assert.equal(result.checks.jobsError.inCreatePanel, true);
      assert.equal(result.checks.jobsError.role, 'alert');
      assert.ok(
        result.checks.jobsError.top >= 0 &&
          result.checks.jobsError.top < result.checks.jobsError.viewport
      );
      await page.locator('#job-title').fill('Closure retry job');
      await page
        .locator('#job-desc')
        .fill('Synthetic job description for disposable regression verification.');
      expectedFault = true;
      await mongoose.disconnect();
      await create.click();
      await page.locator('.create-panel [role="alert"]').waitFor();
      await mongoose.connect(mongo.uri);
      await create.click();
      await page.getByText('Job created successfully.', { exact: true }).waitFor();
      await wait(1800);
      expectedFault = false;
      result.checks.jobsRealFailureRetry = true;
      await page.getByRole('button', { name: 'Notifications', exact: true }).click();
      await page.getByText('Closure notice', { exact: true }).click();
      await page.waitForURL('**/app/admin/activity-logs');
      result.checks.adminNotificationFallback = true;
    }
    await ctx.close();
    const mobile = await context({ width: 390, height: 844, theme: 'dark' });
    delays.audit = 1300;
    await go(mobile.page, '/app/admin/activity-logs');
    await mobile.page.locator('.logs-panel').waitFor();
    const before = await mobile.page
      .locator('.content-grid')
      .evaluate((el) => el.getBoundingClientRect().height);
    await mobile.page.locator('.table-wrap tbody tr').first().waitFor();
    const after = await mobile.page
      .locator('.content-grid')
      .evaluate((el) => el.getBoundingClientRect().height);
    result.checks.activityHeight = { before, after, delta: after - before };
    if (!baseline) {
      await mobile.page.locator('.table-wrap tbody tr').first().click();
      await mobile.page.locator('.btn-archive-log').waitFor();
    }
    result.checks.activityTargets = await mobile.page
      .locator('.searchable-select__trigger, .preset-btn, .btn-archive-log')
      .evaluateAll((elements) =>
        elements.map((el) => ({ class: el.className, height: el.getBoundingClientRect().height }))
      );
    await shot(mobile.page, 'activity-mobile');
    if (!baseline) {
      assert.ok(
        Math.abs(result.checks.activityHeight.delta) < 2,
        'Async activity content height must remain stable'
      );
      assert.ok(result.checks.activityTargets.every((control) => control.height >= 44));
    }
    await mobile.ctx.close();
    delays.audit = 0;

    if (!baseline) {
      const profiles = [
        { name: 'desktop-light', width: 1440, height: 900, theme: 'light' },
        { name: 'desktop-dark', width: 1440, height: 900, theme: 'dark' },
        { name: 'laptop-system-dark', width: 1024, height: 768, theme: 'system', scheme: 'dark' },
        { name: 'tablet-light', width: 768, height: 1024, theme: 'light' },
        { name: 'mobile-light', width: 390, height: 844, theme: 'light' },
        { name: 'mobile-dark', width: 390, height: 844, theme: 'dark' },
        { name: 'xs-mobile-system', width: 320, height: 640, theme: 'system', scheme: 'dark' }
      ];
      for (const profile of profiles) {
        const { ctx, page } = await context(profile);
        let firstRoute = true;
        for (const route of [
          'developers',
          'console?tab=overview',
          'console/performance-statistics',
          'teams',
          'jobs',
          'activity-logs',
          'recruiters'
        ]) {
          if (firstRoute) {
            await go(page, `/app/admin/${route}`);
            firstRoute = false;
          } else {
            // Use the real RouterLink and existing shared shell, as a normal
            // workspace session does, without opening an SSE per route.
            const destination = `/app/admin/${route.split('?')[0]}`;
            await page.locator(`app-sidebar a[href="${destination}"]`).dispatchEvent('click');
            await page.waitForURL((url) => url.pathname === destination);
            const selector = route.includes('performance')
              ? '.ps-shell'
              : route.includes('console')
                ? '.oc-shell'
                : route === 'teams'
                  ? 'app-admin-teams-page'
                  : route === 'jobs'
                    ? 'app-admin-jobs-page'
                    : route === 'recruiters'
                      ? 'app-admin-recruiters-page'
                      : 'app-admin-activity-logs';
            await page.locator(selector).waitFor();
          }
          await settled(page);
          await wait(150);
          const metrics = await page.evaluate(() => ({
            overflow: document.documentElement.scrollWidth - innerWidth,
            theme: document.documentElement.getAttribute('data-theme'),
            motion: [
              ...document.querySelectorAll(
                'app-admin-recruiters-page button, app-admin-developers-page button, app-admin-jobs-page button, .ps-shell button, .ps-loading-bar__fill'
              )
            ].map((el) => ({
              transition: getComputedStyle(el).transitionDuration,
              animation: getComputedStyle(el).animationName
            })),
            clippedControls: [
              ...document.querySelectorAll(
                'app-admin-developers-page button, .ps-header button, .ps-header select, app-admin-recruiters-page button, app-admin-jobs-page button, app-admin-activity-logs button'
              )
            ]
              .filter((el) => {
                const box = el.getBoundingClientRect();
                return (
                  box.width &&
                  box.height &&
                  !el.closest('.table-wrap, .teams-table-wrap') &&
                  (box.left < -1 || box.right > innerWidth + 1)
                );
              })
              .map((el) => el.className)
          }));
          assert.ok(metrics.overflow <= 1, `${profile.name} ${route} overflow ${metrics.overflow}`);
          assert.equal(metrics.theme, profile.theme === 'system' ? profile.scheme : profile.theme);
          assert.deepEqual(
            metrics.clippedControls,
            [],
            `${profile.name} ${route} clipped controls`
          );
          result.profiles.push({ profile: profile.name, route, ...metrics });
          assert.ok(
            metrics.motion.every(
              (style) =>
                style.transition.split(',').every((value) => Number.parseFloat(value) === 0) &&
                style.animation === 'none'
            )
          );
          if (profile.name === 'desktop-light' && route === 'recruiters') {
            await page.emulateMedia({ reducedMotion: 'no-preference' });
            const normal = await page
              .locator('.btn-primary')
              .first()
              .evaluate((el) => getComputedStyle(el).transitionDuration);
            assert.ok(normal.split(',').some((value) => Number.parseFloat(value) > 0));
            result.checks.normalMotionFeedbackPreserved = true;
            await page.emulateMedia({ reducedMotion: 'reduce' });
          }
          console.log(`Verified ${profile.name}: ${route}`);
          if (
            ['console?tab=overview', 'activity-logs', 'console/performance-statistics'].includes(
              route
            )
          )
            await shot(page, `${profile.name}-${route.split('?')[0].replaceAll('/', '-')}`);
        }
        await ctx.close();
      }
      assert.equal(result.maxConcurrentStreams, 1);
      assert.deepEqual(result.runtimeErrors, []);
      assert.deepEqual(result.badHttp, []);
      assert.deepEqual(result.consoleErrors, []);
    }
    result.status = 'passed';
  } catch (error) {
    result.status = 'failed';
    result.failure = error.stack;
    throw error;
  } finally {
    await browser?.close();
    await streams.stop();
    if (server) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
    settings.stopSettingsSynchronization();
    await mongoose.disconnect();
    result.cleanup = await mongo.stop();
    fs.writeFileSync(
      path.join(output, `${phase}-browser.json`),
      JSON.stringify(result, null, 2) + '\n'
    );
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
