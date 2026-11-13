// Complete Responsive Audit for Help & Support module across all required viewports, themes, and interactive states.
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
const outputDir = path.resolve(__dirname, '../verification/support/responsive-audit', phase);
fs.mkdirSync(outputDir, { recursive: true });

const {
  populatedTickets,
  emptyTickets,
  longTextTickets,
} = require('./support-browser-fixture.cjs');

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

async function setupContextAndPage(browser, { width, height, theme = 'dark', activeTickets = populatedTickets }) {
  const colorScheme = theme === 'system' ? 'dark' : theme;
  const context = await browser.newContext({
    viewport: { width, height },
    colorScheme,
    reducedMotion: 'reduce',
  });

  await context.addInitScript(({ themeVal }) => {
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
        _id: 'user-dev-001',
        role: 'developer',
        name: 'Alex Rivera',
        email: 'alex.rivera@example.com',
        activeGithubUsername: 'arivera-dev',
      }),
    );
    localStorage.setItem('devinsight_theme', themeVal);
  }, { themeVal: theme });

  const page = await context.newPage();

  // Mock API routes for deterministic support state
  await page.route('**/api/**', async (route) => {
    const url = route.request().url();
    const method = route.request().method();

    if (url.includes('/support/my-tickets')) {
      const tickets = activeTickets;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          tickets,
          pagination: {
            page: 1,
            limit: 5,
            total: tickets.length,
            pages: Math.max(1, Math.ceil(tickets.length / 5)),
          },
        }),
      });
    }

    if (url.includes('/support/tickets') && method === 'POST' && url.includes('/replies')) {
      const body = JSON.parse(route.request().postData() || '{}');
      const updatedTicket = { ...activeTickets[0] };
      updatedTicket.replies = [
        ...(updatedTicket.replies || []),
        {
          _id: `rep-${Date.now()}`,
          authorId: 'user-dev-001',
          authorRole: 'user',
          body: body.body || 'New reply test message',
          createdAt: new Date().toISOString(),
        },
      ];
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Reply sent', ticket: updatedTicket }),
      });
    }

    if (url.includes('/support/tickets') && method === 'POST') {
      const body = JSON.parse(route.request().postData() || '{}');
      const newTicket = {
        _id: `tck-${Date.now()}`,
        userId: 'user-dev-001',
        category: body.category || 'general_feedback',
        priority: body.priority || 'low',
        subject: body.subject,
        message: body.message,
        replyToEmail: body.replyToEmail || '',
        status: 'open',
        createdAt: new Date().toISOString(),
      };
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          message: 'Support request submitted successfully.',
          ticket: newTicket,
        }),
      });
    }

    if (url.includes('/support/tickets/') && method === 'DELETE') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Ticket deleted successfully.' }),
      });
    }

    if (url.includes('/auth/me') || url.includes('/user/profile')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          _id: 'user-dev-001',
          name: 'Alex Rivera',
          email: 'alex.rivera@example.com',
          role: 'developer',
        }),
      });
    }

    if (url.includes('/notifications')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ unreadCount: 0, notifications: [] }),
      });
    }

    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({}),
    });
  });

  return { context, page };
}

async function runAudit() {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  console.log(`[audit-support] Running phase: ${phase} against ${baseUrl}`);

  const browser = await chromium.launch({
    headless: true,
    executablePath: fs.existsSync(chromePath) ? chromePath : undefined,
  });

  const matrixResults = [];
  const defects = [];
  const landscapeResults = [];

  try {
    // ── 1. Main Matrix: 12 Viewports x 3 Themes = 36 Checks ────────
    for (const vp of VIEWPORTS) {
      for (const theme of THEMES) {
        process.stdout.write(`  Checking ${vp.name}-${theme}... `);
        const { context, page } = await setupContextAndPage(browser, {
          width: vp.width,
          height: vp.height,
          theme,
        });

        await page.goto(`${baseUrl}/app/support`, { waitUntil: 'networkidle' });
        await page.waitForSelector('.support-page', { timeout: 10000 });
        await page.waitForTimeout(300);

        // Overflow assertions
        const metrics = await page.evaluate(() => {
          const docEl = document.documentElement;
          const body = document.body;
          const scrollWidth = Math.max(docEl.scrollWidth, body.scrollWidth);
          const clientWidth = docEl.clientWidth;
          const hasOverflow = scrollWidth > clientWidth + 1; // 1px rounding tolerance
          const font = window.getComputedStyle(document.body).fontFamily;
          const usesManrope = font.includes('Manrope') || font.includes('sans-serif');
          return {
            scrollWidth,
            clientWidth,
            hasOverflow,
            overflowDelta: Math.max(0, scrollWidth - clientWidth),
            usesManrope,
          };
        });

        const screenshotName = `${vp.name}-${theme}.png`;
        const screenshotPath = path.join(outputDir, screenshotName);
        await page.screenshot({ path: screenshotPath, fullPage: true });

        const passed = !metrics.hasOverflow;
        console.log(passed ? 'PASS' : `FAIL (overflow ${metrics.overflowDelta}px)`);

        if (!passed) {
          defects.push({
            type: 'horizontal-overflow',
            viewport: vp.name,
            theme,
            delta: metrics.overflowDelta,
          });
        }

        matrixResults.push({
          viewport: vp.name,
          category: vp.category,
          dimensions: `${vp.width}x${vp.height}`,
          theme,
          ...metrics,
          passed,
          screenshot: screenshotName,
        });

        await context.close();
      }
    }

    // ── 2. Landscape Orientations ─────────────────────────────────
    console.log('\n  Checking Landscape Orientations...');
    const landscapeViewports = [
      { name: 'mobile-390-landscape', width: 844, height: 390 },
      { name: 'tablet-768-landscape', width: 1024, height: 768 },
    ];

    // landscapeResults declared at function scope
    for (const lvp of landscapeViewports) {
      process.stdout.write(`    ${lvp.name}: `);
      const { context, page } = await setupContextAndPage(browser, {
        width: lvp.width,
        height: lvp.height,
        theme: 'dark',
      });

      await page.goto(`${baseUrl}/app/support`, { waitUntil: 'networkidle' });
      await page.waitForSelector('.support-page');
      await page.waitForTimeout(300);

      const metrics = await page.evaluate(() => {
        const docEl = document.documentElement;
        return {
          scrollWidth: docEl.scrollWidth,
          clientWidth: docEl.clientWidth,
          hasOverflow: docEl.scrollWidth > docEl.clientWidth + 1,
        };
      });

      const shotName = `${lvp.name}-dark.png`;
      await page.screenshot({ path: path.join(outputDir, shotName), fullPage: true });
      const passed = !metrics.hasOverflow;
      console.log(passed ? 'PASS' : 'FAIL');

      landscapeResults.push({ ...lvp, ...metrics, passed, screenshot: shotName });
      await context.close();
    }

    // ── 3. Dedicated Scenarios ────────────────────────────────────
    console.log('\n  Checking Dedicated Scenarios...');
    const scenarioResults = {};

    // Scenario A: Empty Requests State (375px)
    {
      process.stdout.write('    Empty Requests State (375px): ');
      const { context, page } = await setupContextAndPage(browser, {
        width: 375,
        height: 667,
        theme: 'dark',
        activeTickets: emptyTickets,
      });

      await page.goto(`${baseUrl}/app/support`, { waitUntil: 'networkidle' });
      await page.waitForSelector('.support-page');
      const hasEmptyState = await page.locator('app-support-empty-state').isVisible();

      const shotName = 'scenario-empty-requests-375.png';
      await page.screenshot({ path: path.join(outputDir, shotName), fullPage: true });
      console.log(hasEmptyState ? 'PASS' : 'FAIL');
      scenarioResults.emptyRequests = { passed: hasEmptyState, screenshot: shotName };
      await context.close();
    }

    // Scenario B: Long Unbroken Text Stress Test (320px)
    {
      process.stdout.write('    Long Text Stress (320px): ');
      const { context, page } = await setupContextAndPage(browser, {
        width: 320,
        height: 640,
        theme: 'dark',
        activeTickets: longTextTickets,
      });

      await page.goto(`${baseUrl}/app/support`, { waitUntil: 'networkidle' });
      await page.waitForSelector('.support-page');
      await page.waitForTimeout(300);

      const metrics = await page.evaluate(() => {
        const docEl = document.documentElement;
        return {
          scrollWidth: docEl.scrollWidth,
          clientWidth: docEl.clientWidth,
          hasOverflow: docEl.scrollWidth > docEl.clientWidth + 1,
        };
      });

      const shotName = 'scenario-longtext-support-320.png';
      await page.screenshot({ path: path.join(outputDir, shotName), fullPage: true });
      const passed = !metrics.hasOverflow;
      console.log(passed ? 'PASS' : `FAIL (overflow ${metrics.scrollWidth - metrics.clientWidth}px)`);
      scenarioResults.longTextStress = { ...metrics, passed, screenshot: shotName };
      await context.close();
    }

    // Scenario C: Error Feedback Banner (390px)
    {
      process.stdout.write('    Error Feedback (390px): ');
      const { context, page } = await setupContextAndPage(browser, {
        width: 390,
        height: 844,
        theme: 'dark',
      });

      await page.goto(`${baseUrl}/app/support`, { waitUntil: 'networkidle' });
      await page.waitForSelector('.support-page');

      // Click submit without entering required subject/message to trigger validation error
      await page.click('button[type="submit"].btn-primary');
      await page.waitForTimeout(200);

      const isErrorVisible = await page.locator('.prof-error').isVisible();
      const shotName = 'scenario-error-banner-390.png';
      await page.screenshot({ path: path.join(outputDir, shotName) });
      console.log(isErrorVisible ? 'PASS' : 'FAIL');
      scenarioResults.errorFeedback = { passed: isErrorVisible, isErrorVisible, screenshot: shotName };
      await context.close();
    }

    // Scenario D: Ticket Details Modal on 320px Mobile
    {
      process.stdout.write('    Ticket Details Modal (320px): ');
      const { context, page } = await setupContextAndPage(browser, {
        width: 320,
        height: 640,
        theme: 'dark',
      });

      await page.goto(`${baseUrl}/app/support`, { waitUntil: 'networkidle' });
      await page.waitForSelector('.ticket-item');

      // Click the first ticket card to open details modal
      await page.click('.ticket-item:first-child');
      await page.waitForSelector('.modal-container', { timeout: 5000 });
      await page.waitForTimeout(300);

      const modalMetrics = await page.evaluate(() => {
        const modal = document.querySelector('.modal-container');
        if (!modal) return { found: false };
        const rect = modal.getBoundingClientRect();
        const footer = modal.querySelector('.modal-footer');
        const buttons = footer ? Array.from(footer.querySelectorAll('button')) : [];
        const buttonBoxes = buttons.map((b) => {
          const r = b.getBoundingClientRect();
          return { text: b.textContent.trim(), width: Math.round(r.width), height: Math.round(r.height) };
        });
        const closeBtn = modal.querySelector('.close-btn');
        const closeRect = closeBtn ? closeBtn.getBoundingClientRect() : null;
        return {
          found: true,
          modalRect: { width: Math.round(rect.width), left: Math.round(rect.left), right: Math.round(rect.right) },
          buttonBoxes,
          closeBtnWithinViewport: closeRect ? closeRect.right <= window.innerWidth : false,
        };
      });

      const shotName = 'scenario-ticket-details-modal-320.png';
      await page.screenshot({ path: path.join(outputDir, shotName) });
      const passed = modalMetrics.found && modalMetrics.modalRect.width <= 320;
      console.log(passed ? 'PASS' : 'FAIL');
      scenarioResults.ticketDetailsModal = { ...modalMetrics, passed, screenshot: shotName };
      await context.close();
    }

    // Scenario E: Delete Confirm Dialog on 320px Mobile
    {
      process.stdout.write('    Delete Confirm Dialog (320px): ');
      const { context, page } = await setupContextAndPage(browser, {
        width: 320,
        height: 640,
        theme: 'dark',
      });

      await page.goto(`${baseUrl}/app/support`, { waitUntil: 'networkidle' });
      await page.waitForSelector('.ticket-item');
      await page.click('.ticket-item:first-child');
      await page.waitForSelector('.modal-container');

      // Click Delete Ticket inside details modal to open confirm dialog
      await page.click('.btn-danger');
      await page.waitForTimeout(300);

      const confirmMetrics = await page.evaluate(() => {
        const dialog = document.querySelector('.modal-container');
        return { dialogVisible: !!dialog };
      });

      const shotName = 'scenario-confirm-dialog-320.png';
      await page.screenshot({ path: path.join(outputDir, shotName) });
      console.log(confirmMetrics.dialogVisible ? 'PASS' : 'FAIL');
      scenarioResults.confirmDialog = { ...confirmMetrics, passed: confirmMetrics.dialogVisible, screenshot: shotName };
      await context.close();
    }

    // Scenario F: FAQ Accordion Expanded State (375px)
    {
      process.stdout.write('    FAQ Accordion Expand (375px): ');
      const { context, page } = await setupContextAndPage(browser, {
        width: 375,
        height: 667,
        theme: 'dark',
      });

      await page.goto(`${baseUrl}/app/support`, { waitUntil: 'networkidle' });
      await page.waitForSelector('.faq-question');

      // Click the first FAQ question button to open accordion
      await page.click('.faq-question:first-child');
      await page.waitForTimeout(200);

      const faqMetrics = await page.evaluate(() => {
        const answer = document.querySelector('.faq-answer');
        const button = document.querySelector('.faq-question');
        return {
          answerVisible: !!answer,
          ariaExpanded: button ? button.getAttribute('aria-expanded') : null,
        };
      });

      const shotName = 'scenario-faq-open-375.png';
      await page.screenshot({ path: path.join(outputDir, shotName), fullPage: true });
      const passed = faqMetrics.answerVisible && faqMetrics.ariaExpanded === 'true';
      console.log(passed ? 'PASS' : 'FAIL');
      scenarioResults.faqAccordion = { ...faqMetrics, passed, screenshot: shotName };
      await context.close();
    }

    // ── 4. Touch Targets Audit (< 32px height) ────────────────────
    console.log('\n  Checking Touch Target Heights (Mobile 375px)...');
    {
      const { context, page } = await setupContextAndPage(browser, {
        width: 375,
        height: 667,
        theme: 'dark',
      });

      await page.goto(`${baseUrl}/app/support`, { waitUntil: 'networkidle' });
      await page.waitForSelector('.support-page');

      const touchDefects = await page.evaluate(() => {
        const selectors = [
          'button',
          'a.header-link',
          'a.header-action-btn',
          '.category-card',
          '.card-action',
          '.ticket-item',
          '.btn-refresh',
          '.page-num',
          '.nav-btn',
          '.faq-question',
          '.btn-toggle-all',
        ];
        const elements = document.querySelectorAll(selectors.join(', '));
        const defectsList = [];
        elements.forEach((el) => {
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            // Check minimum 32px touch target height threshold
            if (rect.height < 32) {
              defectsList.push({
                tag: el.tagName,
                className: el.className,
                text: el.textContent.trim().slice(0, 30),
                width: Math.round(rect.width),
                height: Math.round(rect.height),
              });
            }
          }
        });
        return defectsList;
      });

      console.log(`    Touch Target Defects (< 32px height): ${touchDefects.length} detected`);
      touchDefects.forEach((d) =>
        console.log(`      * [${d.className}] "${d.text}" height = ${d.height}px (expected >= 32px)`),
      );

      scenarioResults.touchTargetAudit = {
        defectsCount: touchDefects.length,
        touchDefects,
        passed: touchDefects.length === 0,
      };

      await context.close();
    }

    // ── 5. Category Card Grid Audit Across Viewports ──────────────
    console.log('\n  Checking Category Cards Column Layout & Dimensions...');
    {
      const cardAudits = [];
      const testWidths = [1280, 1024, 768, 480, 320];
      for (const w of testWidths) {
        const { context, page } = await setupContextAndPage(browser, {
          width: w,
          height: 800,
          theme: 'dark',
        });
        await page.goto(`${baseUrl}/app/support`, { waitUntil: 'networkidle' });
        await page.waitForSelector('.category-grid');

        const cardMetrics = await page.evaluate(() => {
          const grid = document.querySelector('.category-grid');
          if (!grid) return null;
          const cards = Array.from(grid.querySelectorAll('.category-card'));
          return {
            winW: window.innerWidth,
            docW: document.documentElement.clientWidth,
            gridWidth: Math.round(grid.getBoundingClientRect().width),
            cardCount: cards.length,
            cardWidths: cards.map((c) => Math.round(c.getBoundingClientRect().width)),
            columnsCount: Math.round(grid.getBoundingClientRect().width / (cards[0] ? cards[0].getBoundingClientRect().width : 1)),
          };
        });

        cardAudits.push({ viewportWidth: w, ...cardMetrics });
        console.log(
          `    At ${w}px (win ${cardMetrics.winW}px, doc ${cardMetrics.docW}px): Grid width ${cardMetrics.gridWidth}px, Cards: [${cardMetrics.cardWidths.slice(0, 3).join('px, ')}px]`,
        );
        await context.close();
      }

      scenarioResults.categoryCardsAudit = {
        audits: cardAudits,
        passed: true,
      };
    }
  } finally {
    await browser.close();
    server.close();
  }

  // Summary JSON report
  const summaryReport = {
    phase,
    timestamp: new Date().toISOString(),
    summary: {
      totalMatrix: matrixResults.length,
      passedMatrix: matrixResults.filter((r) => r.passed).length,
      failedMatrix: matrixResults.filter((r) => !r.passed).length,
      allPassed: defects.length === 0,
    },
    defects,
    matrixResults,
    landscapeResults,
    scenarioResults,
  };

  const jsonReportPath = path.resolve(__dirname, `../verification/support/${phase}.json`);
  fs.mkdirSync(path.dirname(jsonReportPath), { recursive: true });
  fs.writeFileSync(jsonReportPath, JSON.stringify(summaryReport, null, 2));

  console.log(`\n[audit-support] Phase "${phase}" complete. Report written to ${jsonReportPath}`);
}

runAudit().catch((err) => {
  console.error('[audit-support] Fatal error:', err);
  process.exit(1);
});

