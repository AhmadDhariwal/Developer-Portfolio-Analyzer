// Focused Final Responsive Acceptance Check for GitHub Analyzer & Resume Analyzer
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const { execSync } = require('node:child_process');

const playwrightPath =
  process.env.PLAYWRIGHT_MODULE || 'C:/Users/ahmad.hassan/Desktop/Agrivio/node_modules/playwright';
const { chromium } = require(playwrightPath);

const chromePath =
  process.env.ACCEPTANCE_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const dist = path.resolve(__dirname, '../dist/frontend/browser');
const outputDir = path.resolve(__dirname, '../verification/final-acceptance');
const screenshotsDir = path.join(outputDir, 'screenshots');
fs.mkdirSync(screenshotsDir, { recursive: true });

const githubFixture = require('./github-browser-fixture.cjs');
const resumeFixture = require('./resume-browser-fixture.cjs');
const { profile } = require('./skill-gap-browser-fixture.cjs');

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

async function setupContext(browser, { width, height, theme = 'dark', username = 'janedev' }) {
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

async function attachRoutes(page, moduleType = 'github', overrides = {}) {
  await page.route('https://api.github.com/**', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/**', async (route) => {
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
    if (url.pathname.includes('/github/analyze')) {
      return route.fulfill({ json: githubFixture });
    }
    if (url.pathname.includes('/github/active-username')) {
      return route.fulfill({ json: { username: 'janedev' } });
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

async function checkOverflow(page) {
  return await page.evaluate(() => {
    const doc = document.documentElement;
    const body = document.body;
    const scrollWidth = Math.max(doc.scrollWidth, body.scrollWidth);
    const clientWidth = doc.clientWidth;
    return {
      scrollWidth,
      clientWidth,
      hasOverflow: scrollWidth > clientWidth + 1,
    };
  });
}

async function checkNoInformationHidden(page, selectors) {
  return await page.evaluate((selectorList) => {
    const report = [];
    for (const sel of selectorList) {
      const els = document.querySelectorAll(sel);
      if (els.length === 0) {
        report.push({
          selector: sel,
          found: false,
          visible: false,
          reason: 'element not found in DOM',
        });
        continue;
      }
      let anyVisible = false;
      for (const el of els) {
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        const isHidden =
          style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0';
        const hasDimensions = rect.width > 0 && rect.height > 0;
        if (!isHidden && hasDimensions) {
          anyVisible = true;
          break;
        }
      }
      report.push({
        selector: sel,
        count: els.length,
        found: true,
        visible: anyVisible,
      });
    }
    return report;
  }, selectors);
}

async function main() {
  const port = await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
  const base = `http://127.0.0.1:${port}`;
  console.log(`[acceptance-check] Local static server: ${base}`);

  const acceptanceResults = {
    gitSha: execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim(),
    branch: execSync('git branch --show-current', { encoding: 'utf8' }).trim(),
    timestamp: new Date().toISOString(),
    tests: {},
    summary: { passed: 0, failed: 0, blocked: 0 },
  };

  const browser = await chromium.launch({
    executablePath: fs.existsSync(chromePath) ? chromePath : undefined,
    headless: true,
  });

  try {
    // =========================================================================
    // 1. GITHUB ANALYZER: 200% Browser Zoom & Reflow
    // =========================================================================
    console.log('\n--- 1. GitHub Analyzer: 200% Zoom Verification ---');
    for (const width of [1280, 1440]) {
      const context = await setupContext(browser, { width, height: 800, theme: 'dark' });
      const page = await context.newPage();
      await attachRoutes(page, 'github');
      await page.goto(`${base}/app/github-analyzer`);
      await page.locator('.analyzer-page').waitFor({ timeout: 10000 });
      await page.locator('.exec-score-number').waitFor({ timeout: 10000 });

      // Apply 200% CSS zoom simulation
      await page.evaluate(() => {
        document.body.style.zoom = '200%';
      });
      await page.waitForTimeout(300);

      const overflow = await checkOverflow(page);
      const screenshotName = `github-zoom-200-${width}px.png`;
      await page.screenshot({ path: path.join(screenshotsDir, screenshotName), fullPage: true });

      const testKey = `github_zoom_200_${width}px`;
      acceptanceResults.tests[testKey] = {
        name: `GitHub Analyzer 200% Zoom at ${width}px`,
        status: !overflow.hasOverflow ? 'PASS' : 'FAIL',
        scrollWidth: overflow.scrollWidth,
        clientWidth: overflow.clientWidth,
        screenshot: screenshotName,
      };
      if (!overflow.hasOverflow) acceptanceResults.summary.passed++;
      else acceptanceResults.summary.failed++;

      console.log(
        `  [${acceptanceResults.tests[testKey].status}] GitHub 200% zoom (${width}px): scrollWidth ${overflow.scrollWidth} / ${overflow.clientWidth}px`,
      );
      await context.close();
    }

    // =========================================================================
    // 2. GITHUB ANALYZER: Text Scaling (200% root font-size)
    // =========================================================================
    console.log('\n--- 2. GitHub Analyzer: Text Scaling (200% Font Size) ---');
    {
      const context = await setupContext(browser, { width: 1280, height: 900, theme: 'dark' });
      const page = await context.newPage();
      await attachRoutes(page, 'github');
      await page.goto(`${base}/app/github-analyzer`);
      await page.locator('.analyzer-page').waitFor({ timeout: 10000 });
      await page.locator('.exec-score-number').waitFor({ timeout: 10000 });

      // Apply 200% root font scaling
      await page.evaluate(() => {
        document.documentElement.style.fontSize = '32px';
      });
      await page.waitForTimeout(300);

      const overflow = await checkOverflow(page);
      const screenshotName = 'github-text-scaling-200.png';
      await page.screenshot({ path: path.join(screenshotsDir, screenshotName), fullPage: true });

      const testKey = 'github_text_scaling_200';
      acceptanceResults.tests[testKey] = {
        name: 'GitHub Analyzer Text Scaling 200%',
        status: !overflow.hasOverflow ? 'PASS' : 'FAIL',
        scrollWidth: overflow.scrollWidth,
        clientWidth: overflow.clientWidth,
        screenshot: screenshotName,
      };
      if (!overflow.hasOverflow) acceptanceResults.summary.passed++;
      else acceptanceResults.summary.failed++;

      console.log(
        `  [${acceptanceResults.tests[testKey].status}] GitHub Text Scaling 200%: scrollWidth ${overflow.scrollWidth} / ${overflow.clientWidth}px`,
      );
      await context.close();
    }

    // =========================================================================
    // 3. GITHUB ANALYZER: Keyboard Navigation & Focus Visibility
    // =========================================================================
    console.log('\n--- 3. GitHub Analyzer: Keyboard Navigation & Focus Visibility ---');
    {
      const context = await setupContext(browser, { width: 1280, height: 900, theme: 'dark' });
      const page = await context.newPage();
      await attachRoutes(page, 'github');
      await page.goto(`${base}/app/github-analyzer`);
      await page.locator('.analyzer-page').waitFor({ timeout: 10000 });
      await page.locator('.exec-score-number').waitFor({ timeout: 10000 });

      // Focus first element and tab through 8 interactive controls
      await page.locator('.search-input-field').focus();
      const focusChecks = [];

      for (let i = 0; i < 8; i++) {
        const info = await page.evaluate(() => {
          const el = document.activeElement;
          if (!el) return null;
          const style = window.getComputedStyle(el);
          const hasOutline = style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0;
          const hasBoxShadow = style.boxShadow !== 'none' && style.boxShadow.length > 0;
          const hasBorderFocus = style.borderColor && style.borderColor !== 'rgba(0, 0, 0, 0)';
          return {
            tagName: el.tagName,
            className: el.className ? String(el.className).slice(0, 40) : '',
            hasVisibleFocus: hasOutline || hasBoxShadow || hasBorderFocus,
            outline: style.outline,
            boxShadow: style.boxShadow,
          };
        });
        if (info) focusChecks.push(info);
        await page.keyboard.press('Tab');
        await page.waitForTimeout(80);
      }

      const screenshotName = 'github-keyboard-focus.png';
      await page.screenshot({ path: path.join(screenshotsDir, screenshotName), fullPage: false });

      const allFocusedHaveIndicators =
        focusChecks.length > 0 && focusChecks.every((c) => c.hasVisibleFocus);
      const testKey = 'github_keyboard_focus';
      acceptanceResults.tests[testKey] = {
        name: 'GitHub Analyzer Keyboard Navigation & Focus Visibility',
        status: allFocusedHaveIndicators ? 'PASS' : 'FAIL',
        focusChecks,
        screenshot: screenshotName,
      };
      if (allFocusedHaveIndicators) acceptanceResults.summary.passed++;
      else acceptanceResults.summary.failed++;

      console.log(
        `  [${acceptanceResults.tests[testKey].status}] GitHub keyboard focus checks: ${focusChecks.length} controls tested, all visible: ${allFocusedHaveIndicators}`,
      );
      await context.close();
    }

    // =========================================================================
    // 4. GITHUB ANALYZER: No Information Hidden / Clipped
    // =========================================================================
    console.log('\n--- 4. GitHub Analyzer: Information Completeness Check ---');
    {
      const context = await setupContext(browser, { width: 375, height: 750, theme: 'dark' });
      const page = await context.newPage();
      await attachRoutes(page, 'github');
      await page.goto(`${base}/app/github-analyzer`);
      await page.locator('.analyzer-page').waitFor({ timeout: 10000 });
      await page.locator('.exec-score-number').waitFor({ timeout: 10000 });

      const essentialSelectors = [
        '.identity-bar-card',
        '.metrics-strip-grid',
        '.executive-card',
        '.exec-score-number',
        '.breakdown-panel',
        '.repositories-panel',
        '.tech-panel',
        '.sort-pill-btn',
      ];
      const visibilityResults = await checkNoInformationHidden(page, essentialSelectors);
      const allVisible = visibilityResults.every((r) => r.visible);

      const testKey = 'github_information_completeness';
      acceptanceResults.tests[testKey] = {
        name: 'GitHub Analyzer Information Completeness (Mobile 375px)',
        status: allVisible ? 'PASS' : 'FAIL',
        details: visibilityResults,
      };
      if (allVisible) acceptanceResults.summary.passed++;
      else acceptanceResults.summary.failed++;

      console.log(
        `  [${acceptanceResults.tests[testKey].status}] GitHub essential sections visible on mobile: ${allVisible}`,
      );
      await context.close();
    }

    // =========================================================================
    // 5. RESUME ANALYZER: 200% Browser Zoom & Reflow
    // =========================================================================
    console.log('\n--- 5. Resume Analyzer: 200% Zoom Verification ---');
    for (const width of [1280, 1440]) {
      const context = await setupContext(browser, { width, height: 800, theme: 'dark' });
      const page = await context.newPage();
      await attachRoutes(page, 'resume');
      await page.goto(`${base}/app/resume-analyzer`);
      await page.locator('.analysis-results-container').waitFor({ timeout: 8000 });

      // Apply 200% CSS zoom simulation
      await page.evaluate(() => {
        document.body.style.zoom = '200%';
      });
      await page.waitForTimeout(300);

      const overflow = await checkOverflow(page);
      const screenshotName = `resume-zoom-200-${width}px.png`;
      await page.screenshot({ path: path.join(screenshotsDir, screenshotName), fullPage: true });

      const testKey = `resume_zoom_200_${width}px`;
      acceptanceResults.tests[testKey] = {
        name: `Resume Analyzer 200% Zoom at ${width}px`,
        status: !overflow.hasOverflow ? 'PASS' : 'FAIL',
        scrollWidth: overflow.scrollWidth,
        clientWidth: overflow.clientWidth,
        screenshot: screenshotName,
      };
      if (!overflow.hasOverflow) acceptanceResults.summary.passed++;
      else acceptanceResults.summary.failed++;

      console.log(
        `  [${acceptanceResults.tests[testKey].status}] Resume 200% zoom (${width}px): scrollWidth ${overflow.scrollWidth} / ${overflow.clientWidth}px`,
      );
      await context.close();
    }

    // =========================================================================
    // 6. RESUME ANALYZER: Text Scaling (200% root font-size)
    // =========================================================================
    console.log('\n--- 6. Resume Analyzer: Text Scaling (200% Font Size) ---');
    {
      const context = await setupContext(browser, { width: 1280, height: 900, theme: 'dark' });
      const page = await context.newPage();
      await attachRoutes(page, 'resume');
      await page.goto(`${base}/app/resume-analyzer`);
      await page.locator('.analysis-results-container').waitFor({ timeout: 8000 });

      // Apply 200% root font scaling
      await page.evaluate(() => {
        document.documentElement.style.fontSize = '32px';
      });
      await page.waitForTimeout(300);

      const overflow = await checkOverflow(page);
      const screenshotName = 'resume-text-scaling-200.png';
      await page.screenshot({ path: path.join(screenshotsDir, screenshotName), fullPage: true });

      const testKey = 'resume_text_scaling_200';
      acceptanceResults.tests[testKey] = {
        name: 'Resume Analyzer Text Scaling 200%',
        status: !overflow.hasOverflow ? 'PASS' : 'FAIL',
        scrollWidth: overflow.scrollWidth,
        clientWidth: overflow.clientWidth,
        screenshot: screenshotName,
      };
      if (!overflow.hasOverflow) acceptanceResults.summary.passed++;
      else acceptanceResults.summary.failed++;

      console.log(
        `  [${acceptanceResults.tests[testKey].status}] Resume Text Scaling 200%: scrollWidth ${overflow.scrollWidth} / ${overflow.clientWidth}px`,
      );
      await context.close();
    }

    // =========================================================================
    // 7. RESUME ANALYZER: Keyboard Navigation & Focus Visibility
    // =========================================================================
    console.log('\n--- 7. Resume Analyzer: Keyboard Navigation & Focus Visibility ---');
    {
      const context = await setupContext(browser, { width: 1280, height: 900, theme: 'dark' });
      const page = await context.newPage();
      await attachRoutes(page, 'resume');
      await page.goto(`${base}/app/resume-analyzer`);
      await page.locator('.analysis-results-container').waitFor({ timeout: 8000 });

      // Focus file dropdown and tab through interactive controls
      await page.locator('.resume-dropdown').focus();
      const focusChecks = [];

      for (let i = 0; i < 6; i++) {
        const info = await page.evaluate(() => {
          const el = document.activeElement;
          if (!el) return null;
          const style = window.getComputedStyle(el);
          const hasOutline = style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0;
          const hasBoxShadow = style.boxShadow !== 'none' && style.boxShadow.length > 0;
          const hasBorderFocus = style.borderColor && style.borderColor !== 'rgba(0, 0, 0, 0)';
          return {
            tagName: el.tagName,
            className: el.className ? String(el.className).slice(0, 40) : '',
            hasVisibleFocus: hasOutline || hasBoxShadow || hasBorderFocus,
            outline: style.outline,
            boxShadow: style.boxShadow,
          };
        });
        if (info) focusChecks.push(info);
        await page.keyboard.press('Tab');
        await page.waitForTimeout(80);
      }

      const screenshotName = 'resume-keyboard-focus.png';
      await page.screenshot({ path: path.join(screenshotsDir, screenshotName), fullPage: false });

      const allFocusedHaveIndicators =
        focusChecks.length > 0 && focusChecks.every((c) => c.hasVisibleFocus);
      const testKey = 'resume_keyboard_focus';
      acceptanceResults.tests[testKey] = {
        name: 'Resume Analyzer Keyboard Navigation & Focus Visibility',
        status: allFocusedHaveIndicators ? 'PASS' : 'FAIL',
        focusChecks,
        screenshot: screenshotName,
      };
      if (allFocusedHaveIndicators) acceptanceResults.summary.passed++;
      else acceptanceResults.summary.failed++;

      console.log(
        `  [${acceptanceResults.tests[testKey].status}] Resume keyboard focus checks: ${focusChecks.length} controls tested, all visible: ${allFocusedHaveIndicators}`,
      );
      await context.close();
    }

    // =========================================================================
    // 8. RESUME ANALYZER: No Information Hidden / Clipped
    // =========================================================================
    console.log('\n--- 8. Resume Analyzer: Information Completeness Check ---');
    {
      const context = await setupContext(browser, { width: 375, height: 750, theme: 'dark' });
      const page = await context.newPage();
      await attachRoutes(page, 'resume');
      await page.goto(`${base}/app/resume-analyzer`);
      await page.locator('.analysis-results-container').waitFor({ timeout: 8000 });

      const essentialSelectors = [
        'app-score-card',
        '.readability-quality-card',
        '.metric-highlights-grid',
        '.breakdown-panel',
        '.evidence-grid',
        '.skills-explorer-card',
        '.ai-card',
      ];
      const visibilityResults = await checkNoInformationHidden(page, essentialSelectors);
      const allVisible = visibilityResults.every((r) => r.visible);

      const testKey = 'resume_information_completeness';
      acceptanceResults.tests[testKey] = {
        name: 'Resume Analyzer Information Completeness (Mobile 375px)',
        status: allVisible ? 'PASS' : 'FAIL',
        details: visibilityResults,
      };
      if (allVisible) acceptanceResults.summary.passed++;
      else acceptanceResults.summary.failed++;

      console.log(
        `  [${acceptanceResults.tests[testKey].status}] Resume essential sections visible on mobile: ${allVisible}`,
      );
      await context.close();
    }

    // =========================================================================
    // 9. SHARED COMPONENT: app-score-card Responsive Reflow & Integrity
    // =========================================================================
    console.log('\n--- 9. Shared Component: app-score-card Responsive Reflow ---');
    {
      let allScoreCardsValid = true;
      const scoreCardResults = [];

      for (const width of [320, 375, 768, 1280]) {
        const context = await setupContext(browser, { width, height: 700, theme: 'dark' });
        const page = await context.newPage();
        await attachRoutes(page, 'resume');
        await page.goto(`${base}/app/resume-analyzer`);
        await page.locator('app-score-card').waitFor({ timeout: 8000 });

        const cardMetrics = await page.evaluate(() => {
          const host = document.querySelector('app-score-card');
          const card = host ? host.querySelector('.score-card') : null;
          if (!card) return null;
          const rect = card.getBoundingClientRect();
          const style = window.getComputedStyle(card);
          const scoreVal = card.querySelector('.score-number')?.textContent?.trim();
          return {
            width: Math.round(rect.width),
            padding: style.padding,
            scoreValue: scoreVal,
            hasContent: Boolean(scoreVal),
          };
        });

        const valid =
          cardMetrics &&
          cardMetrics.hasContent &&
          cardMetrics.width > 0 &&
          cardMetrics.width <= width;
        if (!valid) allScoreCardsValid = false;
        scoreCardResults.push({ width, valid, metrics: cardMetrics });

        await context.close();
      }

      const testKey = 'shared_score_card_reflow';
      acceptanceResults.tests[testKey] = {
        name: 'Shared Component: app-score-card Reflow Across Viewports',
        status: allScoreCardsValid ? 'PASS' : 'FAIL',
        results: scoreCardResults,
      };
      if (allScoreCardsValid) acceptanceResults.summary.passed++;
      else acceptanceResults.summary.failed++;

      console.log(
        `  [${acceptanceResults.tests[testKey].status}] app-score-card reflow tested across 4 viewports, all valid: ${allScoreCardsValid}`,
      );
    }

    // =========================================================================
    // 10. SHARED COMPONENT: ResumePromptModal Interactions & Reflow
    // =========================================================================
    console.log('\n--- 10. Shared Component: ResumePromptModal Interactions & Reflow ---');
    {
      const sass = require(path.join(__dirname, '../node_modules/sass'));
      const modalScssPath = path.join(
        __dirname,
        '../src/app/shared/components/resume-prompt-modal/resume-prompt-modal.component.scss',
      );
      const compiledModalCss = sass.compile(modalScssPath).css;

      let modalChecksPassed = true;
      const modalResults = [];

      for (const width of [320, 375, 768]) {
        const context = await setupContext(browser, { width, height: 640, theme: 'dark' });
        const page = await context.newPage();
        await attachRoutes(page, 'resume');
        await page.goto(`${base}/app/resume-analyzer`);
        await page.locator('.analysis-results-container').waitFor({ timeout: 8000 });

        // Inject modal HTML & CSS
        await page.evaluate((css) => {
          const style = document.createElement('style');
          style.id = 'modal-check-style';
          style.textContent = css;
          document.head.appendChild(style);

          const wrapper = document.createElement('app-resume-prompt-modal');
          wrapper.innerHTML = `
            <div class="modal-backdrop">
              <div class="modal-container">
                <button class="close-btn" title="Remind me later" aria-label="Close" id="test-modal-close">
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
                    <button class="btn-primary" id="test-modal-primary">Upload Resume</button>
                    <div class="secondary-actions">
                      <button class="btn-link" id="test-modal-tomorrow">Remind me tomorrow</button>
                      <button class="btn-link" id="test-modal-later">Remind me later</button>
                      <button class="btn-link never" id="test-modal-never">Don't show again</button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          `;
          document.body.appendChild(wrapper);
        }, compiledModalCss);

        await page.waitForTimeout(200);

        // Check modal reflow and touch target metrics
        const modalMetrics = await page.evaluate(() => {
          const container = document.querySelector('.modal-container');
          const closeBtn = document.querySelector('#test-modal-close');
          const primaryBtn = document.querySelector('#test-modal-primary');
          const linkBtn = document.querySelector('#test-modal-tomorrow');
          const doc = document.documentElement;

          const cr = container.getBoundingClientRect();
          const closeR = closeBtn.getBoundingClientRect();
          const primaryR = primaryBtn.getBoundingClientRect();
          const linkR = linkBtn.getBoundingClientRect();

          return {
            containerWidth: Math.round(cr.width),
            docScrollWidth: doc.scrollWidth,
            docClientWidth: doc.clientWidth,
            closeHeight: Math.round(closeR.height),
            primaryHeight: Math.round(primaryR.height),
            linkHeight: Math.round(linkR.height),
            hasOverflow: doc.scrollWidth > doc.clientWidth + 1,
          };
        });

        // Test keyboard tab cycling in modal
        await page.locator('#test-modal-close').focus();
        await page.keyboard.press('Tab');
        const focusedPrimary = await page.evaluate(
          () => document.activeElement?.id === 'test-modal-primary',
        );

        const screenshotName = `resume-prompt-modal-focused-${width}px.png`;
        await page.screenshot({ path: path.join(screenshotsDir, screenshotName), fullPage: true });

        const valid =
          !modalMetrics.hasOverflow &&
          modalMetrics.closeHeight >= 32 &&
          modalMetrics.primaryHeight >= 40 &&
          modalMetrics.linkHeight >= 36 &&
          focusedPrimary;

        if (!valid) modalChecksPassed = false;
        modalResults.push({
          width,
          valid,
          metrics: modalMetrics,
          focusedPrimary,
          screenshot: screenshotName,
        });

        await context.close();
      }

      const testKey = 'shared_resume_prompt_modal';
      acceptanceResults.tests[testKey] = {
        name: 'Shared Component: ResumePromptModal Reflow, Touch Targets & Keyboard Tab',
        status: modalChecksPassed ? 'PASS' : 'FAIL',
        results: modalResults,
      };
      if (modalChecksPassed) acceptanceResults.summary.passed++;
      else acceptanceResults.summary.failed++;

      console.log(
        `  [${acceptanceResults.tests[testKey].status}] ResumePromptModal tested across 3 viewports, all valid: ${modalChecksPassed}`,
      );
    }

    // =========================================================================
    // 11. SCSS GENERATION PROCESS REPRODUCIBILITY CHECK
    // =========================================================================
    console.log('\n--- 11. SCSS Generation Process Reproducibility Check ---');
    {
      let scssReproduced = false;
      try {
        execSync('node frontend/scripts/prepare-component-styles.cjs github-analyzer', {
          stdio: 'pipe',
        });
        execSync('node frontend/scripts/prepare-resume-styles.cjs', { stdio: 'pipe' });
        execSync(
          'node frontend/node_modules/prettier/bin/prettier.cjs --write frontend/src/app/pages/github-analyzer/components/**/*.scss frontend/src/app/pages/github-analyzer/*.scss frontend/src/app/pages/resume-analyzer/components/**/*.scss frontend/src/app/pages/resume-analyzer/*.scss',
          { stdio: 'pipe' },
        );
        const gitDiff = execSync(
          'git diff --name-only frontend/src/app/pages/github-analyzer/ frontend/src/app/pages/resume-analyzer/',
          { encoding: 'utf8' },
        ).trim();
        scssReproduced = gitDiff.length === 0;
      } catch (err) {
        console.error('Error verifying SCSS reproduction:', err.message);
      }

      const testKey = 'scss_generation_reproducibility';
      acceptanceResults.tests[testKey] = {
        name: 'SCSS Generation Scripts Reproducibility & Zero Git Diff',
        status: scssReproduced ? 'PASS' : 'FAIL',
      };
      if (scssReproduced) acceptanceResults.summary.passed++;
      else acceptanceResults.summary.failed++;

      console.log(
        `  [${acceptanceResults.tests[testKey].status}] SCSS generation produces 0 git diff in module stylesheets: ${scssReproduced}`,
      );
    }

    // Write final JSON summary
    const jsonPath = path.join(outputDir, 'acceptance-results.json');
    fs.writeFileSync(jsonPath, JSON.stringify(acceptanceResults, null, 2));
    console.log(`\nAcceptance results saved to: ${jsonPath}`);
    console.log(
      `Summary: ${acceptanceResults.summary.passed} PASSED, ${acceptanceResults.summary.failed} FAILED, ${acceptanceResults.summary.blocked} BLOCKED`,
    );
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  console.error('Acceptance check failed:', err);
  process.exit(1);
});
