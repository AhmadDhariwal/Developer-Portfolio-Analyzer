// Verify Resume score rendering against the actual backend aggregate and saved-view request counts.
const { chromium } = require(process.env.ACCEPTANCE_PLAYWRIGHT || 'playwright');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const engine = require('../../backend/src/services/scoring/resumeOverallScore');
const baseFixture = require('./resume-browser-fixture.cjs');
const values = {
  atsScore: 71,
  contentQuality: 50,
  keywordDensity: 81,
  formatScore: 56,
  projectQuality: 84,
  experienceStrength: 25,
  skillsCoverage: 78,
  technicalDepth: 71,
};
const resume = {
  files: baseFixture.files,
  analysis: {
    ...baseFixture.analysis,
    atsScore: 71,
    scoring: engine.calculate(values, { calculatedAt: '2026-11-01T09:00:00.000Z' }),
  },
};
const { profile } = require('./skill-gap-browser-fixture.cjs');

const phase = 'verified';
const dist = path.resolve(
  process.env.PARITY_DIST || path.join(__dirname, '../dist/frontend/browser'),
);
const output = path.resolve(__dirname, '../verification/resume/score-view');
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
    for (const module of ['resume-analyzer'])
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
            if (
              url.pathname.includes('/resume/result') ||
              url.pathname.includes('/resume/analyze')
            ) {
              await page.evaluate(async () => {
                await document.fonts.load('12px Manrope');
                await document.fonts.ready;
              });
              return route.fulfill({ json: resume.analysis });
            }
            if (url.pathname.includes('/resume/files'))
              return route.fulfill({ json: { files: resume.files } });
            if (url.pathname.includes('/resume/active'))
              return route.fulfill({
                json: {
                  activeResumeFileId: 'file-111',
                  defaultResumeFileId: 'file-111',
                  activeResume: resume.files[0],
                  defaultResume: resume.files[0],
                },
              });
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
          const root = '.resume-analyzer-page';
          await page
            .locator('.breakdown-row')
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
          const expectedScores = Object.values(values);
          const displayed = await page.locator('.breakdown-row .score-current').allTextContents();
          assert.deepEqual(
            displayed.map((value) => Number(value.split('/')[0].trim())),
            expectedScores,
          );
          assert.ok(!/NaN|Infinity/.test(await page.locator(root).innerText()));
          const bars = page.locator('.breakdown-row [role="progressbar"]');
          for (let index = 0; index < expectedScores.length; index++) {
            assert.equal(
              await bars.nth(index).getAttribute('aria-valuenow'),
              String(expectedScores[index]),
            );
            assert.equal(
              await page
                .locator('.breakdown-row .progress-fill')
                .nth(index)
                .evaluate((node) => node.style.width),
              `${expectedScores[index]}%`,
            );
          }
          const beforeView = requests.filter((request) => request.path.includes('/resume/'));
          await page.getByRole('button', { name: 'View Analysis', exact: true }).click();
          await page.waitForTimeout(200);
          const afterView = requests.filter((request) => request.path.includes('/resume/'));
          assert.deepEqual(
            afterView,
            beforeView,
            'View Analysis must reuse the matching loaded result',
          );
          row.scores = expectedScores;
          row.viewTriggeredRequests = afterView.length - beforeView.length;
          results.push(row);
          fs.writeFileSync(path.join(output, `${phase}.json`), JSON.stringify(results, null, 2));
          await context.close();
        }
    console.log(
      JSON.stringify(
        results.map(({ name, scores, viewTriggeredRequests }) => ({
          name,
          scores,
          viewTriggeredRequests,
        })),
        null,
        2,
      ),
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
