const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'verification/weekly-reports/finalization');
const staticRoot = path.join(root, 'dist/frontend/browser');
const report = (id, score, week) => ({
  _id: id,
  score,
  weekStartDate: week,
  weekEndDate: week,
  progressSummary: 'Synthetic fixture: measured progress across saved evidence.',
  insights: ['Resume evidence improved.'],
  recommendations: ['Review your next Sprint task.'],
  topAchievements: ['Completed a planned task.'],
  biggestRiskArea: 'Refresh older evidence.',
  predictedHiringReadiness: { score, reason: 'Deterministic fixture indicator.' },
  meta: {
    scoreBreakdown: { github: { label: 'GitHub', score: 70, weight: 30 } },
    dataSourcesUsed: {
      github: { connected: true, status: 'Connected', freshness: 'fresh', lastAnalyzedAt: week },
      learning: { available: true, status: 'Self-reported', lastAnalyzedAt: week },
    },
  },
});
const history = [
  report('new', 72, '2026-11-09T00:00:00Z'),
  report('old', 61, '2026-11-02T00:00:00Z'),
];
const server = http.createServer((req, res) => {
  const requested = path.resolve(staticRoot, '.' + new URL(req.url, 'http://localhost').pathname);
  if (!requested.startsWith(staticRoot + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  const file =
    fs.existsSync(requested) && fs.statSync(requested).isFile()
      ? requested
      : path.join(staticRoot, 'index.html');
  res.setHeader(
    'Content-Type',
    { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(file)] ||
      'application/octet-stream',
  );
  fs.createReadStream(file).pipe(res);
});
(async () => {
  fs.mkdirSync(output, { recursive: true });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  let browser;
  const results = [];
  try {
    browser = await chromium.launch({
      executablePath: process.env.WEEKLY_CHROMIUM_PATH,
      headless: true,
    });
    for (const width of [1440, 375])
      for (const theme of ['light', 'dark', 'system']) {
        const context = await browser.newContext({
          viewport: { width, height: 1000 },
          colorScheme: 'dark',
        });
        await context.addInitScript(
          ({ theme }) => {
            localStorage.setItem(
              'token',
              'fixture.' +
                btoa(
                  JSON.stringify({
                    exp: Math.floor(Date.now() / 1000) + 36000,
                    iss: 'devinsight-api',
                    aud: 'devinsight-web',
                  }),
                ) +
                '.fixture',
            );
            localStorage.setItem(
              'user',
              JSON.stringify({
                _id: 'fixture',
                name: 'Fixture',
                role: 'developer',
                activeGithubUsername: 'fixture',
              }),
            );
            localStorage.setItem('devinsight_theme', theme);
            localStorage.setItem(
              'devinsight_career_profile',
              JSON.stringify({
                careerStack: 'Frontend',
                experienceLevel: 'Mid-level',
                activeCareerStack: 'Frontend',
                activeExperienceLevel: 'Mid-level',
                githubUsername: 'fixture',
                ownerId: 'fixture',
                isConfigured: true,
              }),
            );
          },
          { theme },
        );
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        let mode = 'normal';
        let release;
        const gate = new Promise((resolve) => {
          release = resolve;
        });
        await page.route('**/api/**', async (route) => {
          const url = route.request().url();
          if (url.includes('/weekly-reports/latest')) await gate;
          if (url.includes('/weekly-reports/') && mode === 'error')
            return route.fulfill({ status: 503, json: { message: 'Synthetic outage' } });
          const json = url.includes('/weekly-reports/latest')
            ? mode === 'empty'
              ? null
              : history[0]
            : url.includes('/weekly-reports/history')
              ? { reports: mode === 'empty' ? [] : history }
              : url.includes('/auth/me')
                ? {
                    user: {
                      _id: 'fixture',
                      name: 'Fixture',
                      role: 'developer',
                      activeGithubUsername: 'fixture',
                    },
                  }
                : url.includes('/profile')
                  ? {
                      profile: {
                        careerStack: 'Frontend',
                        experienceLevel: 'Mid-level',
                        isConfigured: true,
                      },
                      isConfigured: true,
                    }
                  : {};
          return route.fulfill({ json });
        });
        await page.goto(`http://127.0.0.1:${server.address().port}/app/weekly-reports`);
        await page.locator('.skeleton-grid').waitFor();
        release();
        await page
          .getByRole('heading', { name: 'Your momentum over time' })
          .waitFor()
          .catch(async (error) => {
            console.error({
              url: page.url(),
              errors,
              body: (await page.locator('body').innerText()).slice(-2500),
            });
            throw error;
          });
        assert.equal(await page.locator('.source-card').count(), 9);
        assert.equal(await page.getByRole('meter').getAttribute('aria-valuenow'), '72');
        await page.getByRole('button', { name: /Nov 2, 2026: 61/ }).focus();
        await page.getByRole('button', { name: /Nov 2, 2026: 61/ }).press('Enter');
        await page.waitForFunction(
          () => document.querySelector('[role="meter"]')?.getAttribute('aria-valuenow') === '61',
        );
        assert.equal(await page.getByRole('meter').getAttribute('aria-valuenow'), '61');
        if (theme === 'system') {
          await page.emulateMedia({ colorScheme: 'light' });
          await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
        }
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        );
        assert.equal(overflow, false);
        assert.deepEqual(errors, []);
        const name = `${width}-${theme}`;
        await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: true });
        results.push({ name, overflow, pageErrors: errors.length, sources: 9 });
        if (width === 1440 && theme === 'light') {
          mode = 'error';
          await page.evaluate(() =>
            Object.keys(localStorage)
              .filter((key) => key.startsWith('frontend_analysis_cache:'))
              .forEach((key) => localStorage.removeItem(key)),
          );
          await page.reload();
          await page.getByRole('alert').waitFor();
          await page.screenshot({ path: path.join(output, 'error.png'), fullPage: true });
          mode = 'empty';
          await page.getByRole('button', { name: 'Retry', exact: true }).click();
          await page.getByRole('heading', { name: 'No Reports Generated' }).waitFor();
          await page.screenshot({ path: path.join(output, 'empty.png'), fullPage: true });
          results.push({ name: 'loading-error-retry-empty', pageErrors: errors.length });
        }
        assert.deepEqual(errors, []);
        await context.close();
      }
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results));
  } finally {
    await browser?.close();
    server.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
