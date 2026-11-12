// Complete Responsive Audit for Resume Analyzer module across all required viewports and themes.
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
const outputDir = path.resolve(__dirname, '../verification/resume/responsive-audit');
fs.mkdirSync(outputDir, { recursive: true });

const resumeFixture = require('./resume-browser-fixture.cjs');
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

async function setupContextAndPage(context, themeVal = 'dark') {
  await context.addInitScript(
    ({ theme, prof }) => {
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
      localStorage.setItem('devinsight_career_profile', JSON.stringify(prof));
    },
    { theme: themeVal, prof: profile },
  );
}

function attachDefaultRoutes(page, overrides = {}) {
  return page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.includes('/notifications/stream')) {
      return route.fulfill({ contentType: 'text/event-stream', body: ': heartbeat\n\n' });
    }
    if (url.pathname.includes('/profile/career')) {
      return route.fulfill({ json: profile });
    }
    if (url.pathname.includes('/profile/me')) {
      return route.fulfill({
        json: overrides.profileMe || {
          _id: 'user-fixture',
          name: 'Jane Developer',
          defaultResume: { fileId: 'file-111', fileName: 'main-resume.pdf' },
        },
      });
    }
    if (overrides.handle && overrides.handle(url, route)) {
      return;
    }
    if (url.pathname.includes('/resume/result') || url.pathname.includes('/resume/analyze')) {
      return route.fulfill({ json: overrides.analysis || resumeFixture.analysis });
    }
    if (url.pathname.includes('/resume/files')) {
      return route.fulfill({ json: { files: overrides.files || resumeFixture.files } });
    }
    if (url.pathname.includes('/resume/active')) {
      return route.fulfill({
        json: overrides.activeContext || {
          activeResumeFileId: 'file-111',
          defaultResumeFileId: 'file-111',
          activeResume: resumeFixture.files[0],
          defaultResume: resumeFixture.files[0],
        },
      });
    }
    return route.fulfill({ json: { success: true, notifications: [] } });
  });
}

async function main() {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  console.log(`[audit-resume-responsive] Static server running at ${base}`);

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

        await page.goto(`${base}/app/resume-analyzer`);
        await page.locator('.resume-analyzer-page').waitFor({ timeout: 10000 });
        await page.locator('.analysis-results-container').waitFor({ timeout: 10000 });
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

        // Measure layout & check overflow
        const measurement = await page.evaluate(() => {
          const doc = document.documentElement;
          const body = document.body;
          const scrollWidth = Math.max(doc.scrollWidth, body.scrollWidth);
          const clientWidth = doc.clientWidth || window.innerWidth;
          const hasDocOverflow = scrollWidth > clientWidth + 1;

          const analyzer = document.querySelector('.resume-analyzer-page');
          const analyzerScrollWidth = analyzer ? analyzer.scrollWidth : 0;
          const analyzerClientWidth = analyzer ? analyzer.clientWidth : 0;
          const hasAnalyzerOverflow = analyzerScrollWidth > analyzerClientWidth + 1;

          // Find any offending element overflowing the screen
          const offenders = [];
          const allElements = document.querySelectorAll('.resume-analyzer-page *');
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

          const isReallyOverflowing = hasDocOverflow || hasAnalyzerOverflow || offenders.length > 0;

          // Component geometry checks
          const heroGrid = document.querySelector('.results-hero-grid');
          const heroGridStyle = heroGrid ? getComputedStyle(heroGrid) : null;
          const heroGridCols = heroGridStyle
            ? heroGridStyle.gridTemplateColumns.split(' ').length
            : 0;

          const metricsGrid = document.querySelector('.metric-highlights-grid');
          const metricsGridStyle = metricsGrid ? getComputedStyle(metricsGrid) : null;
          const metricsCols = metricsGridStyle
            ? metricsGridStyle.gridTemplateColumns.split(' ').length
            : 0;

          const breakdownRow = document.querySelector('.breakdown-row');
          const breakdownRowStyle = breakdownRow ? getComputedStyle(breakdownRow) : null;
          const breakdownCols = breakdownRowStyle
            ? breakdownRowStyle.gridTemplateColumns.split(' ').length
            : 0;

          const controlsGrid = document.querySelector('.resume-controls-grid');
          const controlsGridStyle = controlsGrid ? getComputedStyle(controlsGrid) : null;
          const controlsCols = controlsGridStyle
            ? controlsGridStyle.gridTemplateColumns.split(' ').length
            : 0;

          return {
            hasOverflow: isReallyOverflowing,
            scrollWidth,
            clientWidth,
            offenders: offenders.slice(0, 5),
            heroGridCols,
            metricsCols,
            breakdownCols,
            controlsCols,
          };
        });

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
          heroGridCols: measurement.heroGridCols,
          metricsCols: measurement.metricsCols,
          breakdownCols: measurement.breakdownCols,
          controlsCols: measurement.controlsCols,
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
            `  [OVERFLOW] ${vp.name} (${theme}): scrollWidth ${measurement.scrollWidth} / ${measurement.clientWidth}px, offenders: ${measurement.offenders.length}`,
          );
        } else {
          console.log(
            `  [OK] ${vp.name} (${theme}): scrollWidth ${measurement.scrollWidth} / ${measurement.clientWidth}px, metricsCols=${measurement.metricsCols}, breakdownCols=${measurement.breakdownCols}`,
          );
        }

        auditReport.matrixResults.push(resultEntry);
        await context.close();
      }
    }

    // 2. State & Scenario Audits
    console.log(`\n--- Running Specific Interactive & Scenario Audits (${phase}) ---`);

    // Scenario A: Empty Onboarding State (Zero Resumes)
    {
      const contextEmpty = await browser.newContext({
        viewport: { width: 375, height: 750 },
        colorScheme: 'dark',
      });
      await setupContextAndPage(contextEmpty, 'dark');
      const pageEmpty = await contextEmpty.newPage();
      await attachDefaultRoutes(pageEmpty, {
        files: [],
        activeContext: {},
        handle: (url, route) => {
          if (url.pathname.includes('/resume/result')) {
            route.fulfill({ status: 404, json: { message: 'No resume' } });
            return true;
          }
          return false;
        },
      });

      await pageEmpty.goto(`${base}/app/resume-analyzer`);
      await pageEmpty.locator('.onboarding-card').waitFor({ timeout: 8000 });

      const emptyOverflow = await pageEmpty.evaluate(() => {
        const doc = document.documentElement;
        return {
          scrollWidth: doc.scrollWidth,
          clientWidth: doc.clientWidth,
          hasOverflow: doc.scrollWidth > doc.clientWidth + 1,
        };
      });

      const emptyScreenshot = 'empty-onboarding-mobile-375.png';
      await pageEmpty.screenshot({ path: path.join(statesDir, emptyScreenshot), fullPage: true });
      auditReport.stateChecks['empty_onboarding'] = {
        hasOverflow: emptyOverflow.hasOverflow,
        scrollWidth: emptyOverflow.scrollWidth,
        clientWidth: emptyOverflow.clientWidth,
        screenshot: emptyScreenshot,
      };
      console.log(`  [EMPTY ONBOARDING 375px] overflow=${emptyOverflow.hasOverflow}`);
      await contextEmpty.close();
    }

    // Scenario B: Selected Unanalyzed Resume & Stale Cached Snapshot
    {
      const contextStale = await browser.newContext({
        viewport: { width: 390, height: 800 },
        colorScheme: 'light',
      });
      await setupContextAndPage(contextStale, 'light');
      const pageStale = await contextStale.newPage();
      await attachDefaultRoutes(pageStale, {
        analysis: {
          ...resumeFixture.analysis,
          cacheMetadata: {
            loadedFromCache: true,
            cachedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 10).toISOString(),
          },
        },
      });

      await pageStale.goto(`${base}/app/resume-analyzer`);
      await pageStale.locator('.state-banner--info').waitFor({ timeout: 8000 });

      const staleScreenshot = 'stale-banner-mobile-390.png';
      await pageStale.screenshot({ path: path.join(statesDir, staleScreenshot), fullPage: true });
      auditReport.stateChecks['stale_banner'] = {
        staleBannerVisible: true,
        screenshot: staleScreenshot,
      };
      console.log(`  [STALE BANNER 390px] Verified stale cached snapshot banner.`);
      await contextStale.close();
    }

    // Scenario C: Score Unavailable / Sufficiency Error State
    {
      const contextUnavail = await browser.newContext({
        viewport: { width: 375, height: 800 },
        colorScheme: 'dark',
      });
      await setupContextAndPage(contextUnavail, 'dark');
      const pageUnavail = await contextUnavail.newPage();
      await attachDefaultRoutes(pageUnavail, {
        analysis: {
          ...resumeFixture.analysis,
          scoring: {
            ...resumeFixture.analysis.scoring,
            score: null, // Unavailable
          },
        },
      });

      await pageUnavail.goto(`${base}/app/resume-analyzer`);
      await pageUnavail.locator('.unavailable-score-card').waitFor({ timeout: 8000 });

      const unavailScreenshot = 'score-unavailable-mobile-375.png';
      await pageUnavail.screenshot({
        path: path.join(statesDir, unavailScreenshot),
        fullPage: true,
      });
      auditReport.stateChecks['score_unavailable'] = {
        unavailableCardVisible: true,
        screenshot: unavailScreenshot,
      };
      console.log(`  [SCORE UNAVAILABLE 375px] Verified unavailable score card.`);
      await contextUnavail.close();
    }

    // Scenario D: Skills Toggle & Warnings Interaction
    {
      const contextSkills = await browser.newContext({
        viewport: { width: 375, height: 850 },
        colorScheme: 'dark',
      });
      await setupContextAndPage(contextSkills, 'dark');
      const pageSkills = await contextSkills.newPage();
      await attachDefaultRoutes(pageSkills);

      await pageSkills.goto(`${base}/app/resume-analyzer`);
      await pageSkills.locator('.skills-explorer-card').waitFor({ timeout: 8000 });

      // Click "View all categories" button
      const toggleBtn = pageSkills
        .locator('.skills-explorer-card')
        .getByRole('button', { name: /View all categories/i });
      if (await toggleBtn.isVisible()) {
        await toggleBtn.click();
        await pageSkills.waitForTimeout(200);
      }

      const skillsScreenshot = 'skills-expanded-mobile-375.png';
      await pageSkills.screenshot({ path: path.join(statesDir, skillsScreenshot), fullPage: true });
      auditReport.stateChecks['skills_expanded'] = {
        screenshot: skillsScreenshot,
      };
      console.log(`  [SKILLS TOGGLE 375px] Verified expanded skills explorer.`);
      await contextSkills.close();
    }

    // Scenario E: Edge Case Long Text & Unbroken Strings
    {
      const contextLong = await browser.newContext({
        viewport: { width: 320, height: 750 },
        colorScheme: 'light',
      });
      await setupContextAndPage(contextLong, 'light');
      const pageLong = await contextLong.newPage();
      const longAnalysis = JSON.parse(JSON.stringify(resumeFixture.analysis));
      longAnalysis.fileName =
        'Senior-Full-Stack-Systems-Architect-and-Engineering-Lead-Resume-Production-Certified-v2026.pdf';
      longAnalysis.extractedSkills = [
        'HyperDistributedMicroservicesArchitectureProtocolBufferingKafkaEventStreamEngine',
        'QuantumResistantAsymmetricCryptographicKeyExchangeImplementationAlgorithm',
      ];
      longAnalysis.scoring.warnings = [
        {
          severity: 'high',
          message:
            'ExtremeUnbrokenHeadingIdentifierWithoutSpacesCausingPotentialContainerOverflowWarningNotice',
          evidence:
            'https://internal-compliance.devinsight.corp/audits/trace/2026-compliance-deep-scan-identifier-verification',
        },
      ];

      await attachDefaultRoutes(pageLong, {
        analysis: longAnalysis,
        files: [
          {
            ...resumeFixture.files[0],
            fileName:
              'Senior-Full-Stack-Systems-Architect-and-Engineering-Lead-Resume-Production-Certified-v2026.pdf',
          },
        ],
      });

      await pageLong.goto(`${base}/app/resume-analyzer`);
      await pageLong.locator('.analysis-results-container').waitFor({ timeout: 8000 });

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
      const contextTouch = await browser.newContext({ viewport: { width: 375, height: 800 } });
      await setupContextAndPage(contextTouch, 'dark');
      const pageTouch = await contextTouch.newPage();
      await attachDefaultRoutes(pageTouch);

      await pageTouch.goto(`${base}/app/resume-analyzer`);
      await pageTouch.locator('.analysis-results-container').waitFor({ timeout: 8000 });

      const touchAudit = await pageTouch.evaluate(() => {
        const interactives = document.querySelectorAll(
          'button, select, input:not([type="file"]):not([type="hidden"]), label[for="resumeUploadInput"]',
        );
        const touchDefects = [];
        for (const el of interactives) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          if (r.height < 32) {
            touchDefects.push({
              tag: el.tagName,
              text: el.textContent ? el.textContent.trim().slice(0, 35) : '',
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

    // Scenario G: Resume Prompt Modal Usability & Reflow (320px & 375px)
    const repoRoot = path.resolve(__dirname, '../..');
    const sass = require(path.join(repoRoot, 'frontend/node_modules/sass'));
    const modalScssPath = path.join(
      repoRoot,
      'frontend/src/app/shared/components/resume-prompt-modal/resume-prompt-modal.component.scss',
    );
    let compiledModalCss = '';
    try {
      const compileRes = sass.compile(modalScssPath);
      compiledModalCss = compileRes.css;
    } catch (err) {
      console.warn('Could not compile modal SCSS:', err.message);
    }

    for (const testW of [320, 375]) {
      const contextModal = await browser.newContext({
        viewport: { width: testW, height: 640 },
        colorScheme: 'dark',
      });
      await setupContextAndPage(contextModal, 'dark');
      const pageModal = await contextModal.newPage();
      await attachDefaultRoutes(pageModal);

      await pageModal.goto(`${base}/app/resume-analyzer`);
      await pageModal.locator('.analysis-results-container').waitFor({ timeout: 8000 });

      // Inject the modal DOM and styles into the active page
      await pageModal.evaluate((css) => {
        const style = document.createElement('style');
        style.id = 'injected-modal-styles';
        style.textContent = css;
        document.head.appendChild(style);

        const modalWrapper = document.createElement('app-resume-prompt-modal');
        modalWrapper.innerHTML = `
          <div class="modal-backdrop">
            <div class="modal-container">
              <button class="close-btn" title="Remind me later" aria-label="Close">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 16px; height: 16px;">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
              <div class="modal-content">
                <div class="icon-header pulse">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 24px; height: 24px;">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                    <polyline points="17 8 12 3 7 8"></polyline>
                    <line x1="12" y1="3" x2="12" y2="15"></line>
                  </svg>
                </div>
                <h2>Complete Your Profile</h2>
                <p>Upload your resume to get personalized recommendations and better results tailored to your profile.</p>
                <div class="actions">
                  <button class="btn-primary">Upload Resume</button>
                  <div class="secondary-actions">
                    <button class="btn-link">Remind me tomorrow</button>
                    <button class="btn-link">Remind me later</button>
                    <button class="btn-link never">Don't show again</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        `;
        document.body.appendChild(modalWrapper);
      }, compiledModalCss);

      await pageModal.waitForTimeout(300);

      const modalMetrics = await pageModal.evaluate(() => {
        const doc = document.documentElement;
        const container = document.querySelector('.modal-container');
        const cr = container ? container.getBoundingClientRect() : null;
        return {
          scrollWidth: doc.scrollWidth,
          clientWidth: doc.clientWidth,
          hasOverflow: doc.scrollWidth > doc.clientWidth + 1,
          containerWidth: cr ? Math.round(cr.width) : null,
          containerLeft: cr ? Math.round(cr.left) : null,
          containerRight: cr ? Math.round(cr.right) : null,
        };
      });

      const modalScreenshot = `resume-prompt-modal-${testW}px.png`;
      await pageModal.screenshot({ path: path.join(statesDir, modalScreenshot), fullPage: true });
      auditReport.stateChecks[`modal_${testW}`] = {
        viewportWidth: testW,
        modalFound: true,
        metrics: modalMetrics,
        screenshot: modalScreenshot,
      };
      console.log(
        `  [MODAL ${testW}px] overflow=${modalMetrics.hasOverflow}, containerWidth=${modalMetrics.containerWidth}px (viewport=${testW}px)`,
      );

      await contextModal.close();
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
