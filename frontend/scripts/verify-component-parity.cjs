// Deterministic, loopback-only visual characterization for the two extracted pages.
const { chromium } = require(process.env.ACCEPTANCE_PLAYWRIGHT || 'playwright');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const sharp = require('../../backend/node_modules/sharp');
const github = require('./github-browser-fixture.cjs');
const { profile } = require('./skill-gap-browser-fixture.cjs');

const phase = process.argv[2];
assert.ok(['before', 'after'].includes(phase));
const dist = path.resolve(
  process.env.PARITY_DIST || path.join(__dirname, '../dist/frontend/browser'),
);
const output = path.resolve(__dirname, '../verification/component-parity');
const notifications = ['github_update', 'resume_upload', 'low_score'].map((type, index) => ({
  _id: `item-${index}`,
  userId: 'fixture',
  type,
  title: ['GitHub synchronized', 'Resume analyzed', 'Readiness update'][index],
  message: 'Verified fixture notification for presentation acceptance.',
  isRead: index === 2,
  createdAt: '2026-11-01T08:00:00.000Z',
  updatedAt: '2026-11-01T08:00:00.000Z',
}));
const server = http.createServer((req, res) => {
  const relative = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(
    /^\/+/,
    '',
  );
  let file = path.resolve(dist, relative);
  if (!file.startsWith(dist + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory())
    file = path.join(dist, 'index.html');
  const mime = {
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.html': 'text/html',
    '.ttf': 'font/ttf',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
  };
  res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});

async function measurement(page, root) {
  return page.locator(root).evaluate((element) => {
    const round = (value) => Math.round(value * 100) / 100;
    return [
      ...element.querySelectorAll(
        'section, h2, h3, button, input, select, table, canvas, .notification-item',
      ),
    ].map((node) => {
      const rect = node.getBoundingClientRect(),
        style = getComputedStyle(node);
      return {
        tag: node.tagName,
        text: (node.textContent || '').trim().replace(/\s+/g, ' '),
        box: [rect.x, rect.y, rect.width, rect.height].map(round),
        color: style.color,
        background: style.backgroundColor,
        font: style.font,
        display: style.display,
        label: node.getAttribute('aria-label'),
        disabled: node.hasAttribute('disabled'),
      };
    });
  });
}

(async () => {
  fs.mkdirSync(output, { recursive: true });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.ACCEPTANCE_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  });
  const results = [];
  try {
    for (const module of ['github-analyzer', 'notifications'])
      for (const theme of ['light', 'dark'])
        for (const width of [1440, 375]) {
          const context = await browser.newContext({
            viewport: { width, height: 1000 },
            colorScheme: theme,
            reducedMotion: 'reduce',
            timezoneId: 'UTC',
          });
          await context.addInitScript(
            ({ theme, profile }) => {
              const payload = btoa(
                JSON.stringify({
                  exp: Date.parse('2026-11-01T09:00:00.000Z') / 1000 + 36000,
                  iss: 'devinsight-api',
                  aud: 'devinsight-web',
                }),
              );
              localStorage.setItem('token', `fixture.${payload}.fixture`);
              localStorage.setItem(
                'user',
                JSON.stringify({
                  _id: 'fixture',
                  role: 'developer',
                  name: 'Fixture Developer',
                  activeGithubUsername: 'fixture',
                }),
              );
              localStorage.setItem('devinsight_career_profile', JSON.stringify(profile));
              localStorage.setItem('devinsight_theme', theme);
              // Freeze relative dates and cache freshness, without stopping animation timers.
              Date.now = () => Date.parse('2026-11-01T09:00:00.000Z');
            },
            { theme, profile },
          );
          const page = await context.newPage(),
            errors = [],
            requests = [];
          page.on('pageerror', (error) => errors.push(error.message));
          await page.route('**/api/**', async (route) => {
            const url = new URL(route.request().url());
            requests.push({ method: route.request().method(), path: url.pathname + url.search });
            if (url.pathname.includes('/github/analyze')) {
              await page.evaluate(async () => {
                await document.fonts.load('12px Manrope');
                await document.fonts.ready;
              });
              return route.fulfill({ json: github });
            }
            if (url.pathname.endsWith('/github/active-username'))
              return route.fulfill({ json: { username: 'fixture' } });
            if (url.pathname.includes('/notifications/stream'))
              return route.fulfill({
                contentType: 'text/event-stream',
                body: ': fixture heartbeat\n\n',
              });
            if (url.pathname.includes('/notifications'))
              return route.fulfill({
                json: {
                  notifications,
                  total: 3,
                  unreadCount: 2,
                  filteredUnreadCount: 2,
                  page: 1,
                  totalPages: 1,
                  revision: 1,
                },
              });
            if (url.pathname.includes('/profile/career')) return route.fulfill({ json: profile });
            return route.fulfill({
              json: {
                data: [],
                organizations: [],
                teams: [],
                user: { _id: 'fixture', role: 'developer' },
                integrations: [],
                resumes: [],
                previews: [],
              },
            });
          });
          await page.goto(`${base}/app/${module}`);
          const root = module === 'github-analyzer' ? '.analyzer-page' : '.notifications-page';
          await page
            .locator(module === 'github-analyzer' ? '.exec-score-number' : '.notification-item')
            .first()
            .waitFor()
            .catch(async (error) => {
              console.error(
                JSON.stringify({
                  url: page.url(),
                  errors,
                  body: (await page.locator('body').innerText()).slice(0, 1000),
                }),
              );
              throw error;
            });
          await page.evaluate(() => document.fonts.ready);
          await page.addStyleTag({
            content:
              '*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }',
          });
          await page.waitForTimeout(1600);
          const captureHeight = await page.evaluate(() =>
            Math.max(1000, document.documentElement.scrollHeight),
          );
          await page.setViewportSize({ width, height: captureHeight });
          if (width > 768 && (await page.locator('.shell-body.sidebar-closed').count())) {
            await page.getByRole('button', { name: 'Toggle sidebar', exact: true }).click();
          }
          await page.waitForTimeout(300);
          const name = `${module}-${theme}-${width}`;
          const layout = await measurement(page, root);
          const file = path.join(output, `${phase}-${name}.png`);
          await page.screenshot({ path: file, fullPage: true, animations: 'disabled' });
          const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth,
          );
          const row = { name, layout, overflow, errors, requests };
          assert.deepEqual(errors, []);
          assert.equal(overflow, false);
          if (phase === 'after') {
            const baseline = JSON.parse(fs.readFileSync(path.join(output, 'before.json'))).find(
              (item) => item.name === name,
            );
            // Angular/Prettier may alter whitespace between block elements without
            // changing rendered text. Geometry, native controls and labels remain exact.
            const comparable = (rows) =>
              rows.map((item) => ({ ...item, text: item.text.replace(/\s/g, '') }));
            row.layoutEqual =
              JSON.stringify(comparable(layout)) === JSON.stringify(comparable(baseline.layout));
            const a = await sharp(path.join(output, `before-${name}.png`))
              .ensureAlpha()
              .raw()
              .toBuffer({ resolveWithObject: true });
            const b = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
            row.sameDimensions = a.info.width === b.info.width && a.info.height === b.info.height;
            row.changedPixels = row.sameDimensions ? 0 : null;
            row.significantPixels = row.sameDimensions ? 0 : null;
            row.maximumChannelDelta = 0;
            if (row.sameDimensions)
              for (let i = 0; i < a.data.length; i += 4) {
                const delta = Math.max(
                  ...[0, 1, 2, 3].map((channel) =>
                    Math.abs(a.data[i + channel] - b.data[i + channel]),
                  ),
                );
                if (delta) row.changedPixels++;
                if (delta > 8) row.significantPixels++;
                row.maximumChannelDelta = Math.max(row.maximumChannelDelta, delta);
              }
          }
          results.push(row);
          fs.writeFileSync(path.join(output, `${phase}.json`), JSON.stringify(results, null, 2));
          await context.close();
        }
    console.log(
      JSON.stringify(
        results.map(
          ({
            name,
            layoutEqual,
            sameDimensions,
            changedPixels,
            significantPixels,
            maximumChannelDelta,
          }) => ({
            name,
            layoutEqual,
            sameDimensions,
            changedPixels,
            significantPixels,
            maximumChannelDelta,
          }),
        ),
        null,
        2,
      ),
    );
    if (phase === 'after')
      assert.ok(
        results.every(
          (row) => row.layoutEqual && row.sameDimensions && row.significantPixels === 0,
        ),
        'Visual/DOM parity requires investigation',
      );
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error.message);
  server.close();
  process.exitCode = 1;
});
