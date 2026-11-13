// Complete Responsive Audit for Profile module across all required viewports, themes, and interactive states.
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');

const playwrightPath =
  process.env.PLAYWRIGHT_MODULE || 'C:/Users/ahmad.hassan/Desktop/Agrivio/node_modules/playwright';
const { chromium } = require(playwrightPath);

const phase = process.argv[2] || 'before';
const chromePath =
  process.env.ACCEPTANCE_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const dist = path.resolve(__dirname, '../dist/frontend/browser');
const outputDir = path.resolve(__dirname, '../verification/profile/responsive-audit', phase);
fs.mkdirSync(outputDir, { recursive: true });

const { fullProfile, emptyProfile, longTextProfile } = require('./profile-browser-fixture.cjs');

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

async function setupContextAndPage(browser, { width, height, theme = 'dark', activeProfile = fullProfile }) {
  const colorScheme = theme === 'system' ? 'dark' : theme;
  const context = await browser.newContext({
    viewport: { width, height },
    colorScheme,
    reducedMotion: 'reduce',
  });

  await context.addInitScript(
    ({ themeVal, prof }) => {
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
          _id: prof._id,
          role: prof.role || 'developer',
          name: prof.name,
          email: prof.email,
          activeGithubUsername: prof.activeGithubUsername || prof.githubUsername,
          avatar: prof.avatar,
        }),
      );
      localStorage.setItem('devinsight_theme', themeVal);
      localStorage.setItem('devinsight_career_profile', JSON.stringify({
        careerStack: prof.careerStack,
        experienceLevel: prof.experienceLevel,
        activeCareerStack: prof.activeCareerStack,
        activeExperienceLevel: prof.activeExperienceLevel,
        careerGoal: prof.careerGoal,
        targetTimeline: prof.targetTimeline,
        learningPreference: prof.learningPreference,
        isConfigured: prof.isConfigured,
      }));
    },
    { themeVal: theme, prof: activeProfile },
  );

  return context;
}

function attachRoutes(page, { activeProfile = fullProfile, shouldFail = false } = {}) {
  return page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();

    if (url.pathname.includes('/notifications/stream')) {
      return route.fulfill({ contentType: 'text/event-stream', body: ': heartbeat\n\n' });
    }

    if (shouldFail) {
      return route.fulfill({ status: 500, json: { message: 'Internal server error simulated for verification.' } });
    }

    if (url.pathname.includes('/profile/me')) {
      if (method === 'GET') {
        return route.fulfill({ json: activeProfile });
      }
      if (method === 'PUT') {
        const postData = route.request().postDataJSON() || {};
        return route.fulfill({ json: { ...activeProfile, ...postData } });
      }
      if (method === 'DELETE') {
        return route.fulfill({ json: { message: 'Account deleted successfully' } });
      }
    }

    if (url.pathname.includes('/profile/career')) {
      if (method === 'PUT') {
        const postData = route.request().postDataJSON() || {};
        return route.fulfill({
          json: {
            ownerId: activeProfile._id,
            careerStack: postData.careerStack || activeProfile.careerStack,
            experienceLevel: postData.experienceLevel || activeProfile.experienceLevel,
            activeCareerStack: postData.careerStack || activeProfile.careerStack,
            activeExperienceLevel: postData.experienceLevel || activeProfile.experienceLevel,
            careerGoal: postData.careerGoal || activeProfile.careerGoal,
            targetTimeline: postData.targetTimeline || activeProfile.targetTimeline,
            learningPreference: postData.learningPreference || activeProfile.learningPreference,
            isConfigured: true,
          },
        });
      }
      return route.fulfill({
        json: {
          careerStack: activeProfile.careerStack,
          experienceLevel: activeProfile.experienceLevel,
          activeCareerStack: activeProfile.activeCareerStack,
          activeExperienceLevel: activeProfile.activeExperienceLevel,
          careerGoal: activeProfile.careerGoal,
          targetTimeline: activeProfile.targetTimeline,
          learningPreference: activeProfile.learningPreference,
          isConfigured: true,
        },
      });
    }

    if (url.pathname.includes('/profile/visibility')) {
      if (method === 'PUT') {
        const postData = route.request().postDataJSON() || {};
        return route.fulfill({ json: { isPublic: !!postData.isPublic } });
      }
      return route.fulfill({ json: { isPublic: activeProfile.isPublic } });
    }

    if (url.pathname.includes('/profile/password')) {
      return route.fulfill({ json: { message: 'Password updated successfully' } });
    }

    if (url.pathname.includes('/profile/avatar')) {
      return route.fulfill({
        json: {
          message: 'Avatar uploaded',
          avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400',
        },
      });
    }

    if (url.pathname.includes('/notifications')) {
      return route.fulfill({ json: { notifications: [], totalCount: 0, unreadCount: 0 } });
    }

    return route.fulfill({ json: {} });
  });
}

async function runAudit() {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  console.log(`[audit-profile] Running phase: ${phase} against ${base}`);

  const browser = await chromium.launch({
    headless: true,
    executablePath: chromePath,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
  });

  const matrixResults = [];
  const defects = [];

  try {
    // ══════════════════════════════════════════════════════════════
    // PART 1: Full 12-Viewport × 3-Theme Matrix (36 Runs)
    // ══════════════════════════════════════════════════════════════
    for (const vp of VIEWPORTS) {
      for (const theme of THEMES) {
        const testId = `${vp.name}-${theme}`;
        process.stdout.write(`  Checking ${testId}... `);

        const context = await setupContextAndPage(browser, {
          width: vp.width,
          height: vp.height,
          theme,
          activeProfile: fullProfile,
        });

        const page = await context.newPage();
        await attachRoutes(page, { activeProfile: fullProfile });

        await page.goto(`${base}/app/profile`, { waitUntil: 'domcontentloaded' });
        await page.locator('.prof-page').waitFor({ timeout: 10000 });
        await page.locator('.save-bar').waitFor({ timeout: 10000 });
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(100);

        // Sidebar behavior on desktop vs mobile
        if (vp.width > 768 && (await page.locator('.shell-body.sidebar-closed').count())) {
          const toggleBtn = page.getByRole('button', { name: 'Toggle sidebar', exact: true });
          if (await toggleBtn.isVisible()) {
            await toggleBtn.click();
            await page.waitForTimeout(60);
          }
        }

        const metrics = await page.evaluate(() => {
          const doc = document.documentElement;
          const body = document.body;
          const profPage = document.querySelector('.prof-page');
          const scrollW = Math.max(doc.scrollWidth, body.scrollWidth);
          const clientW = doc.clientWidth || window.innerWidth;
          const hasOverflow = scrollW > clientW + 1; // 1px tolerance for subpixel rounding

          const fontFamilies = new Set();
          const elements = document.querySelectorAll('h1, h2, h3, .save-bar__title, .context-role, label');
          elements.forEach((el) => {
            const computed = window.getComputedStyle(el).fontFamily;
            fontFamilies.add(computed);
          });

          return {
            scrollWidth: Math.round(scrollW * 10) / 10,
            clientWidth: Math.round(clientW * 10) / 10,
            overflowDelta: Math.round((scrollW - clientW) * 10) / 10,
            hasOverflow,
            usesManrope: Array.from(fontFamilies).some((f) => f.includes('Manrope')),
            fontsFound: Array.from(fontFamilies).slice(0, 3),
          };
        });

        const screenshotPath = path.join(outputDir, `${testId}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: false });

        const passed = !metrics.hasOverflow && metrics.usesManrope;
        if (!passed) {
          defects.push({
            testId,
            viewport: vp.name,
            theme,
            width: vp.width,
            ...metrics,
          });
        }

        matrixResults.push({
          viewport: vp.name,
          category: vp.category,
          dimensions: `${vp.width}x${vp.height}`,
          theme,
          scrollWidth: metrics.scrollWidth,
          clientWidth: metrics.clientWidth,
          hasOverflow: metrics.hasOverflow,
          overflowDelta: metrics.overflowDelta,
          usesManrope: metrics.usesManrope,
          passed,
          screenshot: `${testId}.png`,
        });

        console.log(passed ? 'PASS' : `FAIL (overflow: +${metrics.overflowDelta}px)`);
        await context.close();
      }
    }

    // ══════════════════════════════════════════════════════════════
    // PART 2: Orientation & Landscape Viewports
    // ══════════════════════════════════════════════════════════════
    console.log('\n  Checking Landscape Orientations...');
    const landscapeViewports = [
      { name: 'mobile-390-landscape', width: 844, height: 390 },
      { name: 'tablet-768-landscape', width: 1024, height: 768 },
    ];
    const landscapeResults = [];
    for (const lvp of landscapeViewports) {
      const context = await setupContextAndPage(browser, {
        width: lvp.width,
        height: lvp.height,
        theme: 'dark',
        activeProfile: fullProfile,
      });
      const page = await context.newPage();
      await attachRoutes(page, { activeProfile: fullProfile });
      await page.goto(`${base}/app/profile`, { waitUntil: 'domcontentloaded' });
      await page.locator('.prof-page').waitFor({ timeout: 10000 });
      await page.waitForTimeout(100);

      const metrics = await page.evaluate(() => {
        const doc = document.documentElement;
        return {
          scrollWidth: doc.scrollWidth,
          clientWidth: doc.clientWidth,
          hasOverflow: doc.scrollWidth > doc.clientWidth + 1,
        };
      });

      const shotName = `${lvp.name}-dark.png`;
      await page.screenshot({ path: path.join(outputDir, shotName) });
      landscapeResults.push({ ...lvp, ...metrics, passed: !metrics.hasOverflow, screenshot: shotName });
      console.log(`    ${lvp.name}: ${!metrics.hasOverflow ? 'PASS' : 'FAIL'}`);
      await context.close();
    }

    // ══════════════════════════════════════════════════════════════
    // PART 3: Scenario Suites (Empty, Long Text, Error, Modals)
    // ══════════════════════════════════════════════════════════════
    console.log('\n  Checking Dedicated Scenarios...');
    const scenarioResults = {};

    // 3A. Empty / Newbie Profile
    {
      const context = await setupContextAndPage(browser, {
        width: 375,
        height: 667,
        theme: 'light',
        activeProfile: emptyProfile,
      });
      const page = await context.newPage();
      await attachRoutes(page, { activeProfile: emptyProfile });
      await page.goto(`${base}/app/profile`, { waitUntil: 'domcontentloaded' });
      await page.locator('.prof-page').waitFor({ timeout: 10000 });
      const shotName = 'scenario-empty-profile-375.png';
      await page.screenshot({ path: path.join(outputDir, shotName) });
      const metrics = await page.evaluate(() => ({
        hasOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      }));
      scenarioResults.emptyProfile = { passed: !metrics.hasOverflow, screenshot: shotName };
      console.log(`    Empty Profile (375px): ${!metrics.hasOverflow ? 'PASS' : 'FAIL'}`);
      await context.close();
    }

    // 3B. Long Text / Unbroken String Stress Test
    {
      const context = await setupContextAndPage(browser, {
        width: 320,
        height: 640,
        theme: 'dark',
        activeProfile: longTextProfile,
      });
      const page = await context.newPage();
      await attachRoutes(page, { activeProfile: longTextProfile });
      await page.goto(`${base}/app/profile`, { waitUntil: 'domcontentloaded' });
      await page.locator('.prof-page').waitFor({ timeout: 10000 });
      const shotName = 'scenario-longtext-profile-320.png';
      await page.screenshot({ path: path.join(outputDir, shotName) });
      const metrics = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        hasOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      }));
      scenarioResults.longTextStress = { ...metrics, passed: !metrics.hasOverflow, screenshot: shotName };
      console.log(`    Long Text Stress (320px): ${!metrics.hasOverflow ? 'PASS' : `FAIL (+${metrics.scrollWidth - metrics.clientWidth}px)`}`);
      await context.close();
    }

    // 3C. Error Feedback State
    {
      const context = await setupContextAndPage(browser, {
        width: 390,
        height: 844,
        theme: 'dark',
        activeProfile: fullProfile,
      });
      const page = await context.newPage();
      await attachRoutes(page, { activeProfile: fullProfile, shouldFail: true });
      await page.goto(`${base}/app/profile`, { waitUntil: 'domcontentloaded' });
      await page.locator('.prof-error').waitFor({ timeout: 10000 }).catch(() => {});
      const shotName = 'scenario-error-banner-390.png';
      await page.screenshot({ path: path.join(outputDir, shotName) });
      const isErrorVisible = await page.locator('.prof-error').isVisible().catch(() => false);
      scenarioResults.errorFeedback = { passed: isErrorVisible, isErrorVisible, screenshot: shotName };
      console.log(`    Error Feedback (390px): ${isErrorVisible ? 'PASS' : 'FAIL'}`);
      await context.close();
    }

    // 3D. Delete Account Dialog Open
    {
      const context = await setupContextAndPage(browser, {
        width: 320,
        height: 640,
        theme: 'dark',
        activeProfile: fullProfile,
      });
      const page = await context.newPage();
      await attachRoutes(page, { activeProfile: fullProfile });
      await page.goto(`${base}/app/profile`, { waitUntil: 'domcontentloaded' });
      await page.locator('.prof-page').waitFor({ timeout: 10000 });

      // Click "Delete Account" button
      const deleteTrigger = page.locator('.security-row--danger');
      await deleteTrigger.click();
      await page.waitForTimeout(100);

      const dialogMetrics = await page.evaluate(() => {
        const dialog = document.querySelector('dialog.modal');
        if (!dialog) return { found: false };
        const rect = dialog.getBoundingClientRect();
        const actions = dialog.querySelector('.modal-actions');
        const actionsRect = actions ? actions.getBoundingClientRect() : null;
        const buttons = dialog.querySelectorAll('.modal-actions button');
        const buttonBoxes = Array.from(buttons).map((b) => ({
          text: b.textContent.trim(),
          ...b.getBoundingClientRect(),
        }));
        return {
          found: true,
          dialogRect: { width: Math.round(rect.width), left: Math.round(rect.left), right: Math.round(rect.right) },
          actionsWidth: actionsRect ? Math.round(actionsRect.width) : 0,
          buttonBoxes,
          overflowsDialog: buttonBoxes.some((b) => b.right > rect.right + 2),
        };
      });

      const shotName = 'scenario-delete-modal-320.png';
      await page.screenshot({ path: path.join(outputDir, shotName) });
      scenarioResults.deleteModal = {
        dialogMetrics,
        passed: dialogMetrics.found && !dialogMetrics.overflowsDialog,
        screenshot: shotName,
      };
      console.log(`    Delete Modal (320px): ${dialogMetrics.found && !dialogMetrics.overflowsDialog ? 'PASS' : 'FAIL (button overflow)'}`);
      await context.close();
    }

    // 3E. Password Change Form Expanded
    {
      const context = await setupContextAndPage(browser, {
        width: 320,
        height: 640,
        theme: 'dark',
        activeProfile: fullProfile,
      });
      const page = await context.newPage();
      await attachRoutes(page, { activeProfile: fullProfile });
      await page.goto(`${base}/app/profile`, { waitUntil: 'domcontentloaded' });
      await page.locator('.prof-page').waitFor({ timeout: 10000 });

      const pwdTrigger = page.locator('.security-row:not(.security-row--danger)');
      await pwdTrigger.click();
      await page.waitForTimeout(100);

      const shotName = 'scenario-password-form-320.png';
      await page.screenshot({ path: path.join(outputDir, shotName) });

      const pwdMetrics = await page.evaluate(() => {
        const form = document.querySelector('.pwd-form');
        const actions = document.querySelector('.pwd-actions');
        const doc = document.documentElement;
        return {
          formVisible: !!form,
          hasOverflow: doc.scrollWidth > doc.clientWidth + 1,
        };
      });
      scenarioResults.passwordForm = { ...pwdMetrics, passed: pwdMetrics.formVisible && !pwdMetrics.hasOverflow, screenshot: shotName };
      console.log(`    Password Form (320px): ${pwdMetrics.formVisible && !pwdMetrics.hasOverflow ? 'PASS' : 'FAIL'}`);
      await context.close();
    }

    // 3F. Touch Target Audit across Interactive Elements
    {
      console.log('\n  Checking Touch Target Heights (Mobile 375px)...');
      const context = await setupContextAndPage(browser, {
        width: 375,
        height: 667,
        theme: 'dark',
        activeProfile: fullProfile,
      });
      const page = await context.newPage();
      await attachRoutes(page, { activeProfile: fullProfile });
      await page.goto(`${base}/app/profile`, { waitUntil: 'domcontentloaded' });
      await page.locator('.prof-page').waitFor({ timeout: 10000 });

      const touchDefects = await page.evaluate(() => {
        const interactives = document.querySelectorAll(
          'button, a.text-button, a.resume-analyzer-link, select, input:not([type="hidden"]):not([hidden])',
        );
        const defects = [];
        interactives.forEach((el) => {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) return;
          if (r.height < 32) {
            defects.push({
              tag: el.tagName.toLowerCase(),
              className: el.className,
              text: (el.textContent || el.getAttribute('aria-label') || el.id || '').trim().slice(0, 35),
              height: Math.round(r.height),
              width: Math.round(r.width),
            });
          }
        });
        return defects;
      });

      scenarioResults.touchTargetAudit = {
        defectsCount: touchDefects.length,
        touchDefects,
        passed: touchDefects.length === 0,
      };
      console.log(`    Touch Target Defects (< 32px height): ${touchDefects.length} detected`);
      if (touchDefects.length > 0) {
        touchDefects.forEach((d) => console.log(`      - ${d.tag}.${d.className}: ${d.text} (${d.width}x${d.height}px)`));
      }
      await context.close();
    }

    // 3G. Theme Picker Card Width Audit at 1024px Tablet
    {
      console.log('\n  Checking Theme Picker Column Widths at Tablet 1024px...');
      const context = await setupContextAndPage(browser, {
        width: 1024,
        height: 768,
        theme: 'light',
        activeProfile: fullProfile,
      });
      const page = await context.newPage();
      await attachRoutes(page, { activeProfile: fullProfile });
      await page.goto(`${base}/app/profile`, { waitUntil: 'domcontentloaded' });
      await page.locator('.prof-page').waitFor({ timeout: 10000 });

      const themePickerMetrics = await page.evaluate(() => {
        const options = document.querySelectorAll('.theme-card-option');
        return Array.from(options).map((opt) => {
          const r = opt.getBoundingClientRect();
          return {
            title: opt.querySelector('.theme-card-title')?.textContent?.trim(),
            width: Math.round(r.width),
            height: Math.round(r.height),
          };
        });
      });

      const shotName = 'scenario-theme-picker-1024.png';
      await page.screenshot({ path: path.join(outputDir, shotName) });
      scenarioResults.themePickerAt1024 = {
        themePickerMetrics,
        isSeverelyCompressed: themePickerMetrics.some((m) => m.width < 140),
        screenshot: shotName,
      };
      console.log(`    Theme Picker Cards at 1024px: widths = ${themePickerMetrics.map((m) => m.width + 'px').join(', ')}`);
      await context.close();
    }

    // ══════════════════════════════════════════════════════════════
    // Write Full Results to JSON
    // ══════════════════════════════════════════════════════════════
    const totalMatrix = matrixResults.length;
    const passedMatrix = matrixResults.filter((r) => r.passed).length;
    const finalReport = {
      phase,
      timestamp: new Date().toISOString(),
      summary: {
        totalMatrix,
        passedMatrix,
        failedMatrix: totalMatrix - passedMatrix,
        allPassed: passedMatrix === totalMatrix && defects.length === 0,
      },
      defects,
      matrixResults,
      landscapeResults,
      scenarioResults,
    };

    const targetJson = path.resolve(__dirname, `../verification/profile/${phase}.json`);
    fs.mkdirSync(path.dirname(targetJson), { recursive: true });
    fs.writeFileSync(targetJson, JSON.stringify(finalReport, null, 2), 'utf8');
    console.log(`\n[audit-profile] Phase "${phase}" complete. Report written to ${targetJson}`);
  } finally {
    await browser.close();
    server.close();
  }
}

runAudit().catch((err) => {
  console.error('[audit-profile] FATAL ERROR:', err);
  process.exit(1);
});
