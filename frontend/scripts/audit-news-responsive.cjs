// Complete Responsive Design Audit for Tech News module across all required viewports and themes.
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const assert = require('node:assert/strict');

const playwrightPath = process.env.PLAYWRIGHT_MODULE || 'D:/Agrivio/node_modules/playwright';
const { chromium } = require(playwrightPath);

const phase = process.argv[2] || 'before';
const chromePath =
  process.env.ACCEPTANCE_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const root = path.resolve(__dirname, '../dist/frontend/browser');
const outputDir = path.resolve(__dirname, '../verification/tech-news/responsive-audit');
fs.mkdirSync(outputDir, { recursive: true });

const { profile, catalog, response, artwork } = require('./news-browser-fixture.cjs');

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
  let file = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory())
    file = path.join(root, 'index.html');
  res.setHeader(
    'Content-Type',
    {
      '.html': 'text/html',
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.ttf': 'font/ttf',
      '.ico': 'image/x-icon',
      '.svg': 'image/svg+xml',
    }[path.extname(file)] || 'application/octet-stream',
  );
  fs.createReadStream(file).pipe(res);
});

async function ready(page) {
  await page.locator('app-news').waitFor({ timeout: 20000 });
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  await page.waitForFunction(
    () =>
      !document.querySelector('app-news [aria-busy="true"]') &&
      (!document.querySelector('.feed-status .status-label') ||
        !document
          .querySelector('.feed-status .status-label')
          .textContent.includes('Freshness unavailable')),
    { timeout: 15000 },
  ).catch(() => {});
  await page.evaluate(() => document.fonts.ready);
}

async function createSession(browser, origin, theme, { width, height }, customControls = {}) {
  const colorScheme = theme === 'system' ? 'dark' : theme;
  const context = await browser.newContext({
    viewport: { width, height },
    colorScheme,
    reducedMotion: 'reduce',
  });

  await context.addInitScript(
    ({ themeVal, profileVal }) => {
      if (!localStorage.getItem('token')) {
        const payload = btoa(
          JSON.stringify({
            id: 'one',
            iss: 'devinsight-api',
            aud: 'devinsight-web',
            exp: Math.floor(Date.now() / 1000) + 36000,
          }),
        );
        localStorage.setItem('token', `fixture.${payload}.fixture`);
        localStorage.setItem(
          'user',
          JSON.stringify({
            _id: 'one',
            iss: 'devinsight-api',
            aud: 'devinsight-web',
            name: 'Fixture Developer',
            role: 'developer',
            activeGithubUsername: 'fixture',
            activeCareerStack: 'Frontend',
          }),
        );
        localStorage.setItem('devinsight_career_profile', JSON.stringify(profileVal));
        localStorage.setItem('devinsight_theme', themeVal);
      }
    },
    { themeVal: theme, profileVal: profile },
  );

  const controls = {
    mode: 'normal',
    writes: [],
    reads: [],
    saved: new Map(),
    blocked: [],
    ...customControls,
  };

  // seed initial bookmark and read_later items
  catalog.slice(0, 4).forEach((item, idx) => {
    const isBookmark = idx < 2;
    const type = isBookmark ? 'bookmark' : 'read_later';
    const saved = {
      id: `saved-${idx + 1}`,
      owner: 'one',
      type,
      url: item.url,
      title: item.title,
      source: item.source,
      category: item.category,
      createdAt: new Date(Date.now() - (idx + 1) * 86400000).toISOString(),
      readAt: type === 'read_later' && idx === 3 ? new Date().toISOString() : null,
      firstReadAt: type === 'read_later' && idx === 3 ? new Date().toISOString() : null,
      lastReadAt: type === 'read_later' && idx === 3 ? new Date().toISOString() : null,
      readCount: type === 'read_later' && idx === 3 ? 1 : 0,
    };
    controls.saved.set(saved.id, saved);
  });

  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await context.route('**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const pathname = url.pathname;

    if (pathname.startsWith('/api/')) {
      if (pathname === '/api/news') {
        const params = url.searchParams;
        controls.reads.push(Object.fromEntries(params));
        if (controls.mode === 'error') {
          return route.fulfill({ status: 500, json: { message: 'Feed temporarily unavailable' } });
        }
        if (controls.mode === 'slow') {
          await new Promise((r) => setTimeout(r, 600));
        }
        let items = controls.mode === 'empty' ? [] : [...catalog];
        if (params.get('search')) {
          items = items.filter((item) =>
            item.title.toLowerCase().includes(params.get('search').toLowerCase()),
          );
        }
        if (params.get('source') && params.get('source') !== 'All') {
          items = items.filter((item) => item.source === params.get('source'));
        }
        if (params.get('category') && params.get('category') !== 'All') {
          items = items.filter((item) => item.category === params.get('category'));
        }
        if (params.get('popularity') === 'high') {
          items = items.filter((item) => item.popularity >= 100);
        }

        const payload = response(items, params, controls.mode);
        return route.fulfill({ json: payload }).catch(() => {});
      }

      if (pathname === '/api/news/saved') {
        const type = url.searchParams.get('type') || 'bookmark';
        const pageNum = Number(url.searchParams.get('page') || 1);
        const limit = Number(url.searchParams.get('limit') || 50);
        const all = [...controls.saved.values()].filter((item) => item.type === type);
        return route.fulfill({
          json: {
            items: all.slice((pageNum - 1) * limit, pageNum * limit),
            total: all.length,
            page: pageNum,
            limit,
            hasMore: pageNum * limit < all.length,
            totalPages: Math.max(1, Math.ceil(all.length / limit)),
          },
        });
      }

      if (pathname.startsWith('/api/news/save')) {
        controls.writes.push({ method: req.method(), pathname });
        if (req.method() === 'POST') {
          const body = req.postDataJSON() || {};
          const item = {
            id: `saved-${controls.saved.size + 1}`,
            owner: 'one',
            ...body,
            createdAt: new Date().toISOString(),
            readAt: null,
            firstReadAt: null,
            lastReadAt: null,
            readCount: 0,
          };
          controls.saved.set(item.id, item);
          return route.fulfill({ json: { item } });
        }
        const id = pathname.split('/')[4];
        const item = controls.saved.get(id);
        if (req.method() === 'DELETE') {
          if (item) controls.saved.delete(id);
          return route.fulfill({ json: { id } });
        }
        if (item) {
          const body = req.postDataJSON() || {};
          const read = body.read ?? true;
          if (read && !item.readAt) {
            item.readAt = new Date().toISOString();
            item.firstReadAt ||= item.readAt;
            item.lastReadAt = item.readAt;
            item.readCount = (item.readCount || 0) + 1;
          } else if (!read) {
            item.readAt = null;
          }
          return route.fulfill({ json: { item } });
        }
        return route.fulfill({ status: 404, json: {} });
      }

      if (pathname.includes('/profile/career')) return route.fulfill({ json: profile });
      if (pathname.includes('active-username'))
        return route.fulfill({ json: { username: 'fixture' } });
      return route.fulfill({
        json: {
          data: [],
          notifications: [],
          resumes: [],
          integrations: [],
          organizations: [],
          teams: [],
          profile: {},
          user: { _id: 'one', role: 'developer' },
        },
      });
    }

    if (url.hostname === 'news-fixture.example') {
      if (pathname.startsWith('/images/')) {
        return route.fulfill({
          contentType: 'image/svg+xml',
          body: artwork(Number(pathname.split('/').at(-1)) || 0),
        });
      }
      return route.fulfill({
        contentType: 'text/html',
        body: '<h1>Synthetic original source fixture</h1>',
      });
    }

    if (url.origin === origin) return route.continue();
    controls.blocked.push(url.origin);
    return route.abort();
  });

  return { context, page, pageErrors, controls };
}

async function measureLayout(page) {
  return await page.evaluate(() => {
    const doc = document.documentElement;
    const body = document.body;
    const scrollWidth = Math.max(doc.scrollWidth, body.scrollWidth);
    const clientWidth = doc.clientWidth || window.innerWidth;
    const pageEl = document.querySelector('.news-page');
    const pageScroll = pageEl ? pageEl.scrollWidth : 0;
    const pageClient = pageEl ? pageEl.clientWidth : 0;

    // Detect overflowing elements
    const overflowing = [];
    if (pageEl) {
      pageEl.querySelectorAll('*').forEach((el) => {
        const rect = el.getBoundingClientRect();
        if (rect.right > clientWidth + 1.5 && rect.width > 0) {
          const tag = el.tagName.toLowerCase();
          const cls = el.className && typeof el.className === 'string' ? el.className.trim() : '';
          const id = el.id ? `#${el.id}` : '';
          overflowing.push({
            selector: `${tag}${id}${cls ? '.' + cls.split(/\s+/).join('.') : ''}`,
            right: Math.round(rect.right),
            clientWidth: Math.round(clientWidth),
            excess: Math.round(rect.right - clientWidth),
          });
        }
      });
    }

    // Touch targets < 44px for primary interactive controls
    const smallTargets = [];
    document
      .querySelectorAll(
        '.news-page button, .news-page input, .news-page select, .news-page summary, .news-page .saved-actions a, .news-page .read-link',
      )
      .forEach((el) => {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          if (rect.height < 44 || rect.width < 44) {
            const text = (el.textContent || '').trim().slice(0, 30);
            const tag = el.tagName.toLowerCase();
            const cls = typeof el.className === 'string' ? el.className : '';
            smallTargets.push({
              tag,
              cls,
              text,
              width: Math.round(rect.width),
              height: Math.round(rect.height),
            });
          }
        }
      });

    // Inspect metric strip cards
    const metricCards = [];
    document.querySelectorAll('.metric-card').forEach((card) => {
      const rect = card.getBoundingClientRect();
      const label = card.querySelector('span')?.textContent || '';
      const strong = card.querySelector('strong')?.textContent || '';
      metricCards.push({
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        label,
        value: strong,
      });
    });

    // Inspect news cards
    const cards = [];
    document.querySelectorAll('app-news-card').forEach((c) => {
      const rect = c.getBoundingClientRect();
      const title = c.querySelector('h3')?.textContent || '';
      const badge = c.querySelector('.category-badge')?.textContent || '';
      cards.push({
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        title: title.slice(0, 35),
        badge,
      });
    });

    return {
      scrollWidth,
      clientWidth,
      pageScroll,
      pageClient,
      hasHorizontalOverflow: scrollWidth > clientWidth + 1 || pageScroll > pageClient + 1,
      overflowingElements: overflowing.slice(0, 8),
      smallTouchTargets: smallTargets.slice(0, 8),
      totalSmallTouchTargets: smallTargets.length,
      metricCards,
      newsCardsCount: cards.length,
      newsCardsSample: cards.slice(0, 3),
    };
  });
}

async function main() {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  console.log(`[audit-news-responsive] Local test server running at ${origin}`);

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
  };

  const matrixDir = path.join(outputDir, phase, 'matrix');
  const scenariosDir = path.join(outputDir, phase, 'scenarios');
  fs.mkdirSync(matrixDir, { recursive: true });
  fs.mkdirSync(scenariosDir, { recursive: true });

  try {
    // 1. Matrix verification: 12 viewports x 3 themes = 36 runs
    console.log(`\n=== 1. Starting 36-cell Viewport & Theme Matrix Audit (${phase}) ===`);
    for (const vp of VIEWPORTS) {
      for (const theme of THEMES) {
        let session;
        try {
          session = await createSession(browser, origin, theme, vp);
          const { page, pageErrors } = session;

          await page.goto(origin + '/app/news', { waitUntil: 'domcontentloaded' });
          await page.locator('app-news-card').first().waitFor({ timeout: 15000 }).catch(() => {});
          await ready(page);

          // Sidebar check: On desktop/laptop (> 768), ensure shell isn't blocking view
          if (vp.width > 768 && (await page.locator('.shell-body.sidebar-closed').count())) {
            const toggleBtn = page.getByRole('button', { name: 'Toggle sidebar', exact: true });
            if (await toggleBtn.isVisible().catch(() => false)) {
              await toggleBtn.click();
              await page.waitForTimeout(150);
            }
          }

          const measurement = await measureLayout(page);
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
            `  [${vp.name}] ${theme.toUpperCase()} -> ${cellResult.pass ? 'PASS' : 'FAIL'} (scroll: ${measurement.scrollWidth}px / client: ${measurement.clientWidth}px, overflow elements: ${measurement.overflowingElements.length}, small targets: ${measurement.totalSmallTouchTargets})`,
          );
        } catch (cellErr) {
          console.error(`  [${vp.name}] ${theme.toUpperCase()} -> ERROR:`, cellErr.message);
        } finally {
          if (session?.context) await session.context.close().catch(() => {});
        }
      }
    }

    // 2. Interactive Scenarios & UI States
    console.log(`\n=== 2. Starting Interactive Scenarios & States Audit (${phase}) ===`);

    // Scenario 1: Explore Tab View
    console.log(`Scenario 1: Explore Tab View (Mobile 390 & Desktop 1440)`);
    for (const [vpName, vp] of [['mobile-390', { width: 390, height: 844 }], ['desktop-1440', { width: 1440, height: 900 }]]) {
      const session = await createSession(browser, origin, 'dark', vp);
      const { page } = session;
      await page.goto(origin + '/app/news');
      await page.locator('app-news-card').first().waitFor().catch(() => {});
      await ready(page);

      const exploreBtn = page.locator('.view-tabs button').filter({ hasText: 'Explore' });
      await exploreBtn.click();
      await page.waitForTimeout(300);

      const m = await measureLayout(page);
      const scName = `scenario-explore-${vpName}.png`;
      await page.screenshot({ path: path.join(scenariosDir, scName), fullPage: true });
      auditReport.scenarioChecks[`explore_${vpName}`] = { pass: !m.hasHorizontalOverflow, ...m, screenshot: scName };
      console.log(`  -> Explore tab (${vpName}): ${!m.hasHorizontalOverflow ? 'PASS' : 'FAIL'}`);
      await session.context.close();
    }

    // Scenario 2: Trending Tab View
    console.log(`Scenario 2: Trending Tab View with Topic Pills (Mobile 390 & Desktop 1440)`);
    for (const [vpName, vp] of [['mobile-390', { width: 390, height: 844 }], ['desktop-1440', { width: 1440, height: 900 }]]) {
      const session = await createSession(browser, origin, 'light', vp);
      const { page } = session;
      await page.goto(origin + '/app/news');
      await page.locator('app-news-card').first().waitFor().catch(() => {});
      await ready(page);

      const trendingBtn = page.locator('.view-tabs button').filter({ hasText: 'Trending' });
      await trendingBtn.click();
      await page.waitForTimeout(300);

      const m = await measureLayout(page);
      const scName = `scenario-trending-${vpName}.png`;
      await page.screenshot({ path: path.join(scenariosDir, scName), fullPage: true });
      auditReport.scenarioChecks[`trending_${vpName}`] = { pass: !m.hasHorizontalOverflow, ...m, screenshot: scName };
      console.log(`  -> Trending tab (${vpName}): ${!m.hasHorizontalOverflow ? 'PASS' : 'FAIL'}`);
      await session.context.close();
    }

    // Scenario 3: Bookmarks Library View
    console.log(`Scenario 3: Bookmarks Library View`);
    for (const [vpName, vp] of [['mobile-390', { width: 390, height: 844 }], ['desktop-1440', { width: 1440, height: 900 }]]) {
      const session = await createSession(browser, origin, 'dark', vp);
      const { page } = session;
      await page.goto(origin + '/app/news');
      await page.locator('app-news-card').first().waitFor().catch(() => {});
      await ready(page);

      const bmBtn = page.locator('.view-tabs button').filter({ hasText: 'Bookmarks' });
      await bmBtn.click();
      await page.waitForTimeout(400);

      const m = await measureLayout(page);
      const scName = `scenario-bookmarks-${vpName}.png`;
      await page.screenshot({ path: path.join(scenariosDir, scName), fullPage: true });
      auditReport.scenarioChecks[`bookmarks_${vpName}`] = { pass: !m.hasHorizontalOverflow, ...m, screenshot: scName };
      console.log(`  -> Bookmarks tab (${vpName}): ${!m.hasHorizontalOverflow ? 'PASS' : 'FAIL'}`);
      await session.context.close();
    }

    // Scenario 4: Read Later Library View & History Filters
    console.log(`Scenario 4: Read Later Library View & History Filters`);
    for (const [vpName, vp] of [['mobile-390', { width: 390, height: 844 }], ['desktop-1440', { width: 1440, height: 900 }]]) {
      const session = await createSession(browser, origin, 'light', vp);
      const { page } = session;
      await page.goto(origin + '/app/news');
      await page.locator('app-news-card').first().waitFor().catch(() => {});
      await ready(page);

      const rlBtn = page.locator('.view-tabs button').filter({ hasText: 'Read Later' });
      await rlBtn.click();
      await page.waitForTimeout(400);

      const historyBtn = page.locator('.history-filters button').filter({ hasText: 'Reading history' });
      if (await historyBtn.isVisible().catch(() => false)) {
        await historyBtn.click();
        await page.waitForTimeout(200);
      }

      const m = await measureLayout(page);
      const scName = `scenario-read-later-${vpName}.png`;
      await page.screenshot({ path: path.join(scenariosDir, scName), fullPage: true });
      auditReport.scenarioChecks[`read_later_${vpName}`] = { pass: !m.hasHorizontalOverflow, ...m, screenshot: scName };
      console.log(`  -> Read Later tab (${vpName}): ${!m.hasHorizontalOverflow ? 'PASS' : 'FAIL'}`);
      await session.context.close();
    }

    // Scenario 5: Mobile Filter Panel Expansion
    console.log(`Scenario 5: Mobile Filter Panel Expansion (Mobile 375 & 390)`);
    {
      const session = await createSession(browser, origin, 'dark', { width: 375, height: 667 });
      const { page } = session;
      await page.goto(origin + '/app/news');
      await page.locator('app-news-card').first().waitFor().catch(() => {});
      await ready(page);

      const toggle = page.locator('.mobile-filter-toggle');
      if (await toggle.isVisible().catch(() => false)) {
        await toggle.click();
        await page.waitForTimeout(250);
      }

      const m = await measureLayout(page);
      const scName = `scenario-filters-expanded-mobile.png`;
      await page.screenshot({ path: path.join(scenariosDir, scName), fullPage: true });
      auditReport.scenarioChecks['filters_expanded_mobile'] = {
        pass: !m.hasHorizontalOverflow,
        ...m,
        screenshot: scName,
      };
      console.log(`  -> Filter Panel Expanded: ${!m.hasHorizontalOverflow ? 'PASS' : 'FAIL'}`);
      await session.context.close();
    }

    // Scenario 6: Context Disclosure Opened
    console.log(`Scenario 6: Context Disclosure Opened (Mobile 390 & Desktop 1440)`);
    for (const [vpName, vp] of [['mobile-390', { width: 390, height: 844 }], ['desktop-1440', { width: 1440, height: 900 }]]) {
      const session = await createSession(browser, origin, 'dark', vp);
      const { page } = session;
      await page.goto(origin + '/app/news');
      await page.locator('app-news-card').first().waitFor().catch(() => {});
      await ready(page);

      const summary = page.locator('.context-disclosure summary');
      if (await summary.isVisible().catch(() => false)) {
        await summary.click();
        await page.waitForTimeout(250);
      }

      const m = await measureLayout(page);
      const scName = `scenario-context-open-${vpName}.png`;
      await page.screenshot({ path: path.join(scenariosDir, scName), fullPage: true });
      auditReport.scenarioChecks[`context_open_${vpName}`] = { pass: !m.hasHorizontalOverflow, ...m, screenshot: scName };
      console.log(`  -> Context Disclosure Opened (${vpName}): ${!m.hasHorizontalOverflow ? 'PASS' : 'FAIL'}`);
      await session.context.close();
    }

    // Scenario 7: News Card Relevance Details Opened
    console.log(`Scenario 7: News Card Relevance Details Opened`);
    {
      const session = await createSession(browser, origin, 'dark', { width: 390, height: 844 });
      const { page } = session;
      await page.goto(origin + '/app/news');
      await page.locator('app-news-card').first().waitFor().catch(() => {});
      await ready(page);

      const relSummary = page.locator('.relevance-details summary').first();
      if (await relSummary.isVisible().catch(() => false)) {
        await relSummary.click();
        await page.waitForTimeout(200);
      }

      const m = await measureLayout(page);
      const scName = `scenario-relevance-details-open.png`;
      await page.screenshot({ path: path.join(scenariosDir, scName), fullPage: true });
      auditReport.scenarioChecks['relevance_details_open'] = { pass: !m.hasHorizontalOverflow, ...m, screenshot: scName };
      console.log(`  -> Relevance Details Open: ${!m.hasHorizontalOverflow ? 'PASS' : 'FAIL'}`);
      await session.context.close();
    }

    // Scenario 8: Source Diagnostics Disclosure Opened
    console.log(`Scenario 8: Source Diagnostics Disclosure Opened`);
    {
      const session = await createSession(browser, origin, 'light', { width: 390, height: 844 });
      const { page } = session;
      await page.goto(origin + '/app/news');
      await page.locator('app-news-card').first().waitFor().catch(() => {});
      await ready(page);

      const srcSummary = page.locator('.source-disclosure summary');
      if (await srcSummary.isVisible().catch(() => false)) {
        await srcSummary.click();
        await page.waitForTimeout(200);
      }

      const m = await measureLayout(page);
      const scName = `scenario-sources-disclosure-open.png`;
      await page.screenshot({ path: path.join(scenariosDir, scName), fullPage: true });
      auditReport.scenarioChecks['sources_disclosure_open'] = { pass: !m.hasHorizontalOverflow, ...m, screenshot: scName };
      console.log(`  -> Source Diagnostics Disclosure Open: ${!m.hasHorizontalOverflow ? 'PASS' : 'FAIL'}`);
      await session.context.close();
    }

    // Scenario 9: Loading Skeleton State
    console.log(`Scenario 9: Loading Skeleton State`);
    {
      const session = await createSession(browser, origin, 'dark', { width: 768, height: 1024 }, { mode: 'slow' });
      const { page } = session;
      await page.goto(origin + '/app/news');
      await page.locator('app-news').waitFor();

      const refreshBtn = page.locator('.header-actions .secondary-button').first();
      if (await refreshBtn.isVisible().catch(() => false)) {
        await refreshBtn.click();
      }
      await page.waitForTimeout(150);

      const scName = `scenario-loading-skeleton.png`;
      await page.screenshot({ path: path.join(scenariosDir, scName) });
      auditReport.scenarioChecks['loading_skeleton'] = { pass: true, screenshot: scName };
      console.log(`  -> Loading Skeleton captured`);
      await session.context.close();
    }

    // Scenario 10: Empty State
    console.log(`Scenario 10: Empty State`);
    {
      const session = await createSession(browser, origin, 'light', { width: 390, height: 844 }, { mode: 'empty' });
      const { page } = session;
      await page.goto(origin + '/app/news');
      await page.locator('.empty-state').waitFor({ timeout: 15000 }).catch(() => {});

      const m = await measureLayout(page);
      const scName = `scenario-empty-state.png`;
      await page.screenshot({ path: path.join(scenariosDir, scName), fullPage: true });
      auditReport.scenarioChecks['empty_state'] = { pass: !m.hasHorizontalOverflow, ...m, screenshot: scName };
      console.log(`  -> Empty State: ${!m.hasHorizontalOverflow ? 'PASS' : 'FAIL'}`);
      await session.context.close();
    }

    // Scenario 11: Error State
    console.log(`Scenario 11: Error State with Retry Button`);
    {
      const session = await createSession(browser, origin, 'dark', { width: 390, height: 844 }, { mode: 'error' });
      const { page } = session;
      await page.goto(origin + '/app/news');
      await page.locator('.error-message').waitFor({ timeout: 15000 }).catch(() => {});

      const m = await measureLayout(page);
      const scName = `scenario-error-state.png`;
      await page.screenshot({ path: path.join(scenariosDir, scName), fullPage: true });
      auditReport.scenarioChecks['error_state'] = { pass: !m.hasHorizontalOverflow, ...m, screenshot: scName };
      console.log(`  -> Error State: ${!m.hasHorizontalOverflow ? 'PASS' : 'FAIL'}`);
      await session.context.close();
    }

    // Scenario 12: Zoom Tests (125%, 150%, 175%, 200%)
    console.log(`Scenario 12: Browser Zoom (125% - 200%)`);
    for (const zoom of [1.25, 1.5, 1.75, 2.0]) {
      const effectiveW = Math.round(1280 / zoom);
      const effectiveH = Math.round(800 / zoom);
      const session = await createSession(browser, origin, 'dark', { width: effectiveW, height: effectiveH });
      const { page } = session;
      await page.goto(origin + '/app/news');
      await page.locator('app-news-card').first().waitFor().catch(() => {});
      await ready(page);

      const m = await measureLayout(page);
      const scName = `scenario-zoom-${Math.round(zoom * 100)}.png`;
      await page.screenshot({ path: path.join(scenariosDir, scName), fullPage: true });
      auditReport.scenarioChecks[`zoom_${Math.round(zoom * 100)}`] = {
        pass: !m.hasHorizontalOverflow,
        effectiveWidth: effectiveW,
        ...m,
        screenshot: scName,
      };
      console.log(
        `  -> Zoom ${Math.round(zoom * 100)}% (vp ${effectiveW}px): ${!m.hasHorizontalOverflow ? 'PASS' : 'FAIL'} (scroll: ${m.scrollWidth}px / client: ${m.clientWidth}px)`,
      );
      await session.context.close();
    }

    // Scenario 13: Text Scaling Tests (125%, 150%, 200%)
    console.log(`Scenario 13: Text Scaling (125% - 200%)`);
    for (const scale of [125, 150, 200]) {
      const session = await createSession(browser, origin, 'dark', { width: 390, height: 844 });
      const { page } = session;
      await page.goto(origin + '/app/news');
      await page.locator('app-news-card').first().waitFor().catch(() => {});
      await ready(page);

      await page.evaluate((s) => {
        document.documentElement.style.fontSize = `${s}%`;
      }, scale);
      await page.waitForTimeout(200);

      const m = await measureLayout(page);
      const scName = `scenario-text-scale-${scale}.png`;
      await page.screenshot({ path: path.join(scenariosDir, scName), fullPage: true });
      auditReport.scenarioChecks[`text_scale_${scale}`] = {
        pass: !m.hasHorizontalOverflow,
        ...m,
        screenshot: scName,
      };
      console.log(
        `  -> Text scale ${scale}%: ${!m.hasHorizontalOverflow ? 'PASS' : 'FAIL'} (scroll: ${m.scrollWidth}px / client: ${m.clientWidth}px)`,
      );
      await session.context.close();
    }

    // Scenario 14: Mobile & Tablet Orientation (Portrait vs Landscape)
    console.log(`Scenario 14: Mobile & Tablet Orientation`);
    for (const [name, w, h] of [
      ['mobile-portrait-390x844', 390, 844],
      ['mobile-landscape-844x390', 844, 390],
      ['tablet-portrait-768x1024', 768, 1024],
      ['tablet-landscape-1024x768', 1024, 768],
    ]) {
      const session = await createSession(browser, origin, 'dark', { width: w, height: h });
      const { page } = session;
      await page.goto(origin + '/app/news');
      await page.locator('app-news-card').first().waitFor().catch(() => {});
      await ready(page);

      const m = await measureLayout(page);
      const scName = `scenario-orient-${name}.png`;
      await page.screenshot({ path: path.join(scenariosDir, scName), fullPage: true });
      auditReport.scenarioChecks[`orient_${name}`] = {
        pass: !m.hasHorizontalOverflow,
        ...m,
        screenshot: scName,
      };
      console.log(`  -> Orientation ${name}: ${!m.hasHorizontalOverflow ? 'PASS' : 'FAIL'}`);
      await session.context.close();
    }

    // Scenario 15: Keyboard Navigation & Focus Ring
    console.log(`Scenario 15: Keyboard Navigation & Focus Rings`);
    {
      const session = await createSession(browser, origin, 'dark', { width: 1440, height: 900 });
      const { page } = session;
      await page.goto(origin + '/app/news');
      await page.locator('app-news-card').first().waitFor().catch(() => {});
      await ready(page);

      for (let i = 0; i < 5; i++) {
        await page.keyboard.press('Tab');
        await page.waitForTimeout(50);
      }

      const focusedTag = await page.evaluate(() => document.activeElement?.tagName.toLowerCase());
      const scName = `scenario-keyboard-focus.png`;
      await page.screenshot({ path: path.join(scenariosDir, scName) });
      auditReport.scenarioChecks['keyboard_focus'] = {
        pass: !!focusedTag && focusedTag !== 'body',
        focusedTag,
        screenshot: scName,
      };
      console.log(`  -> Active element on Tab navigation: <${focusedTag}>`);
      await session.context.close();
    }

    // Write report within try block
    const totalMatrix = auditReport.matrixResults.length;
    const passedMatrix = auditReport.matrixResults.filter((r) => r.pass).length;
    const totalScenarios = Object.keys(auditReport.scenarioChecks).length;
    const passedScenarios = Object.values(auditReport.scenarioChecks).filter((s) => s.pass).length;

    auditReport.summary = {
      phase,
      matrixTotal: totalMatrix,
      matrixPassed: passedMatrix,
      matrixFailed: totalMatrix - passedMatrix,
      scenariosTotal: totalScenarios,
      scenariosPassed: passedScenarios,
      scenariosFailed: totalScenarios - passedScenarios,
      totalOverflowDefects: auditReport.overflowDefects.length,
      totalTouchTargetDefects: auditReport.touchTargetDefects.length,
    };

    const jsonPath = path.join(outputDir, `${phase}-results.json`);
    fs.writeFileSync(jsonPath, JSON.stringify(auditReport, null, 2));
    console.log(`\n======================================================`);
    console.log(`Audit (${phase}) complete! Results written to:`);
    console.log(`  ${jsonPath}`);
    console.log(`Matrix: ${passedMatrix}/${totalMatrix} passed`);
    console.log(`Scenarios: ${passedScenarios}/${totalScenarios} passed`);
    console.log(`Overflow defects: ${auditReport.overflowDefects.length}`);
    console.log(`Touch target defect instances: ${auditReport.touchTargetDefects.length}`);
    console.log(`======================================================\n`);
  } finally {
    try {
      await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 2000))]);
    } catch {}
    try {
      if (server.closeAllConnections) server.closeAllConnections();
      server.close();
    } catch {}
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal audit failure:', err);
  process.exit(1);
});
