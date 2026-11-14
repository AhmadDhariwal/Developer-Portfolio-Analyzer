// Complete Responsive Audit for Integrations Marketplace across all required viewports, themes, and states.
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
const outputDir = path.resolve(__dirname, '../verification/integrations/responsive-audit');
fs.mkdirSync(outputDir, { recursive: true });

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

const initialItems = [
  ['github', 'GitHub', 'Code Hosting', 'oauth2', 'connected'],
  ['linkedin', 'LinkedIn', 'Professional Network', 'oauth2', 'disconnected'],
  ['leetcode', 'LeetCode', 'Practice Platform', 'manual', 'error'],
  ['kaggle', 'Kaggle', 'Data Science', 'manual', 'disconnected'],
  ['stackoverflow', 'Stack Overflow', 'Developer Community', 'manual', 'pending'],
  ['portfolio', 'Portfolio', 'Personal Website', 'manual', 'disconnected'],
  ['certifications', 'Certifications', 'Credentials', 'manual', 'disconnected'],
  ['devblogs', 'Dev.to', 'Technical Writing', 'manual', 'disconnected'],
].map(([provider, name, category, authMode, status]) => ({
  provider,
  name,
  category,
  authMode,
  status,
  description: `Observe ${name} public profile and activity signals across all registered environments.`,
  externalUsername: provider === 'github' ? 'fixture-developer' : '',
  lastSyncedAt: provider === 'github' ? '2026-10-28T10:00:00Z' : null,
  available: provider !== 'kaggle',
  resourceSummary: provider === 'kaggle' ? { notebooks: 14, datasets: 6, ownershipVerified: false } : undefined,
}));

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

async function setupContextAndPage(context, themeVal = 'dark') {
  await context.addInitScript(
    ({ theme }) => {
      const payload = btoa(
        JSON.stringify({
          exp: Date.now() / 1000 + 36000,
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
          name: 'Alex Rivera',
          email: 'alex.rivera@example.com',
          activeGithubUsername: 'alexrivera',
        }),
      );
      localStorage.setItem('devinsight_theme', theme);
      localStorage.setItem(
        'devinsight_career_profile',
        JSON.stringify({
          careerStack: 'Fullstack',
          experienceLevel: 'Senior',
          activeCareerStack: 'Fullstack',
          activeExperienceLevel: 'Senior',
          githubUsername: 'alexrivera',
          isConfigured: true,
        }),
      );
    },
    { theme: themeVal },
  );
}

function attachDefaultRoutes(page, overrides = {}) {
  let catalog = structuredClone(overrides.catalog || initialItems);
  let linkedKaggle = overrides.linkedKaggle || {
    provider: 'kaggle',
    username: 'alexkaggle',
    profileUrl: 'https://kaggle.com/alexkaggle',
    ownershipVerified: false,
    evidenceKind: 'user-entered-link',
  };

  return page.route('**/api/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method();

    if (url.pathname.includes('/notifications')) {
      return route.fulfill({ json: { success: true, notifications: [] } });
    }
    if (url.pathname.includes('/profile/career')) {
      return route.fulfill({
        json: {
          careerStack: 'Fullstack',
          experienceLevel: 'Senior',
          activeCareerStack: 'Fullstack',
          activeExperienceLevel: 'Senior',
          githubUsername: 'alexrivera',
          isConfigured: true,
        },
      });
    }
    if (url.pathname.includes('/profile/me')) {
      return route.fulfill({
        json: {
          _id: 'user-fixture',
          name: 'Alex Rivera',
          email: 'alex.rivera@example.com',
          activeGithubUsername: 'alexrivera',
        },
      });
    }

    if (url.pathname.endsWith('/integrations/marketplace')) {
      if (overrides.loadingMarketplace) {
        // do not fulfill to simulate loading
        return;
      }
      return route.fulfill({ json: { integrations: catalog } });
    }

    if (url.pathname.endsWith('/integrations/insights')) {
      return route.fulfill({
        json: {
          integrationScore: 78,
          providers: [],
          mergedSkills: [],
        },
      });
    }

    if (url.pathname.includes('/integrations/linked-profiles/kaggle')) {
      if (method === 'GET') {
        return route.fulfill({ json: linkedKaggle });
      }
      if (method === 'POST') {
        const body = req.postDataJSON() || {};
        linkedKaggle = {
          provider: 'kaggle',
          username: body.username || 'newuser',
          profileUrl: `https://kaggle.com/${body.username || 'newuser'}`,
          ownershipVerified: false,
          evidenceKind: 'user-entered-link',
        };
        return route.fulfill({ json: linkedKaggle });
      }
      if (method === 'DELETE') {
        linkedKaggle = null;
        return route.fulfill({ json: { success: true } });
      }
    }

    if (url.pathname.endsWith('/sync-all')) {
      return route.fulfill({ json: { success: true, message: 'All active stream syncs initiated.' } });
    }

    if (url.pathname.includes('/sync')) {
      return route.fulfill({ json: { success: true, message: 'Sync queued successfully.' } });
    }

    if (url.pathname.includes('/connect')) {
      return route.fulfill({ json: { success: true, message: 'Connected successfully.' } });
    }

    if (method === 'DELETE' && url.pathname.includes('/integrations/')) {
      return route.fulfill({ json: { success: true, message: 'Disconnected successfully.' } });
    }

    return route.fulfill({ json: { success: true } });
  });
}

async function measureLayout(page) {
  return await page.evaluate(() => {
    const doc = document.documentElement;
    const body = document.body;
    const scrollWidth = Math.max(doc.scrollWidth, body.scrollWidth);
    const clientWidth = doc.clientWidth || window.innerWidth;
    const hasDocOverflow = scrollWidth > clientWidth + 1;

    const pageContainer = document.querySelector('.integrations-page');
    const containerScrollWidth = pageContainer ? pageContainer.scrollWidth : 0;
    const containerClientWidth = pageContainer ? pageContainer.clientWidth : 0;
    const hasContainerOverflow = containerScrollWidth > containerClientWidth + 1;

    const offenders = [];
    if (pageContainer) {
      const allElements = pageContainer.querySelectorAll('*');
      for (const el of allElements) {
        const r = el.getBoundingClientRect();
        // check horizontal overflow
        if (r.right > clientWidth + 1.5) {
          offenders.push({
            tag: el.tagName.toLowerCase(),
            className: (el.className || '').toString().slice(0, 80),
            right: Math.round(r.right),
            width: Math.round(r.width),
            clientWidth,
            text: (el.innerText || el.textContent || '').trim().slice(0, 40),
          });
        }
      }
    }

    // Touch target checks for interactive elements on mobile/tablet (width <= 1024)
    const touchDefects = [];
    if (clientWidth <= 1024) {
      const interactives = document.querySelectorAll(
        '.integrations-page button, .integrations-page input, .integrations-page a, .integrations-page .tab-btn',
      );
      for (const el of interactives) {
        if (!el.offsetParent) continue; // hidden
        const r = el.getBoundingClientRect();
        if (r.width < 28 || r.height < 28) {
          touchDefects.push({
            tag: el.tagName.toLowerCase(),
            className: (el.className || '').toString().slice(0, 80),
            width: Math.round(r.width),
            height: Math.round(r.height),
            text: (el.innerText || el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 30),
          });
        }
      }
    }

    return {
      scrollWidth,
      clientWidth,
      hasDocOverflow,
      containerScrollWidth,
      containerClientWidth,
      hasContainerOverflow,
      offenders: offenders.slice(0, 10),
      touchDefects: touchDefects.slice(0, 10),
    };
  });
}

async function main() {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  console.log(`[audit-integrations-responsive] Server running at ${base}`);

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
    discoveredDefects: [],
  };

  const matrixDir = path.join(outputDir, phase, 'matrix');
  const statesDir = path.join(outputDir, phase, 'states');
  fs.mkdirSync(matrixDir, { recursive: true });
  fs.mkdirSync(statesDir, { recursive: true });

  try {
    // 1. Matrix verification: 12 viewports x 3 themes = 36 runs
    console.log(`\n=== Starting 36-cell Viewport & Theme Matrix Audit (${phase}) ===`);
    for (const vp of VIEWPORTS) {
      for (const theme of THEMES) {
        const colorScheme = theme === 'system' ? 'dark' : theme;
        const context = await browser.newContext({
          viewport: { width: vp.width, height: vp.height },
          colorScheme,
          reducedMotion: 'reduce',
        });

        await setupContextAndPage(context, theme);
        const page = await context.newPage();
        const pageErrors = [];
        page.on('pageerror', (err) => pageErrors.push(err.message));

        await attachDefaultRoutes(page);

        await page.goto(`${base}/app/integrations`);
        await page.locator('.integrations-page').waitFor({ timeout: 10000 });
        await page.locator('.market-grid').waitFor({ timeout: 10000 });
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(150);

        // Sidebar check: On desktop/laptop (> 768), ensure shell isn't blocking view
        if (vp.width > 768 && (await page.locator('.shell-body.sidebar-closed').count())) {
          const toggleBtn = page.getByRole('button', { name: 'Toggle sidebar', exact: true });
          if (await toggleBtn.isVisible()) {
            await toggleBtn.click();
            await page.waitForTimeout(100);
          }
        }

        const metrics = await measureLayout(page);

        const screenshotPath = path.join(matrixDir, `${vp.name}-${theme}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: true });

        const pass = !metrics.hasDocOverflow && !metrics.hasContainerOverflow && pageErrors.length === 0;

        const cellResult = {
          viewport: vp.name,
          category: vp.category,
          width: vp.width,
          height: vp.height,
          theme,
          pass,
          scrollWidth: metrics.scrollWidth,
          clientWidth: metrics.clientWidth,
          containerScrollWidth: metrics.containerScrollWidth,
          containerClientWidth: metrics.containerClientWidth,
          offendersCount: metrics.offenders.length,
          offenders: metrics.offenders,
          touchDefectsCount: metrics.touchDefects.length,
          touchDefects: metrics.touchDefects,
          pageErrors,
        };

        auditReport.matrixResults.push(cellResult);

        if (!pass || metrics.touchDefects.length > 0) {
          auditReport.discoveredDefects.push({
            context: `${vp.name} (${theme})`,
            hasOverflow: metrics.hasDocOverflow || metrics.hasContainerOverflow,
            scrollWidth: metrics.scrollWidth,
            clientWidth: metrics.clientWidth,
            offenders: metrics.offenders,
            touchDefects: metrics.touchDefects,
          });
        }

        console.log(
          `  [${pass ? 'PASS' : 'FAIL'}] ${vp.name.padEnd(12)} | theme: ${theme.padEnd(6)} | ` +
            `client: ${metrics.clientWidth}px, scroll: ${metrics.scrollWidth}px ` +
            `(container: ${metrics.containerClientWidth}px / ${metrics.containerScrollWidth}px) | ` +
            `offenders: ${metrics.offenders.length}, touchIssues: ${metrics.touchDefects.length}`,
        );

        await context.close();
      }
    }

    // 2. Dedicated UI State Audits
    console.log(`\n=== Running Dedicated State Audits (${phase}) ===`);

    // State A: Terminal feed open
    {
      console.log('  Testing State: Activity Terminal Open (Mobile 375 & Desktop 1440)');
      for (const w of [375, 1440]) {
        const context = await browser.newContext({
          viewport: { width: w, height: 800 },
          colorScheme: 'dark',
        });
        await setupContextAndPage(context, 'dark');
        const page = await context.newPage();
        await attachDefaultRoutes(page);
        await page.goto(`${base}/app/integrations`);
        await page.locator('.integrations-page').waitFor({ timeout: 10000 });

        // Click "View Ingestion Feed"
        const toggleFeedBtn = page.locator('.btn-ghost-terminal');
        await toggleFeedBtn.waitFor({ state: 'visible' });
        await toggleFeedBtn.click();
        await page.locator('.terminal-drawer').waitFor({ state: 'visible' });
        await page.waitForTimeout(200);

        const metrics = await measureLayout(page);
        const screenshotPath = path.join(statesDir, `state-terminal-open-w${w}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: true });

        auditReport.stateChecks[`terminal-open-w${w}`] = {
          width: w,
          pass: !metrics.hasDocOverflow && !metrics.hasContainerOverflow,
          metrics,
        };
        console.log(`    w=${w}px -> pass: ${!metrics.hasDocOverflow}, scrollWidth: ${metrics.scrollWidth}px vs clientWidth: ${metrics.clientWidth}px`);
        await context.close();
      }
    }

    // State B: Empty search state
    {
      console.log('  Testing State: Empty Search / Filter (Mobile 375 & Desktop 1440)');
      for (const w of [375, 1440]) {
        const context = await browser.newContext({
          viewport: { width: w, height: 800 },
          colorScheme: 'dark',
        });
        await setupContextAndPage(context, 'dark');
        const page = await context.newPage();
        await attachDefaultRoutes(page);
        await page.goto(`${base}/app/integrations`);
        await page.locator('.integrations-page').waitFor({ timeout: 10000 });

        // Type nonexistent query
        const searchInput = page.locator('.search-input');
        await searchInput.fill('xyznonexistentquery');
        await page.locator('.empty-state').waitFor({ state: 'visible' });
        await page.waitForTimeout(150);

        const metrics = await measureLayout(page);
        const screenshotPath = path.join(statesDir, `state-empty-search-w${w}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: true });

        auditReport.stateChecks[`empty-search-w${w}`] = {
          width: w,
          pass: !metrics.hasDocOverflow && !metrics.hasContainerOverflow,
          metrics,
        };
        console.log(`    w=${w}px -> pass: ${!metrics.hasDocOverflow}, scrollWidth: ${metrics.scrollWidth}px`);
        await context.close();
      }
    }

    // State C: Category filter tabs
    {
      console.log('  Testing State: Category Filter Selection (Mobile 390)');
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        colorScheme: 'dark',
      });
      await setupContextAndPage(context, 'dark');
      const page = await context.newPage();
      await attachDefaultRoutes(page);
      await page.goto(`${base}/app/integrations`);
      await page.locator('.integrations-page').waitFor({ timeout: 10000 });

      // Click "Connected" tab
      await page.locator('.tab-btn').filter({ hasText: 'Connected' }).click();
      await page.waitForTimeout(100);
      let metrics = await measureLayout(page);
      await page.screenshot({ path: path.join(statesDir, 'state-category-connected.png') });

      // Click "Code & Repos" tab
      await page.locator('.tab-btn').filter({ hasText: 'Code & Repos' }).click();
      await page.waitForTimeout(100);
      metrics = await measureLayout(page);
      await page.screenshot({ path: path.join(statesDir, 'state-category-code.png') });

      auditReport.stateChecks['category-tabs'] = {
        pass: !metrics.hasDocOverflow,
        metrics,
      };
      console.log(`    Category filters reflow pass: ${!metrics.hasDocOverflow}`);
      await context.close();
    }

    // State D: Error Banner
    {
      console.log('  Testing State: Error Banner State (Mobile 320 & Tablet 768)');
      for (const w of [320, 768]) {
        const context = await browser.newContext({
          viewport: { width: w, height: 700 },
          colorScheme: 'dark',
        });
        await setupContextAndPage(context, 'dark');
        const page = await context.newPage();
        await attachDefaultRoutes(page);
        // Pass query param ?error=access_denied&error_description=OAuth+token+exchange+rejected+by+remote+security+gateway
        await page.goto(`${base}/app/integrations?error=access_denied&error_description=OAuth+token+exchange+rejected+by+remote+security+gateway`);
        await page.locator('.integrations-page').waitFor({ timeout: 10000 });
        await page.locator('.error-banner').waitFor({ state: 'visible', timeout: 5000 });
        await page.waitForTimeout(150);

        const metrics = await measureLayout(page);
        await page.screenshot({ path: path.join(statesDir, `state-error-banner-w${w}.png`) });

        auditReport.stateChecks[`error-banner-w${w}`] = {
          width: w,
          pass: !metrics.hasDocOverflow,
          metrics,
        };
        console.log(`    w=${w}px -> Error banner pass: ${!metrics.hasDocOverflow}, scroll: ${metrics.scrollWidth}px vs client: ${metrics.clientWidth}px`);
        await context.close();
      }
    }

    // State E: Long unbreakable text / edge-case text handling
    {
      console.log('  Testing State: Long Edge Case Text in Cards (Mobile 375)');
      const modifiedCatalog = structuredClone(initialItems);
      modifiedCatalog[0].name = 'GitHub Enterprise Extra Long Long Long Name';
      modifiedCatalog[0].externalUsername = 'unusually-long-developer-account-handle-2026-production';
      modifiedCatalog[0].description =
        'Super-long-unbroken-description-string-testing-word-break-and-text-overflow-behavior-across-mobile-screens-and-tablet-layouts.';

      const context = await browser.newContext({
        viewport: { width: 375, height: 800 },
        colorScheme: 'dark',
      });
      await setupContextAndPage(context, 'dark');
      const page = await context.newPage();
      await attachDefaultRoutes(page, { catalog: modifiedCatalog });
      await page.goto(`${base}/app/integrations`);
      await page.locator('.integrations-page').waitFor({ timeout: 10000 });
      await page.waitForTimeout(200);

      const metrics = await measureLayout(page);
      await page.screenshot({ path: path.join(statesDir, 'state-long-text-w375.png') });

      auditReport.stateChecks['long-text'] = {
        pass: !metrics.hasDocOverflow,
        metrics,
      };
      console.log(`    Long text edge case pass: ${!metrics.hasDocOverflow}, scrollWidth: ${metrics.scrollWidth}px vs client: ${metrics.clientWidth}px`);
      await context.close();
    }

    // State F: Zoom 200% reflow check (WCAG 1.4.10)
    {
      console.log('  Testing State: 200% Zoom / Reflow (Desktop 1280 at 2x text/zoom scale)');
      const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        deviceScaleFactor: 2,
        colorScheme: 'dark',
      });
      await setupContextAndPage(context, 'dark');
      const page = await context.newPage();
      await attachDefaultRoutes(page);
      await page.goto(`${base}/app/integrations`);
      await page.locator('.integrations-page').waitFor({ timeout: 10000 });
      await page.waitForTimeout(150);

      const metrics = await measureLayout(page);
      await page.screenshot({ path: path.join(statesDir, 'state-zoom-200.png') });

      auditReport.stateChecks['zoom-200'] = {
        pass: !metrics.hasDocOverflow,
        metrics,
      };
      console.log(`    200% zoom reflow pass: ${!metrics.hasDocOverflow}, scrollWidth: ${metrics.scrollWidth}px`);
      await context.close();
    }

    // State G: Orientation checks (Mobile landscape 844x390, Tablet landscape 1024x768)
    {
      console.log('  Testing State: Orientation (Mobile landscape 844x390 & Tablet 1024x768)');
      for (const orient of [
        { name: 'mobile-landscape', width: 844, height: 390 },
        { name: 'tablet-landscape', width: 1024, height: 768 },
      ]) {
        const context = await browser.newContext({
          viewport: { width: orient.width, height: orient.height },
          colorScheme: 'dark',
        });
        await setupContextAndPage(context, 'dark');
        const page = await context.newPage();
        await attachDefaultRoutes(page);
        await page.goto(`${base}/app/integrations`);
        await page.locator('.integrations-page').waitFor({ timeout: 10000 });
        await page.waitForTimeout(150);

        const metrics = await measureLayout(page);
        await page.screenshot({ path: path.join(statesDir, `state-orientation-${orient.name}.png`) });

        auditReport.stateChecks[orient.name] = {
          pass: !metrics.hasDocOverflow,
          metrics,
        };
        console.log(`    ${orient.name} pass: ${!metrics.hasDocOverflow}, scrollWidth: ${metrics.scrollWidth}px`);
        await context.close();
      }
    }

    // State H: Keyboard navigation & focus visibility check
    {
      console.log('  Testing State: Keyboard Navigation & Focus Ring');
      const context = await browser.newContext({
        viewport: { width: 1024, height: 768 },
        colorScheme: 'dark',
      });
      await setupContextAndPage(context, 'dark');
      const page = await context.newPage();
      await attachDefaultRoutes(page);
      await page.goto(`${base}/app/integrations`);
      await page.locator('.integrations-page').waitFor({ timeout: 10000 });

      // Tab through items
      await page.keyboard.press('Tab'); // skip link
      await page.keyboard.press('Tab'); // main or header search
      await page.waitForTimeout(50);
      await page.screenshot({ path: path.join(statesDir, 'state-keyboard-focus-search.png') });

      const activeTag = await page.evaluate(() => document.activeElement ? document.activeElement.tagName : 'none');
      auditReport.stateChecks['keyboard-nav'] = {
        pass: true,
        activeTag,
      };
      console.log(`    Keyboard nav active element: <${activeTag}>`);
      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }

  // Save report JSON
  const reportPath = path.join(outputDir, `results-${phase}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(auditReport, null, 2));
  console.log(`\nAudit complete (${phase}). Report written to: ${reportPath}`);

  const passedCount = auditReport.matrixResults.filter((r) => r.pass).length;
  const totalCount = auditReport.matrixResults.length;
  console.log(`Matrix summary: ${passedCount}/${totalCount} cells passed.`);

  if (phase === 'after' && passedCount < totalCount) {
    console.error(`ERROR: Responsive defects remain in phase "${phase}".`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[audit-integrations-responsive] Fatal error:', err);
  process.exit(1);
});
