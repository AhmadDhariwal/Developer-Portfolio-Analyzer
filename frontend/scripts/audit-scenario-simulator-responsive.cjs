// Complete Responsive Design & Accessibility Audit for Scenario Simulator
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const assert = require('node:assert/strict');

const playwrightPath =
  process.env.PLAYWRIGHT_MODULE || 'C:/Users/ahmad.hassan/Desktop/Agrivio/node_modules/playwright';
const { chromium } = require(playwrightPath);

const phase = process.argv[2] || 'before';
const chromePath =
  process.env.ACCEPTANCE_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const dist = path.resolve(__dirname, '../dist/frontend/browser');
const outputDir = path.resolve(__dirname, '../verification/scenario-simulator/responsive-audit');
const screenshotsDir = path.join(outputDir, phase);
fs.mkdirSync(screenshotsDir, { recursive: true });

const root = path.resolve(__dirname, '../..');
const engine = require(path.join(root, 'backend/src/services/scoring/scenarioPlanningScore'));

const profile = {
  careerStack: 'Frontend',
  experienceLevel: 'Mid-level',
  githubUsername: 'fixture',
  isConfigured: true,
};

const contextFixture = {
  profile: {
    careerStack: 'Frontend',
    experienceLevel: 'Mid-level',
    githubUsername: 'fixture',
    role: 'frontend',
    level: 'mid',
    baselineHiringScore: 55,
    baselineJobMatch: 48,
  },
  sources: [
    {
      key: 'integrations',
      label: 'Integrations',
      connected: true,
      lastUpdatedAt: '2026-10-25T00:00:00Z',
    },
    {
      key: 'resume',
      label: 'Resume Analyzer',
      connected: true,
      lastUpdatedAt: '2026-10-24T00:00:00Z',
    },
    {
      key: 'github',
      label: 'GitHub Analyzer',
      connected: true,
      lastUpdatedAt: '2026-10-24T00:00:00Z',
    },
  ],
  signals: {
    knownSkills: ['JavaScript', 'HTML/CSS'],
    missingSkills: ['TypeScript', 'GraphQL', 'Next.js'],
    recommendationSkills: ['Testing', 'CI/CD'],
    sprintFocus: [],
    connectedProviders: ['github'],
    portfolioProjects: [],
    portfolioCandidates: [
      { name: 'Typed E-Commerce App', skills: ['TypeScript', 'Next.js'] },
    ],
    completedPortfolioProjects: [],
    topDemandedSkills: ['Angular', 'Docker', 'AWS'],
  },
  suggestedInputs: {
    role: 'frontend',
    experienceLevel: 'mid',
    baselineHiringScore: 55,
    baselineJobMatch: 48,
    durationWeeks: 6,
    skills: ['TypeScript', 'GraphQL'],
    projects: [
      { name: 'Typed E-Commerce App', impact: 75, complexity: 'medium', weeks: 3 },
    ],
  },
  summary: 'Live profile indicates solid Frontend foundations with growth opportunities in TypeScript and full-stack frameworks.',
};

const baseInput = {
  ...contextFixture.suggestedInputs,
  name: 'Frontend Growth Scenario',
  baselineConfirmed: true,
  baselineAuthority: 'user-assumption',
  ruleVersion: 'scenario-planning-v2',
};

const evaluatedFixture = engine.calculate(baseInput);

const savedScenarioFixture1 = {
  ...baseInput,
  _id: 'scenario-saved-1',
  name: 'Frontend + GraphQL Ramp-up',
  confidenceScore: evaluatedFixture.confidenceScore,
  predicted: evaluatedFixture.predicted,
  improvements: evaluatedFixture.improvements,
  result: evaluatedFixture,
  createdAt: '2026-10-20T10:00:00Z',
  scenarioHash: evaluatedFixture.scenarioHash,
};

const savedScenarioFixture2 = {
  role: 'full stack',
  experienceLevel: 'mid',
  durationWeeks: 8,
  skills: ['Node.js', 'PostgreSQL', 'Docker'],
  projects: [
    { name: 'Microservices API Gateway', impact: 85, complexity: 'high', weeks: 4 },
  ],
  baselineHiringScore: 50,
  baselineJobMatch: 45,
  baselineConfirmed: true,
  baselineAuthority: 'user-assumption',
  ruleVersion: 'scenario-planning-v2',
  _id: 'scenario-saved-2',
  name: 'Full Stack & Cloud Pivot',
  confidenceScore: 78,
  predicted: {
    hiringScore: 76,
    jobMatch: 72,
  },
  improvements: {
    hiringScore: 26,
    jobMatch: 27,
  },
  result: engine.calculate({
    role: 'full stack',
    experienceLevel: 'mid',
    durationWeeks: 8,
    skills: ['Node.js', 'PostgreSQL', 'Docker'],
    projects: [
      { name: 'Microservices API Gateway', impact: 85, complexity: 'high', weeks: 4 },
    ],
    baselineHiringScore: 50,
    baselineJobMatch: 45,
    baselineConfirmed: true,
    baselineAuthority: 'user-assumption',
    ruleVersion: 'scenario-planning-v2',
  }),
  createdAt: '2026-10-15T14:30:00Z',
  scenarioHash: 'f9a2b8e1',
};

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
    ({ themeVal, activeProfile }) => {
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
          activeGithubUsername: 'fixture',
        }),
      );
      localStorage.setItem('devinsight_theme', themeVal);
      localStorage.setItem(
        'devinsight_career_profile',
        JSON.stringify({
          ...activeProfile,
          ownerId: userId,
          isConfigured: true,
          activeGithubUsername: 'fixture',
        }),
      );
    },
    { themeVal: theme, activeProfile: profile },
  );

  return context;
}

function attachRoutes(page, overrides = {}) {
  let savedList = [savedScenarioFixture1, savedScenarioFixture2];

  return page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());

    if (url.pathname.includes('/notifications/stream')) {
      return route.fulfill({ contentType: 'text/event-stream', body: ': heartbeat\n\n' });
    }
    if (url.pathname.includes('/auth/me')) {
      return route.fulfill({
        json: { user: { _id: 'user-fixture', name: 'Fixture Developer', role: 'developer' } },
      });
    }
    if (url.pathname.includes('/profile/career') || (url.pathname.includes('/profile') && !url.pathname.includes('/profile/me'))) {
      return route.fulfill({
        json: {
          ...profile,
          ...contextFixture.profile,
          isConfigured: true,
        },
      });
    }
    if (overrides.handle && overrides.handle(url, route)) {
      return;
    }

    if (url.pathname.includes('/simulator/context')) {
      if (overrides.contextError) {
        return route.fulfill({ status: 500, json: { message: 'Failed to load scenario workspace data.' } });
      }
      return route.fulfill({
        json: {
          context: overrides.context || contextFixture,
          frontendCacheHit: false,
        },
      });
    }

    if (url.pathname.includes('/simulator/history')) {
      if (overrides.historyError) {
        return route.fulfill({ status: 500, json: { message: 'History could not be retrieved.' } });
      }
      return route.fulfill({
        json: {
          history: overrides.history || savedList,
          nextCursor: overrides.nextCursor || null,
          frontendCacheHit: false,
          cache: { hit: false },
        },
      });
    }

    if (url.pathname.includes('/simulator/what-if')) {
      const payload = route.request().postDataJSON();
      const calculated = engine.calculate(payload);
      return route.fulfill({
        json: {
          result: calculated,
        },
      });
    }

    if (url.pathname.includes('/simulator/save')) {
      const payload = route.request().postDataJSON();
      const newSaved = {
        ...payload,
        _id: 'scenario-new-' + Date.now(),
        createdAt: new Date().toISOString(),
        confidenceScore: payload.evaluation?.confidenceScore || 75,
        predicted: payload.evaluation?.predicted || { hiringScore: 70, jobMatch: 65 },
        improvements: payload.evaluation?.improvements || { hiringScore: 15, jobMatch: 17 },
        result: payload.evaluation || evaluatedFixture,
      };
      savedList = [newSaved, ...savedList];
      return route.fulfill({
        json: {
          scenario: newSaved,
        },
      });
    }

    if (url.pathname.includes('/simulator/sprint-draft')) {
      return route.fulfill({
        json: {
          message: 'Scenario sprint updated: 4 tasks created, 0 merged, 0 skipped.',
          sprint: { tasksCreated: 4, tasksMerged: 0, tasksSkipped: 0 },
        },
      });
    }

    if (route.request().method() === 'DELETE' && url.pathname.includes('/simulator/')) {
      const id = url.pathname.split('/').pop();
      savedList = savedList.filter((s) => s._id !== id);
      return route.fulfill({ json: { success: true } });
    }

    return route.fulfill({ json: { success: true } });
  });
}

async function measureOverflow(page) {
  return page.evaluate(() => {
    const docEl = document.documentElement;
    const body = document.body;
    const scrollWidth = Math.max(docEl.scrollWidth, body ? body.scrollWidth : 0);
    const clientWidth = docEl.clientWidth;
    const hasHorizontalOverflow = scrollWidth > clientWidth + 1;

    // Detect any wide element causing overflow
    const overflowingElements = [];
    if (hasHorizontalOverflow) {
      const all = document.querySelectorAll('*');
      for (const el of all) {
        const rect = el.getBoundingClientRect();
        if (rect.right > clientWidth + 2) {
          const cls = el.className ? String(el.className).slice(0, 50) : '';
          const tag = el.tagName.toLowerCase();
          overflowingElements.push({
            tag,
            class: cls,
            right: Math.round(rect.right),
            width: Math.round(rect.width),
            clientWidth,
          });
          if (overflowingElements.length >= 5) break;
        }
      }
    }

    return {
      scrollWidth,
      clientWidth,
      overflow: hasHorizontalOverflow,
      overflowingElements,
    };
  });
}

async function auditTouchTargets(page) {
  return page.evaluate(() => {
    const interactiveElements = document.querySelectorAll(
      'button, a, input, select, textarea, [role="button"], [tabindex]:not([tabindex="-1"])'
    );
    const issues = [];
    const minTargetSize = 32; // strict accessibility threshold (32px minimum, 44px recommended for touch)
    for (const el of interactiveElements) {
      if (el.offsetParent === null) continue; // invisible
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const computed = window.getComputedStyle(el);
      if (computed.visibility === 'hidden' || computed.display === 'none') continue;

      if (rect.height < minTargetSize || rect.width < minTargetSize) {
        issues.push({
          tag: el.tagName.toLowerCase(),
          text: (el.innerText || el.getAttribute('aria-label') || el.id || '').trim().slice(0, 30),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          className: String(el.className || '').slice(0, 40),
        });
      }
    }
    return issues;
  });
}

async function run() {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}/app/scenario-simulator`;
  console.log(`[audit-scenario-simulator] Server listening at ${baseUrl}`);

  const browser = await chromium.launch({
    headless: true,
    executablePath: chromePath,
  });

  const auditReport = {
    module: 'Scenario Simulator',
    phase,
    timestamp: new Date().toISOString(),
    viewportsTested: VIEWPORTS.length,
    themesTested: THEMES.length,
    matrixResults: [],
    stateChecks: {},
    overflowDefects: [],
    touchTargetDefects: [],
    modalChecks: {},
    compareChecks: {},
  };

  try {
    console.log(`\n--- PHASE 1: CORE VIEWPORT & THEME MATRIX (36 executions) ---`);
    for (const vp of VIEWPORTS) {
      for (const theme of THEMES) {
        const testId = `${vp.name}-${theme}`;
        process.stdout.write(`Testing ${testId} ... `);

        const context = await initPageContext(browser, {
          width: vp.width,
          height: vp.height,
          theme,
        });
        const page = await context.newPage();
        await attachRoutes(page);

        await page.goto(baseUrl, { waitUntil: 'networkidle' });
        await page.locator('#targetRole').waitFor({ state: 'visible', timeout: 10000 });

        // Ensure sidebar toggle state appropriate for viewport
        const toggle = page.getByRole('button', { name: 'Toggle sidebar', exact: true });
        if (await toggle.count()) {
          const desired = vp.width > 768 ? 'true' : 'false';
          const expanded = await toggle.getAttribute('aria-expanded');
          if (expanded !== desired) {
            await toggle.click();
            await page.waitForTimeout(300);
          }
        }

        // Measure unsimulated / draft overflow
        const draftOverflow = await measureOverflow(page);

        // Take unsimulated screenshot for key viewports
        if (theme === 'dark' || vp.width === 375 || vp.width === 1440) {
          await page.screenshot({
            path: path.join(screenshotsDir, `${testId}-draft.png`),
            fullPage: false,
          });
        }

        // Run simulation to test result state
        const baselineCheck = page.locator('.baseline-consent-card input');
        if (await baselineCheck.count()) {
          await baselineCheck.check();
        }
        const runBtn = page.locator('.input-panel .run-btn');
        await runBtn.click();
        await page.locator('.result-top-grid').waitFor({ state: 'visible', timeout: 5000 });

        const resultOverflow = await measureOverflow(page);
        const touchIssues = await auditTouchTargets(page);

        // Screenshot full page result
        await page.screenshot({
          path: path.join(screenshotsDir, `${testId}-result.png`),
          fullPage: true,
        });

        const hasOverflow = draftOverflow.overflow || resultOverflow.overflow;
        if (hasOverflow) {
          auditReport.overflowDefects.push({
            testId,
            viewport: vp,
            theme,
            draft: draftOverflow,
            result: resultOverflow,
          });
          console.log(`FAILED (Overflow: draft ${draftOverflow.scrollWidth}px vs ${draftOverflow.clientWidth}px, result ${resultOverflow.scrollWidth}px vs ${resultOverflow.clientWidth}px)`);
        } else {
          console.log(`PASSED (0 overflow)`);
        }

        if (touchIssues.length > 0) {
          auditReport.touchTargetDefects.push({
            testId,
            count: touchIssues.length,
            issues: touchIssues.slice(0, 3),
          });
        }

        auditReport.matrixResults.push({
          name: vp.name,
          category: vp.category,
          dimensions: `${vp.width}x${vp.height}`,
          theme,
          passed: !hasOverflow,
          draftScrollWidth: draftOverflow.scrollWidth,
          draftClientWidth: draftOverflow.clientWidth,
          resultScrollWidth: resultOverflow.scrollWidth,
          resultClientWidth: resultOverflow.clientWidth,
          touchIssuesCount: touchIssues.length,
        });

        await context.close();
      }
    }

    console.log(`\n--- PHASE 2: TABS & PERSPECTIVE VIEWS AUDIT ---`);
    for (const testWidth of [375, 768, 1440]) {
      const context = await initPageContext(browser, { width: testWidth, height: 900, theme: 'dark' });
      const page = await context.newPage();
      await attachRoutes(page);
      await page.goto(baseUrl, { waitUntil: 'networkidle' });
      await page.locator('.baseline-consent-card input').check();
      await page.locator('.input-panel .run-btn').click();
      await page.locator('.result-top-grid').waitFor({ state: 'visible' });

      // Tab 1: Overview
      const tab1Overflow = await measureOverflow(page);
      await page.screenshot({
        path: path.join(screenshotsDir, `tab-overview-${testWidth}.png`),
        fullPage: true,
      });

      // Tab 2: Breakdown
      await page.locator('#dossierTab-breakdown').click();
      await page.waitForTimeout(300);
      const tab2Overflow = await measureOverflow(page);
      await page.screenshot({
        path: path.join(screenshotsDir, `tab-breakdown-${testWidth}.png`),
        fullPage: true,
      });

      // Tab 3: Roadmap
      await page.locator('#dossierTab-roadmap').click();
      await page.waitForTimeout(300);
      const tab3Overflow = await measureOverflow(page);
      await page.screenshot({
        path: path.join(screenshotsDir, `tab-roadmap-${testWidth}.png`),
        fullPage: true,
      });

      auditReport.stateChecks[`tabs-${testWidth}`] = {
        tab1Overflow: tab1Overflow.overflow,
        tab2Overflow: tab2Overflow.overflow,
        tab3Overflow: tab3Overflow.overflow,
      };
      await context.close();
    }

    console.log(`\n--- PHASE 3: SCENARIO TEMPLATE CONFIGURATOR MODAL AUDIT ---`);
    for (const testWidth of [320, 375, 768, 1440]) {
      const context = await initPageContext(browser, { width: testWidth, height: 800, theme: 'dark' });
      const page = await context.newPage();
      await attachRoutes(page);
      await page.goto(baseUrl, { waitUntil: 'networkidle' });

      // Click the first template card to open modal dialog
      const firstTemplate = page.locator('.template-card').first();
      await firstTemplate.waitFor({ state: 'visible' });
      await firstTemplate.click();

      const dialog = page.locator('app-scenario-template-configurator dialog');
      await dialog.waitFor({ state: 'visible', timeout: 5000 });
      await page.waitForTimeout(300);

      const modalOverflow = await measureOverflow(page);
      const dialogBox = await dialog.boundingBox();
      const modalTouchIssues = await auditTouchTargets(page);

      await page.screenshot({
        path: path.join(screenshotsDir, `modal-template-${testWidth}.png`),
        fullPage: true,
      });

      auditReport.modalChecks[`modal-${testWidth}`] = {
        overflow: modalOverflow.overflow,
        dialogWidth: dialogBox?.width,
        dialogHeight: dialogBox?.height,
        viewportWidth: testWidth,
        touchIssues: modalTouchIssues.length,
      };

      // Test cancel button
      const cancelBtn = dialog.locator('footer button', { hasText: 'Cancel' });
      await cancelBtn.click();
      await page.waitForTimeout(200);

      await context.close();
    }

    console.log(`\n--- PHASE 4: SCENARIO COMPARISON MATRIX AUDIT ---`);
    for (const testWidth of [320, 375, 768, 1440]) {
      const context = await initPageContext(browser, { width: testWidth, height: 900, theme: 'dark' });
      const page = await context.newPage();
      await attachRoutes(page);
      await page.goto(baseUrl, { waitUntil: 'networkidle' });

      // If screen <= 980px, history is collapsed by default; expand it
      if (testWidth <= 980) {
        const historyToggle = page.getByRole('button', { name: 'Toggle history panel' });
        if (await historyToggle.count()) {
          const isExpanded = await page.evaluate(() => {
            const sec = document.querySelector('.history-section');
            return sec && !sec.classList.contains('mobile-collapsed');
          });
          if (!isExpanded) {
            await historyToggle.click();
            await page.waitForTimeout(300);
          }
        }
      }

      // Click Compare on the first history card
      const compareBtn = page.locator('.action-btn-compare').first();
      await compareBtn.waitFor({ state: 'visible' });
      await compareBtn.click();

      const compareCard = page.locator('.comparison-card');
      await compareCard.waitFor({ state: 'visible', timeout: 5000 });
      await page.waitForTimeout(300);

      const compareOverflow = await measureOverflow(page);
      await page.screenshot({
        path: path.join(screenshotsDir, `compare-matrix-${testWidth}.png`),
        fullPage: true,
      });

      auditReport.compareChecks[`compare-${testWidth}`] = {
        overflow: compareOverflow.overflow,
        scrollWidth: compareOverflow.scrollWidth,
        clientWidth: compareOverflow.clientWidth,
      };

      await context.close();
    }

    console.log(`\n--- PHASE 5: HOW IT WORKS GUIDE & ERROR / DEGRADED STATES AUDIT ---`);
    {
      const context = await initPageContext(browser, { width: 375, height: 800, theme: 'dark' });
      const page = await context.newPage();
      await attachRoutes(page);
      await page.goto(baseUrl, { waitUntil: 'networkidle' });

      // Open How It Works guide
      const guideBtn = page.getByRole('button', { name: 'Toggle assumptions guide' });
      await guideBtn.click();
      await page.locator('.info-panel').waitFor({ state: 'visible' });
      const guideOverflow = await measureOverflow(page);
      await page.screenshot({
        path: path.join(screenshotsDir, `info-guide-375.png`),
        fullPage: false,
      });

      auditReport.stateChecks['info-guide-375'] = { overflow: guideOverflow.overflow };
      await context.close();
    }

    // Error and degraded state
    {
      const context = await initPageContext(browser, { width: 375, height: 800, theme: 'dark' });
      const page = await context.newPage();
      await attachRoutes(page, {
        context: { ...contextFixture, degraded: true },
        historyError: true,
      });
      await page.goto(baseUrl, { waitUntil: 'networkidle' });
      await page.waitForTimeout(500);

      const degradedOverflow = await measureOverflow(page);
      await page.screenshot({
        path: path.join(screenshotsDir, `degraded-error-375.png`),
        fullPage: false,
      });

      auditReport.stateChecks['degraded-error-375'] = { overflow: degradedOverflow.overflow };
      await context.close();
    }

    // Write final JSON summary
    const jsonPath = path.join(outputDir, `audit-results-${phase}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify(auditReport, null, 2));
    console.log(`\nAudit complete! Report written to ${jsonPath}`);
    console.log(`Total overflow defects discovered: ${auditReport.overflowDefects.length}`);
    console.log(`Total touch target defect groups: ${auditReport.touchTargetDefects.length}`);

  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

run().catch((err) => {
  console.error('Audit failed with error:', err);
  process.exitCode = 1;
});
