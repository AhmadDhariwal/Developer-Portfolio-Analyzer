// Complete Responsive Audit for Notifications Module across all required viewports and themes.
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const assert = require('node:assert/strict');

const playwrightPath =
  process.env.PLAYWRIGHT_MODULE ||
  'C:/Users/ahmad.hassan/Desktop/Agrivio/node_modules/playwright';
const { chromium } = require(playwrightPath);

const phase = process.argv[2] || 'before';
const chromePath =
  process.env.ACCEPTANCE_CHROME ||
  'C:/Program Files/Google/Chrome/Application/chrome.exe';

const dist = path.resolve(__dirname, '../dist/frontend/browser');
const outputDir = path.resolve(
  __dirname,
  '../verification/notifications/responsive-audit',
);
fs.mkdirSync(outputDir, { recursive: true });

const mockNotifications = [
  {
    _id: 'notif-1',
    userId: 'user-fixture',
    type: 'github_update',
    title: 'GitHub Repositories Synchronized',
    message:
      'Successfully fetched and analyzed 14 repositories including Developer-Portfolio-Analyzer.',
    isRead: false,
    createdAt: new Date(Date.now() - 1000 * 60 * 15).toISOString(),
    updatedAt: new Date(Date.now() - 1000 * 60 * 15).toISOString(),
  },
  {
    _id: 'notif-2',
    userId: 'user-fixture',
    type: 'resume_upload',
    title: 'New Resume Parsed & Evaluated',
    message:
      'Senior Full Stack Engineer resume uploaded with 92% readiness score.',
    isRead: false,
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
    updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
  },
  {
    _id: 'notif-3',
    userId: 'user-fixture',
    type: 'low_score',
    title: 'Action Recommended: System Architecture Gap',
    message:
      'Distributed systems benchmarking evidenced below target expectation for current role target.',
    isRead: true,
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
    updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
  },
  {
    _id: 'notif-4',
    userId: 'user-fixture',
    type: 'career_update',
    title: 'Career Sprint Milestone Achieved',
    message:
      'Sprint week #4 goals reached with 5 consecutive commits and verified peer PR reviews.',
    isRead: true,
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString(),
    updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString(),
  },
  {
    _id: 'notif-5',
    userId: 'user-fixture',
    type: 'system',
    title:
      'Scheduled Security Maintenance Notice with an Exceptionally Long Unbroken Identifier URL https://internal-security.devinsight.corp/advisories/cve-2026-99214-audit-trace-verification',
    message:
      'System token rotations will occur between 02:00 UTC and 03:00 UTC. No downtime anticipated for active WebSocket sessions or SSE listener pipelines.',
    isRead: false,
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 72).toISOString(),
    updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 72).toISOString(),
  },
];

const mockOrganizations = [
  { _id: 'org-1', name: 'Acme Software Corporation' },
  { _id: 'org-2', name: 'Global Tech Systems' },
];

const mockTeams = [
  { _id: 'team-1', name: 'Core Infrastructure' },
  { _id: 'team-2', name: 'Frontend Architecture' },
];

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
  const relative = decodeURIComponent(
    new URL(req.url, 'http://localhost').pathname,
  ).replace(/^\/+/, '');
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
  res.setHeader(
    'Content-Type',
    mime[path.extname(file)] || 'application/octet-stream',
  );
  fs.createReadStream(file).pipe(res);
});

async function main() {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  console.log(`Static server running at ${base}`);

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

  try {
    for (const vp of VIEWPORTS) {
      for (const theme of THEMES) {
        const colorScheme =
          theme === 'system' ? 'dark' : theme;
        const context = await browser.newContext({
          viewport: { width: vp.width, height: vp.height },
          colorScheme,
          reducedMotion: 'reduce',
        });

        await context.addInitScript(
          ({ themeVal }) => {
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
            localStorage.setItem('devinsight_theme', themeVal);
          },
          { themeVal: theme },
        );

        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', (err) => errors.push(err.message));

        await page.route('**/api/**', async (route) => {
          const url = new URL(route.request().url());
          if (url.pathname.includes('/notifications/stream')) {
            return route.fulfill({
              contentType: 'text/event-stream',
              body: ': fixture heartbeat\n\n',
            });
          }
          if (url.pathname.includes('/organizations')) {
            return route.fulfill({ json: { organizations: mockOrganizations } });
          }
          if (url.pathname.includes('/teams')) {
            return route.fulfill({ json: { teams: mockTeams } });
          }
          if (url.pathname.endsWith('/api/notifications')) {
            return route.fulfill({
              json: {
                notifications: mockNotifications,
                total: mockNotifications.length,
                unreadCount: mockNotifications.filter((n) => !n.isRead).length,
                filteredUnreadCount: mockNotifications.filter((n) => !n.isRead)
                  .length,
                page: 1,
                totalPages: 1,
                revision: 1,
              },
            });
          }
          return route.fulfill({ json: { success: true } });
        });

        await page.goto(`${base}/app/notifications`);
        await page.locator('.notifications-page').waitFor({ timeout: 10000 });
        await page.locator('.notification-item').first().waitFor();
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(400);

        // Check horizontal overflow
        const overflow = await page.evaluate(() => {
          const doc = document.documentElement;
          const body = document.body;
          const scrollWidth = Math.max(doc.scrollWidth, body.scrollWidth);
          const clientWidth = doc.clientWidth || window.innerWidth;
          const hasOverflow = scrollWidth > clientWidth + 1;

          // Find specific offending elements if any
          const offending = [];
          if (hasOverflow) {
            const all = document.querySelectorAll('*');
            for (const el of all) {
              const r = el.getBoundingClientRect();
              if (r.right > clientWidth + 2) {
                offending.push({
                  tag: el.tagName,
                  className: el.className,
                  right: r.right,
                  clientWidth,
                });
                if (offending.length >= 5) break;
              }
            }
          }
          return { hasOverflow, scrollWidth, clientWidth, offending };
        });

        // Touch target evaluation for buttons and controls on mobile/touch
        const touchTargets = await page.evaluate(() => {
          const buttons = [
            ...document.querySelectorAll(
              'button, input, select, .quick-pill, .select-control',
            ),
          ];
          const undersized = [];
          for (const b of buttons) {
            const r = b.getBoundingClientRect();
            // Visible elements only
            if (r.width > 0 && r.height > 0 && r.top < window.innerHeight) {
              if (r.height < 28 || r.width < 28) {
                undersized.push({
                  text: (b.textContent || b.getAttribute('aria-label') || '')
                    .trim()
                    .slice(0, 30),
                  tag: b.tagName,
                  className: b.className,
                  width: Math.round(r.width),
                  height: Math.round(r.height),
                });
              }
            }
          }
          return undersized;
        });

        const screenshotName = `${phase}-${vp.name}-${theme}.png`;
        const screenshotPath = path.join(outputDir, screenshotName);
        await page.screenshot({ path: screenshotPath, fullPage: true });

        const record = {
          viewport: vp.name,
          category: vp.category,
          width: vp.width,
          height: vp.height,
          theme,
          overflow: overflow.hasOverflow,
          scrollWidth: overflow.scrollWidth,
          clientWidth: overflow.clientWidth,
          offending: overflow.offending,
          undersizedTargets: touchTargets.length,
          pageErrors: errors,
          screenshot: screenshotName,
        };

        if (overflow.hasOverflow) {
          auditReport.overflowDefects.push(record);
        }
        if (touchTargets.length > 0 && vp.category === 'Mobile') {
          auditReport.touchTargetDefects.push({
            viewport: vp.name,
            theme,
            targets: touchTargets,
          });
        }

        auditReport.matrixResults.push(record);
        await context.close();
      }
    }

    // Interactive UI State Verifications: Dialogs, Empty, Error, Loading, Bulk Selection
    console.log('Auditing interactive UI states...');
    const stateContext = await browser.newContext({
      viewport: { width: 375, height: 800 },
      colorScheme: 'dark',
    });
    await stateContext.addInitScript(() => {
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
        }),
      );
    });

    const statePage = await stateContext.newPage();
    await statePage.route('**/api/**', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.includes('/notifications/stream')) {
        return route.fulfill({
          contentType: 'text/event-stream',
          body: ': heartbeat\n\n',
        });
      }
      if (url.pathname.includes('/organizations')) {
        return route.fulfill({ json: { organizations: mockOrganizations } });
      }
      if (url.pathname.includes('/teams')) {
        return route.fulfill({ json: { teams: mockTeams } });
      }
      if (url.pathname.endsWith('/api/notifications')) {
        return route.fulfill({
          json: {
            notifications: mockNotifications,
            total: mockNotifications.length,
            unreadCount: mockNotifications.filter((n) => !n.isRead).length,
            filteredUnreadCount: mockNotifications.filter((n) => !n.isRead)
              .length,
            page: 1,
            totalPages: 1,
            revision: 1,
          },
        });
      }
      return route.fulfill({ json: { success: true } });
    });

    await statePage.goto(`${base}/app/notifications`);
    await statePage.locator('.notifications-page').waitFor();
    await statePage.locator('.notification-item').first().waitFor();

    // 1. Bulk selection state
    console.log('Testing bulk selection state...');
    const selectCheckbox = statePage
      .locator('.notification-actions input[type="checkbox"]')
      .first();
    await selectCheckbox.check();
    await statePage.locator('.bulk-actions--active').waitFor();
    const bulkOverflow = await statePage.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    );
    await statePage.screenshot({
      path: path.join(outputDir, `${phase}-state-bulk-selected.png`),
      fullPage: true,
    });
    auditReport.stateChecks.bulkSelection = {
      visible: true,
      overflow: bulkOverflow,
    };

    // 2. Bulk delete dialog state
    console.log('Testing bulk delete confirmation dialog...');
    await statePage.getByRole('button', { name: 'Delete selected' }).click();
    await statePage.locator('dialog[open]').waitFor();
    const dialogOverflow = await statePage.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    );
    await statePage.screenshot({
      path: path.join(outputDir, `${phase}-state-bulk-delete-dialog.png`),
      fullPage: true,
    });
    auditReport.stateChecks.bulkDeleteDialog = {
      opened: true,
      overflow: dialogOverflow,
    };
    // Cancel dialog
    await statePage.getByRole('button', { name: 'Cancel' }).click();
    await statePage.waitForTimeout(200);

    // 3. Clear all dialog state
    console.log('Testing clear all confirmation dialog...');
    await statePage.getByRole('button', { name: 'Clear All' }).click();
    await statePage.locator('dialog[open]').waitFor();
    await statePage.screenshot({
      path: path.join(outputDir, `${phase}-state-clear-all-dialog.png`),
      fullPage: true,
    });
    auditReport.stateChecks.clearAllDialog = { opened: true };
    await statePage.getByRole('button', { name: 'Cancel' }).click();
    await statePage.waitForTimeout(200);

    // 4. Single item delete dialog state
    console.log('Testing single item delete dialog...');
    const deleteBtn = statePage
      .locator('.notification-actions button')
      .filter({ hasText: 'Delete' })
      .first();
    await deleteBtn.click();
    await statePage.locator('dialog[open]').waitFor();
    await statePage.screenshot({
      path: path.join(outputDir, `${phase}-state-single-delete-dialog.png`),
      fullPage: true,
    });
    auditReport.stateChecks.singleDeleteDialog = { opened: true };
    await statePage.getByRole('button', { name: 'Cancel' }).click();
    await statePage.waitForTimeout(200);

    // 5. Empty State
    console.log('Testing empty state...');
    const emptyPage = await stateContext.newPage();
    await emptyPage.route('**/api/**', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.includes('/notifications/stream')) {
        return route.fulfill({
          contentType: 'text/event-stream',
          body: ': heartbeat\n\n',
        });
      }
      if (url.pathname.endsWith('/api/notifications')) {
        return route.fulfill({
          json: {
            notifications: [],
            total: 0,
            unreadCount: 0,
            filteredUnreadCount: 0,
            page: 1,
            totalPages: 1,
            revision: 1,
          },
        });
      }
      return route.fulfill({ json: { organizations: [], teams: [] } });
    });
    await emptyPage.goto(`${base}/app/notifications`);
    await emptyPage.locator('.state--empty').waitFor();
    await emptyPage.screenshot({
      path: path.join(outputDir, `${phase}-state-empty.png`),
      fullPage: true,
    });
    auditReport.stateChecks.emptyState = { rendered: true };
    await emptyPage.close();

    // 6. Error & Retry State
    console.log('Testing error and retry state...');
    const errorPage = await stateContext.newPage();
    let failRequest = true;
    await errorPage.route('**/api/**', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.includes('/notifications/stream')) {
        return route.fulfill({
          contentType: 'text/event-stream',
          body: ': heartbeat\n\n',
        });
      }
      if (url.pathname.endsWith('/api/notifications')) {
        if (failRequest) {
          return route.abort('failed');
        }
        return route.fulfill({
          json: {
            notifications: mockNotifications,
            total: mockNotifications.length,
            unreadCount: 3,
            filteredUnreadCount: 3,
            page: 1,
            totalPages: 1,
            revision: 1,
          },
        });
      }
      return route.fulfill({ json: { organizations: [], teams: [] } });
    });
    await errorPage.goto(`${base}/app/notifications`);
    await errorPage.locator('.state--error').waitFor();
    await errorPage.screenshot({
      path: path.join(outputDir, `${phase}-state-error.png`),
      fullPage: true,
    });
    failRequest = false;
    await errorPage.getByRole('button', { name: 'Try again' }).click();
    await errorPage.locator('.notification-item').first().waitFor();
    auditReport.stateChecks.errorAndRetry = {
      errorRendered: true,
      retryRecovered: true,
    };
    await errorPage.close();

    await stateContext.close();

    // Save final report
    const reportPath = path.join(outputDir, `${phase}-audit-results.json`);
    fs.writeFileSync(reportPath, JSON.stringify(auditReport, null, 2));
    console.log(`Audit completed! Results saved to ${reportPath}`);
    console.log(
      `Total Viewport/Theme Checks: ${auditReport.matrixResults.length}`,
    );
    console.log(`Horizontal Overflows: ${auditReport.overflowDefects.length}`);
    console.log(
      `Touch Target Notices: ${auditReport.touchTargetDefects.length}`,
    );
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  console.error('Audit failed:', err);
  process.exit(1);
});

