const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const {
  CANDIDATE_IDS,
  JOB_IDS,
  recruiterUser,
  organizationsPayload,
  teamsPayload,
  createState,
  buildAnalytics,
  buildComparison,
} = require('./recruiter-browser-fixture.cjs');

function loadPlaywright() {
  const candidates = [];
  if (process.env.PLAYWRIGHT_MODULE) candidates.push(process.env.PLAYWRIGHT_MODULE);
  for (const pkg of ['playwright', 'playwright-core']) {
    try {
      candidates.push(require.resolve(pkg));
    } catch {
      // keep searching
    }
  }
  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData) {
    const npxDir = path.join(localAppData, 'npm-cache', '_npx');
    if (fs.existsSync(npxDir)) {
      for (const dir of fs.readdirSync(npxDir)) {
        const hit = path.join(npxDir, dir, 'node_modules', 'playwright-core');
        if (fs.existsSync(hit)) candidates.push(hit);
      }
    }
  }
  for (const modPath of candidates) {
    try {
      return require(modPath);
    } catch {
      // try next
    }
  }
  throw new Error('Unable to locate playwright or playwright-core runtime.');
}

const { chromium } = loadPlaywright();

const phase = process.argv[2] === 'after' ? 'after' : 'before';
const distRoot = path.resolve(__dirname, '../dist/frontend/browser');
const outputDir = path.resolve(__dirname, '../verification/recruiter', phase);
fs.mkdirSync(outputDir, { recursive: true });

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
};

const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname).replace(
    /^\/+/,
    '',
  );
  let filePath = path.resolve(distRoot, pathname);
  if (
    !filePath.startsWith(distRoot + path.sep) ||
    !fs.existsSync(filePath) ||
    fs.statSync(filePath).isDirectory()
  ) {
    filePath = path.join(distRoot, 'index.html');
  }
  const ext = path.extname(filePath).toLowerCase();
  res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream');
  fs.createReadStream(filePath).pipe(res);
});

const ROUTES = [
  { key: '01-dashboard', path: '/app/recruiter/dashboard', ready: '.hub-page' },
  { key: '02-profile', path: '/app/recruiter/profile', ready: '.hub-page' },
  { key: '03-jobs', path: '/app/recruiter/jobs', ready: '.hub-page' },
  { key: '04-job-details', path: `/app/recruiter/jobs/${JOB_IDS.backend}`, ready: '.hub-page' },
  { key: '05-candidates', path: '/app/recruiter/candidates', ready: '.hub-page' },
  {
    key: '06-candidate-details',
    path: `/app/recruiter/candidates/${CANDIDATE_IDS.marcus}`,
    ready: '.hub-page',
  },
  {
    key: '07-matches',
    path: `/app/recruiter/matches?jobId=${JOB_IDS.backend}`,
    ready: '.hub-page',
  },
  {
    key: '08-comparison',
    path: `/app/recruiter/comparison?ids=${CANDIDATE_IDS.arjun},${CANDIDATE_IDS.marcus}&jobId=${JOB_IDS.backend}`,
    ready: '.hub-page',
  },
  { key: '09-shortlists', path: '/app/recruiter/shortlists', ready: '.hub-page' },
  { key: '10-analytics', path: '/app/recruiter/analytics', ready: '.hub-page' },
  { key: '11-activity-logs', path: '/app/recruiter/activity-logs', ready: '.hub-page' },
];

const VIEWPORTS =
  phase === 'before'
    ? [
        { name: 'desktop-1440', width: 1440, height: 900, routes: 'all' },
        {
          name: 'mobile-390',
          width: 390,
          height: 844,
          routes: ['01-dashboard', '05-candidates', '07-matches', '10-analytics'],
        },
      ]
    : [
        { name: 'desktop-1440', width: 1440, height: 900, routes: 'all' },
        { name: 'tablet-768', width: 768, height: 1024, routes: 'all' },
        { name: 'mobile-390', width: 390, height: 844, routes: 'all' },
        {
          name: 'mobile-320',
          width: 320,
          height: 640,
          routes: ['01-dashboard', '05-candidates', '06-candidate-details', '08-comparison'],
        },
      ];

async function settle(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await page.waitForTimeout(160);
}

function attachApiRoutes(page, state, options = {}) {
  return page.route('**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());

    if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
      return route.abort();
    }

    if (!url.pathname.startsWith('/api/')) {
      return route.continue();
    }

    const apiPath = url.pathname;
    const method = req.method().toUpperCase();

    if (apiPath.includes('/notifications/stream')) {
      return route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: ': heartbeat\n\n',
      });
    }

    if (apiPath.startsWith('/api/notifications')) {
      return route.fulfill({
        json: { notifications: [], unreadCount: 0, total: 0 },
      });
    }

    if (apiPath === '/api/tenant/organizations') {
      return route.fulfill({ json: organizationsPayload });
    }

    if (apiPath.startsWith('/api/tenant/organizations/') && apiPath.endsWith('/teams')) {
      return route.fulfill({ json: teamsPayload });
    }

    if (options.failNext && apiPath.startsWith(options.failNext)) {
      options.failNext = '';
      return route.fulfill({
        status: 503,
        json: { message: 'Temporary recruiter service error.' },
      });
    }

    if (apiPath === '/api/recruiter-hub/analytics/dashboard') {
      return route.fulfill({ json: buildAnalytics(state) });
    }

    if (apiPath === '/api/recruiter-hub/analytics') {
      return route.fulfill({ json: buildAnalytics(state) });
    }

    if (apiPath === '/api/recruiter-hub/activity') {
      const action = url.searchParams.get('action') || '';
      const candidateId = url.searchParams.get('candidateId') || '';
      const jobId = url.searchParams.get('jobId') || '';
      const filtered = state.activity.filter((item) => {
        if (action && item.action !== action) return false;
        if (candidateId && item.candidate?.id !== candidateId) return false;
        if (jobId && item.job?._id !== jobId) return false;
        return true;
      });
      return route.fulfill({
        json: {
          logs: filtered,
          filters: {
            actions: [...new Set(state.activity.map((l) => l.action))],
            candidates: state.candidates.map((c) => ({ _id: c.id, name: c.name })),
            jobs: state.jobs.map((j) => ({ _id: j._id, title: j.title })),
          },
        },
      });
    }

    if (apiPath === '/api/recruiter-hub/profile') {
      if (method === 'PATCH') {
        const body = req.postDataJSON() || {};
        state.profile = { ...state.profile, ...body };
        return route.fulfill({ json: { profile: state.profile } });
      }
      return route.fulfill({ json: { profile: state.profile } });
    }

    if (apiPath === '/api/recruiter-hub/candidates') {
      const search = (url.searchParams.get('search') || '').trim().toLowerCase();
      const stack = url.searchParams.get('stack') || '';
      const location = url.searchParams.get('location') || '';
      const minReadiness = Number(url.searchParams.get('minReadiness') || 0);
      const filtered = state.candidates.filter((c) => {
        if (search && !`${c.name} ${c.headline} ${c.githubUsername}`.toLowerCase().includes(search))
          return false;
        if (stack && c.stack !== stack) return false;
        if (location && c.location !== location) return false;
        if (minReadiness > 0 && Number(c.readinessScore || 0) < minReadiness) return false;
        return true;
      });
      return route.fulfill({
        json: {
          candidates: filtered,
          filters: {
            stacks: ['Backend', 'Frontend', 'Full Stack', 'DevOps'],
            locations: ['Remote', 'Berlin, Germany', 'London, UK'],
            availability: ['Open to entry roles', 'High intent', 'Available', 'Review needed'],
          },
          meta: { page: 1, limit: 12, total: filtered.length, totalPages: 1, sortBy: 'score-desc' },
        },
      });
    }

    if (apiPath.startsWith('/api/recruiter-hub/candidates/') && apiPath.endsWith('/analyze')) {
      const id = apiPath.split('/')[4];
      const found = state.candidates.find((c) => c.id === id);
      return route.fulfill({
        json: {
          analysis: {
            summary: found?.aiInsight?.summary || 'AI candidate analysis completed.',
            strengths: found?.aiInsight?.strengths || [],
            weaknesses: found?.aiInsight?.weaknesses || [],
            recommendation: found?.aiInsight?.recommendation || 'Review candidate evidence.',
            confidenceScore: 84,
          },
        },
      });
    }

    if (apiPath.startsWith('/api/recruiter-hub/candidates/')) {
      const id = apiPath.split('/').pop();
      const found = state.candidates.find((c) => c.id === id);
      if (!found) return route.fulfill({ status: 404, json: { message: 'Candidate not found' } });
      return route.fulfill({ json: { candidate: found } });
    }

    if (apiPath === '/api/recruiter-hub/jobs') {
      if (method === 'POST') {
        const body = req.postDataJSON() || {};
        const created = {
          _id: `65f1a2b3c4d5e6f708192d9${state.jobs.length + 1}`,
          organizationId: recruiterUser.organizationId,
          recruiterId: recruiterUser._id,
          ...body,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        state.jobs.unshift(created);
        return route.fulfill({ status: 201, json: { job: created } });
      }
      return route.fulfill({ json: { jobs: state.jobs } });
    }

    if (apiPath.startsWith('/api/recruiter-hub/jobs/') && apiPath.endsWith('/archive')) {
      const id = apiPath.split('/')[4];
      const job = state.jobs.find((j) => j._id === id);
      if (job) {
        job.status = 'closed';
        job.archivedAt = new Date().toISOString();
        job.updatedAt = new Date().toISOString();
      }
      return route.fulfill({ json: { job } });
    }

    if (apiPath.startsWith('/api/recruiter-hub/jobs/')) {
      const id = apiPath.split('/').pop();
      if (method === 'PATCH') {
        const body = req.postDataJSON() || {};
        const idx = state.jobs.findIndex((j) => j._id === id);
        if (idx >= 0) {
          state.jobs[idx] = { ...state.jobs[idx], ...body, updatedAt: new Date().toISOString() };
          return route.fulfill({ json: { job: state.jobs[idx] } });
        }
      }
      if (method === 'DELETE') {
        state.jobs = state.jobs.filter((j) => j._id !== id);
        return route.fulfill({ json: { message: 'Deleted' } });
      }
      const found = state.jobs.find((j) => j._id === id);
      if (!found) return route.fulfill({ status: 404, json: { message: 'Job not found' } });
      return route.fulfill({ json: { job: found } });
    }

    if (apiPath === '/api/recruiter-hub/matches/generate') {
      const body = req.postDataJSON() || {};
      const list = state.matches.filter((m) => !body.jobId || m.jobId === body.jobId);
      const generatedWithoutId = list.map(({ _id, ...rest }) => rest);
      return route.fulfill({
        json: {
          job: state.jobs.find((j) => j._id === body.jobId) || state.jobs[0],
          matches: generatedWithoutId,
          meta: { totalCandidates: generatedWithoutId.length, jobId: body.jobId },
        },
      });
    }

    if (apiPath.startsWith('/api/recruiter-hub/matches/') && apiPath.endsWith('/status')) {
      const id = apiPath.split('/')[4];
      const body = req.postDataJSON() || {};
      const match = state.matches.find((m) => m._id === id);
      if (match) {
        match.status = body.status || match.status;
        match.updatedAt = new Date().toISOString();
      }
      return route.fulfill({ json: { match } });
    }

    if (apiPath === '/api/recruiter-hub/matches') {
      const jobId = url.searchParams.get('jobId') || '';
      const status = url.searchParams.get('status') || '';
      const list = state.matches.filter((m) => {
        if (jobId && m.jobId !== jobId) return false;
        if (status && m.status !== status) return false;
        return true;
      });
      return route.fulfill({ json: { matches: list } });
    }

    if (apiPath === '/api/recruiter-hub/shortlists') {
      if (method === 'POST') {
        const body = req.postDataJSON() || {};
        const cand = state.candidates.find((c) => c.id === body.candidateId);
        const job = body.jobId ? state.jobs.find((j) => j._id === body.jobId) : null;
        const created = {
          _id: `65f1a2b3c4d5e6f70819309${state.shortlists.length + 1}`,
          candidateId: body.candidateId,
          jobId: body.jobId || null,
          status: body.status || 'shortlisted',
          notes: body.notes || '',
          candidate: cand || null,
          job: job || null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        state.shortlists.unshift(created);
        return route.fulfill({ status: 201, json: { shortlist: created } });
      }
      const status = url.searchParams.get('status') || '';
      const list = status ? state.shortlists.filter((s) => s.status === status) : state.shortlists;
      return route.fulfill({ json: { shortlists: list } });
    }

    if (apiPath.startsWith('/api/recruiter-hub/shortlists/')) {
      const id = apiPath.split('/').pop();
      if (method === 'PATCH') {
        const body = req.postDataJSON() || {};
        const item = state.shortlists.find((s) => s._id === id);
        if (item) {
          if (body.status !== undefined) item.status = body.status;
          if (body.notes !== undefined) item.notes = body.notes;
          item.updatedAt = new Date().toISOString();
        }
        return route.fulfill({ json: { shortlist: item } });
      }
      if (method === 'DELETE') {
        state.shortlists = state.shortlists.filter((s) => s._id !== id);
        return route.fulfill({ json: { message: 'Removed' } });
      }
    }

    if (apiPath === '/api/recruiter-hub/comparison') {
      const body = req.postDataJSON() || {};
      const ids = Array.isArray(body.candidateIds) ? body.candidateIds : [];
      return route.fulfill({
        json: { comparison: buildComparison(state, ids, body.jobId || null) },
      });
    }

    return route.fulfill({ json: { data: [] } });
  });
}

async function createRecruiterContext(browser, theme, viewport, empty = false) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    colorScheme: theme === 'system' ? 'dark' : theme,
    reducedMotion: 'reduce',
  });
  await context.addInitScript(
    ({ theme, user }) => {
      const payload = btoa(
        JSON.stringify({
          exp: Math.floor(Date.now() / 1000) + 36000,
          iss: 'devinsight-api',
          aud: 'devinsight-web',
        }),
      );
      localStorage.setItem('token', `fixture.${payload}.fixture`);
      localStorage.setItem('user', JSON.stringify(user));
      localStorage.setItem('devinsight_theme', theme);
      window.__dpaCls = 0;
      if (typeof PerformanceObserver !== 'undefined') {
        try {
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              if (!entry.hadRecentInput) {
                window.__dpaCls += entry.value;
              }
            }
          }).observe({ type: 'layout-shift', buffered: true });
        } catch {
          // ignore unsupported layout-shift observer
        }
      }
    },
    { theme, user: recruiterUser },
  );
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(String(err.message || err)));
  const state = createState(empty);
  await attachApiRoutes(page, state);
  return { context, page, pageErrors, state };
}

async function runCaptureMatrix() {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const origin = `http://127.0.0.1:${port}`;

  const chromePath =
    process.env.ACCEPTANCE_CHROME ||
    (fs.existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe')
      ? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
      : undefined);

  const browser = await chromium.launch({
    headless: true,
    executablePath: chromePath,
  });

  const matrixResults = [];
  const interactionChecks = [];
  const developerRegression = [];

  try {
    const themes = phase === 'before' ? ['light', 'dark'] : ['light', 'dark', 'system'];

    for (const theme of themes) {
      for (const vp of VIEWPORTS) {
        if (theme === 'system' && vp.name !== 'desktop-1440' && vp.name !== 'mobile-390') {
          continue;
        }
        const { context, page, pageErrors } = await createRecruiterContext(browser, theme, vp);
        const selectedRoutes =
          vp.routes === 'all' ? ROUTES : ROUTES.filter((r) => vp.routes.includes(r.key));

        for (const r of selectedRoutes) {
          await page.goto(`${origin}${r.path}`);
          await page.locator(r.ready).first().waitFor({ timeout: 15000 });
          await settle(page);

          const metrics = await page.evaluate(() => {
            const docEl = document.documentElement;
            const main = document.querySelector('.main-content');
            const card =
              document.querySelector(
                '.ui-card, .stat-card, .candidate-card, .job-card, .panel, .list-card',
              ) || main;
            const h1 = document.querySelector('h1');
            return {
              theme: docEl.dataset.theme || '',
              scrollWidth: docEl.scrollWidth,
              innerWidth: window.innerWidth,
              overflow: docEl.scrollWidth > window.innerWidth,
              cls: Number((window.__dpaCls || 0).toFixed(4)),
              canvasCount: document.querySelectorAll('canvas').length,
              h1Text: h1 ? h1.textContent.trim() : '',
              h1Color: h1 ? getComputedStyle(h1).color : '',
              mainBg: main ? getComputedStyle(main).backgroundColor : '',
              cardBg: card ? getComputedStyle(card).backgroundColor : '',
              fontFamily: main ? getComputedStyle(main).fontFamily : '',
              hasRecruiterWorkspace: Boolean(document.querySelector('.recruiter-workspace')),
              hasDeveloperWorkspace: Boolean(document.querySelector('.developer-workspace')),
            };
          });

          const shotName = `${theme}-${vp.name}-${r.key}.png`;
          const takeShot =
            theme !== 'system' ||
            (vp.name === 'desktop-1440' && ['01-dashboard', '10-analytics'].includes(r.key));
          if (takeShot) {
            await page.screenshot({
              path: path.join(outputDir, shotName),
              fullPage: true,
              animations: 'disabled',
            });
          }

          if (phase === 'after') {
            assert.equal(metrics.overflow, false, `Overflow on ${theme} ${vp.name} ${r.key}`);
            assert.equal(metrics.hasRecruiterWorkspace, true);
            assert.equal(metrics.hasDeveloperWorkspace, false);
            assert.notEqual(metrics.cardBg, metrics.h1Color, `Contrast check failed on ${r.key}`);
            assert.ok(
              metrics.cls <= 0.05,
              `CLS ${metrics.cls} exceeded 0.05 on ${theme} ${vp.name} ${r.key}`,
            );
            if (theme === 'light') {
              assert.equal(metrics.theme, 'light');
            } else {
              assert.equal(metrics.theme, 'dark');
            }
          }

          matrixResults.push({
            theme,
            viewport: vp.name,
            route: r.key,
            screenshot: takeShot ? shotName : null,
            ...metrics,
          });
        }

        if (phase === 'after' && theme === 'system' && vp.name === 'desktop-1440') {
          await page.goto(`${origin}/app/recruiter/dashboard`);
          await page.locator('.hub-page').waitFor();
          await settle(page);
          await page.emulateMedia({ colorScheme: 'light' });
          await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
          const afterLightBg = await page.evaluate(
            () => getComputedStyle(document.querySelector('.main-content')).backgroundColor,
          );
          await page.emulateMedia({ colorScheme: 'dark' });
          await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
          const afterDarkBg = await page.evaluate(
            () => getComputedStyle(document.querySelector('.main-content')).backgroundColor,
          );
          assert.notEqual(afterLightBg, afterDarkBg);
          interactionChecks.push({
            name: 'system-theme-live-os-switch',
            status: 'PASS',
            afterLightBg,
            afterDarkBg,
          });
        }

        assert.deepEqual(
          pageErrors,
          [],
          `Page errors in ${theme} ${vp.name}: ${pageErrors.join('; ')}`,
        );
        await context.close();
      }
    }

    if (phase === 'after') {
      const { context, page, pageErrors } = await createRecruiterContext(browser, 'light', {
        width: 1440,
        height: 900,
      });

      // 1. Jobs editor toggle + create job
      await page.goto(`${origin}/app/recruiter/jobs`);
      await page.locator('.hub-page').waitFor();
      await settle(page);
      const toggleBtn = page.locator('[data-testid="toggle-job-editor"]');
      await toggleBtn.click();
      await page.locator('#job-title').fill('QA Reliability Lead');
      await page.locator('#job-role').fill('Reliability Engineer');
      await page.locator('#job-stack').fill('DevOps');
      await page.locator('#job-location').fill('Remote');
      await page.locator('#job-required-skills').fill('Playwright, Docker');
      await page.locator('button[type="submit"]').click();
      await page.getByText('QA Reliability Lead').first().waitFor();
      interactionChecks.push({ name: 'jobs-create-and-drawer-toggle', status: 'PASS' });

      // 2. Candidates filter + compare selection
      await page.goto(`${origin}/app/recruiter/candidates`);
      await page.locator('app-candidate-card').first().waitFor();
      await page.locator('#candidate-search').fill('Elena');
      await page.locator('button.filter-btn').nth(1).click();
      await settle(page);
      assert.equal(await page.locator('app-candidate-card').count(), 1);
      interactionChecks.push({ name: 'candidates-filter-submit', status: 'PASS' });

      // 3. Matches status filter + generate hydrate + reject
      await page.goto(`${origin}/app/recruiter/matches?jobId=${JOB_IDS.backend}`);
      await page.locator('app-match-card').first().waitFor();
      await page.getByRole('button', { name: /Generate Matches/i }).click();
      await settle(page);
      await page.locator('app-match-card button', { hasText: 'Reject' }).first().click();
      await settle(page);
      interactionChecks.push({ name: 'matches-generate-hydrate-and-reject', status: 'PASS' });

      // 4. Shortlists inline notes + confirm dialog
      await page.goto(`${origin}/app/recruiter/shortlists`);
      await page.locator('app-shortlist-card').first().waitFor();
      await page.locator('app-shortlist-card button', { hasText: 'Edit Note' }).first().click();
      await page.locator('app-shortlist-card textarea').first().fill('Confirmed panel for Friday.');
      await page.locator('app-shortlist-card button', { hasText: 'Save Note' }).first().click();
      await page.getByText('Confirmed panel for Friday.').waitFor();
      interactionChecks.push({ name: 'shortlists-inline-note-update', status: 'PASS' });

      // 5. Activity logs AI count accuracy + label
      await page.goto(`${origin}/app/recruiter/activity-logs`);
      await page.locator('app-activity-timeline').waitFor();
      const aiCountText = await page
        .locator('app-recruiter-stat-card', { hasText: /AI & Match/i })
        .textContent();
      assert.match(aiCountText || '', /2/);
      interactionChecks.push({ name: 'activity-logs-ai-count-accuracy', status: 'PASS' });

      // 6. Unavailable telemetry disclosure on Candidate Details & Comparison
      await page.goto(`${origin}/app/recruiter/candidates/${CANDIDATE_IDS.marcus}`);
      await page.locator('.score-hero').waitFor();
      await page.getByText('Unavailable').first().waitFor();
      interactionChecks.push({ name: 'candidate-unavailable-github-disclosure', status: 'PASS' });

      // 7. Recruiter RBAC guard redirects Developer-only /app/profile to Recruiter workspace
      await page.goto(`${origin}/app/profile`);
      await page.waitForURL(/\/app\/recruiter\//, { timeout: 10000 });
      await settle(page);
      const profileScope = await page.evaluate(() => ({
        pathname: window.location.pathname,
        hasRecruiterWorkspace: Boolean(document.querySelector('.recruiter-workspace')),
        hasDeveloperWorkspace: Boolean(document.querySelector('.developer-workspace')),
        overflow: document.documentElement.scrollWidth > window.innerWidth,
      }));
      assert.match(profileScope.pathname, /^\/app\/recruiter\//);
      assert.equal(profileScope.hasRecruiterWorkspace, true);
      assert.equal(profileScope.hasDeveloperWorkspace, false);
      assert.equal(profileScope.overflow, false);
      interactionChecks.push({ name: 'recruiter-rbac-profile-redirect', status: 'PASS' });

      // 6. Empty pool / hidden visibility verification
      const emptySession = await createRecruiterContext(
        browser,
        'light',
        { width: 1440, height: 900 },
        true,
      );
      await emptySession.page.goto(`${origin}/app/recruiter/candidates`);
      await emptySession.page.locator('app-recruiter-empty-state').waitFor();
      await emptySession.page.screenshot({
        path: path.join(outputDir, 'empty-candidates-light-1440.png'),
        fullPage: true,
        animations: 'disabled',
      });
      await emptySession.context.close();
      interactionChecks.push({ name: 'empty-visibility-state', status: 'PASS' });

      assert.deepEqual(pageErrors, []);
      await context.close();

      // Developer UI non-regression smoke check
      const devContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      await devContext.addInitScript(() => {
        const payload = btoa(
          JSON.stringify({
            exp: Math.floor(Date.now() / 1000) + 36000,
            iss: 'devinsight-api',
            aud: 'devinsight-web',
          }),
        );
        localStorage.setItem('token', `fixture.${payload}.fixture`);
        localStorage.setItem(
          'user',
          JSON.stringify({
            _id: 'dev-fixture',
            role: 'developer',
            name: 'Fixture Developer',
            activeGithubUsername: 'fixture',
          }),
        );
        localStorage.setItem('devinsight_theme', 'light');
      });
      const devPage = await devContext.newPage();
      const devErrors = [];
      devPage.on('pageerror', (e) => devErrors.push(e.message));
      await devPage.route('**/*', (route) => {
        const url = new URL(route.request().url());
        if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') return route.abort();
        if (url.pathname.startsWith('/api/')) {
          return route.fulfill({
            json: {
              data: [],
              notifications: [],
              organizations: [],
              teams: [],
              profile: {},
              summary: {},
              user: { _id: 'dev-fixture', role: 'developer' },
            },
          });
        }
        return route.continue();
      });
      await devPage.goto(`${origin}/app/dashboard`);
      await devPage.locator('.developer-workspace').waitFor();
      await settle(devPage);
      const devCheck = await devPage.evaluate(() => ({
        hasDevWorkspace: Boolean(document.querySelector('.developer-workspace')),
        hasRecruiterWorkspace: Boolean(document.querySelector('.recruiter-workspace')),
        overflow: document.documentElement.scrollWidth > window.innerWidth,
        font: getComputedStyle(document.querySelector('.main-content')).fontFamily,
      }));
      assert.equal(devCheck.hasDevWorkspace, true);
      assert.equal(devCheck.hasRecruiterWorkspace, false);
      assert.equal(devCheck.overflow, false);
      assert.deepEqual(devErrors, []);
      developerRegression.push({ route: '/app/dashboard', ...devCheck });
      await devContext.close();
    }

    fs.writeFileSync(
      path.join(outputDir, 'results.json'),
      JSON.stringify(
        {
          phase,
          totalRuns: matrixResults.length,
          overflowCount: matrixResults.filter((r) => r.overflow).length,
          interactionChecks,
          developerRegression,
          matrixResults,
        },
        null,
        2,
      ),
    );
    console.log(
      `PASS [${phase}]: ${matrixResults.length} route/theme/viewport runs, ${
        matrixResults.filter((r) => r.overflow).length
      } overflows, ${interactionChecks.length} interaction checks.`,
    );
  } finally {
    await browser.close();
    server.close();
  }
}

runCaptureMatrix().catch((error) => {
  console.error(error);
  server.close();
  process.exitCode = 1;
});
