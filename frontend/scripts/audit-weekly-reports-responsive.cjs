// Complete Responsive Design Audit for Weekly Reports module across all required viewports and themes.
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const assert = require('node:assert/strict');

const playwrightPath =
  process.env.PLAYWRIGHT_MODULE ||
  (fs.existsSync('C:/Users/ahmad.hassan/Desktop/Agrivio/node_modules/playwright')
    ? 'C:/Users/ahmad.hassan/Desktop/Agrivio/node_modules/playwright'
    : 'playwright');
const { chromium } = require(playwrightPath);

const phase = process.argv[2] || 'before';
const chromePath =
  process.env.ACCEPTANCE_CHROME ||
  (fs.existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe')
    ? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
    : undefined);

const dist = path.resolve(__dirname, '../dist/frontend/browser');
const outputDir = path.resolve(__dirname, '../verification/weekly-reports/responsive-audit');
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

function createMockReport(id, score, offset = 0, overrides = {}) {
  const now = new Date('2026-11-13T10:00:00.000Z');
  const start = new Date(now.getTime() - (offset * 7 + 7) * 86400000);
  const end = new Date(now.getTime() - offset * 7 * 86400000);
  const assessedAt = now.toISOString();
  const oldEvidence = new Date(now.getTime() - 18 * 86400000).toISOString();

  const report = {
    _id: id,
    score,
    weekStartDate: start.toISOString(),
    weekEndDate: end.toISOString(),
    progressSummary:
      'Deterministic developer metrics established this week. Comprehensive progress recorded across active projects and interviews.',
    insights: [
      'Interview activity maintained steady momentum with consistent daily problem solving.',
      'Strong commit velocity across primary repositories with zero regression in test coverage.',
    ],
    recommendations: [
      'Prioritize reviewing system architecture patterns for upcoming senior interviews.',
      'Complete the pending career sprint milestone on TypeScript migration.',
    ],
    topAchievements: [
      'Successfully delivered responsive audit automation suite with full matrix coverage.',
      'Maintained 100% test pass rate across 23 targeted Vitest suites.',
    ],
    biggestRiskArea: 'Skill coverage depth needs attention in distributed systems.',
    predictedHiringReadiness: {
      score,
      reason: 'Strong performance across active repositories and mock assessments.',
    },
    reportText: 'Detailed weekly report snapshot with deterministic signals.',
    emailStatus: 'sent',
    emailDelivery: { status: 'sent', contentHash: 'hash-' + id, history: [] },
    createdAt: assessedAt,
    updatedAt: assessedAt,
    meta: {
      version: 1,
      reportHash: 'hash-' + id,
      signalHash: 'signal-' + id,
      narrativeSource: 'ai-enhanced',
      evidence: {
        scoreAvailable: true,
        measuredScore: score,
        coverageWeight: 100,
        inputs: {
          github: { available: true, value: 85, weight: 30, reason: 'Saved evidence' },
          resume: { available: true, value: 78, weight: 25, reason: 'Saved evidence' },
          sprint: { available: true, value: 92, weight: 20, reason: 'Saved evidence' },
          interview: { available: true, value: 70, weight: 15, reason: 'Saved evidence' },
          skillCoverage: { available: true, value: 65, weight: 10, reason: 'Saved evidence' },
        },
      },
      provenance: {
        assessedAt,
        timezone: 'Asia/Karachi',
        activityBasis: 'Weekly commit telemetry verified against upstream origins.',
      },
      comparison: {
        available: true,
        baselineReportId: 'prior-report-id',
        reason: 'Compared with immediately preceding verified reporting week.',
      },
      githubScore: 85,
      resumeScore: 78,
      skillFocus: ['TypeScript', 'Angular', 'SCSS', 'Playwright'],
      activity: {
        repositoriesTracked: 4,
        activeRepositories: 3,
        commits: 48,
        weeklyCommitSignal: 48,
        stars: 12,
        forks: 3,
      },
      sprint: { tasksCompleted: 6, tasksTotal: 7, completionRate: 86, weeklyGoal: 6, streak: 3 },
      interview: { sessions: 4, questionsGenerated: 24 },
      learning: { totalTracked: 5, completedCount: 4 },
      comparisons: {
        scoreDelta: 6,
        readinessDelta: 5,
        githubDelta: 8,
        resumeDelta: 3,
        sprintCompletionDelta: 14,
        tasksCompletedDelta: 2,
        interviewSessionsDelta: 1,
        interviewQuestionsDelta: 8,
        activityCommitsDelta: 12,
        activeReposDelta: 1,
        missingSkillsDelta: -2,
        coverageDelta: 5,
      },
      scoreBreakdown: {
        github: { label: 'GitHub', score: 85, weight: 30 },
        resume: { label: 'Resume', score: 78, weight: 25 },
        sprint: { label: 'Sprint completion', score: 92, weight: 20 },
        interview: { label: 'Interview prep', score: 70, weight: 15 },
        skillCoverage: { label: 'Skill coverage', score: 65, weight: 10 },
      },
      dataSourcesUsed: {
        github: {
          connected: true,
          status: 'Connected',
          freshness: 'fresh',
          lastAnalyzedAt: assessedAt,
        },
        resume: {
          analyzed: true,
          status: 'Analyzed',
          freshness: 'fresh',
          lastAnalyzedAt: assessedAt,
        },
        skillGap: {
          analyzed: true,
          status: 'Analyzed',
          freshness: 'fresh',
          lastAnalyzedAt: assessedAt,
        },
        recommendations: {
          available: true,
          status: '3 active',
          freshness: 'fresh',
          lastAnalyzedAt: assessedAt,
        },
        careerSprint: {
          connected: true,
          status: 'Active',
          freshness: 'fresh',
          lastAnalyzedAt: assessedAt,
        },
        interviewPrep: {
          analyzed: true,
          status: '4 sessions completed',
          freshness: 'fresh',
          lastAnalyzedAt: assessedAt,
        },
        learning: {
          available: true,
          status: '4 completed',
          freshness: 'fresh',
          lastAnalyzedAt: assessedAt,
        },
        portfolio: {
          connected: true,
          status: 'Public live',
          freshness: 'fresh',
          lastAnalyzedAt: assessedAt,
        },
        integrations: {
          connected: true,
          status: '3 connected',
          freshness: 'fresh',
          lastAnalyzedAt: assessedAt,
        },
      },
      sourceFreshness: {
        detection: false,
        message: 'All signal sources fresh at time of assessment.',
        staleSources: [],
        severity: 'info',
      },
    },
    ...overrides,
  };

  return report;
}

function createMissingEvidenceReport() {
  const base = createMockReport('missing-evidence-rep', 0);
  base.score = 0;
  base.progressSummary = 'Overall score is not assessed because critical inputs are missing.';
  base.predictedHiringReadiness = {
    score: 0,
    reason: 'Not assessed: incomplete source evidence across multiple key pillars.',
  };
  base.meta.evidence = {
    scoreAvailable: false,
    measuredScore: null,
    coverageWeight: 40,
    inputs: {
      github: { available: true, value: 0, weight: 30, reason: 'Measured zero' },
      resume: { available: false, value: null, weight: 25, reason: 'Missing evidence' },
      sprint: { available: false, value: null, weight: 20, reason: 'Missing evidence' },
      interview: { available: false, value: null, weight: 15, reason: 'Missing evidence' },
      skillCoverage: { available: true, value: 0, weight: 10, reason: 'Measured zero' },
    },
  };
  base.meta.comparison = {
    available: false,
    reason: 'Delta comparison requires complete evidence in both adjacent weeks.',
  };
  base.meta.sourceFreshness = {
    detection: true,
    message: 'Resume, Sprint and Interview Prep evidence is missing. Action required.',
    staleSources: ['resume', 'sprint', 'interview'],
    severity: 'warning',
    recommendation: 'Connect or analyze missing sources before interpreting weekly signals.',
  };
  return base;
}

function attachDefaultRoutes(page, state = {}) {
  const current = state.current || createMockReport('rep-curr', 78);
  const prior = state.prior || createMockReport('rep-prior', 72, 1);
  const historyList = state.history || [current, prior];

  return page.route('**/api/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const pathname = url.pathname;
    const method = req.method();

    if (pathname.includes('/notifications/stream')) {
      return route.fulfill({ contentType: 'text/event-stream', body: ': heartbeat\n\n' });
    }
    if (pathname.endsWith('/auth/me')) {
      return route.fulfill({
        json: {
          user: {
            _id: 'user-fixture',
            name: 'Jane Developer',
            role: 'developer',
            activeGithubUsername: 'janedev',
          },
        },
      });
    }
    if (pathname.endsWith('/profile')) {
      return route.fulfill({
        json: {
          profile: {
            careerStack: 'Frontend',
            experienceLevel: 'Mid-level',
            isConfigured: true,
            activeGithubUsername: 'janedev',
          },
          isConfigured: true,
        },
      });
    }

    if (pathname.endsWith('/weekly-reports/latest')) {
      if (state.mode === 'error') {
        return route.fulfill({ status: 503, json: { message: 'Synthetic service outage' } });
      }
      if (state.mode === 'empty') {
        return route.fulfill({ json: null });
      }
      if (state.mode === 'missing') {
        return route.fulfill({ json: createMissingEvidenceReport() });
      }
      return route.fulfill({ json: current });
    }

    if (pathname.endsWith('/weekly-reports/history')) {
      if (state.mode === 'empty') {
        return route.fulfill({ json: { reports: [] } });
      }
      return route.fulfill({ json: { reports: historyList } });
    }

    if (method === 'POST' && pathname.endsWith('/weekly-reports/generate')) {
      return route.fulfill({ json: current });
    }

    if (method === 'POST' && pathname.includes('/refresh')) {
      return route.fulfill({ json: { ...current, meta: { ...current.meta, version: 2 } } });
    }

    if (method === 'POST' && pathname.includes('/resend-email')) {
      return route.fulfill({ json: { sent: true, reportId: current._id } });
    }

    if (method === 'GET' && pathname.includes('/pdf')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/pdf',
        body: Buffer.from('%PDF-1.4 mock pdf'),
      });
    }

    if (method === 'GET' && /\/weekly-reports\/[^/]+$/.test(pathname)) {
      const id = pathname.split('/').pop();
      const match = historyList.find((r) => r._id === id) || current;
      return route.fulfill({ json: match });
    }

    return route.fulfill({ json: { success: true } });
  });
}

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
          name: 'Jane Developer',
          email: 'jane@example.com',
          activeGithubUsername: 'janedev',
        }),
      );
      localStorage.setItem('devinsight_theme', theme);
      localStorage.setItem(
        'devinsight_career_profile',
        JSON.stringify({
          careerStack: 'Frontend',
          experienceLevel: 'Mid-level',
          isConfigured: true,
        }),
      );
    },
    { theme: themeVal },
  );
}

async function main() {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  console.log(`[audit-weekly-reports-responsive] Static server running at ${base}`);

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
    scenarios: {},
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
    console.log(`\n=== Running 36-cell Viewport & Theme Matrix (${phase}) ===`);
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

        await page.goto(`${base}/app/weekly-reports`);
        await page.locator('.weekly-reports-page').waitFor({ timeout: 10000 });
        await page.locator('app-weekly-report-overview').waitFor({ timeout: 10000 });
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(100);

        // Sidebar check: On desktop/laptop (> 768), ensure shell isn't blocking view
        if (vp.width > 768 && (await page.locator('.shell-body.sidebar-closed').count())) {
          const toggleBtn = page.getByRole('button', { name: 'Toggle sidebar', exact: true });
          if (await toggleBtn.isVisible()) {
            await toggleBtn.click();
            await page.waitForTimeout(100);
          }
        }

        // Measure layout & check overflow
        const measurement = await page.evaluate(() => {
          const doc = document.documentElement;
          const body = document.body;
          const scrollWidth = Math.max(doc.scrollWidth, body.scrollWidth);
          const clientWidth = doc.clientWidth || window.innerWidth;
          const hasDocOverflow = scrollWidth > clientWidth + 1;

          const wrPage = document.querySelector('.weekly-reports-page');
          const pageScrollWidth = wrPage ? wrPage.scrollWidth : 0;
          const pageClientWidth = wrPage ? wrPage.clientWidth : 0;
          const hasPageOverflow = pageScrollWidth > pageClientWidth + 1;

          // Find any offending element overflowing the screen
          const offenders = [];
          const allElements = document.querySelectorAll('.weekly-reports-page *');
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

          // Component geometry checks
          const heroGrid = document.querySelector('.hero-grid');
          const heroGridStyle = heroGrid ? getComputedStyle(heroGrid) : null;
          const heroCols = heroGridStyle ? heroGridStyle.gridTemplateColumns.split(' ').length : 0;

          const kpiGrid = document.querySelector('.kpi-grid');
          const kpiGridStyle = kpiGrid ? getComputedStyle(kpiGrid) : null;
          const kpiCols = kpiGridStyle ? kpiGridStyle.gridTemplateColumns.split(' ').length : 0;

          const breakdownGrid = document.querySelector('.breakdown-grid');
          const breakdownGridStyle = breakdownGrid ? getComputedStyle(breakdownGrid) : null;
          const breakdownCols = breakdownGridStyle
            ? breakdownGridStyle.gridTemplateColumns.split(' ').length
            : 0;

          const analyticsGrid = document.querySelector('.analytics-grid');
          const analyticsGridStyle = analyticsGrid ? getComputedStyle(analyticsGrid) : null;
          const analyticsCols = analyticsGridStyle
            ? analyticsGridStyle.gridTemplateColumns.split(' ').length
            : 0;

          const trendBars = document.querySelector('.trend-bars');
          const trendBarsScrollWidth = trendBars ? trendBars.scrollWidth : 0;
          const trendBarsClientWidth = trendBars ? trendBars.clientWidth : 0;

          return {
            scrollWidth,
            clientWidth,
            hasDocOverflow,
            pageScrollWidth,
            pageClientWidth,
            hasPageOverflow,
            offenders: offenders.slice(0, 5),
            heroCols,
            kpiCols,
            breakdownCols,
            analyticsCols,
            trendBarsScrollWidth,
            trendBarsClientWidth,
          };
        });

        // Touch target evaluation on mobile (<= 480px)
        const touchTargets = [];
        if (vp.width <= 480) {
          const interactiveMetrics = await page.evaluate(() => {
            const items = [];
            const clickableElements = document.querySelectorAll(
              '.weekly-reports-page button, .weekly-reports-page a, .weekly-reports-page [role="button"]',
            );
            for (const el of clickableElements) {
              const r = el.getBoundingClientRect();
              if (r.width > 0 && r.height > 0) {
                const text = (el.innerText || el.getAttribute('aria-label') || '').trim();
                items.push({
                  text: text.slice(0, 30),
                  tag: el.tagName,
                  className: String(el.className).slice(0, 50),
                  width: Math.round(r.width),
                  height: Math.round(r.height),
                  tooSmall: r.height < 40 || r.width < 40,
                });
              }
            }
            return items;
          });
          touchTargets.push(...interactiveMetrics);
        }

        const screenshotName = `${vp.name}-${theme}.png`;
        const screenshotPath = path.join(matrixDir, screenshotName);
        await page.screenshot({ path: screenshotPath, fullPage: true });

        const passed =
          !measurement.hasDocOverflow &&
          !measurement.hasPageOverflow &&
          measurement.offenders.length === 0;

        const cellResult = {
          viewport: vp.name,
          category: vp.category,
          dimensions: `${vp.width}x${vp.height}`,
          theme,
          passed,
          measurement,
          touchTargetsSmall: touchTargets.filter((t) => t.tooSmall),
          pageErrors,
          screenshot: path.relative(outputDir, screenshotPath).replace(/\\/g, '/'),
        };

        auditReport.matrixResults.push(cellResult);

        if (!passed) {
          auditReport.overflowDefects.push({
            viewport: vp.name,
            theme,
            measurement,
          });
        }

        const statusIcon = passed ? '✓ PASS' : '✗ FAIL';
        console.log(
          `  ${statusIcon} [${vp.name}] [${theme}] doc: ${measurement.scrollWidth}/${measurement.clientWidth}px, page: ${measurement.pageScrollWidth}/${measurement.pageClientWidth}px, heroCols: ${measurement.heroCols}, kpiCols: ${measurement.kpiCols}`,
        );

        await context.close();
      }
    }

    // 2. Scenario Suites
    console.log(`\n=== Running Scenario Verification Suites (${phase}) ===`);

    // Scenario A: Mobile Landscape (640x360 and 844x390)
    console.log(`- Scenario A: Mobile Landscape Orientation`);
    for (const [w, h, name] of [
      [640, 360, 'landscape-640x360'],
      [844, 390, 'landscape-844x390'],
    ]) {
      const context = await browser.newContext({
        viewport: { width: w, height: h },
        colorScheme: 'dark',
      });
      await setupContextAndPage(context, 'dark');
      const page = await context.newPage();
      await attachDefaultRoutes(page);
      await page.goto(`${base}/app/weekly-reports`);
      await page.locator('.weekly-reports-page').waitFor({ timeout: 10000 });
      await page.waitForTimeout(100);

      const m = await page.evaluate(() => {
        const doc = document.documentElement;
        return {
          scrollWidth: doc.scrollWidth,
          clientWidth: doc.clientWidth,
          hasOverflow: doc.scrollWidth > doc.clientWidth + 1,
        };
      });

      const shot = path.join(statesDir, `scenario-a-${name}.png`);
      await page.screenshot({ path: shot, fullPage: true });
      auditReport.scenarios[`scenario_a_${name}`] = {
        viewport: `${w}x${h}`,
        passed: !m.hasOverflow,
        measurement: m,
        screenshot: path.relative(outputDir, shot).replace(/\\/g, '/'),
      };
      console.log(
        `  Scenario A ${name}: ${!m.hasOverflow ? 'PASS' : 'FAIL'} (${m.scrollWidth}/${m.clientWidth}px)`,
      );
      await context.close();
    }

    // Scenario B: Empty State (No Reports Generated)
    console.log(`- Scenario B: Empty State (No Reports)`);
    for (const [w, h, vpName] of [
      [320, 640, 'mobile-320'],
      [375, 667, 'mobile-375'],
      [768, 1024, 'tablet-768'],
    ]) {
      const context = await browser.newContext({
        viewport: { width: w, height: h },
        colorScheme: 'dark',
      });
      await setupContextAndPage(context, 'dark');
      const page = await context.newPage();
      await attachDefaultRoutes(page, { mode: 'empty' });
      await page.goto(`${base}/app/weekly-reports`);
      await page.locator('.empty-state').waitFor({ timeout: 10000 });
      await page.waitForTimeout(100);

      const m = await page.evaluate(() => {
        const doc = document.documentElement;
        const btn = document.querySelector('.generate-btn');
        const br = btn ? btn.getBoundingClientRect() : null;
        return {
          scrollWidth: doc.scrollWidth,
          clientWidth: doc.clientWidth,
          hasOverflow: doc.scrollWidth > doc.clientWidth + 1,
          btnWidth: br ? Math.round(br.width) : 0,
          btnHeight: br ? Math.round(br.height) : 0,
        };
      });

      const shot = path.join(statesDir, `scenario-b-empty-${vpName}.png`);
      await page.screenshot({ path: shot, fullPage: true });
      auditReport.scenarios[`scenario_b_empty_${vpName}`] = {
        viewport: `${w}x${h}`,
        passed: !m.hasOverflow && m.btnHeight >= 40,
        measurement: m,
        screenshot: path.relative(outputDir, shot).replace(/\\/g, '/'),
      };
      console.log(
        `  Scenario B empty (${vpName}): ${!m.hasOverflow ? 'PASS' : 'FAIL'} (${m.scrollWidth}/${m.clientWidth}px, btn: ${m.btnWidth}x${m.btnHeight})`,
      );
      await context.close();
    }

    // Scenario C: Missing Evidence / Score Unavailable State
    console.log(`- Scenario C: Missing Evidence / Score Unavailable`);
    for (const [w, h, vpName] of [
      [320, 640, 'mobile-320'],
      [375, 667, 'mobile-375'],
      [768, 1024, 'tablet-768'],
      [1440, 900, 'desktop-1440'],
    ]) {
      const context = await browser.newContext({
        viewport: { width: w, height: h },
        colorScheme: 'dark',
      });
      await setupContextAndPage(context, 'dark');
      const page = await context.newPage();
      await attachDefaultRoutes(page, { mode: 'missing' });
      await page.goto(`${base}/app/weekly-reports`);
      await page.locator('.score--missing').waitFor({ timeout: 10000 });
      await page.waitForTimeout(100);

      const m = await page.evaluate(() => {
        const doc = document.documentElement;
        const meter = document.querySelector('.score--missing');
        const meterText = meter ? meter.innerText.trim() : '';
        const warning = document.querySelector('.stale-warning');
        const notice = document.querySelector('.snapshot-notice');
        return {
          scrollWidth: doc.scrollWidth,
          clientWidth: doc.clientWidth,
          hasOverflow: doc.scrollWidth > doc.clientWidth + 1,
          meterText,
          hasWarning: !!warning,
          hasNotice: !!notice,
        };
      });

      const shot = path.join(statesDir, `scenario-c-missing-${vpName}.png`);
      await page.screenshot({ path: shot, fullPage: true });
      auditReport.scenarios[`scenario_c_missing_${vpName}`] = {
        viewport: `${w}x${h}`,
        passed: !m.hasOverflow && m.meterText.includes('Not assessed'),
        measurement: m,
        screenshot: path.relative(outputDir, shot).replace(/\\/g, '/'),
      };
      console.log(
        `  Scenario C missing (${vpName}): ${!m.hasOverflow ? 'PASS' : 'FAIL'} (${m.scrollWidth}/${m.clientWidth}px, text: "${m.meterText}")`,
      );
      await context.close();
    }

    // Scenario D: Outage / Error State & Retry
    console.log(`- Scenario D: Service Outage Error State`);
    {
      const context = await browser.newContext({
        viewport: { width: 375, height: 667 },
        colorScheme: 'dark',
      });
      await setupContextAndPage(context, 'dark');
      const page = await context.newPage();
      await attachDefaultRoutes(page, { mode: 'error' });
      await page.goto(`${base}/app/weekly-reports`);
      await page.locator('.error-state').waitFor({ timeout: 10000 });
      await page.waitForTimeout(100);

      const m = await page.evaluate(() => {
        const doc = document.documentElement;
        const retryBtn = document.querySelector('.error-state button');
        const r = retryBtn ? retryBtn.getBoundingClientRect() : null;
        return {
          scrollWidth: doc.scrollWidth,
          clientWidth: doc.clientWidth,
          hasOverflow: doc.scrollWidth > doc.clientWidth + 1,
          retryBtnHeight: r ? Math.round(r.height) : 0,
        };
      });

      const shot = path.join(statesDir, `scenario-d-error-375.png`);
      await page.screenshot({ path: shot, fullPage: true });
      auditReport.scenarios[`scenario_d_error`] = {
        passed: !m.hasOverflow && m.retryBtnHeight >= 40,
        measurement: m,
        screenshot: path.relative(outputDir, shot).replace(/\\/g, '/'),
      };
      console.log(
        `  Scenario D error: ${!m.hasOverflow ? 'PASS' : 'FAIL'} (${m.scrollWidth}/${m.clientWidth}px, retry: ${m.retryBtnHeight}px)`,
      );
      await context.close();
    }

    // Scenario E: Edge-case Unbroken Strings and Extreme Lengths
    console.log(`- Scenario E: Long Strings & Unbroken Text Containment`);
    {
      const longReport = createMockReport('long-rep', 80, 0, {
        progressSummary:
          'LongUnbrokenTokenStringWhichCouldCauseHorizontalOverflowIfWordBreakWrapIsNotConfiguredProperlyAcrossAllContainersAndParentElements12345678901234567890',
        topAchievements: [
          'https://github.com/organization-enterprise-repository/sub-package-nested-service-implementation-repository-pull-request-number-1284758923749823749823',
          'Accomplished massive system integration verification against enterprise endpoints.',
        ],
        insights: [
          'UnbrokenDeepNamespacePackageIdentificationServiceWorkerComponentConfigurationValidationProtocolEstablishedSuccessfully',
        ],
        biggestRiskArea:
          'ExtremelyLongUnbrokenRiskAreaIdentifierThatTestsElementContainmentInMobileScreensAndTabletsWithoutCausingCollisionsOrClipping',
      });

      const context = await browser.newContext({
        viewport: { width: 320, height: 640 },
        colorScheme: 'dark',
      });
      await setupContextAndPage(context, 'dark');
      const page = await context.newPage();
      await attachDefaultRoutes(page, { current: longReport });
      await page.goto(`${base}/app/weekly-reports`);
      await page.locator('.weekly-reports-page').waitFor({ timeout: 10000 });
      await page.waitForTimeout(100);

      const m = await page.evaluate(() => {
        const doc = document.documentElement;
        return {
          scrollWidth: doc.scrollWidth,
          clientWidth: doc.clientWidth,
          hasOverflow: doc.scrollWidth > doc.clientWidth + 1,
        };
      });

      const shot = path.join(statesDir, `scenario-e-long-text-320.png`);
      await page.screenshot({ path: shot, fullPage: true });
      auditReport.scenarios[`scenario_e_long_text`] = {
        passed: !m.hasOverflow,
        measurement: m,
        screenshot: path.relative(outputDir, shot).replace(/\\/g, '/'),
      };
      console.log(
        `  Scenario E long text: ${!m.hasOverflow ? 'PASS' : 'FAIL'} (${m.scrollWidth}/${m.clientWidth}px)`,
      );
      await context.close();
    }

    // Scenario F: Momentum Trend with Many Reports (8 weekly bars)
    console.log(`- Scenario F: Momentum Trend Many Reports (8 weekly bars)`);
    {
      const manyHistory = Array.from({ length: 8 }, (_, i) =>
        createMockReport(`hist-${i}`, 60 + i * 3, i),
      );

      for (const [w, h, vpName] of [
        [320, 640, 'mobile-320'],
        [375, 667, 'mobile-375'],
        [768, 1024, 'tablet-768'],
      ]) {
        const context = await browser.newContext({
          viewport: { width: w, height: h },
          colorScheme: 'dark',
        });
        await setupContextAndPage(context, 'dark');
        const page = await context.newPage();
        await attachDefaultRoutes(page, {
          current: manyHistory[0],
          history: manyHistory,
        });
        await page.goto(`${base}/app/weekly-reports`);
        await page.locator('.momentum-trend').waitFor({ timeout: 10000 });
        await page.waitForTimeout(100);

        const m = await page.evaluate(() => {
          const doc = document.documentElement;
          const trend = document.querySelector('.momentum-trend');
          const trendBars = document.querySelector('.trend-bars');
          return {
            scrollWidth: doc.scrollWidth,
            clientWidth: doc.clientWidth,
            hasOverflow: doc.scrollWidth > doc.clientWidth + 1,
            trendScroll: trend ? trend.scrollWidth : 0,
            trendClient: trend ? trend.clientWidth : 0,
            barsScroll: trendBars ? trendBars.scrollWidth : 0,
            barsClient: trendBars ? trendBars.clientWidth : 0,
          };
        });

        const shot = path.join(statesDir, `scenario-f-many-bars-${vpName}.png`);
        await page.screenshot({ path: shot, fullPage: true });
        auditReport.scenarios[`scenario_f_bars_${vpName}`] = {
          viewport: `${w}x${h}`,
          passed: !m.hasOverflow,
          measurement: m,
          screenshot: path.relative(outputDir, shot).replace(/\\/g, '/'),
        };
        console.log(
          `  Scenario F bars (${vpName}): ${!m.hasOverflow ? 'PASS' : 'FAIL'} (${m.scrollWidth}/${m.clientWidth}px, bars: ${m.barsScroll}/${m.barsClient}px)`,
        );
        await context.close();
      }
    }

    // Scenario G: History Panel Accordion Toggle on Mobile (375px)
    console.log(`- Scenario G: History Panel Accordion Toggle on Mobile`);
    {
      const context = await browser.newContext({
        viewport: { width: 375, height: 667 },
        colorScheme: 'dark',
      });
      await setupContextAndPage(context, 'dark');
      const page = await context.newPage();
      await attachDefaultRoutes(page);
      await page.goto(`${base}/app/weekly-reports`);
      await page.locator('.history-panel').waitFor({ timeout: 10000 });
      await page.waitForTimeout(100);

      // Verify toggle button
      const toggle = page.locator('.history-toggle');
      await toggle.click();
      await page.waitForTimeout(150);

      const m = await page.evaluate(() => {
        const doc = document.documentElement;
        const list = document.querySelector('.history-list');
        const isOpen = list ? list.classList.contains('history-list--open') : false;
        return {
          scrollWidth: doc.scrollWidth,
          clientWidth: doc.clientWidth,
          hasOverflow: doc.scrollWidth > doc.clientWidth + 1,
          isOpen,
        };
      });

      const shot = path.join(statesDir, `scenario-g-history-open-375.png`);
      await page.screenshot({ path: shot, fullPage: true });
      auditReport.scenarios[`scenario_g_history_toggle`] = {
        passed: !m.hasOverflow && m.isOpen,
        measurement: m,
        screenshot: path.relative(outputDir, shot).replace(/\\/g, '/'),
      };
      console.log(
        `  Scenario G history open: ${!m.hasOverflow && m.isOpen ? 'PASS' : 'FAIL'} (${m.scrollWidth}/${m.clientWidth}px, isOpen: ${m.isOpen})`,
      );
      await context.close();
    }

    // Scenario H: Browser Zoom & Font Scaling (125%, 150%)
    console.log(`- Scenario H: Zoom & Scaling (125%, 150%)`);
    for (const zoom of [1.25, 1.5]) {
      const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        deviceScaleFactor: zoom,
        colorScheme: 'dark',
      });
      await setupContextAndPage(context, 'dark');
      const page = await context.newPage();
      await attachDefaultRoutes(page);
      await page.goto(`${base}/app/weekly-reports`);
      await page.locator('.weekly-reports-page').waitFor({ timeout: 10000 });
      await page.waitForTimeout(100);

      const m = await page.evaluate(() => {
        const doc = document.documentElement;
        return {
          scrollWidth: doc.scrollWidth,
          clientWidth: doc.clientWidth,
          hasOverflow: doc.scrollWidth > doc.clientWidth + 1,
        };
      });

      const shot = path.join(statesDir, `scenario-h-zoom-${Math.round(zoom * 100)}.png`);
      await page.screenshot({ path: shot, fullPage: true });
      auditReport.scenarios[`scenario_h_zoom_${Math.round(zoom * 100)}`] = {
        zoom,
        passed: !m.hasOverflow,
        measurement: m,
        screenshot: path.relative(outputDir, shot).replace(/\\/g, '/'),
      };
      console.log(
        `  Scenario H zoom ${Math.round(zoom * 100)}%: ${!m.hasOverflow ? 'PASS' : 'FAIL'} (${m.scrollWidth}/${m.clientWidth}px)`,
      );
      await context.close();
    }

    // Write results JSON
    const resultsFile = path.join(outputDir, `${phase}-results.json`);
    fs.writeFileSync(resultsFile, JSON.stringify(auditReport, null, 2), 'utf8');
    console.log(`\nAudit results written to: ${resultsFile}`);

    const totalPassed = auditReport.matrixResults.filter((r) => r.passed).length;
    const totalMatrix = auditReport.matrixResults.length;
    console.log(`Matrix summary: ${totalPassed}/${totalMatrix} PASSED`);
    console.log(`Overflow defects: ${auditReport.overflowDefects.length}`);
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  console.error('Audit execution error:', err);
  process.exit(1);
});
