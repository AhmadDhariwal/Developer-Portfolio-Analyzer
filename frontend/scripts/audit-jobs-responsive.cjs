// Complete Responsive Audit for Jobs Hub across all required viewports and themes.
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const assert = require('node:assert/strict');

const playwrightPath =
  process.env.PLAYWRIGHT_MODULE || 'D:/Agrivio/node_modules/playwright';
const { chromium } = require(playwrightPath);

const phase = process.argv[2] || 'before';
const chromePath =
  process.env.ACCEPTANCE_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const dist = path.resolve(__dirname, '../dist/frontend/browser');
const outputDir = path.resolve(__dirname, '../verification/jobs-hub/responsive-audit');
fs.mkdirSync(outputDir, { recursive: true });

const { profile, catalog, emptyAction } = require('./jobs-browser-fixture.cjs');

const VIEWPORTS = [
  // Mobile
  { name: 'mobile-320', width: 320, height: 640, category: 'Mobile' },
  { name: 'mobile-375', width: 375, height: 667, category: 'Mobile' },
  { name: 'mobile-390', width: 390, height: 844, category: 'Mobile' },
  { name: 'mobile-430', width: 430, height: 932, category: 'Mobile' },
  // Tablet
  { name: 'tablet-768', width: 768, height: 1024, category: 'Tablet' },
  { name: 'tablet-820', width: 820, height: 1180, category: 'Tablet' },
  { name: 'tablet-1024', width: 1024, height: 768, category: 'Tablet' },
  // Laptop
  { name: 'laptop-1280', width: 1280, height: 800, category: 'Laptop' },
  { name: 'laptop-1366', width: 1366, height: 768, category: 'Laptop' },
  // Desktop
  { name: 'desktop-1440', width: 1440, height: 900, category: 'Desktop' },
  { name: 'desktop-1920', width: 1920, height: 1080, category: 'Desktop' },
  // Large screen
  { name: 'large-2560', width: 2560, height: 1440, category: 'Large screen' },
];

const THEMES = ['dark', 'light', 'system'];

const server = http.createServer((req, res) => {
  const relative = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(
    /^\/+/,
    '',
  );
  let file = path.resolve(dist, relative);
  if (
    !file.startsWith(dist + path.sep) ||
    !fs.existsSync(file) ||
    fs.statSync(file).isDirectory()
  ) {
    file = path.join(dist, 'index.html');
  }
  const mime = {
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.html': 'text/html',
    '.ttf': 'font/ttf',
    '.woff2': 'font/woff2',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
  };
  res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});

async function initPageContext(browser, { width, height, theme = 'dark' }) {
  const colorScheme = theme === 'system' ? 'dark' : theme;
  const context = await browser.newContext({
    viewport: { width, height },
    colorScheme,
    reducedMotion: 'reduce',
  });

  await context.addInitScript(
    ({ themeVal, profileVal }) => {
      const exp = Math.floor(Date.now() / 1000) + 36000;
      const payload = btoa(
        JSON.stringify({
          exp,
          iss: 'devinsight-api',
          aud: 'devinsight-web',
        }),
      );
      localStorage.setItem('token', `fixture.${payload}.fixture`);
      localStorage.setItem(
        'user',
        JSON.stringify({
          _id: 'user-fixture',
          role: 'developer',
          name: 'Jane Developer',
          email: 'jane@example.com',
          activeGithubUsername: 'janedev',
        }),
      );
      localStorage.setItem('devinsight_theme', themeVal);
      localStorage.setItem('devinsight_career_profile', JSON.stringify(profileVal));
    },
    { themeVal: theme, profileVal: profile },
  );

  return context;
}

async function attachDefaultRoutes(page, controls) {
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname;

    if (!pathname.includes('/api/')) {
      return route.continue();
    }

    const hiddenAccess =
      controls.hiddenUnlocked && request.headers()['x-jobs-hidden-token'] === 'h'.repeat(43);

    if (pathname === '/api/profile/career') {
      return route.fulfill({ json: profile });
    }

    if (pathname.includes('/notifications/stream')) {
      return route.fulfill({
        contentType: 'text/event-stream',
        body: ': heartbeat\n\n',
      });
    }

    if (pathname === '/api/jobs/hidden-access/unlock') {
      if (request.postDataJSON()?.password !== 'Fixture!Password123') {
        return route.fulfill({ status: 403, json: { code: 'JOBS_HIDDEN_PASSWORD_INCORRECT' } });
      }
      controls.hiddenUnlocked = true;
      return route.fulfill({ json: { token: 'h'.repeat(43), expiresAt: Date.now() + 300000 } });
    }

    if (pathname === '/api/jobs/hidden-access/lock') {
      controls.hiddenUnlocked = false;
      return route.fulfill({ json: { locked: true } });
    }

    if (pathname === '/api/jobs') {
      controls.requests.push(Object.fromEntries(url.searchParams));
      if (controls.mode === 'loading') {
        await new Promise((r) => setTimeout(r, 800));
      }
      if (['503', '429'].includes(controls.mode)) {
        return route.fulfill({
          status: Number(controls.mode),
          headers: { 'Retry-After': '60' },
          json: {},
        });
      }

      let all = catalog.filter((job) => !controls.saved.get(job.id)?.hidden);
      if (url.searchParams.get('skills')) {
        const query = url.searchParams.get('skills').toLowerCase();
        all = all.filter((job) =>
          (job.title + ' ' + job.skills.join(' ')).toLowerCase().includes(query),
        );
      }
      if (url.searchParams.get('platform')) {
        all = all.filter((job) => job.platform === url.searchParams.get('platform'));
      }
      if (url.searchParams.get('location')) {
        all = all.filter((job) => job.location.toLowerCase().includes(url.searchParams.get('location').toLowerCase()));
      }
      if (url.searchParams.get('experienceLevel')) {
        all = all.filter((job) => job.experienceLevel === url.searchParams.get('experienceLevel'));
      }
      if (url.searchParams.get('jobType')) {
        all = all.filter((job) => job.jobType === url.searchParams.get('jobType'));
      }
      if (controls.mode === 'empty') all = [];

      const pageNum = Number(url.searchParams.get('page') || 1);
      const limit = Number(url.searchParams.get('limit') || 10);
      return route.fulfill({
        json: {
          jobs: all.slice((pageNum - 1) * limit, pageNum * limit).map((job) => ({
            ...job,
            actions: controls.saved.get(job.id) || emptyAction(job.id),
          })),
          page: pageNum,
          total: all.length,
          totalPages: Math.max(1, Math.ceil(all.length / limit)),
          hasMore: pageNum * limit < all.length,
          fromCache: true,
          sourceMessage: 'Source data retained; confirm employer availability.',
          diagnostics: {
            cacheFallback: {
              stale: controls.mode === 'stale',
              used: true,
              available: all.length,
            },
          },
          sourceFailures:
            controls.mode === 'stale' ? [{ source: 'Jooble', reason: 'cooldown' }] : [],
        },
      });
    }

    if (pathname === '/api/jobs/actions') {
      const state = url.searchParams.get('state');
      const all = [...controls.saved.values()].filter(
        (action) => (!state || action[state]) && (hiddenAccess || !action.hidden),
      );
      const pageNum = Number(url.searchParams.get('page') || 1);
      const limit = Number(url.searchParams.get('limit') || 10);
      return route.fulfill({
        json: {
          actions: all.slice((pageNum - 1) * limit, pageNum * limit),
          page: pageNum,
          hasMore: pageNum * limit < all.length,
        },
      });
    }

    if (/\/jobs\/[^/]+\/actions$/.test(pathname)) {
      const id = decodeURIComponent(pathname.split('/').at(-2));
      const patch = request.postDataJSON();
      if (!hiddenAccess && (controls.saved.get(id)?.hidden || patch.hidden === false)) {
        return route.fulfill({ status: 403, json: { code: 'JOBS_HIDDEN_LOCKED' } });
      }
      const action = { ...(controls.saved.get(id) || emptyAction(id)), ...patch };
      controls.saved.set(id, action);
      return route.fulfill({ json: { action } });
    }

    if (/\/jobs\/[^/]+$/.test(pathname)) {
      const id = decodeURIComponent(pathname.split('/').at(-1));
      const job = catalog.find((j) => j.id === id);
      return route.fulfill(
        job
          ? { json: { job: { ...job, actions: controls.saved.get(id) || emptyAction(id) } } }
          : { status: 404, json: {} },
      );
    }

    return route.fulfill({ json: { success: true } });
  });
}

function seedSavedJobs(controls) {
  controls.saved.set('fixture-job-1', {
    jobId: 'fixture-job-1',
    saved: true,
    applied: false,
    hidden: false,
    updatedAt: new Date().toISOString(),
  });
  controls.saved.set('fixture-job-2', {
    jobId: 'fixture-job-2',
    saved: true,
    applied: true,
    hidden: false,
    updatedAt: new Date().toISOString(),
  });
  controls.saved.set('fixture-job-3', {
    jobId: 'fixture-job-3',
    saved: false,
    applied: true,
    hidden: false,
    updatedAt: new Date().toISOString(),
  });
  controls.saved.set('fixture-job-4', {
    jobId: 'fixture-job-4',
    saved: false,
    applied: false,
    hidden: true,
    updatedAt: new Date().toISOString(),
  });
}

async function main() {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  console.log(`[audit-jobs-responsive] Static server running at ${base}`);

  const browser = await chromium.launch({
    headless: true,
    executablePath: chromePath,
  });

  const auditReport = {
    phase,
    timestamp: new Date().toISOString(),
    viewportsTested: VIEWPORTS.length,
    themesTested: THEMES.length,
    matrixResults: [],
    stateChecks: {},
    orientationChecks: {},
    zoomChecks: {},
    overflowDefects: [],
    touchTargetDefects: [],
    accessibilityDefects: [],
  };

  const matrixDir = path.join(outputDir, phase, 'matrix');
  const statesDir = path.join(outputDir, phase, 'states');
  const zoomDir = path.join(outputDir, phase, 'zoom');
  const orientDir = path.join(outputDir, phase, 'orientation');
  fs.mkdirSync(matrixDir, { recursive: true });
  fs.mkdirSync(statesDir, { recursive: true });
  fs.mkdirSync(zoomDir, { recursive: true });
  fs.mkdirSync(orientDir, { recursive: true });

  try {
    // 1. Matrix verification: 12 viewports x 3 themes = 36 runs
    console.log(`\n--- Starting 36-cell Viewport & Theme Matrix Audit (${phase}) ---`);
    for (const vp of VIEWPORTS) {
      for (const theme of THEMES) {
        const context = await initPageContext(browser, {
          width: vp.width,
          height: vp.height,
          theme,
        });

        const page = await context.newPage();
        const pageErrors = [];
        page.on('pageerror', (err) => pageErrors.push(err.message));

        const controls = {
          mode: 'normal',
          requests: [],
          saved: new Map(),
          hiddenUnlocked: false,
        };
        seedSavedJobs(controls);
        await attachDefaultRoutes(page, controls);

        await page.goto(`${base}/app/jobs`);
        await page.locator('.jobs-page').waitFor({ timeout: 10000 });
        await page.locator('.jobs-grid app-job-card').first().waitFor({ timeout: 10000 });
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(300);

        // Sidebar check: On desktop/laptop (> 768), ensure shell isn't blocking view
        if (vp.width > 768 && (await page.locator('.shell-body.sidebar-closed').count())) {
          const toggleBtn = page.getByRole('button', { name: 'Toggle sidebar', exact: true });
          if (await toggleBtn.isVisible()) {
            await toggleBtn.click();
            await page.waitForTimeout(150);
          }
        }

        // Measure layout & check overflow
        const measurement = await page.evaluate(() => {
          const doc = document.documentElement;
          const body = document.body;
          const scrollWidth = Math.max(doc.scrollWidth, body.scrollWidth);
          const clientWidth = doc.clientWidth || window.innerWidth;
          const hasDocOverflow = scrollWidth > clientWidth + 1;

          const jobsPage = document.querySelector('.jobs-page');
          const pageScrollWidth = jobsPage ? jobsPage.scrollWidth : 0;
          const pageClientWidth = jobsPage ? jobsPage.clientWidth : 0;
          const hasPageOverflow = pageScrollWidth > pageClientWidth + 1;

          // Find any offending elements overflowing horizontally
          const offenders = [];
          if (hasDocOverflow || hasPageOverflow) {
            const allElements = document.querySelectorAll('.jobs-page *');
            for (const el of allElements) {
              const r = el.getBoundingClientRect();
              if (r.right > clientWidth + 2) {
                offenders.push({
                  tag: el.tagName,
                  className: el.className ? String(el.className).slice(0, 80) : '',
                  right: Math.round(r.right),
                  width: Math.round(r.width),
                  clientWidth,
                });
              }
            }
          }

          const jobsGrid = document.querySelector('.jobs-grid');
          const jobsGridStyle = jobsGrid ? getComputedStyle(jobsGrid) : null;
          const jobsGridCols = jobsGridStyle
            ? jobsGridStyle.gridTemplateColumns.split(' ').length
            : 0;

          const cards = [...document.querySelectorAll('app-job-card')].map((c) => {
            const r = c.getBoundingClientRect();
            return {
              width: Math.round(r.width),
              height: Math.round(r.height),
            };
          });

          // Touch target checks for visible interactive controls
          const smallTargets = [];
          const interactives = document.querySelectorAll(
            'button, a, input, select, [role="button"], [tabindex="0"]',
          );
          for (const el of interactives) {
            const r = el.getBoundingClientRect();
            if (r.width > 0 && r.height > 0 && r.top < window.innerHeight && r.bottom > 0) {
              // Below 40px height or width on non-inline items
              if (r.height < 36 || r.width < 36) {
                smallTargets.push({
                  tag: el.tagName,
                  text: (el.textContent || '').trim().slice(0, 30),
                  width: Math.round(r.width),
                  height: Math.round(r.height),
                  className: el.className ? String(el.className).slice(0, 50) : '',
                });
              }
            }
          }

          return {
            scrollWidth,
            clientWidth,
            hasDocOverflow,
            pageScrollWidth,
            pageClientWidth,
            hasPageOverflow,
            offenders: offenders.slice(0, 5),
            jobsGridCols,
            cardCount: cards.length,
            cardSampleWidth: cards[0]?.width || 0,
            smallTargets: smallTargets.slice(0, 10),
          };
        });

        const status =
          !measurement.hasDocOverflow && !measurement.hasPageOverflow && pageErrors.length === 0
            ? 'PASS'
            : 'FAIL';

        const resultEntry = {
          viewport: vp.name,
          category: vp.category,
          dimensions: `${vp.width}x${vp.height}`,
          theme,
          scrollWidth: measurement.scrollWidth,
          clientWidth: measurement.clientWidth,
          hasDocOverflow: measurement.hasDocOverflow,
          pageScrollWidth: measurement.pageScrollWidth,
          pageClientWidth: measurement.pageClientWidth,
          hasPageOverflow: measurement.hasPageOverflow,
          offenders: measurement.offenders,
          gridCols: measurement.jobsGridCols,
          cardWidth: measurement.cardSampleWidth,
          smallTargets: measurement.smallTargets,
          pageErrors,
          status,
        };

        auditReport.matrixResults.push(resultEntry);
        console.log(`  Matrix ${vp.name} (${theme}): status=${status}, scrollWidth=${measurement.scrollWidth}, clientWidth=${measurement.clientWidth}`);

        if (status === 'FAIL') {
          console.log(
            `  [FAIL] ${vp.name} (${theme}): scrollWidth=${measurement.scrollWidth} > clientWidth=${measurement.clientWidth}. Offenders:`,
            measurement.offenders,
          );
          auditReport.overflowDefects.push({
            viewport: vp.name,
            theme,
            overflow: measurement.scrollWidth - measurement.clientWidth,
            offenders: measurement.offenders,
          });
        }

        // Capture screenshot for sample matrix cells (all dark mobile/tablet/desktop, plus light 375/1440)
        const shouldCapture =
          theme === 'dark' ||
          (theme === 'light' && (vp.name === 'mobile-375' || vp.name === 'desktop-1440')) ||
          (theme === 'system' && vp.name === 'mobile-390');

        if (shouldCapture) {
          const shotName = `${vp.name}-${theme}.png`;
          await page.screenshot({
            path: path.join(matrixDir, shotName),
            fullPage: false,
          });
        }

        await context.close();
      }
    }

    // 2. Interactive States & Views Verification
    console.log(`\n--- Starting Dedicated State & View Checks (${phase}) ---`);
    const stateContext = await initPageContext(browser, {
      width: 375,
      height: 667,
      theme: 'dark',
    });
    const statePage = await stateContext.newPage();
    const stateControls = {
      mode: 'normal',
      requests: [],
      saved: new Map(),
      hiddenUnlocked: false,
    };
    seedSavedJobs(stateControls);
    await attachDefaultRoutes(statePage, stateControls);

    // 2a. Discover View with Filters Opened
    await statePage.goto(`${base}/app/jobs`);
    await statePage.locator('.jobs-page').waitFor({ timeout: 10000 });
    await statePage.evaluate(() => document.fonts.ready);

    // Open filters on mobile
    const filterToggle = statePage.locator('.btn-mobile-filters');
    if (await filterToggle.isVisible()) {
      await filterToggle.click();
      await statePage.waitForTimeout(200);
    }
    const filterOpenMeas = await statePage.evaluate(() => {
      const doc = document.documentElement;
      return {
        hasOverflow: doc.scrollWidth > doc.clientWidth + 1,
        scrollWidth: doc.scrollWidth,
        clientWidth: doc.clientWidth,
      };
    });
    await statePage.screenshot({
      path: path.join(statesDir, 'filters-open-mobile-375.png'),
    });
    auditReport.stateChecks['filters-open-mobile'] = {
      ...filterOpenMeas,
      status: !filterOpenMeas.hasOverflow ? 'PASS' : 'FAIL',
    };

    // 2b. Saved Opportunities View
    await statePage.click('.tab-btn:has-text("Saved")');
    await statePage.waitForTimeout(300);
    const savedMeas = await statePage.evaluate(() => {
      const doc = document.documentElement;
      const count = document.querySelectorAll('app-job-card').length;
      return {
        hasOverflow: doc.scrollWidth > doc.clientWidth + 1,
        scrollWidth: doc.scrollWidth,
        clientWidth: doc.clientWidth,
        cardCount: count,
      };
    });
    await statePage.screenshot({
      path: path.join(statesDir, 'saved-view-mobile-375.png'),
    });
    auditReport.stateChecks['saved-view'] = {
      ...savedMeas,
      status: !savedMeas.hasOverflow ? 'PASS' : 'FAIL',
    };

    // 2c. Application Tracker View
    await statePage.click('.tab-btn:has-text("Application Tracker")');
    await statePage.waitForTimeout(300);
    const appliedMeas = await statePage.evaluate(() => {
      const doc = document.documentElement;
      const count = document.querySelectorAll('app-job-card').length;
      return {
        hasOverflow: doc.scrollWidth > doc.clientWidth + 1,
        scrollWidth: doc.scrollWidth,
        clientWidth: doc.clientWidth,
        cardCount: count,
      };
    });
    await statePage.screenshot({
      path: path.join(statesDir, 'applied-view-mobile-375.png'),
    });
    auditReport.stateChecks['applied-view'] = {
      ...appliedMeas,
      status: !appliedMeas.hasOverflow ? 'PASS' : 'FAIL',
    };

    // 2d. Hidden Jobs View (Locked state)
    await statePage.click('.tab-btn:has-text("Hidden")');
    await statePage.waitForTimeout(300);
    const hiddenLockedMeas = await statePage.evaluate(() => {
      const doc = document.documentElement;
      const pwdInput = document.querySelector('#hidden-account-password');
      return {
        hasOverflow: doc.scrollWidth > doc.clientWidth + 1,
        scrollWidth: doc.scrollWidth,
        clientWidth: doc.clientWidth,
        hasPasswordInput: !!pwdInput,
      };
    });
    await statePage.screenshot({
      path: path.join(statesDir, 'hidden-locked-mobile-375.png'),
    });
    auditReport.stateChecks['hidden-locked'] = {
      ...hiddenLockedMeas,
      status: !hiddenLockedMeas.hasOverflow && hiddenLockedMeas.hasPasswordInput ? 'PASS' : 'FAIL',
    };

    // 2e. Hidden Jobs View (Unlocked state)
    await statePage.fill('#hidden-account-password', 'Fixture!Password123');
    await statePage.click('.btn-unlock-hidden');
    await statePage.waitForTimeout(400);
    const hiddenUnlockedMeas = await statePage.evaluate(() => {
      const doc = document.documentElement;
      const count = document.querySelectorAll('app-job-card').length;
      return {
        hasOverflow: doc.scrollWidth > doc.clientWidth + 1,
        scrollWidth: doc.scrollWidth,
        clientWidth: doc.clientWidth,
        cardCount: count,
      };
    });
    await statePage.screenshot({
      path: path.join(statesDir, 'hidden-unlocked-mobile-375.png'),
    });
    auditReport.stateChecks['hidden-unlocked'] = {
      ...hiddenUnlockedMeas,
      status: !hiddenUnlockedMeas.hasOverflow ? 'PASS' : 'FAIL',
    };

    // 2f. Job Details Page View on Mobile 375 & Desktop 1440
    await statePage.goto(`${base}/app/jobs/fixture-job-1`);
    await statePage.locator('.job-details-page').waitFor({ timeout: 10000 });
    await statePage.evaluate(() => document.fonts.ready);
    await statePage.waitForTimeout(300);
    const detailsMobileMeas = await statePage.evaluate(() => {
      const doc = document.documentElement;
      const title = document.querySelector('.job-title')?.textContent;
      const headerActions = document.querySelector('.header-actions');
      const layout = document.querySelector('.detail-layout');
      return {
        hasOverflow: doc.scrollWidth > doc.clientWidth + 1,
        scrollWidth: doc.scrollWidth,
        clientWidth: doc.clientWidth,
        hasTitle: !!title,
        headerActionsWrap: headerActions ? getComputedStyle(headerActions).flexWrap : null,
      };
    });
    await statePage.screenshot({
      path: path.join(statesDir, 'job-details-mobile-375.png'),
      fullPage: true,
    });
    auditReport.stateChecks['job-details-mobile'] = {
      ...detailsMobileMeas,
      status: !detailsMobileMeas.hasOverflow && detailsMobileMeas.hasTitle ? 'PASS' : 'FAIL',
    };

    await stateContext.close();

    // 2g. Job Details Page Desktop 1440
    const desktopContext = await initPageContext(browser, {
      width: 1440,
      height: 900,
      theme: 'dark',
    });
    const desktopPage = await desktopContext.newPage();
    const desktopControls = {
      mode: 'normal',
      requests: [],
      saved: new Map(),
    };
    seedSavedJobs(desktopControls);
    await attachDefaultRoutes(desktopPage, desktopControls);
    await desktopPage.goto(`${base}/app/jobs/fixture-job-1`);
    await desktopPage.locator('.job-details-page').waitFor({ timeout: 10000 });
    await desktopPage.evaluate(() => document.fonts.ready);
    await desktopPage.waitForTimeout(300);

    const detailsDesktopMeas = await desktopPage.evaluate(() => {
      const doc = document.documentElement;
      return {
        hasOverflow: doc.scrollWidth > doc.clientWidth + 1,
        scrollWidth: doc.scrollWidth,
        clientWidth: doc.clientWidth,
      };
    });
    await desktopPage.screenshot({
      path: path.join(statesDir, 'job-details-desktop-1440.png'),
      fullPage: true,
    });
    auditReport.stateChecks['job-details-desktop'] = {
      ...detailsDesktopMeas,
      status: !detailsDesktopMeas.hasOverflow ? 'PASS' : 'FAIL',
    };

    await desktopContext.close();

    // 3. Orientations Check (Landscape mobile and portrait tablet)
    console.log(`\n--- Starting Orientation Checks (${phase}) ---`);
    const orientations = [
      { name: 'mobile-375-landscape', width: 667, height: 375 },
      { name: 'mobile-390-landscape', width: 844, height: 390 },
      { name: 'mobile-430-landscape', width: 932, height: 430 },
      { name: 'tablet-1024-portrait', width: 768, height: 1024 },
    ];
    for (const orient of orientations) {
      const orientCtx = await initPageContext(browser, {
        width: orient.width,
        height: orient.height,
        theme: 'dark',
      });
      const orientPage = await orientCtx.newPage();
      const oControls = { mode: 'normal', requests: [], saved: new Map() };
      seedSavedJobs(oControls);
      await attachDefaultRoutes(orientPage, oControls);
      await orientPage.goto(`${base}/app/jobs`);
      await orientPage.locator('.jobs-page').waitFor({ timeout: 10000 });
      await orientPage.evaluate(() => document.fonts.ready);
      await orientPage.waitForTimeout(200);

      const oMeas = await orientPage.evaluate(() => {
        const doc = document.documentElement;
        return {
          hasOverflow: doc.scrollWidth > doc.clientWidth + 1,
          scrollWidth: doc.scrollWidth,
          clientWidth: doc.clientWidth,
        };
      });
      await orientPage.screenshot({
        path: path.join(orientDir, `${orient.name}.png`),
      });
      auditReport.orientationChecks[orient.name] = {
        ...oMeas,
        status: !oMeas.hasOverflow ? 'PASS' : 'FAIL',
      };
      await orientCtx.close();
    }

    // 4. Zoom & Text Scaling Checks (125%, 150%)
    console.log(`\n--- Starting Browser Zoom & Scaling Checks (${phase}) ---`);
    const zooms = [
      { name: 'mobile-375-zoom125', baseWidth: 375, baseHeight: 667, zoomFactor: 1.25 },
      { name: 'desktop-1440-zoom125', baseWidth: 1440, baseHeight: 900, zoomFactor: 1.25 },
      { name: 'mobile-375-zoom150', baseWidth: 375, baseHeight: 667, zoomFactor: 1.5 },
      { name: 'desktop-1440-zoom150', baseWidth: 1440, baseHeight: 900, zoomFactor: 1.5 },
    ];
    for (const z of zooms) {
      const effectiveW = Math.round(z.baseWidth / z.zoomFactor);
      const effectiveH = Math.round(z.baseHeight / z.zoomFactor);
      const zoomCtx = await initPageContext(browser, {
        width: effectiveW,
        height: effectiveH,
        theme: 'dark',
      });
      const zoomPage = await zoomCtx.newPage();
      const zControls = { mode: 'normal', requests: [], saved: new Map() };
      seedSavedJobs(zControls);
      await attachDefaultRoutes(zoomPage, zControls);
      await zoomPage.goto(`${base}/app/jobs`);
      await zoomPage.locator('.jobs-page').waitFor({ timeout: 10000 });
      await zoomPage.evaluate(() => document.fonts.ready);
      await zoomPage.waitForTimeout(200);

      const zMeas = await zoomPage.evaluate(() => {
        const doc = document.documentElement;
        return {
          hasOverflow: doc.scrollWidth > doc.clientWidth + 1,
          scrollWidth: doc.scrollWidth,
          clientWidth: doc.clientWidth,
        };
      });
      await zoomPage.screenshot({
        path: path.join(zoomDir, `${z.name}.png`),
      });
      auditReport.zoomChecks[z.name] = {
        ...zMeas,
        effectiveDimensions: `${effectiveW}x${effectiveH}`,
        status: !zMeas.hasOverflow ? 'PASS' : 'FAIL',
      };
      await zoomCtx.close();
    }

    // Write report JSON before shutting down
    const reportPath = path.join(outputDir, `audit-report-${phase}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(auditReport, null, 2), 'utf8');
    console.log(`\nAudit complete! Report saved to ${reportPath}`);

    // Summary output
    const fails = auditReport.matrixResults.filter((r) => r.status === 'FAIL');
    console.log(`Matrix Result: ${auditReport.matrixResults.length - fails.length}/36 passed.`);
    if (fails.length) {
      console.log(`Failed viewports (${fails.length}):`);
      for (const f of fails) {
        console.log(`  - ${f.viewport} (${f.theme}): overflow by ${f.scrollWidth - f.clientWidth}px`);
      }
    }
  } finally {
    try {
      await browser.close();
    } catch (_) {}
    try {
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
      server.close();
    } catch (_) {}
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('Audit failed with error:', err);
  process.exit(1);
});
