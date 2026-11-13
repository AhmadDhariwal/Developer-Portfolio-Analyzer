// Complete Responsive Audit for Learning Hub (Courses) across all required viewports and themes.
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
const outputDir = path.resolve(__dirname, '../verification/courses/responsive-audit');
fs.mkdirSync(outputDir, { recursive: true });

const { catalog, profile, discover } = require('./courses-browser-fixture.cjs');

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

async function initPageContext(browser, { width, height, theme = 'dark', initialProfile = 'normal' }) {
  const colorScheme = theme === 'system' ? 'dark' : theme;
  const context = await browser.newContext({
    viewport: { width, height },
    colorScheme,
    reducedMotion: 'reduce',
  });

  await context.addInitScript(
    ({ themeVal, profileVal, initialVal }) => {
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
          activeGithubUsername: 'janedev',
        }),
      );
      localStorage.setItem('devinsight_theme', themeVal);
      localStorage.setItem(
        'devinsight_career_profile',
        JSON.stringify({ ...profileVal, isConfigured: initialVal !== 'no-profile' }),
      );
    },
    { themeVal: theme, profileVal: profile, initialVal: initialProfile },
  );

  return context;
}

function attachDefaultRoutes(page, controls) {
  return page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname;

    if (pathname === '/api/courses') {
      controls.requests.push(Object.fromEntries(url.searchParams));
      if (controls.mode === 'loading') {
        await new Promise((r) => setTimeout(r, 1200));
      }
      if (controls.mode === 'error') {
        return route.fulfill({ status: 503, json: { message: 'Temporary course source outage' } });
      }
      return route.fulfill({ json: discover(url.searchParams, controls.mode) });
    }

    if (pathname === '/api/courses/my-learning') {
      if (controls.mode === 'progress-unavailable') {
        return route.fulfill({ status: 503, json: { message: 'Saved courses unavailable' } });
      }
      const all = [...controls.saved.values()].filter(
        (record) =>
          !url.searchParams.get('status') || record.status === url.searchParams.get('status'),
      );
      const current = Number(url.searchParams.get('page') || 1);
      const limit = Number(url.searchParams.get('limit') || 50);
      return route.fulfill({
        json: {
          courses: all.slice((current - 1) * limit, current * limit),
          total: all.length,
          page: current,
          totalPages: Math.max(1, Math.ceil(all.length / limit)),
        },
      });
    }

    if (/\/courses\/[^/]+\/progress$/.test(pathname)) {
      const id = pathname.split('/').at(-2);
      const body = request.method() === 'PUT' ? request.postDataJSON() : null;
      if (request.method() === 'DELETE') {
        controls.saved.delete(id);
        return route.fulfill({ status: 204 });
      }
      const course = catalog.find((c) => c.id === id) || {
        id,
        title: 'Synthetic Course',
        platform: 'Udemy',
        topics: ['SQL'],
      };
      const previous = controls.saved.get(id);
      const record = {
        courseId: id,
        course,
        notes: '',
        progressPercent: null,
        ...previous,
        ...body,
        progressSource: 'user-entered',
        completionSource: 'self-reported',
        createdAt: previous?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        completedAt: body?.status === 'completed' ? new Date().toISOString() : null,
      };
      controls.saved.set(id, record);
      return route.fulfill({ json: record });
    }

    if (pathname.includes('/career-sprint') && pathname.includes('/courses/')) {
      const id = pathname.split('/').at(-2);
      return route.fulfill({
        json: {
          sprintId: 'fixture-sprint',
          courseId: id,
          targetSkill: 'SQL',
          alreadyAdded: false,
          route: '/app/career-sprint',
        },
      });
    }

    if (pathname.includes('/profile/career')) {
      return route.fulfill({ json: { ...profile, isConfigured: true } });
    }

    if (pathname.includes('/notifications/stream')) {
      return route.fulfill({ contentType: 'text/event-stream', body: ': heartbeat\n\n' });
    }

    return route.fulfill({ json: { success: true, data: [] } });
  });
}

function seedSavedCourses(controls) {
  controls.saved.set('course_1', {
    courseId: 'course_123456789012345678901234',
    course: catalog.find((c) => c.id === 'course_123456789012345678901234') || catalog[1],
    notes: 'Mastered SQL joins and window functions.',
    progressPercent: 75,
    status: 'in_progress',
    progressSource: 'user-entered',
    completionSource: 'self-reported',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  controls.saved.set('course_2', {
    courseId: 'yt_abcdefghijk',
    course: catalog.find((c) => c.id === 'yt_abcdefghijk') || catalog[0],
    notes: 'Completed full tutorial on index optimization.',
    progressPercent: 100,
    status: 'completed',
    completedAt: new Date().toISOString(),
    progressSource: 'user-entered',
    completionSource: 'self-reported',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

async function main() {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  console.log(`[audit-courses-responsive] Static server running at ${base}`);

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
    orientationChecks: {},
    zoomChecks: {},
    overflowDefects: [],
    touchTargetDefects: [],
    accessibilityDefects: [],
  };

  const matrixDir = path.join(outputDir, phase, 'matrix');
  const statesDir = path.join(outputDir, phase, 'states');
  const zoomDir = path.join(outputDir, phase, 'zoom');
  const orientDir = path.join(outputDir, phase, 'orientation');
  fs.mkdirSync(matrixDir, { recursive: true });
  fs.mkdirSync(statesDir, { recursive: true });
  fs.mkdirSync(zoomDir, { recursive: true });
  fs.mkdirSync(orientDir, { recursive: true });

  try {
    // 1. Matrix verification: 12 viewports x 3 themes = 36 runs
    console.log(`\n--- Starting 36-cell Viewport & Theme Matrix Audit (${phase}) ---`);
    for (const vp of VIEWPORTS) {
      for (const theme of THEMES) {
        const context = await initPageContext(browser, {
          width: vp.width,
          height: vp.height,
          theme,
        });

        const page = await context.newPage();
        const pageErrors = [];
        page.on('pageerror', (err) => pageErrors.push(err.message));

        const controls = {
          mode: 'normal',
          requests: [],
          saved: new Map(),
        };
        seedSavedCourses(controls);
        await attachDefaultRoutes(page, controls);

        await page.goto(`${base}/app/courses`);
        await page.locator('.courses-page').waitFor({ timeout: 10000 });
        await page.locator('.course-grid app-course-card').first().waitFor({ timeout: 10000 });
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

          const coursesPage = document.querySelector('.courses-page');
          const pageScrollWidth = coursesPage ? coursesPage.scrollWidth : 0;
          const pageClientWidth = coursesPage ? coursesPage.clientWidth : 0;
          const hasPageOverflow = pageScrollWidth > pageClientWidth + 1;

          // Find any offending elements overflowing horizontally
          const offenders = [];
          if (hasDocOverflow || hasPageOverflow) {
            const allElements = document.querySelectorAll('.courses-page *');
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

          // Responsive element geometry checks
          const metricsGrid = document.querySelector('.learning-metrics-strip');
          const metricsGridStyle = metricsGrid ? getComputedStyle(metricsGrid) : null;
          const metricsCols = metricsGridStyle
            ? metricsGridStyle.gridTemplateColumns.split(' ').length
            : 0;

          const courseGrid = document.querySelector('.course-grid');
          const courseGridStyle = courseGrid ? getComputedStyle(courseGrid) : null;
          const courseGridCols = courseGridStyle
            ? courseGridStyle.gridTemplateColumns.split(' ').length
            : 0;

          const cards = [...document.querySelectorAll('app-course-card')].map((c) => {
            const r = c.getBoundingClientRect();
            return {
              width: Math.round(r.width),
              height: Math.round(r.height),
            };
          });

          // Touch target checks (interactive elements < 40px)
          const smallTargets = [];
          const interactives = document.querySelectorAll(
            '.courses-page button, .courses-page a, .courses-page select, .courses-page input, .courses-page summary',
          );
          for (const el of interactives) {
            if (!el.checkVisibility()) continue;
            const r = el.getBoundingClientRect();
            if (r.width > 0 && r.height > 0 && (r.height < 40 || r.width < 40)) {
              smallTargets.push({
                text: el.textContent.trim().slice(0, 40),
                tag: el.tagName,
                className: el.className ? String(el.className).slice(0, 60) : '',
                width: Math.round(r.width),
                height: Math.round(r.height),
              });
            }
          }

          return {
            hasOverflow: hasDocOverflow || hasPageOverflow,
            scrollWidth,
            clientWidth,
            pageScrollWidth,
            pageClientWidth,
            offenders: offenders.slice(0, 5),
            metricsCols,
            courseGridCols,
            cardCount: cards.length,
            firstCardWidth: cards[0]?.width || null,
            smallTargets: smallTargets.slice(0, 10),
            totalSmallTargets: smallTargets.length,
          };
        });

        // Screenshot paths
        const fullScreenshotName = `${theme}-${vp.name}-full.png`;
        const foldScreenshotName = `${theme}-${vp.name}-fold.png`;

        try {
          await page.screenshot({
            path: path.join(matrixDir, fullScreenshotName),
            fullPage: true,
            timeout: 60000,
          });
        } catch (err) {
          console.warn(`  [WARN] Full-page screenshot timed out for ${theme}-${vp.name}`);
        }
        try {
          await page.screenshot({
            path: path.join(matrixDir, foldScreenshotName),
            fullPage: false,
            timeout: 60000,
          });
        } catch (err) {
          console.warn(`  [WARN] Fold screenshot timed out for ${theme}-${vp.name}`);
        }

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
          metricsCols: measurement.metricsCols,
          courseGridCols: measurement.courseGridCols,
          firstCardWidth: measurement.firstCardWidth,
          totalSmallTargets: measurement.totalSmallTargets,
          smallTargets: measurement.smallTargets,
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
            `  [OK] ${vp.name} (${theme}): scrollWidth ${measurement.scrollWidth}/${measurement.clientWidth}px, metricsCols=${measurement.metricsCols}, gridCols=${measurement.courseGridCols}, cardW=${measurement.firstCardWidth}px, smallTargets=${measurement.totalSmallTargets}`,
          );
        }

        if (measurement.totalSmallTargets > 0) {
          for (const st of measurement.smallTargets) {
            if (!auditReport.touchTargetDefects.some((d) => d.className === st.className && d.tag === st.tag)) {
              auditReport.touchTargetDefects.push(st);
            }
          }
        }

        auditReport.matrixResults.push(resultEntry);
        await context.close();
      }
    }

    // 2. State & Interactive Workflows
    console.log(`\n--- Running State & Interactive Workflows (${phase}) ---`);

    // State A: "For You" view with personalized recommendations and target skills bridge
    for (const testW of [320, 375, 768, 1440]) {
      const context = await initPageContext(browser, {
        width: testW,
        height: 800,
        theme: 'dark',
      });
      const page = await context.newPage();
      const controls = { mode: 'normal', requests: [], saved: new Map() };
      seedSavedCourses(controls);
      await attachDefaultRoutes(page, controls);

      await page.goto(`${base}/app/courses`);
      await page.locator('.courses-page').waitFor({ timeout: 10000 });

      // Click "For You" tab
      const forYouTab = page.getByRole('button', { name: 'For You', exact: true });
      await forYouTab.click();
      await page.locator('.overview-intelligence').waitFor({ timeout: 5000 });
      await page.waitForTimeout(300);

      const stateMeasure = await page.evaluate(() => {
        const doc = document.documentElement;
        const scrollWidth = doc.scrollWidth;
        const clientWidth = doc.clientWidth || window.innerWidth;
        const banner = document.querySelector('.overview-intelligence');
        const bridge = document.querySelector('.target-skills-bridge');
        const pills = document.querySelectorAll('.skill-pill').length;
        return {
          hasOverflow: scrollWidth > clientWidth + 1,
          scrollWidth,
          clientWidth,
          bannerVisible: !!banner,
          bridgeVisible: !!bridge,
          pills,
        };
      });

      const ssName = `for-you-view-${testW}px.png`;
      await page.screenshot({ path: path.join(statesDir, ssName) });
      auditReport.stateChecks[`for_you_${testW}`] = {
        viewportWidth: testW,
        ...stateMeasure,
        screenshot: ssName,
      };
      console.log(`  For You (${testW}px): banner=${stateMeasure.bannerVisible}, overflow=${stateMeasure.hasOverflow}`);
      await context.close();
    }

    // State B: "My Learning" view with active tracked courses
    for (const testW of [320, 375, 768, 1440]) {
      const context = await initPageContext(browser, {
        width: testW,
        height: 800,
        theme: 'dark',
      });
      const page = await context.newPage();
      const controls = { mode: 'normal', requests: [], saved: new Map() };
      seedSavedCourses(controls);
      await attachDefaultRoutes(page, controls);

      await page.goto(`${base}/app/courses`);
      await page.locator('.courses-page').waitFor({ timeout: 10000 });

      // Click "My Learning" tab
      const myLearningTab = page.getByRole('button', { name: /My Learning/i });
      await myLearningTab.click();
      await page.locator('.my-learning-section').waitFor({ timeout: 5000 });
      await page.waitForTimeout(300);

      const stateMeasure = await page.evaluate(() => {
        const doc = document.documentElement;
        const scrollWidth = doc.scrollWidth;
        const clientWidth = doc.clientWidth || window.innerWidth;
        const trackerStrip = document.querySelector('.learning-tracker-strip');
        const tabs = document.querySelector('.status-segmented-tabs');
        const savedCards = document.querySelectorAll('.my-learning-section app-course-card').length;
        return {
          hasOverflow: scrollWidth > clientWidth + 1,
          scrollWidth,
          clientWidth,
          trackerVisible: !!trackerStrip,
          tabsVisible: !!tabs,
          savedCards,
        };
      });

      const ssName = `my-learning-view-${testW}px.png`;
      await page.screenshot({ path: path.join(statesDir, ssName) });
      auditReport.stateChecks[`my_learning_${testW}`] = {
        viewportWidth: testW,
        ...stateMeasure,
        screenshot: ssName,
      };
      console.log(`  My Learning (${testW}px): savedCards=${stateMeasure.savedCards}, overflow=${stateMeasure.hasOverflow}`);
      await context.close();
    }

    // State C: Mobile filter dialog on mobile (320, 375, 430px)
    for (const testW of [320, 375, 430]) {
      const context = await initPageContext(browser, {
        width: testW,
        height: 640,
        theme: 'dark',
      });
      const page = await context.newPage();
      const controls = { mode: 'normal', requests: [], saved: new Map() };
      await attachDefaultRoutes(page, controls);

      await page.goto(`${base}/app/courses`);
      await page.locator('.courses-page').waitFor({ timeout: 10000 });

      // Open mobile filter dialog
      const filterTrigger = page.locator('.mobile-filter-trigger');
      await filterTrigger.click();
      const dialog = page.locator('.filter-dialog');
      await dialog.waitFor({ timeout: 5000 });
      await page.waitForTimeout(300);

      const dialogMeasure = await page.evaluate(() => {
        const dlg = document.querySelector('.filter-dialog');
        const content = document.querySelector('.dialog-content');
        const rect = dlg ? dlg.getBoundingClientRect() : null;
        const winH = window.innerHeight;
        const winW = window.innerWidth;
        const overflowsHeight = rect ? rect.height >= winH : false;
        const hasScrollbar = content ? content.scrollHeight > content.clientHeight : false;
        const hasDialogScroll = dlg ? dlg.scrollHeight > dlg.clientHeight : false;
        const dialogStyle = dlg ? getComputedStyle(dlg) : null;
        const overflowY = dialogStyle ? dialogStyle.overflowY : '';
        return {
          isOpen: dlg ? dlg.hasAttribute('open') : false,
          rect: rect ? { width: Math.round(rect.width), height: Math.round(rect.height) } : null,
          winH,
          winW,
          overflowsHeight,
          hasScrollbar,
          hasDialogScroll,
          overflowY,
        };
      });

      const ssName = `filter-dialog-${testW}px.png`;
      await page.screenshot({ path: path.join(statesDir, ssName) });
      auditReport.stateChecks[`filter_dialog_${testW}`] = {
        viewportWidth: testW,
        ...dialogMeasure,
        screenshot: ssName,
      };
      console.log(`  Filter Dialog (${testW}px): open=${dialogMeasure.isOpen}, dlgW=${dialogMeasure.rect?.width}px, overflowY=${dialogMeasure.overflowY}, hasScroll=${dialogMeasure.hasScrollbar || dialogMeasure.hasDialogScroll}`);

      // Test Escape key closes dialog
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
      const isClosed = await page.evaluate(() => !document.querySelector('.filter-dialog[open]'));
      auditReport.stateChecks[`filter_dialog_${testW}`].escapeKeyCloses = isClosed;

      await context.close();
    }

    // State D: Methodology accordion open across key viewports
    for (const testW of [320, 375, 768, 1440]) {
      const context = await initPageContext(browser, {
        width: testW,
        height: 800,
        theme: 'dark',
      });
      const page = await context.newPage();
      const controls = { mode: 'normal', requests: [], saved: new Map() };
      await attachDefaultRoutes(page, controls);

      await page.goto(`${base}/app/courses`);
      await page.locator('.courses-page').waitFor({ timeout: 10000 });

      // Click methodology summary to open details
      const summary = page.locator('details.methodology summary');
      await summary.click();
      await page.waitForTimeout(200);

      const methMeasure = await page.evaluate(() => {
        const doc = document.documentElement;
        const scrollWidth = doc.scrollWidth;
        const clientWidth = doc.clientWidth || window.innerWidth;
        const cardsGrid = document.querySelector('.method-cards-grid');
        const gridStyle = cardsGrid ? getComputedStyle(cardsGrid) : null;
        const cols = gridStyle ? gridStyle.gridTemplateColumns.split(' ').length : 0;
        return {
          hasOverflow: scrollWidth > clientWidth + 1,
          scrollWidth,
          clientWidth,
          methodologyCols: cols,
        };
      });

      const ssName = `methodology-open-${testW}px.png`;
      await page.screenshot({ path: path.join(statesDir, ssName) });
      auditReport.stateChecks[`methodology_${testW}`] = {
        viewportWidth: testW,
        ...methMeasure,
        screenshot: ssName,
      };
      console.log(`  Methodology (${testW}px): cols=${methMeasure.methodologyCols}, overflow=${methMeasure.hasOverflow}`);
      await context.close();
    }

    // State E: Course Card Expanded Drawer (Notes & Progress + Course & Source details)
    for (const testW of [320, 375, 768, 1440]) {
      const context = await initPageContext(browser, {
        width: testW,
        height: 800,
        theme: 'dark',
      });
      const page = await context.newPage();
      const controls = { mode: 'normal', requests: [], saved: new Map() };
      seedSavedCourses(controls);
      await attachDefaultRoutes(page, controls);

      await page.goto(`${base}/app/courses`);
      await page.locator('.courses-page').waitFor({ timeout: 10000 });

      // Open "Notes and progress" and "Course and source details" on the first saved card
      const card = page.locator('app-course-card .has-progress').first();
      await card.waitFor({ timeout: 5000 });
      const notesSummary = card.locator('details.drawer-panel summary');
      if (await notesSummary.count()) await notesSummary.click();
      const sourceSummary = card.locator('details.source-details summary');
      if (await sourceSummary.count()) await sourceSummary.click();
      await page.waitForTimeout(200);

      const cardMeasure = await page.evaluate(() => {
        const doc = document.documentElement;
        const scrollWidth = doc.scrollWidth;
        const clientWidth = doc.clientWidth || window.innerWidth;
        const textarea = document.querySelector('app-course-card textarea');
        const textareaRect = textarea ? textarea.getBoundingClientRect() : null;
        const saveBtn = document.querySelector('app-course-card .save-progress-btn');
        const saveRect = saveBtn ? saveBtn.getBoundingClientRect() : null;
        return {
          hasOverflow: scrollWidth > clientWidth + 1,
          scrollWidth,
          clientWidth,
          textareaW: textareaRect ? Math.round(textareaRect.width) : null,
          saveBtnH: saveRect ? Math.round(saveRect.height) : null,
        };
      });

      const ssName = `card-drawers-open-${testW}px.png`;
      await page.screenshot({ path: path.join(statesDir, ssName) });
      auditReport.stateChecks[`card_drawers_${testW}`] = {
        viewportWidth: testW,
        ...cardMeasure,
        screenshot: ssName,
      };
      console.log(`  Card Drawers (${testW}px): textareaW=${cardMeasure.textareaW}px, overflow=${cardMeasure.hasOverflow}`);
      await context.close();
    }

    // State F: Skeleton Loading State
    for (const testW of [320, 375, 768, 1440]) {
      const context = await initPageContext(browser, {
        width: testW,
        height: 800,
        theme: 'dark',
      });
      const page = await context.newPage();
      const controls = { mode: 'loading', requests: [], saved: new Map() };
      await attachDefaultRoutes(page, controls);

      await page.goto(`${base}/app/courses`);
      await page.locator('.skeleton-grid').waitFor({ timeout: 5000 });

      const skelMeasure = await page.evaluate(() => {
        const doc = document.documentElement;
        const scrollWidth = doc.scrollWidth;
        const clientWidth = doc.clientWidth || window.innerWidth;
        const skelCards = document.querySelectorAll('.skeleton-card').length;
        return {
          hasOverflow: scrollWidth > clientWidth + 1,
          scrollWidth,
          clientWidth,
          skelCards,
        };
      });

      const ssName = `skeleton-loading-${testW}px.png`;
      await page.screenshot({ path: path.join(statesDir, ssName) });
      auditReport.stateChecks[`skeleton_${testW}`] = {
        viewportWidth: testW,
        ...skelMeasure,
        screenshot: ssName,
      };
      console.log(`  Skeleton Loading (${testW}px): cards=${skelMeasure.skelCards}, overflow=${skelMeasure.hasOverflow}`);
      await context.close();
    }

    // 3. Orientation Checks (Landscape vs Portrait)
    console.log(`\n--- Running Orientation Checks (${phase}) ---`);
    const orientations = [
      { name: 'mobile-375-landscape', width: 667, height: 375, desc: 'Mobile 375 Landscape' },
      { name: 'mobile-390-landscape', width: 844, height: 390, desc: 'Mobile 390 Landscape' },
      { name: 'mobile-430-landscape', width: 932, height: 430, desc: 'Mobile 430 Landscape' },
      { name: 'tablet-1024-portrait', width: 768, height: 1024, desc: 'Tablet 1024 Portrait' },
    ];

    for (const orient of orientations) {
      const context = await initPageContext(browser, {
        width: orient.width,
        height: orient.height,
        theme: 'dark',
      });
      const page = await context.newPage();
      const controls = { mode: 'normal', requests: [], saved: new Map() };
      seedSavedCourses(controls);
      await attachDefaultRoutes(page, controls);

      await page.goto(`${base}/app/courses`);
      await page.locator('.courses-page').waitFor({ timeout: 10000 });
      await page.waitForTimeout(300);

      const orientMeasure = await page.evaluate(() => {
        const doc = document.documentElement;
        const scrollWidth = doc.scrollWidth;
        const clientWidth = doc.clientWidth || window.innerWidth;
        return {
          hasOverflow: scrollWidth > clientWidth + 1,
          scrollWidth,
          clientWidth,
        };
      });

      const ssName = `orientation-${orient.name}.png`;
      await page.screenshot({ path: path.join(orientDir, ssName) });
      auditReport.orientationChecks[orient.name] = {
        ...orient,
        ...orientMeasure,
        screenshot: ssName,
      };
      console.log(`  Orientation ${orient.name} (${orient.width}x${orient.height}): overflow=${orientMeasure.hasOverflow}`);
      await context.close();
    }

    // 4. Zoom & Text Scaling Checks (125% and 150%)
    console.log(`\n--- Running Zoom & Text Scaling Checks (${phase}) ---`);
    for (const zoomScale of [1.25, 1.5]) {
      for (const vp of [{ name: 'mobile-375', width: 375, height: 667 }, { name: 'desktop-1440', width: 1440, height: 900 }]) {
        const context = await browser.newContext({
          viewport: { width: Math.round(vp.width / zoomScale), height: Math.round(vp.height / zoomScale) },
          deviceScaleFactor: zoomScale,
          colorScheme: 'dark',
        });

        await context.addInitScript(({ profileVal }) => {
          const exp = Math.floor(Date.now() / 1000) + 36000;
          const payload = btoa(JSON.stringify({ exp, iss: 'devinsight-api', aud: 'devinsight-web' }));
          localStorage.setItem('token', `fixture.${payload}.fixture`);
          localStorage.setItem('user', JSON.stringify({ _id: 'user-fixture', role: 'developer', name: 'Jane Developer' }));
          localStorage.setItem('devinsight_theme', 'dark');
          localStorage.setItem('devinsight_career_profile', JSON.stringify(profileVal));
        }, { profileVal: profile });

        const page = await context.newPage();
        const controls = { mode: 'normal', requests: [], saved: new Map() };
        seedSavedCourses(controls);
        await attachDefaultRoutes(page, controls);

        await page.goto(`${base}/app/courses`);
        await page.locator('.courses-page').waitFor({ timeout: 10000 });
        await page.waitForTimeout(300);

        const zoomMeasure = await page.evaluate(() => {
          const doc = document.documentElement;
          const scrollWidth = doc.scrollWidth;
          const clientWidth = doc.clientWidth || window.innerWidth;
          return {
            hasOverflow: scrollWidth > clientWidth + 1,
            scrollWidth,
            clientWidth,
          };
        });

        const ssName = `zoom-${zoomScale * 100}pct-${vp.name}.png`;
        await page.screenshot({ path: path.join(zoomDir, ssName) });
        auditReport.zoomChecks[`${vp.name}_${zoomScale * 100}`] = {
          zoomScale,
          viewport: vp.name,
          ...zoomMeasure,
          screenshot: ssName,
        };
        console.log(`  Zoom ${zoomScale * 100}% on ${vp.name}: overflow=${zoomMeasure.hasOverflow}`);
        await context.close();
      }
    }

  } finally {
    await browser.close();
    server.close();
  }

  // Write audit results
  const reportPath = path.join(outputDir, `audit-results-${phase}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(auditReport, null, 2), 'utf8');
  console.log(`\nAudit completed (${phase}). Output written to ${reportPath}`);
}

main().catch((err) => {
  console.error('[audit-courses-responsive] FATAL:', err);
  process.exit(1);
});
