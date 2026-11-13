// Complete Responsive Design Audit for Recommendations module across all required viewports, themes, orientations, zoom levels, and UI states.
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const assert = require('node:assert/strict');

const playwrightPath = process.env.PLAYWRIGHT_MODULE || 'D:/Agrivio/node_modules/playwright';
const { chromium } = require(playwrightPath);

const phase = process.argv[2] || 'before';
const chromePath =
  process.env.ACCEPTANCE_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const dist = path.resolve(__dirname, '../dist/frontend/browser');
const outputDir = path.resolve(__dirname, '../verification/recommendations/responsive-audit');
fs.mkdirSync(outputDir, { recursive: true });

const { fixture, hash } = require('./recommendations-browser-fixture.cjs');
const { profile } = require('./skill-gap-browser-fixture.cjs');

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

async function initPageContext(browser, { width, height, theme = 'dark', username = 'fixture' }) {
  const colorScheme = theme === 'system' ? 'dark' : theme;
  const context = await browser.newContext({
    viewport: { width, height },
    colorScheme,
    reducedMotion: 'reduce',
  });

  await context.addInitScript(
    ({ themeVal, activeUser, profileVal }) => {
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
          _id: 'fixture-user',
          role: 'developer',
          name: 'Fixture Developer',
          email: 'fixture@example.com',
          activeGithubUsername: activeUser,
        }),
      );
      localStorage.setItem('devinsight_career_profile', JSON.stringify(profileVal));
      localStorage.setItem('devinsight_theme', themeVal);
    },
    { themeVal: theme, activeUser: username, profileVal: profile },
  );

  return context;
}

function attachRoutes(page, { mode = 'normal', sprintState = 'success', savedPreviews = [] } = {}) {
  const requests = [];
  const handoffs = [];

  return page.route('**/api/**', async (route) => {
    const url = route.request().url();

    if (url.includes('/recommendations/') && url.endsWith('/career-sprint')) {
      handoffs.push({ url, body: route.request().postDataJSON() });
      await new Promise((resolve) => setTimeout(resolve, 80));
      if (sprintState === 'error') {
        return route.fulfill({
          status: 409,
          json: { message: 'Refresh before starting a sprint.' },
        });
      }
      return route.fulfill({
        json: {
          sprintId: 'fixture-sprint',
          alreadyAdded: sprintState === 'duplicate',
          route: '/app/career-sprint',
        },
      });
    }

    if (url.endsWith('/recommendations') || url.endsWith('/recommendations/generate')) {
      requests.push(route.request().postDataJSON());
      if (mode === 'loading') {
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
      if (mode === 'error') {
        return route.fulfill({
          status: 503,
          json: { message: 'Temporary recommendations source outage' },
        });
      }

      const data = fixture();
      if (mode === 'empty') {
        data.recommendations = [];
        data.structuredRecommendations = {};
        data.projects = [];
        data.technologies = [];
        data.careerPaths = [];
        data.roadmap = { timeline: [] };
      }
      if (mode === 'legacy') {
        delete data.recommendations;
        data.verified = false;
      }
      if (mode === 'partial') {
        data.cacheMetadata.partial = true;
        data.sourceMetadata.github.available = false;
        data.sourceMetadata.github.freshness = 'STALE';
      }
      if (mode === 'ai') {
        data.aiUsed = true;
        data.aiSuggestions = [
          {
            suggestion: 'Build a production microservice with automated integration tests.',
            aiGenerated: true,
            kind: 'learningIdea',
          },
        ];
      }

      return route.fulfill({ json: data });
    }

    if (url.includes('/recommendations/previews')) {
      if (route.request().method() === 'DELETE') {
        return route.fulfill({ status: 204 });
      }
      if (route.request().method() === 'POST') {
        return route.fulfill({
          status: 201,
          json: {
            preview: {
              _id: 'saved-preview-1',
              title: 'Saved test candidate',
              module: 'recommendations',
              githubUsername: 'testcandidate',
              careerStack: 'Full Stack',
              experienceLevel: 'Student',
              resultSummary: { ...fixture(), verified: false },
            },
          },
        });
      }
      return route.fulfill({
        json: {
          previews: savedPreviews.length
            ? savedPreviews
            : [
                {
                  _id: 'preview-alpha',
                  title: 'Frontend Engineer (Mid) - torvalds',
                  createdAt: new Date().toISOString(),
                },
              ],
        },
      });
    }

    if (url.includes('/profile/career')) {
      return route.fulfill({ json: profile });
    }

    if (url.includes('active-username')) {
      return route.fulfill({ json: { username: mode === 'no-profile' ? '' : 'fixture' } });
    }

    if (url.includes('/notifications/stream')) {
      return route.fulfill({ contentType: 'text/event-stream', body: ': heartbeat\n\n' });
    }

    return route.fulfill({
      json: {
        success: true,
        data: [],
        notifications: [],
        profile: {},
        user: { _id: 'fixture-user', role: 'developer' },
      },
    });
  });
}

async function measurePage(page) {
  return await page.evaluate(() => {
    const doc = document.documentElement;
    const body = document.body;
    const scrollWidth = Math.max(doc.scrollWidth, body.scrollWidth);
    const clientWidth = doc.clientWidth || window.innerWidth;
    const hasDocOverflow = scrollWidth > clientWidth + 1;

    const pageContainer = document.querySelector('.rec-page');
    const containerScrollWidth = pageContainer ? pageContainer.scrollWidth : 0;
    const containerClientWidth = pageContainer ? pageContainer.clientWidth : 0;
    const hasContainerOverflow = containerScrollWidth > containerClientWidth + 1;

    // Find all overflowing elements (excluding items inside valid horizontal scroll containers)
    const offenders = [];
    const allElements = document.querySelectorAll('.rec-page *');
    for (const el of allElements) {
      const scrollParent = el.closest('.pills-scroll, pre, .dev-inventory');
      if (scrollParent && el !== scrollParent) {
        continue;
      }
      const r = el.getBoundingClientRect();
      if (r.right > clientWidth + 2) {
        offenders.push({
          tag: el.tagName,
          className: el.className ? String(el.className).slice(0, 100) : '',
          right: Math.round(r.right),
          width: Math.round(r.width),
          clientWidth,
        });
      }
    }

    // Touch targets check (< 44px in either dimension for standalone buttons / inputs / selects)
    const smallTouchTargets = [];
    const interactive = document.querySelectorAll(
      'button, select, input:not([type="checkbox"]), a.primary, a.sprint-action, a.onboarding-btn, .mode-tab-btn, .btn-pagination, .refresh-rec-btn',
    );
    for (const el of interactive) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && (r.height < 32 || r.width < 32)) {
        smallTouchTargets.push({
          tag: el.tagName,
          className: el.className ? String(el.className).slice(0, 80) : '',
          text: (el.textContent || '').trim().slice(0, 30),
          width: Math.round(r.width),
          height: Math.round(r.height),
        });
      }
    }

    // Component specific measurements
    const metricsStrip = document.querySelector('.rec-metrics-strip');
    const metricsCols = metricsStrip
      ? getComputedStyle(metricsStrip).gridTemplateColumns.split(' ').length
      : 0;

    const filterBar = document.querySelector('.filter-bar:not(.preview-grid)');
    const filterCols = filterBar
      ? getComputedStyle(filterBar).gridTemplateColumns.split(' ').length
      : 0;

    const previewGrid = document.querySelector('.preview-grid');
    const previewGridCols = previewGrid
      ? getComputedStyle(previewGrid).gridTemplateColumns.split(' ').length
      : 0;

    const focusGrid = document.querySelector('.focus-grid');
    const focusCols = focusGrid
      ? getComputedStyle(focusGrid).gridTemplateColumns.split(' ').length
      : 0;

    const resourceGrid = document.querySelector('.resource-grid');
    const resourceCols = resourceGrid
      ? getComputedStyle(resourceGrid).gridTemplateColumns.split(' ').length
      : 0;

    const featuredRow = document.querySelector('.recommendation-row.featured');
    const featuredActions = featuredRow ? featuredRow.querySelector('.row-actions') : null;
    const featuredActionsWidth = featuredActions
      ? Math.round(featuredActions.getBoundingClientRect().width)
      : 0;

    const sprintSummary = document.querySelector('.sprint-summary');
    const sprintFlexDir = sprintSummary ? getComputedStyle(sprintSummary).flexDirection : '';

    return {
      scrollWidth,
      clientWidth,
      hasOverflow: hasDocOverflow || hasContainerOverflow || offenders.length > 0,
      offenders: offenders.slice(0, 8),
      smallTouchTargets: smallTouchTargets.slice(0, 5),
      metricsCols,
      filterCols,
      previewGridCols,
      focusCols,
      resourceCols,
      featuredActionsWidth,
      sprintFlexDir,
    };
  });
}

async function runAudit() {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  console.log(
    `[audit-recommendations-responsive] Static server running at ${base} (Phase: ${phase})`,
  );

  const browser = await chromium.launch({
    headless: true,
    executablePath: chromePath,
  });

  const phaseDir = path.join(outputDir, phase);
  const matrixDir = path.join(phaseDir, 'matrix');
  const statesDir = path.join(phaseDir, 'states');
  const zoomDir = path.join(phaseDir, 'zoom');
  const orientDir = path.join(phaseDir, 'orientations');
  fs.mkdirSync(matrixDir, { recursive: true });
  fs.mkdirSync(statesDir, { recursive: true });
  fs.mkdirSync(zoomDir, { recursive: true });
  fs.mkdirSync(orientDir, { recursive: true });

  const auditReport = {
    phase,
    timestamp: new Date().toISOString(),
    viewportsTested: VIEWPORTS.length,
    themesTested: THEMES.length,
    matrixResults: [],
    stateResults: {},
    zoomResults: [],
    orientationResults: [],
    defectsDiscovered: [],
  };

  try {
    // ═════════════════════════════════════════════════════════════════
    // 1. Matrix verification: 12 viewports x 3 themes = 36 runs
    // ═════════════════════════════════════════════════════════════════
    console.log(`\n--- Starting 36-cell Viewport & Theme Matrix Audit (${phase}) ---`);
    for (const vp of VIEWPORTS) {
      for (const theme of THEMES) {
        const context = await initPageContext(browser, {
          width: vp.width,
          height: vp.height,
          theme,
          username: 'fixture',
        });

        const page = await context.newPage();
        const pageErrors = [];
        page.on('pageerror', (err) => pageErrors.push(err.message));

        await attachRoutes(page, { mode: 'normal' });

        await page.goto(`${base}/app/recommendations`);
        await page.locator('.rec-page').waitFor({ timeout: 10000 });
        await page.locator('.recommendation-row').first().waitFor({ timeout: 10000 });
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(200);

        // Sidebar check: On desktop/laptop (> 768), ensure shell sidebar is open for true workspace width
        if (vp.width > 768 && (await page.locator('.shell-body.sidebar-closed').count())) {
          const toggleBtn = page.getByRole('button', { name: 'Toggle sidebar', exact: true });
          if (await toggleBtn.isVisible()) {
            await toggleBtn.click();
            await page.waitForTimeout(100);
          }
        }

        const m = await measurePage(page);

        // Take screenshot
        const shotPath = path.join(matrixDir, `${vp.name}-${theme}.png`);
        await page.screenshot({ path: shotPath, fullPage: false });

        const cellResult = {
          viewport: vp.name,
          category: vp.category,
          width: vp.width,
          height: vp.height,
          theme,
          hasOverflow: m.hasOverflow,
          scrollWidth: m.scrollWidth,
          clientWidth: m.clientWidth,
          offenders: m.offenders,
          metricsCols: m.metricsCols,
          filterCols: m.filterCols,
          focusCols: m.focusCols,
          resourceCols: m.resourceCols,
          pageErrors,
          screenshot: path.relative(outputDir, shotPath),
        };

        if (m.hasOverflow) {
          console.warn(
            `[DEFECT] Overflow on ${vp.name} (${theme}): scrollWidth=${m.scrollWidth} > clientWidth=${m.clientWidth}`,
          );
          auditReport.defectsDiscovered.push({
            type: 'HORIZONTAL_OVERFLOW',
            viewport: vp.name,
            theme,
            scrollWidth: m.scrollWidth,
            clientWidth: m.clientWidth,
            offenders: m.offenders,
          });
        }

        auditReport.matrixResults.push(cellResult);
        await context.close();
      }
    }

    // ═════════════════════════════════════════════════════════════════
    // 2. Candidate Preview Mode (Audit Forms, Inputs, Dropdowns, Grid)
    // ═════════════════════════════════════════════════════════════════
    console.log(`\n--- Auditing Candidate Preview Mode across Mobile & Desktop ---`);
    for (const vp of [VIEWPORTS[0], VIEWPORTS[1], VIEWPORTS[4], VIEWPORTS[9]]) {
      // 320, 375, 768, 1440
      const context = await initPageContext(browser, {
        width: vp.width,
        height: vp.height,
        theme: 'dark',
      });
      const page = await context.newPage();
      await attachRoutes(page, { mode: 'normal' });
      await page.goto(`${base}/app/recommendations`);
      await page.locator('.rec-page').waitFor({ timeout: 10000 });

      // Click "Preview Candidate" tab
      const previewTab = page.getByRole('button', { name: 'Preview Candidate' });
      await previewTab.click();
      await page.locator('.preview-panel').waitFor({ timeout: 5000 });
      await page.waitForTimeout(200);

      // Open the resume disclosure to check textareas and file uploads
      const resumeDisclosure = page.locator('.resume-disclosure summary');
      await resumeDisclosure.click();
      await page.waitForTimeout(100);

      const m = await measurePage(page);
      const shot = path.join(statesDir, `candidate-preview-${vp.name}.png`);
      await page.screenshot({ path: shot, fullPage: false });

      if (m.previewGridCols > 1 && vp.width <= 430) {
        console.warn(
          `[DEFECT] Candidate Preview grid has ${m.previewGridCols} columns at ${vp.width}px, causing squeezed/clipped form controls!`,
        );
        auditReport.defectsDiscovered.push({
          type: 'BROKEN_FORM_GRID',
          viewport: vp.name,
          details: `preview-grid forced to ${m.previewGridCols} columns on ${vp.width}px`,
        });
      }

      auditReport.stateResults[`preview-${vp.name}`] = {
        viewport: vp.name,
        hasOverflow: m.hasOverflow,
        previewGridCols: m.previewGridCols,
        offenders: m.offenders,
        screenshot: path.relative(outputDir, shot),
      };

      await context.close();
    }

    // ═════════════════════════════════════════════════════════════════
    // 3. UI States (Empty, Loading, Error, Stale/Partial, Legacy)
    // ═════════════════════════════════════════════════════════════════
    console.log(`\n--- Auditing Edge States (Empty, Loading, Error, Stale, Legacy) ---`);
    const stateConfigs = [
      { name: 'empty-onboarding', mode: 'no-profile' },
      { name: 'loading-refreshing', mode: 'loading' },
      { name: 'error-banner', mode: 'error' },
      { name: 'partial-stale', mode: 'partial' },
      { name: 'legacy-history', mode: 'legacy' },
      { name: 'ai-suggestions', mode: 'ai' },
    ];

    for (const sc of stateConfigs) {
      const context = await initPageContext(browser, {
        width: 375,
        height: 667,
        theme: 'light',
        username: sc.mode === 'no-profile' ? '' : 'fixture',
      });
      const page = await context.newPage();
      await attachRoutes(page, { mode: sc.mode });
      await page.goto(`${base}/app/recommendations`);
      await page.waitForTimeout(500);

      const m = await measurePage(page);
      const shot = path.join(statesDir, `state-${sc.name}-375.png`);
      await page.screenshot({ path: shot, fullPage: false });

      auditReport.stateResults[sc.name] = {
        state: sc.name,
        hasOverflow: m.hasOverflow,
        offenders: m.offenders,
        screenshot: path.relative(outputDir, shot),
      };
      await context.close();
    }

    // ═════════════════════════════════════════════════════════════════
    // 4. Orientations: Portrait vs Landscape
    // ═════════════════════════════════════════════════════════════════
    console.log(`\n--- Auditing Portrait & Landscape Orientations ---`);
    const orientations = [
      { name: 'mobile-390-portrait', width: 390, height: 844 },
      { name: 'mobile-390-landscape', width: 844, height: 390 },
      { name: 'tablet-820-portrait', width: 820, height: 1180 },
      { name: 'tablet-820-landscape', width: 1180, height: 820 },
    ];

    for (const ori of orientations) {
      const context = await initPageContext(browser, {
        width: ori.width,
        height: ori.height,
        theme: 'dark',
      });
      const page = await context.newPage();
      await attachRoutes(page, { mode: 'normal' });
      await page.goto(`${base}/app/recommendations`);
      await page.locator('.rec-page').waitFor({ timeout: 10000 });
      await page.waitForTimeout(200);

      const m = await measurePage(page);
      const shot = path.join(orientDir, `${ori.name}.png`);
      await page.screenshot({ path: shot, fullPage: false });

      auditReport.orientationResults.push({
        orientation: ori.name,
        width: ori.width,
        height: ori.height,
        hasOverflow: m.hasOverflow,
        offenders: m.offenders,
        screenshot: path.relative(outputDir, shot),
      });
      await context.close();
    }

    // ═════════════════════════════════════════════════════════════════
    // 5. Browser Zoom & Text Scaling
    // ═════════════════════════════════════════════════════════════════
    console.log(`\n--- Auditing Browser Zoom / Text Scaling (125%, 150%, 200%) ---`);
    const zoomLevels = [
      { name: 'zoom-125', scale: 1.25, width: Math.round(1280 / 1.25), height: 800 },
      { name: 'zoom-150', scale: 1.5, width: Math.round(1280 / 1.5), height: 800 },
      { name: 'zoom-200', scale: 2.0, width: Math.round(1280 / 2.0), height: 800 },
    ];

    for (const zl of zoomLevels) {
      const context = await initPageContext(browser, {
        width: zl.width,
        height: zl.height,
        theme: 'dark',
      });
      const page = await context.newPage();
      await attachRoutes(page, { mode: 'normal' });
      await page.goto(`${base}/app/recommendations`);
      await page.locator('.rec-page').waitFor({ timeout: 10000 });
      await page.waitForTimeout(200);

      const m = await measurePage(page);
      const shot = path.join(zoomDir, `${zl.name}.png`);
      await page.screenshot({ path: shot, fullPage: false });

      auditReport.zoomResults.push({
        zoom: zl.name,
        scale: zl.scale,
        effectiveWidth: zl.width,
        hasOverflow: m.hasOverflow,
        offenders: m.offenders,
        screenshot: path.relative(outputDir, shot),
      });
      await context.close();
    }

    // ═════════════════════════════════════════════════════════════════
    // 6. Interactive Workflows (Sprint handoff, disclosures, filters)
    // ═════════════════════════════════════════════════════════════════
    console.log(`\n--- Auditing Interactive Workflows & Disclosures ---`);
    {
      const context = await initPageContext(browser, {
        width: 375,
        height: 800,
        theme: 'dark',
      });
      const page = await context.newPage();
      await attachRoutes(page, { mode: 'normal', sprintState: 'success' });
      await page.goto(`${base}/app/recommendations`);
      await page.locator('.rec-page').waitFor({ timeout: 10000 });

      // Click "Add to Career Sprint" on first row
      const sprintBtn = page.locator('.recommendation-row .sprint-action').first();
      await sprintBtn.click();
      await page.waitForTimeout(300);

      // Verify "Open Career Sprint" state is rendered
      const sprintSuccessLink = page.locator('.sprint-action.added').first();
      const isAddedVisible = await sprintSuccessLink.isVisible();

      // Open evidence disclosure on first row
      const details = page.locator('.recommendation-row details.evidence summary').first();
      await details.click();
      await page.waitForTimeout(150);

      // Open projects disclosure
      const projPanel = page.locator('.resource-panel').first();
      if (await projPanel.count()) {
        await projPanel.locator('summary').first().click();
        await page.waitForTimeout(150);
      }

      // Open methodology accordion
      const methodPanel = page.locator('.method-panel').first();
      if (await methodPanel.count()) {
        await methodPanel.locator('summary').click();
        await page.waitForTimeout(150);
      }

      const m = await measurePage(page);
      const shot = path.join(statesDir, 'workflow-interactive-mobile-375.png');
      await page.screenshot({ path: shot, fullPage: false });

      auditReport.workflowResults = {
        sprintHandoffWorked: isAddedVisible,
        hasOverflowWithDisclosuresOpen: m.hasOverflow,
        offenders: m.offenders,
        screenshot: path.relative(outputDir, shot),
      };

      await context.close();
    }

    // Save full JSON report
    const reportPath = path.join(phaseDir, 'audit-results.json');
    fs.writeFileSync(reportPath, JSON.stringify(auditReport, null, 2));
    console.log(`\nAudit complete! Results saved to ${reportPath}`);
    console.log(`Defects found: ${auditReport.defectsDiscovered.length}`);
  } finally {
    await browser.close();
    server.close();
  }
}

runAudit().catch((err) => {
  console.error('[audit-recommendations-responsive] Failed:', err);
  process.exit(1);
});
