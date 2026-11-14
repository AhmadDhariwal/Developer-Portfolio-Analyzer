// Complete Responsive Design Audit for Career Sprint module across all required viewports and themes.
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
const outputDir = path.resolve(__dirname, '../verification/career-sprint/responsive-audit');
fs.mkdirSync(outputDir, { recursive: true });

const {
  profile,
  NOW,
  clone,
  proposed,
  draft,
  state: stateFactory,
} = require('./career-sprint-browser-fixture.cjs');

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
    ({ themeVal, activeUser, activeProfile }) => {
      const exp = Math.floor(Date.now() / 1000) + 36000;
      const userId = 'user-fixture';
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
          _id: userId,
          role: 'developer',
          name: 'Fixture Developer',
          email: 'dev@example.com',
          activeGithubUsername: activeUser,
        }),
      );
      localStorage.setItem('devinsight_theme', themeVal);
      localStorage.setItem(
        'devinsight_career_profile',
        JSON.stringify({
          ...activeProfile,
          ownerId: userId,
          isConfigured: true,
          activeGithubUsername: activeUser,
        }),
      );
    },
    { themeVal: theme, activeUser: username, activeProfile: profile },
  );

  return context;
}

async function attachDefaultRoutes(page, mode = 'normal') {
  const controls = stateFactory(mode);

  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (!url.includes('/api/')) {
      return route.continue();
    }
    const request = route.request();
    const endpoint = new URL(url).pathname;
    const method = request.method();
    const data = request.postDataJSON?.() || {};

    const target = controls.current;
    const send = (json, status = 200) => route.fulfill({ status, json: clone(json) });

    if (endpoint === '/api/career-sprints/current') {
      if (controls.delay) await new Promise((r) => setTimeout(r, controls.delay));
      return controls.mode === 'unavailable'
        ? send({ message: 'Sprint temporarily unavailable.' }, 503)
        : send(controls.current);
    }
    if (endpoint === '/api/career-sprints/history') {
      return controls.failHistory
        ? send({ message: 'History unavailable.' }, 503)
        : send({ history: controls.history });
    }
    if (endpoint === '/api/career-sprints/preferences') {
      if (method === 'PUT') controls.preference = data.timeZone;
      return send({ timeZone: controls.preference });
    }
    if (endpoint === '/api/profile/career') {
      return send(profile);
    }
    if (endpoint.includes('active-username')) {
      return send({ username: 'fixture' });
    }
    if (endpoint === '/api/simulator/history') {
      return send({
        history: [{ _id: 'scenario-fixture', name: 'Explore a full-stack direction' }],
      });
    }
    if (/\/career-sprints\/generate-(plan|ai-plan)$/.test(endpoint)) {
      return send({
        tasks: proposed,
        planMeta: {
          summary: 'Build clearer project evidence through small, measurable steps.',
          confidenceScore: 68,
          consistencyScore: 52,
          signalsUsed: ['Career profile', 'Current recommendations'],
          generationMode: 'deterministic',
          limitations: ['Proposed work only; completion does not establish proficiency.'],
        },
      });
    }
    if (endpoint.includes('/notifications/stream')) {
      return route.fulfill({ contentType: 'text/event-stream', body: ': heartbeat\n\n' });
    }
    return send({ success: true });
  });

  return controls;
}

function luminance(rgb) {
  const values = (rgb.match(/[\d.]+/g) || [0, 0, 0])
    .slice(0, 3)
    .map(Number)
    .map((v) => v / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
}

function contrastRatio(fg, bg) {
  const l1 = Math.max(luminance(fg), luminance(bg));
  const l2 = Math.min(luminance(fg), luminance(bg));
  return (l1 + 0.05) / (l2 + 0.05);
}

async function main() {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  console.log(`[audit-career-sprint-responsive] Static server running at ${base}`);

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
    scenarioChecks: {},
    overflowDefects: [],
    touchTargetDefects: [],
    layoutDefects: [],
    accessibilityDefects: [],
  };

  const matrixDir = path.join(outputDir, phase, 'matrix');
  const scenariosDir = path.join(outputDir, phase, 'scenarios');
  fs.mkdirSync(matrixDir, { recursive: true });
  fs.mkdirSync(scenariosDir, { recursive: true });

  try {
    // 1. Matrix verification: 12 viewports x 3 themes = 36 runs
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

        await attachDefaultRoutes(page, 'normal');

        await page.goto(`${base}/app/career-sprint`, { waitUntil: 'domcontentloaded' });
        await page.locator('.sprint-page').waitFor({ timeout: 25000 });
        await page.locator('.sprint-overview').waitFor({ timeout: 25000 });
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(200);

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
          const pageEl = document.querySelector('.sprint-page');
          const pageScroll = pageEl ? pageEl.scrollWidth : 0;
          const pageClient = pageEl ? pageEl.clientWidth : 0;

          // Find any elements exceeding viewport width
          const overflowing = [];
          document.querySelectorAll('.sprint-page *').forEach((el) => {
            const rect = el.getBoundingClientRect();
            if (rect.right > clientWidth + 1.5 && rect.width > 0) {
              const tag = el.tagName.toLowerCase();
              const cls =
                el.className && typeof el.className === 'string' ? el.className.trim() : '';
              overflowing.push({
                tag,
                cls,
                right: Math.round(rect.right),
                width: Math.round(rect.width),
              });
            }
          });

          // Check touch targets (buttons, links, inputs)
          const smallTouchTargets = [];
          document
            .querySelectorAll(
              '.sprint-page button, .sprint-page a, .sprint-page input, .sprint-page select, .sprint-page summary',
            )
            .forEach((el) => {
              const rect = el.getBoundingClientRect();
              if (rect.width > 0 && rect.height > 0) {
                if (
                  rect.height < 32 ||
                  (rect.height < 36 &&
                    !el.classList.contains('inline-link') &&
                    !el.classList.contains('task-check'))
                ) {
                  const text = (el.textContent || '').trim().slice(0, 30);
                  const cls = typeof el.className === 'string' ? el.className : '';
                  smallTouchTargets.push({
                    tag: el.tagName.toLowerCase(),
                    cls,
                    text,
                    height: Math.round(rect.height),
                    width: Math.round(rect.width),
                  });
                }
              }
            });

          // Measure key section layout details
          const overviewBox = document.querySelector('.sprint-overview')?.getBoundingClientRect();
          const rhythmBox = document.querySelector('.rhythm-panel')?.getBoundingClientRect();
          const metricGridBox = document.querySelector('.metric-grid')?.getBoundingClientRect();
          const taskFiltersBox = document.querySelector('.task-filters')?.getBoundingClientRect();

          return {
            scrollWidth,
            clientWidth,
            pageScroll,
            pageClient,
            hasHorizontalOverflow: scrollWidth > clientWidth + 1 || pageScroll > pageClient + 1,
            overflowingElements: overflowing.slice(0, 5),
            smallTouchTargets: smallTouchTargets.slice(0, 5),
            totalSmallTouchTargets: smallTouchTargets.length,
            overviewWidth: overviewBox ? Math.round(overviewBox.width) : null,
            rhythmWidth: rhythmBox ? Math.round(rhythmBox.width) : null,
            metricGridWidth: metricGridBox ? Math.round(metricGridBox.width) : null,
            taskFiltersWidth: taskFiltersBox ? Math.round(taskFiltersBox.width) : null,
          };
        });

        // Screenshot
        const screenshotName = `${theme}-${vp.name}.png`;
        const screenshotPath = path.join(matrixDir, screenshotName);
        await page.screenshot({ path: screenshotPath, fullPage: true });

        const cellResult = {
          viewport: vp.name,
          category: vp.category,
          width: vp.width,
          height: vp.height,
          theme,
          pass: !measurement.hasHorizontalOverflow && pageErrors.length === 0,
          hasHorizontalOverflow: measurement.hasHorizontalOverflow,
          pageErrors,
          measurement,
          screenshot: screenshotName,
        };

        auditReport.matrixResults.push(cellResult);
        if (measurement.hasHorizontalOverflow) {
          auditReport.overflowDefects.push({
            viewport: vp.name,
            theme,
            overflowingElements: measurement.overflowingElements,
          });
        }
        if (measurement.totalSmallTouchTargets > 0) {
          auditReport.touchTargetDefects.push({
            viewport: vp.name,
            theme,
            count: measurement.totalSmallTouchTargets,
            samples: measurement.smallTouchTargets,
          });
        }

        console.log(
          `  [${vp.name}] ${theme.toUpperCase()} -> ${cellResult.pass ? 'PASS' : 'FAIL'} (scroll: ${measurement.scrollWidth}px / client: ${measurement.clientWidth}px, overflow elements: ${measurement.overflowingElements.length})`,
        );
        await context.close();
      }
    }

    // 2. Specialized Scenarios & UI States across Representative Viewports
    const scenarioViewports = [
      { name: 'mobile-320', width: 320, height: 640 },
      { name: 'mobile-375', width: 375, height: 667 },
      { name: 'tablet-768', width: 768, height: 1024 },
      { name: 'desktop-1440', width: 1440, height: 900 },
    ];

    console.log(`\n--- Running Targeted UI Scenarios & States ---`);

    // Scenario 1: Calendar Settings Open
    console.log(`\nScenario 1: Calendar Settings Open`);
    for (const svp of scenarioViewports) {
      const context = await initPageContext(browser, {
        width: svp.width,
        height: svp.height,
        theme: 'dark',
      });
      const page = await context.newPage();
      await attachDefaultRoutes(page, 'normal');
      await page.goto(`${base}/app/career-sprint`);
      await page.locator('.sprint-page').waitFor({ timeout: 10000 });

      // Click "Calendar settings"
      await page.getByRole('button', { name: 'Calendar settings' }).click();
      await page.locator('#sprint-settings').waitFor({ timeout: 5000 });
      await page.waitForTimeout(200);

      const ofCheck = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: window.innerWidth,
        pass: document.documentElement.scrollWidth <= window.innerWidth,
      }));
      const scName = `scenario-settings-${svp.name}.png`;
      await page.screenshot({ path: path.join(scenariosDir, scName), fullPage: true });
      auditReport.scenarioChecks[`settings_${svp.name}`] = {
        pass: ofCheck.pass,
        ...ofCheck,
        screenshot: scName,
      };
      console.log(
        `  -> ${svp.name}: ${ofCheck.pass ? 'PASS' : 'FAIL'} (${ofCheck.scrollWidth}px / ${ofCheck.clientWidth}px)`,
      );
      await context.close();
    }

    // Scenario 2: Create Sprint Drawer Open
    console.log(`\nScenario 2: Create Sprint Drawer Open`);
    for (const svp of scenarioViewports) {
      const context = await initPageContext(browser, {
        width: svp.width,
        height: svp.height,
        theme: 'dark',
      });
      const page = await context.newPage();
      await attachDefaultRoutes(page, 'normal');
      await page.goto(`${base}/app/career-sprint`);
      await page.locator('.sprint-page').waitFor({ timeout: 10000 });

      // Click "+ New Sprint"
      await page.getByRole('button', { name: '+ New Sprint' }).click();
      await page.locator('#new-sprint').waitFor({ timeout: 5000 });
      await page.waitForTimeout(200);

      const ofCheck = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: window.innerWidth,
        pass: document.documentElement.scrollWidth <= window.innerWidth,
      }));
      const scName = `scenario-new-sprint-${svp.name}.png`;
      await page.screenshot({ path: path.join(scenariosDir, scName), fullPage: true });
      auditReport.scenarioChecks[`new_sprint_${svp.name}`] = {
        pass: ofCheck.pass,
        ...ofCheck,
        screenshot: scName,
      };
      console.log(
        `  -> ${svp.name}: ${ofCheck.pass ? 'PASS' : 'FAIL'} (${ofCheck.scrollWidth}px / ${ofCheck.clientWidth}px)`,
      );
      await context.close();
    }

    // Scenario 3: Task Editor Drawer Open
    console.log(`\nScenario 3: Task Editor Drawer Open`);
    for (const svp of scenarioViewports) {
      const context = await initPageContext(browser, {
        width: svp.width,
        height: svp.height,
        theme: 'dark',
      });
      const page = await context.newPage();
      await attachDefaultRoutes(page, 'normal');
      await page.goto(`${base}/app/career-sprint`);
      await page.locator('.sprint-page').waitFor({ timeout: 10000 });

      // Click "+ Add task"
      await page.getByRole('button', { name: '+ Add task' }).first().click();
      await page.locator('app-sprint-task-editor').waitFor({ timeout: 5000 });
      await page.waitForTimeout(200);

      const ofCheck = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: window.innerWidth,
        pass: document.documentElement.scrollWidth <= window.innerWidth,
      }));
      const scName = `scenario-task-editor-${svp.name}.png`;
      await page.screenshot({ path: path.join(scenariosDir, scName), fullPage: true });
      auditReport.scenarioChecks[`task_editor_${svp.name}`] = {
        pass: ofCheck.pass,
        ...ofCheck,
        screenshot: scName,
      };
      console.log(
        `  -> ${svp.name}: ${ofCheck.pass ? 'PASS' : 'FAIL'} (${ofCheck.scrollWidth}px / ${ofCheck.clientWidth}px)`,
      );
      await context.close();
    }

    // Scenario 4: Sprint Studio View
    console.log(`\nScenario 4: Sprint Studio View`);
    for (const svp of scenarioViewports) {
      const context = await initPageContext(browser, {
        width: svp.width,
        height: svp.height,
        theme: 'dark',
      });
      const page = await context.newPage();
      await attachDefaultRoutes(page, 'normal');
      await page.goto(`${base}/app/career-sprint`);
      await page.locator('.sprint-page').waitFor({ timeout: 10000 });

      // Click "Sprint studio" nav button
      await page.locator('.workspace-nav button:has-text("Sprint studio")').click();
      await page.locator('app-sprint-planner').waitFor({ timeout: 5000 });
      await page.waitForTimeout(200);

      const ofCheck = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: window.innerWidth,
        pass: document.documentElement.scrollWidth <= window.innerWidth,
      }));
      const scName = `scenario-sprint-studio-${svp.name}.png`;
      await page.screenshot({ path: path.join(scenariosDir, scName), fullPage: true });
      auditReport.scenarioChecks[`sprint_studio_${svp.name}`] = {
        pass: ofCheck.pass,
        ...ofCheck,
        screenshot: scName,
      };
      console.log(
        `  -> ${svp.name}: ${ofCheck.pass ? 'PASS' : 'FAIL'} (${ofCheck.scrollWidth}px / ${ofCheck.clientWidth}px)`,
      );
      await context.close();
    }

    // Scenario 5: Sprint History View
    console.log(`\nScenario 5: Sprint History View`);
    for (const svp of scenarioViewports) {
      const context = await initPageContext(browser, {
        width: svp.width,
        height: svp.height,
        theme: 'dark',
      });
      const page = await context.newPage();
      await attachDefaultRoutes(page, 'normal');
      await page.goto(`${base}/app/career-sprint`);
      await page.locator('.sprint-page').waitFor({ timeout: 10000 });

      // Click "Sprint history" nav button
      await page.locator('.workspace-nav button:has-text("Sprint history")').click();
      await page.locator('.history-list').waitFor({ timeout: 5000 });
      // Open the first details element
      await page.locator('.history-entry summary').first().click();
      await page.waitForTimeout(200);

      const ofCheck = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: window.innerWidth,
        pass: document.documentElement.scrollWidth <= window.innerWidth,
      }));
      const scName = `scenario-history-${svp.name}.png`;
      await page.screenshot({ path: path.join(scenariosDir, scName), fullPage: true });
      auditReport.scenarioChecks[`history_${svp.name}`] = {
        pass: ofCheck.pass,
        ...ofCheck,
        screenshot: scName,
      };
      console.log(
        `  -> ${svp.name}: ${ofCheck.pass ? 'PASS' : 'FAIL'} (${ofCheck.scrollWidth}px / ${ofCheck.clientWidth}px)`,
      );
      await context.close();
    }

    // Scenario 6: Read-only Legacy Sprint State
    console.log(`\nScenario 6: Read-Only Legacy Sprint State`);
    for (const svp of scenarioViewports) {
      const context = await initPageContext(browser, {
        width: svp.width,
        height: svp.height,
        theme: 'dark',
      });
      const page = await context.newPage();
      await attachDefaultRoutes(page, 'legacy');
      await page.goto(`${base}/app/career-sprint`);
      await page.locator('.legacy-notice').waitFor({ timeout: 10000 });
      await page.waitForTimeout(200);

      const ofCheck = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: window.innerWidth,
        pass: document.documentElement.scrollWidth <= window.innerWidth,
      }));
      const scName = `scenario-legacy-readonly-${svp.name}.png`;
      await page.screenshot({ path: path.join(scenariosDir, scName), fullPage: true });
      auditReport.scenarioChecks[`legacy_${svp.name}`] = {
        pass: ofCheck.pass,
        ...ofCheck,
        screenshot: scName,
      };
      console.log(
        `  -> ${svp.name}: ${ofCheck.pass ? 'PASS' : 'FAIL'} (${ofCheck.scrollWidth}px / ${ofCheck.clientWidth}px)`,
      );
      await context.close();
    }

    // Scenario 7: Empty Sprint State
    console.log(`\nScenario 7: Empty Sprint State`);
    for (const svp of scenarioViewports) {
      const context = await initPageContext(browser, {
        width: svp.width,
        height: svp.height,
        theme: 'dark',
      });
      const page = await context.newPage();
      await attachDefaultRoutes(page, 'empty');
      await page.goto(`${base}/app/career-sprint`);
      await page.locator('.empty-state').waitFor({ timeout: 10000 });
      await page.waitForTimeout(200);

      const ofCheck = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: window.innerWidth,
        pass: document.documentElement.scrollWidth <= window.innerWidth,
      }));
      const scName = `scenario-empty-${svp.name}.png`;
      await page.screenshot({ path: path.join(scenariosDir, scName), fullPage: true });
      auditReport.scenarioChecks[`empty_${svp.name}`] = {
        pass: ofCheck.pass,
        ...ofCheck,
        screenshot: scName,
      };
      console.log(
        `  -> ${svp.name}: ${ofCheck.pass ? 'PASS' : 'FAIL'} (${ofCheck.scrollWidth}px / ${ofCheck.clientWidth}px)`,
      );
      await context.close();
    }

    // Scenario 8: Error / Reconnect State
    console.log(`\nScenario 8: Error / Reconnect State`);
    for (const svp of scenarioViewports) {
      const context = await initPageContext(browser, {
        width: svp.width,
        height: svp.height,
        theme: 'dark',
      });
      const page = await context.newPage();
      await attachDefaultRoutes(page, 'unavailable');
      await page.goto(`${base}/app/career-sprint`);
      await page.locator('.notice.error').waitFor({ timeout: 10000 });
      await page.waitForTimeout(200);

      const ofCheck = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: window.innerWidth,
        pass: document.documentElement.scrollWidth <= window.innerWidth,
      }));
      const scName = `scenario-error-${svp.name}.png`;
      await page.screenshot({ path: path.join(scenariosDir, scName), fullPage: true });
      auditReport.scenarioChecks[`error_${svp.name}`] = {
        pass: ofCheck.pass,
        ...ofCheck,
        screenshot: scName,
      };
      console.log(
        `  -> ${svp.name}: ${ofCheck.pass ? 'PASS' : 'FAIL'} (${ofCheck.scrollWidth}px / ${ofCheck.clientWidth}px)`,
      );
      await context.close();
    }

    // Scenario 9: Streak Recovery Panel
    console.log(`\nScenario 9: Streak Recovery Panel`);
    for (const svp of scenarioViewports) {
      const context = await initPageContext(browser, {
        width: svp.width,
        height: svp.height,
        theme: 'dark',
      });
      const page = await context.newPage();
      await attachDefaultRoutes(page, 'restore');
      await page.goto(`${base}/app/career-sprint`);
      await page.locator('.restore-panel').waitFor({ timeout: 10000 });
      await page.waitForTimeout(200);

      const ofCheck = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: window.innerWidth,
        pass: document.documentElement.scrollWidth <= window.innerWidth,
      }));
      const scName = `scenario-restore-${svp.name}.png`;
      await page.screenshot({ path: path.join(scenariosDir, scName), fullPage: true });
      auditReport.scenarioChecks[`restore_${svp.name}`] = {
        pass: ofCheck.pass,
        ...ofCheck,
        screenshot: scName,
      };
      console.log(
        `  -> ${svp.name}: ${ofCheck.pass ? 'PASS' : 'FAIL'} (${ofCheck.scrollWidth}px / ${ofCheck.clientWidth}px)`,
      );
      await context.close();
    }

    // Scenario 10: Orientations (Mobile & Tablet Landscape)
    console.log(`\nScenario 10: Landscape Orientations`);
    const landscapeViewports = [
      { name: 'mobile-landscape-667x375', width: 667, height: 375 },
      { name: 'mobile-landscape-844x390', width: 844, height: 390 },
      { name: 'tablet-landscape-1024x768', width: 1024, height: 768 },
    ];
    for (const lvp of landscapeViewports) {
      const context = await initPageContext(browser, {
        width: lvp.width,
        height: lvp.height,
        theme: 'dark',
      });
      const page = await context.newPage();
      await attachDefaultRoutes(page, 'normal');
      await page.goto(`${base}/app/career-sprint`);
      await page.locator('.sprint-page').waitFor({ timeout: 10000 });
      await page.waitForTimeout(200);

      const ofCheck = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: window.innerWidth,
        pass: document.documentElement.scrollWidth <= window.innerWidth,
      }));
      const scName = `scenario-orientation-${lvp.name}.png`;
      await page.screenshot({ path: path.join(scenariosDir, scName), fullPage: true });
      auditReport.scenarioChecks[`orientation_${lvp.name}`] = {
        pass: ofCheck.pass,
        ...ofCheck,
        screenshot: scName,
      };
      console.log(
        `  -> ${lvp.name}: ${ofCheck.pass ? 'PASS' : 'FAIL'} (${ofCheck.scrollWidth}px / ${ofCheck.clientWidth}px)`,
      );
      await context.close();
    }

    // Scenario 11: Browser Zoom Reflow (125%, 150%, 175%, 200%)
    console.log(`\nScenario 11: Browser Zoom Reflow`);
    const zoomLevels = [1.25, 1.5, 1.75, 2.0];
    for (const zoom of zoomLevels) {
      const vpWidth = Math.round(1280 / zoom);
      const vpHeight = Math.round(800 / zoom);
      const context = await initPageContext(browser, {
        width: vpWidth,
        height: vpHeight,
        theme: 'dark',
      });
      const page = await context.newPage();
      await attachDefaultRoutes(page, 'normal');
      await page.goto(`${base}/app/career-sprint`);
      await page.locator('.sprint-page').waitFor({ timeout: 10000 });
      await page.waitForTimeout(200);

      const ofCheck = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: window.innerWidth,
        pass: document.documentElement.scrollWidth <= window.innerWidth,
      }));
      const scName = `scenario-zoom-${Math.round(zoom * 100)}.png`;
      await page.screenshot({ path: path.join(scenariosDir, scName), fullPage: true });
      auditReport.scenarioChecks[`zoom_${Math.round(zoom * 100)}`] = {
        pass: ofCheck.pass,
        ...ofCheck,
        screenshot: scName,
      };
      console.log(
        `  -> Zoom ${Math.round(zoom * 100)}% (effective vp ${vpWidth}px): ${ofCheck.pass ? 'PASS' : 'FAIL'} (${ofCheck.scrollWidth}px / ${ofCheck.clientWidth}px)`,
      );
      await context.close();
    }

    // Scenario 12: Keyboard Navigation & Focus Ring
    console.log(`\nScenario 12: Keyboard Navigation & Focus Rings`);
    {
      const context = await initPageContext(browser, { width: 1440, height: 900, theme: 'dark' });
      const page = await context.newPage();
      await attachDefaultRoutes(page, 'normal');
      await page.goto(`${base}/app/career-sprint`);
      await page.locator('.sprint-page').waitFor({ timeout: 10000 });

      // Tab through elements
      for (let i = 0; i < 6; i++) {
        await page.keyboard.press('Tab');
      }
      await page.waitForTimeout(150);

      const focusedTag = await page.evaluate(() => document.activeElement?.tagName.toLowerCase());
      const scName = `scenario-keyboard-focus.png`;
      await page.screenshot({ path: path.join(scenariosDir, scName) });
      auditReport.scenarioChecks['keyboard_focus'] = {
        pass: !!focusedTag && focusedTag !== 'body',
        focusedTag,
        screenshot: scName,
      };
      console.log(`  -> Active element on Tab navigation: <${focusedTag}>`);
      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }

  // Save audit JSON report
  const reportPath = path.join(outputDir, `${phase}-results.json`);
  fs.writeFileSync(reportPath, JSON.stringify(auditReport, null, 2), 'utf8');
  console.log(`\nAudit completed! Report saved to ${reportPath}`);
}

main().catch((err) => {
  console.error('[audit-career-sprint-responsive] Fatal error:', err);
  process.exit(1);
});
