// Complete Responsive Design Audit for Skill Gap module across all required viewports and themes.
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
const outputDir = path.resolve(__dirname, '../verification/skill-gap/responsive-audit');
fs.mkdirSync(outputDir, { recursive: true });

const { profile, fixture } = require('./skill-gap-browser-fixture.cjs');

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
  if (!fs.existsSync(file)) {
    res.statusCode = 404;
    return res.end('Not found');
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
  const stream = fs.createReadStream(file);
  stream.on('error', () => {
    if (!res.headersSent) res.statusCode = 404;
    res.end();
  });
  stream.pipe(res);
});

async function initPageContext(browser, { width, height, theme = 'dark', username = 'fixture', customProfile = null }) {
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
          isConfigured: activeProfile.isConfigured !== false,
          activeGithubUsername: activeUser,
        }),
      );
    },
    { themeVal: theme, activeUser: username, activeProfile: customProfile !== null ? customProfile : profile },
  );

  return context;
}

async function attachDefaultRoutes(page, customFixture = null, customProfile = null, options = {}) {
  const mockFixture = customFixture !== null ? customFixture : fixture();
  const mockProfile = customProfile !== null ? customProfile : profile;

  page.on('console', (msg) => console.log('  [CONSOLE]', msg.text()));
  page.on('pageerror', (err) => console.log('  [PAGEERROR]', err.message));

  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (!url.includes('/api/')) {
      return route.continue();
    }
    console.log('  [API REQ]', route.request().method(), url);

    if (url.includes('/skillgap/skill-gap')) {
      if (options.failSkillGap) {
        return route.fulfill({ status: 500, json: { message: 'Failed to refresh evidence' } });
      }
      return route.fulfill({ json: mockFixture });
    }
    if (url.includes('/profile/career')) {
      return route.fulfill({ json: mockProfile });
    }
    if (url.includes('active-username')) {
      return route.fulfill({ json: { username: 'fixture' } });
    }
    if (url.includes('/recommendations/saved-previews')) {
      const preview = {
        _id: 'saved-fixture-1',
        module: 'skill-gap',
        title: 'Full Stack Preview',
        githubUsername: 'fixture',
        careerStack: 'Full Stack',
        experienceLevel: 'Student',
        resumeHash: 'no-resume',
        resultSummary: { coverage: 35.5 },
        createdAt: '2026-10-12T00:00:00Z',
      };
      return route.fulfill({
        json:
          route.request().method() === 'POST'
            ? { preview }
            : route.request().method() === 'DELETE'
              ? {}
              : { previews: [preview] },
      });
    }
    if (url.includes('/notifications/stream')) {
      return route.fulfill({ contentType: 'text/event-stream', body: ': heartbeat\n\n' });
    }
    return route.fulfill({
      json: {
        success: true,
        data: [],
        notifications: [],
        resumes: [],
        previews: [],
        integrations: [],
        user: { _id: 'user-fixture', role: 'developer' },
      },
    });
  });
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
  console.log(`[audit-skill-gap-responsive] Static server running at ${base}`);

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

        await attachDefaultRoutes(page);

        await page.goto(`${base}/app/skill-gap`);
        await page.locator('.skill-gap-page').waitFor({ timeout: 10000 });
        await page.locator('[data-testid=coverage]').waitFor({ timeout: 10000 });
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
          const pageEl = document.querySelector('.skill-gap-page');
          const pageScroll = pageEl ? pageEl.scrollWidth : 0;
          const pageClient = pageEl ? pageEl.clientWidth : 0;
          const pageWidth = pageEl ? pageEl.getBoundingClientRect().width : 0;

          // Find any elements exceeding viewport width
          const overflowing = [];
          document.querySelectorAll('.skill-gap-page *').forEach((el) => {
            const rect = el.getBoundingClientRect();
            if (rect.right > clientWidth + 1.5 && rect.width > 0) {
              const tag = el.tagName.toLowerCase();
              const cls = el.className && typeof el.className === 'string' ? el.className.trim() : '';
              overflowing.push({ tag, cls, right: Math.round(rect.right), width: Math.round(rect.width) });
            }
          });

          // Check touch targets (buttons, links, inputs)
          const smallTouchTargets = [];
          document.querySelectorAll('.skill-gap-page button, .skill-gap-page a, .skill-gap-page input, .skill-gap-page select, .skill-gap-page summary').forEach((el) => {
            const rect = el.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              if (rect.height < 32 || (rect.height < 36 && !el.classList.contains('inline-link'))) {
                const text = (el.textContent || '').trim().slice(0, 30);
                const cls = typeof el.className === 'string' ? el.className : '';
                smallTouchTargets.push({ tag: el.tagName.toLowerCase(), cls, text, height: Math.round(rect.height), width: Math.round(rect.width) });
              }
            }
          });

          // Measure key section widths & layout modes
          const kpiGrid = document.querySelector('.metrics-grid');
          const kpiCols = kpiGrid ? getComputedStyle(kpiGrid).gridTemplateColumns.split(' ').length : 0;
          const catGrid = document.querySelector('.category-grid');
          const catCols = catGrid ? getComputedStyle(catGrid).gridTemplateColumns.split(' ').length : 0;

          return {
            scrollWidth,
            clientWidth,
            hasDocOverflow: scrollWidth > clientWidth + 1,
            pageScroll,
            pageClient,
            hasPageOverflow: pageScroll > pageClient + 1.5,
            pageWidth: Math.round(pageWidth),
            overflowing: overflowing.slice(0, 5),
            smallTouchTargets: smallTouchTargets.slice(0, 5),
            kpiCols,
            catCols,
          };
        });

        // Contrast measurement
        const colors = await page.evaluate(() => {
          const panel = document.querySelector('.panel');
          const panelStyle = panel ? getComputedStyle(panel) : null;
          const h1 = document.querySelector('h1');
          const h1Style = h1 ? getComputedStyle(h1) : null;
          const p = document.querySelector('.coverage-summary p');
          const pStyle = p ? getComputedStyle(p) : null;
          const tag = document.querySelector('.tag');
          const tagStyle = tag ? getComputedStyle(tag) : null;
          const pageEl = document.querySelector('.skill-gap-page');
          const pageStyle = pageEl ? getComputedStyle(pageEl) : null;

          return {
            pageBg: pageStyle ? pageStyle.backgroundColor : 'rgb(246, 248, 251)',
            panelBg: panelStyle ? panelStyle.backgroundColor : 'rgb(255,255,255)',
            panelFg: panelStyle ? panelStyle.color : 'rgb(15, 23, 42)',
            h1Color: h1Style ? h1Style.color : 'rgb(15, 23, 42)',
            pColor: pStyle ? pStyle.color : 'rgb(71, 85, 105)',
            tagBg: tagStyle ? tagStyle.backgroundColor : 'rgb(240,240,240)',
            tagColor: tagStyle ? tagStyle.color : 'rgb(82, 96, 117)',
          };
        });

        const defaultBg = theme === 'light' ? 'rgb(255, 255, 255)' : 'rgb(17, 24, 39)';
        const effectiveBg =
          colors.panelBg === 'rgba(0, 0, 0, 0)' || colors.panelBg === 'transparent'
            ? defaultBg
            : colors.panelBg;
        const panelRatio = contrastRatio(colors.panelFg, effectiveBg);
        const pRatio = contrastRatio(colors.pColor, effectiveBg);
        const tagRatio = contrastRatio(colors.tagColor, colors.tagBg);

        const screenshotName = `${vp.name}-${theme}.png`;
        const screenshotPath = path.join(matrixDir, screenshotName);
        await page.screenshot({ path: screenshotPath, fullPage: true });

        const cellResult = {
          viewport: vp.name,
          category: vp.category,
          dimensions: `${vp.width}x${vp.height}`,
          theme,
          docOverflow: measurement.hasDocOverflow,
          pageOverflow: measurement.hasPageOverflow,
          scrollWidth: measurement.scrollWidth,
          clientWidth: measurement.clientWidth,
          pageWidth: measurement.pageWidth,
          kpiCols: measurement.kpiCols,
          catCols: measurement.catCols,
          panelContrast: +panelRatio.toFixed(2),
          pContrast: +pRatio.toFixed(2),
          tagContrast: +tagRatio.toFixed(2),
          pageErrorsCount: pageErrors.length,
          overflowingElements: measurement.overflowing,
          smallTouchTargets: measurement.smallTouchTargets,
          screenshot: screenshotName,
          status: (!measurement.hasDocOverflow && !measurement.hasPageOverflow && panelRatio >= 4.5) ? 'PASS' : 'FAIL',
        };

        if (cellResult.status === 'FAIL') {
          auditReport.overflowDefects.push({
            viewport: vp.name,
            theme,
            measurement,
          });
        }
        if (measurement.smallTouchTargets.length > 0) {
          auditReport.touchTargetDefects.push({
            viewport: vp.name,
            theme,
            targets: measurement.smallTouchTargets,
          });
        }

        auditReport.matrixResults.push(cellResult);
        console.log(`[Matrix] ${vp.name} (${vp.width}x${vp.height}) [${theme}] -> ${cellResult.status} (DocOF: ${measurement.hasDocOverflow}, PageOF: ${measurement.hasPageOverflow}, PanelContrast: ${cellResult.panelContrast}:1, KPICols: ${measurement.kpiCols})`);

        await context.close();
      }
    }

    // 2. Scenario Testing across representative viewports (375 mobile, 768 tablet, 1440 desktop)
    console.log(`\n--- Starting Dedicated Scenario Suite (${phase}) ---`);
    const scenarioViewports = [
      { name: 'mobile-375', width: 375, height: 667 },
      { name: 'tablet-768', width: 768, height: 1024 },
      { name: 'desktop-1440', width: 1440, height: 900 },
    ];

    // Scenario A: Insufficient Evidence State
    console.log(`\nScenario A: Insufficient Evidence State`);
    for (const svp of scenarioViewports) {
      const context = await initPageContext(browser, { width: svp.width, height: svp.height, theme: 'dark' });
      const page = await context.newPage();
      const customFix = fixture();
      customFix.coverage = null;
      customFix.evidenceConfidence = 'INSUFFICIENT';
      customFix.evidenceCompleteness = { availableCoreSources: 0, totalCoreSources: 2, complete: false };
      customFix.coverageUnavailableReason = 'insufficient_evidence_sources';
      // Mark all skills UNKNOWN
      customFix.skills = customFix.skills.map((s) => ({ ...s, status: 'UNKNOWN', evidence: [] }));

      await attachDefaultRoutes(page, customFix);
      await page.goto(`${base}/app/skill-gap`);
      await page.locator('[data-testid=insufficient-evidence-panel]').waitFor({ timeout: 10000 });
      await page.waitForTimeout(200);

      const ofCheck = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
      const scName = `scenario-insufficient-evidence-${svp.name}.png`;
      await page.screenshot({ path: path.join(scenariosDir, scName), fullPage: true });
      auditReport.scenarioChecks[`insufficient_evidence_${svp.name}`] = { pass: ofCheck, screenshot: scName };
      console.log(`  -> ${svp.name}: ${ofCheck ? 'PASS' : 'FAIL'}`);
      await context.close();
    }

    // Scenario B: Empty Target Configuration State (No career target configured)
    console.log(`\nScenario B: Empty Target State (No Career Target)`);
    for (const svp of scenarioViewports) {
      const emptyProfile = { isConfigured: false, careerStack: '', experienceLevel: '' };
      const context = await initPageContext(browser, {
        width: svp.width,
        height: svp.height,
        theme: 'dark',
        customProfile: emptyProfile,
      });
      const page = await context.newPage();

      await attachDefaultRoutes(page, null, emptyProfile);
      await page.goto(`${base}/app/skill-gap`);
      await page.locator('.empty-state').waitFor({ timeout: 10000 });
      await page.waitForTimeout(200);

      const ofCheck = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
      const scName = `scenario-empty-target-${svp.name}.png`;
      await page.screenshot({ path: path.join(scenariosDir, scName), fullPage: true });
      auditReport.scenarioChecks[`empty_target_${svp.name}`] = { pass: ofCheck, screenshot: scName };
      console.log(`  -> ${svp.name}: ${ofCheck ? 'PASS' : 'FAIL'}`);
      await context.close();
    }

    // Scenario C: Temporary Preview Mode
    console.log(`\nScenario C: Temporary Preview Mode`);
    for (const svp of scenarioViewports) {
      const context = await initPageContext(browser, { width: svp.width, height: svp.height, theme: 'dark' });
      const page = await context.newPage();
      await attachDefaultRoutes(page);
      await page.goto(`${base}/app/skill-gap`);
      await page.locator('.mode-controls button').nth(1).click();
      await page.locator('.preview-fields').waitFor({ timeout: 10000 });
      await page.waitForTimeout(200);

      const ofCheck = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
      const scName = `scenario-preview-mode-${svp.name}.png`;
      await page.screenshot({ path: path.join(scenariosDir, scName), fullPage: true });
      auditReport.scenarioChecks[`preview_mode_${svp.name}`] = { pass: ofCheck, screenshot: scName };
      console.log(`  -> ${svp.name}: ${ofCheck ? 'PASS' : 'FAIL'}`);
      await context.close();
    }

    // Scenario D: Long Skill Name & Expanded Details
    console.log(`\nScenario D: Long Skill Name & Expanded Details`);
    for (const svp of scenarioViewports) {
      const context = await initPageContext(browser, { width: svp.width, height: svp.height, theme: 'dark' });
      const page = await context.newPage();
      await attachDefaultRoutes(page);
      await page.goto(`${base}/app/skill-gap`);
      await page.locator('.skill-row summary').first().waitFor({ timeout: 10000 });

      // Click to open the skill row with long text
      const skillRows = page.locator('.skill-row summary');
      const count = await skillRows.count();
      for (let i = 0; i < Math.min(count, 3); i++) {
        await skillRows.nth(i).click();
      }

      // Also open roadmap phase
      const roadmapPhase = page.locator('.phase-summary-bar').first();
      if (await roadmapPhase.isVisible()) {
        await roadmapPhase.click();
      }

      await page.waitForTimeout(200);
      const ofCheck = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
      const scName = `scenario-expanded-details-${svp.name}.png`;
      await page.screenshot({ path: path.join(scenariosDir, scName), fullPage: true });
      auditReport.scenarioChecks[`expanded_details_${svp.name}`] = { pass: ofCheck, screenshot: scName };
      console.log(`  -> ${svp.name}: ${ofCheck ? 'PASS' : 'FAIL'}`);
      await context.close();
    }

    // Scenario E: Error State
    console.log(`\nScenario E: Error Notice State`);
    for (const svp of scenarioViewports) {
      const context = await initPageContext(browser, { width: svp.width, height: svp.height, theme: 'dark' });
      const page = await context.newPage();
      await attachDefaultRoutes(page, null, null, { failSkillGap: true });
      await page.goto(`${base}/app/skill-gap`);
      await page.locator('.notice[role=alert]').waitFor({ timeout: 10000 });
      await page.waitForTimeout(200);

      const ofCheck = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
      const scName = `scenario-error-notice-${svp.name}.png`;
      await page.screenshot({ path: path.join(scenariosDir, scName), fullPage: true });
      auditReport.scenarioChecks[`error_notice_${svp.name}`] = { pass: ofCheck, screenshot: scName };
      console.log(`  -> ${svp.name}: ${ofCheck ? 'PASS' : 'FAIL'}`);
      await context.close();
    }

    // Save audit JSON report
    const reportPath = path.join(outputDir, `audit-${phase}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(auditReport, null, 2));
    console.log(`\n[audit-skill-gap-responsive] Audit report saved to ${reportPath}`);
  } finally {
    try {
      if (browser) await browser.close();
    } catch (_) {}
    try {
      if (server) {
        if (typeof server.closeAllConnections === 'function') {
          server.closeAllConnections();
        }
        server.close();
      }
    } catch (_) {}
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('[audit-skill-gap-responsive] FATAL ERROR:', err);
  process.exit(1);
});
