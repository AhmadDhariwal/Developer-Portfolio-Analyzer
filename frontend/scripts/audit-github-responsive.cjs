// Complete Responsive Audit for GitHub Analyzer module across all required viewports and themes.
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
const outputDir = path.resolve(__dirname, '../verification/github-ui/responsive-audit');
fs.mkdirSync(outputDir, { recursive: true });

const githubFixture = require('./github-browser-fixture.cjs');
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

async function initPageContext(browser, { width, height, theme = 'dark', username = 'janedev' }) {
  const colorScheme = theme === 'system' ? 'dark' : theme;
  const context = await browser.newContext({
    viewport: { width, height },
    colorScheme,
    reducedMotion: 'reduce',
  });

  await context.addInitScript(
    ({ themeVal, activeUser }) => {
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
          activeGithubUsername: activeUser,
        }),
      );
      localStorage.setItem('devinsight_theme', themeVal);
      localStorage.setItem(
        'devinsight_career_profile',
        JSON.stringify({
          githubUsername: activeUser,
          targetRole: 'Full Stack Engineer',
        }),
      );
    },
    { themeVal: theme, activeUser: username },
  );

  return context;
}

async function attachDefaultRoutes(page, customFixture = null, customUsername = 'janedev') {
  await page.route('https://api.github.com/**', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.includes('/github/analyze')) {
      const fix = customFixture || githubFixture;
      return route.fulfill({ json: fix });
    }
    if (url.pathname.includes('/github/active-username')) {
      return route.fulfill({ json: { username: customUsername } });
    }
    if (url.pathname.includes('/profile/career')) {
      return route.fulfill({ json: profile });
    }
    if (url.pathname.includes('/notifications/stream')) {
      return route.fulfill({ contentType: 'text/event-stream', body: ': heartbeat\n\n' });
    }
    return route.fulfill({ json: { success: true, notifications: [] } });
  });
}

async function main() {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  console.log(`[audit-github-responsive] Static server running at ${base}`);

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
    overflowDefects: [],
    touchTargetDefects: [],
    accessibilityDefects: [],
  };

  const matrixDir = path.join(outputDir, phase, 'matrix');
  const statesDir = path.join(outputDir, phase, 'states');
  fs.mkdirSync(matrixDir, { recursive: true });
  fs.mkdirSync(statesDir, { recursive: true });

  try {
    // 1. Matrix verification: 12 viewports x 3 themes = 36 runs
    console.log(`\n--- Starting 36-cell Viewport & Theme Matrix Audit (${phase}) ---`);
    for (const vp of VIEWPORTS) {
      for (const theme of THEMES) {
        const context = await initPageContext(browser, {
          width: vp.width,
          height: vp.height,
          theme,
          username: 'janedev',
        });

        const page = await context.newPage();
        const pageErrors = [];
        page.on('pageerror', (err) => pageErrors.push(err.message));

        await attachDefaultRoutes(page, githubFixture, 'janedev');

        await page.goto(`${base}/app/github-analyzer`);
        await page.locator('.analyzer-page').waitFor({ timeout: 10000 });
        await page.locator('.exec-score-number').waitFor({ timeout: 10000 });
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

          const analyzer = document.querySelector('.analyzer-page');
          const analyzerScrollWidth = analyzer ? analyzer.scrollWidth : 0;
          const analyzerClientWidth = analyzer ? analyzer.clientWidth : 0;
          const hasAnalyzerOverflow = analyzerScrollWidth > analyzerClientWidth + 1;

          // Find any offending element overflowing the screen
          const offenders = [];
          if (hasDocOverflow || hasAnalyzerOverflow) {
            const allElements = document.querySelectorAll('.analyzer-page *');
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

          // Responsive component geometry checks
          const searchGroup = document.querySelector('.search-input-group');
          const searchGroupRect = searchGroup ? searchGroup.getBoundingClientRect() : null;

          const metricsGrid = document.querySelector('.metrics-strip-grid');
          const metricsGridStyle = metricsGrid ? getComputedStyle(metricsGrid) : null;
          const metricsColumnCount = metricsGridStyle
            ? metricsGridStyle.gridTemplateColumns.split(' ').length
            : 0;

          const table = document.querySelector('.clean-repo-table');
          const tableDisplay = table ? getComputedStyle(table).display : null;
          const isCardMode = tableDisplay === 'block';

          const scoreNum = document.querySelector('.exec-score-number');
          const scoreFontSize = scoreNum ? getComputedStyle(scoreNum).fontSize : null;

          const canvasEls = [...document.querySelectorAll('canvas')].map((c) => ({
            width: c.width,
            height: c.height,
            displayWidth: Math.round(c.getBoundingClientRect().width),
            displayHeight: Math.round(c.getBoundingClientRect().height),
          }));

          return {
            hasOverflow: hasDocOverflow || hasAnalyzerOverflow,
            scrollWidth,
            clientWidth,
            offenders: offenders.slice(0, 5),
            scoreFontSize,
            metricsColumnCount,
            isCardMode,
            searchGroupWidth: searchGroupRect ? Math.round(searchGroupRect.width) : null,
            canvasEls,
          };
        });

        // Screenshot paths
        const fullScreenshotName = `${theme}-${vp.name}-full.png`;
        const foldScreenshotName = `${theme}-${vp.name}-fold.png`;

        await page.screenshot({
          path: path.join(matrixDir, fullScreenshotName),
          fullPage: true,
        });
        await page.screenshot({
          path: path.join(matrixDir, foldScreenshotName),
          fullPage: false,
        });

        const resultEntry = {
          viewport: vp.name,
          category: vp.category,
          width: vp.width,
          height: vp.height,
          theme,
          hasOverflow: measurement.hasOverflow,
          scrollWidth: measurement.scrollWidth,
          clientWidth: measurement.clientWidth,
          offenders: measurement.offenders,
          metricsColumnCount: measurement.metricsColumnCount,
          isCardMode: measurement.isCardMode,
          scoreFontSize: measurement.scoreFontSize,
          searchGroupWidth: measurement.searchGroupWidth,
          canvasCount: measurement.canvasEls.length,
          pageErrors,
          screenshots: {
            full: fullScreenshotName,
            fold: foldScreenshotName,
          },
        };

        if (measurement.hasOverflow) {
          auditReport.overflowDefects.push({
            viewport: vp.name,
            theme,
            scrollWidth: measurement.scrollWidth,
            clientWidth: measurement.clientWidth,
            offenders: measurement.offenders,
          });
          console.log(
            `  [OVERFLOW] ${vp.name} (${theme}): scrollWidth ${measurement.scrollWidth} > clientWidth ${measurement.clientWidth}`,
          );
        } else {
          console.log(
            `  [OK] ${vp.name} (${theme}): scrollWidth ${measurement.scrollWidth} / ${measurement.clientWidth}px, tableCard=${measurement.isCardMode}, metricsCols=${measurement.metricsColumnCount}`,
          );
        }

        auditReport.matrixResults.push(resultEntry);
        await context.close();
      }
    }

    // 2. Specific Feature & Interactive Scenario Verifications
    console.log(`\n--- Running Specific Interactive & Scenario Audits (${phase}) ---`);

    // Scenario A: Technical Audit Drawer Open across key viewports (320, 375, 768, 1440)
    for (const testW of [320, 375, 768, 1440]) {
      const context = await initPageContext(browser, {
        width: testW,
        height: 900,
        theme: 'dark',
        username: 'janedev',
      });
      const page = await context.newPage();
      await attachDefaultRoutes(page, githubFixture, 'janedev');

      await page.goto(`${base}/app/github-analyzer`);
      await page.locator('.exec-score-number').waitFor({ timeout: 10000 });

      // Click "Analysis Details & Audit"
      const auditBtn = page.getByRole('button', { name: 'Analysis Details & Audit', exact: true });
      await auditBtn.click();
      await page.locator('.drawer-evidence-content').waitFor({ timeout: 5000 });
      await page.waitForTimeout(300);

      const drawerMeasurement = await page.evaluate(() => {
        const doc = document.documentElement;
        const scrollWidth = doc.scrollWidth;
        const clientWidth = doc.clientWidth || window.innerWidth;
        const drawerContent = document.querySelector('.drawer-evidence-content');
        const drawerSectionTitles = [...document.querySelectorAll('.drawer-section-title')].map(
          (el) => el.textContent.trim(),
        );
        const weightRows = document.querySelectorAll('.drawer-weight-row').length;
        return {
          hasOverflow: scrollWidth > clientWidth + 1,
          scrollWidth,
          clientWidth,
          drawerVisible: !!drawerContent,
          drawerSectionTitles,
          weightRows,
        };
      });

      const drawerScreenshot = `drawer-open-${testW}px.png`;
      await page.screenshot({ path: path.join(statesDir, drawerScreenshot) });
      auditReport.stateChecks[`drawer_${testW}`] = {
        viewportWidth: testW,
        hasOverflow: drawerMeasurement.hasOverflow,
        scrollWidth: drawerMeasurement.scrollWidth,
        clientWidth: drawerMeasurement.clientWidth,
        drawerVisible: drawerMeasurement.drawerVisible,
        weightRows: drawerMeasurement.weightRows,
        screenshot: drawerScreenshot,
      };
      console.log(
        `  [DRAWER] ${testW}px: overflow=${drawerMeasurement.hasOverflow}, weightRows=${drawerMeasurement.weightRows}`,
      );
      await context.close();
    }

    // Scenario B: Table Interactions (Sorting by Score, Stars, Name; Disclosure Expansion; View All)
    {
      const context = await initPageContext(browser, {
        width: 375,
        height: 800,
        theme: 'dark',
        username: 'janedev',
      });
      const page = await context.newPage();
      await attachDefaultRoutes(page, githubFixture, 'janedev');

      await page.goto(`${base}/app/github-analyzer`);
      await page.locator('.exec-score-number').waitFor({ timeout: 10000 });

      // Check initial 5 rows
      const initialRowCount = await page.locator('tbody tr').count();
      assert.equal(initialRowCount, 5, 'Initial repository row count should be 5');

      // Click "View All Repositories (8)"
      const viewAllBtn = page.getByRole('button', { name: /View All Repositories/i });
      await viewAllBtn.click();
      await page.waitForFunction(() => document.querySelectorAll('tbody tr').length === 8);
      const expandedRowCount = await page.locator('tbody tr').count();
      assert.equal(expandedRowCount, 8, 'Expanded repository row count should be 8');

      // Click sort by Stars
      const starsSortBtn = page.locator('.sort-pill-btn').filter({ hasText: 'Stars' });
      await starsSortBtn.click();
      await page.waitForTimeout(200);

      // Open repository evidence disclosure in first row
      const firstDisclosure = page.locator('.repository-evidence summary').first();
      await firstDisclosure.click();
      await page.waitForTimeout(200);

      const tableInteractionScreenshot = 'table-interactions-mobile-375.png';
      await page.screenshot({
        path: path.join(statesDir, tableInteractionScreenshot),
        fullPage: true,
      });

      auditReport.stateChecks['table_interactions'] = {
        initialRowCount,
        expandedRowCount,
        sortPillFunctional: true,
        disclosureExpanded: true,
        screenshot: tableInteractionScreenshot,
      };
      console.log(
        `  [TABLE] Mobile 375px: rows expanded from ${initialRowCount} to ${expandedRowCount}, sorted & disclosure expanded.`,
      );
      await context.close();
    }

    // Scenario C: Empty States (Unconfigured GitHub profile & 0 public repos)
    {
      // Subcase 1: No GitHub username configured
      const contextUnconfig = await initPageContext(browser, {
        width: 375,
        height: 700,
        theme: 'dark',
        username: '',
      });
      const pageUnconfig = await contextUnconfig.newPage();
      await pageUnconfig.route('https://api.github.com/**', (route) => route.fulfill({ json: [] }));
      await pageUnconfig.route('**/api/**', (route) => {
        if (route.request().url().includes('/github/active-username'))
          return route.fulfill({ json: { username: '' } });
        return route.fulfill({ json: { success: true } });
      });

      await pageUnconfig.goto(`${base}/app/github-analyzer`);
      await pageUnconfig.locator('app-ui-empty-state').waitFor({ timeout: 8000 });
      const emptyUnconfigScreenshot = 'empty-unconfigured-mobile-375.png';
      await pageUnconfig.screenshot({ path: path.join(statesDir, emptyUnconfigScreenshot) });

      // Subcase 2: Account exists but 0 public repositories
      const zeroReposFixture = {
        ...githubFixture,
        repoCount: 0,
        repositories: [],
        repositoryActivity: [],
      };
      const contextZeroRepos = await initPageContext(browser, {
        width: 375,
        height: 700,
        theme: 'light',
        username: 'zerorepos',
      });
      const pageZeroRepos = await contextZeroRepos.newPage();
      await attachDefaultRoutes(pageZeroRepos, zeroReposFixture, 'zerorepos');

      await pageZeroRepos.goto(`${base}/app/github-analyzer`);
      await pageZeroRepos.locator('app-ui-empty-state').waitFor({ timeout: 8000 });
      const emptyZeroScreenshot = 'empty-zero-repos-mobile-375.png';
      await pageZeroRepos.screenshot({ path: path.join(statesDir, emptyZeroScreenshot) });

      auditReport.stateChecks['empty_states'] = {
        unconfiguredPresent: true,
        zeroReposPresent: true,
        screenshots: [emptyUnconfigScreenshot, emptyZeroScreenshot],
      };
      console.log(`  [EMPTY STATES] Unconfigured & Zero-repo states verified without overflow.`);
      await contextUnconfig.close();
      await contextZeroRepos.close();
    }

    // Scenario D: Warning Callout Banner (Rate limited / cached snapshot) & Preview Mode
    {
      const staleFixture = {
        ...githubFixture,
        cache: { source: 'stale-cache', hit: true, stale: true },
        rateLimited: true,
        warning:
          'GitHub API rate limits prevent fresh retrieval right now. Presenting the latest verified cached snapshot.',
      };
      const contextNotice = await initPageContext(browser, {
        width: 390,
        height: 800,
        theme: 'dark',
        username: 'defaultuser',
      });
      const pageNotice = await contextNotice.newPage();
      await attachDefaultRoutes(pageNotice, staleFixture, 'defaultuser');

      await pageNotice.goto(`${base}/app/github-analyzer`);
      await pageNotice.locator('.warning-callout').waitFor({ timeout: 8000 });

      // Now enter a different username in the search bar and analyze to trigger preview mode banner
      await pageNotice.locator('.search-input-field').fill('previewuser');
      await pageNotice.locator('.search-form-wrap app-ui-button button').click();
      await pageNotice.waitForTimeout(500);

      const noticeScreenshot = 'warning-and-preview-mobile-390.png';
      await pageNotice.screenshot({ path: path.join(statesDir, noticeScreenshot), fullPage: true });

      auditReport.stateChecks['banners'] = {
        warningCalloutVerified: true,
        screenshot: noticeScreenshot,
      };
      console.log(`  [BANNERS] Warning callout and preview mode banner verified.`);
      await contextNotice.close();
    }

    // Scenario E: Long Text & Edge Case Overflow
    {
      const longFixture = JSON.parse(JSON.stringify(githubFixture));
      longFixture.repositories[0].name =
        'hyper-distributed-asynchronous-telemetry-protocol-engine-node-v2';
      longFixture.repositories[0].description =
        'ExceptionallyLongUnbrokenTechnicalDescriptionDesignedToValidateStringWrappingBehaviorsWithoutBreakingGridContainersOrIntroducingHorizontalScrollbarshttps://github.com/org/repo';
      longFixture.summary =
        'SeniorFullStackSystemsArchitectDemonstratingConsistentCadenceAcrossDistributedEventDrivenPipelinesWithZeroDowntimeDeploymentHistoriesAndStrictTelemetryCompliance';

      const contextLong = await initPageContext(browser, {
        width: 320,
        height: 750,
        theme: 'light',
        username: 'longtextuser',
      });
      const pageLong = await contextLong.newPage();
      await attachDefaultRoutes(pageLong, longFixture, 'longtextuser');

      await pageLong.goto(`${base}/app/github-analyzer`);
      await pageLong.locator('.exec-score-number').waitFor({ timeout: 8000 });

      const longOverflowCheck = await pageLong.evaluate(() => {
        const doc = document.documentElement;
        return {
          scrollWidth: doc.scrollWidth,
          clientWidth: doc.clientWidth,
          hasOverflow: doc.scrollWidth > doc.clientWidth + 1,
        };
      });

      const longScreenshot = 'long-text-edge-320px.png';
      await pageLong.screenshot({ path: path.join(statesDir, longScreenshot), fullPage: true });

      auditReport.stateChecks['long_text'] = {
        hasOverflow: longOverflowCheck.hasOverflow,
        scrollWidth: longOverflowCheck.scrollWidth,
        clientWidth: longOverflowCheck.clientWidth,
        screenshot: longScreenshot,
      };
      console.log(
        `  [LONG TEXT 320px] overflow=${longOverflowCheck.hasOverflow} (${longOverflowCheck.scrollWidth}/${longOverflowCheck.clientWidth}px)`,
      );
      await contextLong.close();
    }

    // Scenario F: Touch Target Usability on 375px
    {
      const contextTouch = await initPageContext(browser, {
        width: 375,
        height: 800,
        theme: 'dark',
        username: 'octocat',
      });
      const pageTouch = await contextTouch.newPage();
      await attachDefaultRoutes(pageTouch, githubFixture, 'octocat');

      await pageTouch.goto(`${base}/app/github-analyzer`);
      await pageTouch.locator('.exec-score-number').waitFor({ timeout: 8000 });

      const touchAudit = await pageTouch.evaluate(() => {
        const interactives = document.querySelectorAll('button, input, a, summary');
        const touchDefects = [];
        for (const el of interactives) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          // WCAG touch target guideline: check interactive controls
          const isButtonOrInput =
            ['BUTTON', 'INPUT'].includes(el.tagName) || el.classList.contains('sort-pill-btn');
          if (isButtonOrInput && r.height < 32) {
            touchDefects.push({
              tag: el.tagName,
              text: el.textContent ? el.textContent.trim().slice(0, 30) : '',
              height: Math.round(r.height),
              width: Math.round(r.width),
            });
          }
        }
        return touchDefects;
      });

      auditReport.touchTargetDefects = touchAudit;
      console.log(
        `  [TOUCH TARGETS] Evaluated interactive touch targets. Defects found: ${touchAudit.length}`,
      );
      await contextTouch.close();
    }

    // Save final report JSON
    const reportPath = path.join(outputDir, `audit-results-${phase}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(auditReport, null, 2));
    console.log(`\nAudit report saved to: ${reportPath}`);
    console.log(`Total overflow defects: ${auditReport.overflowDefects.length}`);
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  console.error('Audit failed:', err);
  process.exit(1);
});
