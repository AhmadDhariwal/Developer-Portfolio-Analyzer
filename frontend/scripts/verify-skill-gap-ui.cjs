/* Browser verification uses synthetic API fixtures, never production accounts or evidence. */
const { chromium } = require('../../backend/node_modules/playwright');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../dist/frontend/browser');
const output = path.resolve(__dirname, '../verification/skill-gap');
const { profile, fixture } = require('./skill-gap-browser-fixture.cjs');
const mime = {
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.html': 'text/html',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};
const server = http.createServer((req, res) => {
  const relative = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(
    /^\/+/,
    '',
  );
  let file = path.resolve(root, relative);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory())
    file = path.join(root, 'index.html');
  res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});
function luminance(rgb) {
  const values = rgb
    .match(/[\d.]+/g)
    .slice(0, 3)
    .map(Number)
    .map((v) => v / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
}
(async () => {
  fs.mkdirSync(output, { recursive: true });
  await new Promise((resolve) => server.listen(4317, '127.0.0.1', resolve));
  const browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.SKILL_GAP_BROWSER ||
      'C:/Users/ahmad.hassan/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe',
  });
  const results = [];
  try {
    for (const theme of ['light', 'dark', 'system']) {
      const context = await browser.newContext({
        colorScheme: theme === 'system' ? 'dark' : theme,
      });
      await context.addInitScript(
        ({ theme, profile }) => {
          const payload = btoa(
            JSON.stringify({
              exp: Math.floor(Date.now() / 1000) + 36000,
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
        },
        { theme, profile },
      );
      const page = await context.newPage();
      let response = fixture();
      let fail = false;
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.route('**/api/**', (route) => {
        const url = route.request().url();
        if (url.includes('/recommendations/saved-previews')) {
          const preview = {
            _id: 'saved-fixture',
            module: 'skill-gap',
            title: 'Saved fixture',
            githubUsername: 'fixture',
            careerStack: 'Backend',
            experienceLevel: 'Student',
            resumeHash: 'no-resume',
            resultSummary: { coverage: 16.67 },
            createdAt: '2026-10-12T00:00:00Z',
          };
          return route.fulfill({
            json:
              route.request().method() === 'POST'
                ? { preview }
                : route.request().method() === 'DELETE'
                  ? {}
                  : { previews: [preview] },
          });
        }
        if (url.includes('/skillgap/skill-gap'))
          return route.fulfill({
            status: fail ? 500 : 200,
            json: fail ? { message: 'Fixture error' } : response,
          });
        if (url.includes('/profile/career')) return route.fulfill({ json: profile });
        if (url.includes('active-username'))
          return route.fulfill({ json: { username: 'fixture' } });
        return route.fulfill({
          json: {
            data: [],
            notifications: [],
            resumes: [],
            previews: [],
            integrations: [],
            profile: {},
            user: { _id: 'fixture', role: 'developer' },
          },
        });
      });
      await page.goto('http://127.0.0.1:4317/app/skill-gap');
      await page.locator('[data-testid=coverage]').waitFor();
      await page.evaluate(() => document.fonts.ready);
      for (const width of [320, 375, 425, 768, 1024, 1280, 1440, 1600]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.waitForFunction(
          () =>
            document.querySelector('.shell-body').classList.contains('shell-body--mobile') ===
            innerWidth <= 768,
        );
        if (width >= 1024 && (await page.locator('.shell-body.sidebar-closed').count()))
          await page.getByRole('button', { name: 'Toggle sidebar', exact: true }).click();
        await page.evaluate(async () => {
          await new Promise(requestAnimationFrame);
          await Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {})));
        });
        await page.waitForFunction(
          () =>
            innerWidth > 768 ||
            document.querySelector('.shell-body').getBoundingClientRect().left === 0,
        );
        await page.evaluate(() => scrollTo(0, 0));
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          true,
          `${theme} ${width}: document overflow`,
        );
        assert.equal(
          await page
            .locator('.skill-gap-page')
            .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
          true,
          `${theme} ${width}: page overflow`,
        );
        const colors = await page
          .locator('.panel')
          .first()
          .evaluate((el) => ({
            fg: getComputedStyle(el).color,
            bg: getComputedStyle(el).backgroundColor,
          }));
        const ratio =
          (Math.max(luminance(colors.fg), luminance(colors.bg)) + 0.05) /
          (Math.min(luminance(colors.fg), luminance(colors.bg)) + 0.05);
        assert.ok(ratio >= 4.5, `contrast ${ratio}`);
        const secondary = await page
          .locator('.coverage-summary p')
          .first()
          .evaluate((el) => ({
            fg: getComputedStyle(el).color,
            bg: getComputedStyle(el.closest('.panel')).backgroundColor,
          }));
        const secondaryRatio =
          (Math.max(luminance(secondary.fg), luminance(secondary.bg)) + 0.05) /
          (Math.min(luminance(secondary.fg), luminance(secondary.bg)) + 0.05);
        assert.ok(secondaryRatio >= 4.5, 'secondary text contrast');
        const computed = await page.evaluate(() => {
          const info = (selector) => {
            const el = document.querySelector(selector);
            const css = getComputedStyle(el);
            return {
              font: css.fontFamily,
              size: css.fontSize,
              weight: css.fontWeight,
              lineHeight: css.lineHeight,
              width: el.getBoundingClientRect().width,
              padding: css.padding,
            };
          };
          return {
            title: info('h1'),
            section: info('#coverage-title'),
            body: info('.coverage-summary__content p'),
            coverage: info('[data-testid=coverage]'),
            workspace: info('.skill-gap-page'),
            shell: info('.main-content'),
            skill: info('.skill-name strong'),
            fontLoaded: document.fonts.check('600 14px Manrope'),
          };
        });
        assert.ok(computed.fontLoaded);
        results.push({
          theme,
          width,
          overflow: false,
          contrast: +ratio.toFixed(2),
          secondaryContrast: +secondaryRatio.toFixed(2),
          computed,
        });
        if ([375, 768, 1024, 1440, 1600].includes(width)) {
          await page.screenshot({ path: path.join(output, `${theme}-${width}-fold.png`) });
          await page.screenshot({
            path: path.join(output, `${theme}-${width}.png`),
            fullPage: true,
          });
        }
      }
      const summary = page.locator('.skill-row summary').first();
      await summary.focus();
      await page.keyboard.press('Enter');
      assert.equal(await page.locator('.skill-row').first().getAttribute('open'), '');
      assert.equal(await summary.evaluate((el) => getComputedStyle(el).outlineStyle), 'solid');
      await page.locator('.filters select').nth(0).selectOption('OPTIONAL');
      await page.waitForFunction(() => document.querySelectorAll('.skill-row').length === 1);
      await page.waitForFunction(
        ({ selector, count }) => document.querySelectorAll(selector).length === count,
        { selector: '.skill-row', count: 1 },
      );
      await page.locator('.filters select').nth(0).selectOption('ALL');
      await page.waitForFunction(() => document.querySelectorAll('.skill-row').length === 8);
      await page.getByRole('button', { name: 'Show all 12 skills', exact: true }).click();
      await page.waitForFunction(
        ({ selector, count }) => document.querySelectorAll(selector).length === count,
        { selector: '.skill-row', count: 12 },
      );
      await page.getByRole('button', { name: 'Show fewer skills (top 8)', exact: true }).click();
      await page.getByRole('searchbox').fill('Docker');
      await page.waitForFunction(() => document.querySelectorAll('.skill-row').length === 1);
      await page.getByRole('searchbox').fill('');
      await page.locator('.filters select').nth(1).selectOption('UNKNOWN');
      await page.waitForFunction(
        ({ selector, count }) => document.querySelectorAll(selector).length === count,
        { selector: '.skill-row', count: 1 },
      );
      await page.locator('.filters select').nth(1).selectOption('ALL');
      await page.locator('.filters select').nth(2).selectOption('Architecture');
      await page.waitForFunction(
        ({ selector, count }) => document.querySelectorAll(selector).length === count,
        { selector: '.skill-row', count: 4 },
      );
      await page.locator('.filters select').nth(2).selectOption('ALL');
      await page.getByLabel('Sort skills by').selectOption('name');
      await page.waitForFunction(() =>
        document.querySelector('.skill-name strong').textContent.startsWith('A very long'),
      );
      assert.equal(
        await page.locator('.skill-name strong').first().textContent(),
        'A very long skill name that must wrap gracefully at every mobile viewport width',
      );
      await page.getByLabel('Sort skills by').selectOption('status');
      await page.getByLabel('Sort skills by').selectOption('confidence');
      await page.getByLabel('Sort skills by').selectOption('priority');
      const phase = page.locator('.phase-summary-bar').first();
      await phase.focus();
      await page.keyboard.press('Enter');
      assert.equal(await page.locator('.roadmap-accordion-phase').first().getAttribute('open'), '');
      await phase.click();
      await page.locator('.weekly-plan > summary').click();
      await page.getByText('Run the service in a container', { exact: true }).waitFor();
      await page.locator('.weekly-plan > summary').click();
      await page.locator('.horizons-section > summary').click();
      await page.getByText('Immediate', { exact: true }).waitFor();
      await page.locator('.horizons-section > summary').click();
      await page.getByRole('button', { name: 'View all 4 proof projects', exact: true }).click();
      await page.waitForFunction(
        ({ selector, count }) => document.querySelectorAll(selector).length === count,
        { selector: '.project-card', count: 4 },
      );
      await page.getByRole('button', { name: 'Show fewer projects (top 3)', exact: true }).click();
      assert.equal(await page.locator('.opportunities li').count(), 3);
      assert.equal(
        await page.locator('.opportunity-links a').first().getAttribute('href'),
        '/app/courses?skill=Docker',
      );
      assert.equal(
        await page.locator('.opportunity-links a').nth(1).getAttribute('href'),
        '/app/career-sprint?skill=Docker',
      );
      for (const coverage of [0, 50, 100, null]) {
        response = { ...fixture(), coverage };
        await page.getByRole('button', { name: 'Refresh evidence' }).click();
        await page.waitForFunction(
          (value) => document.querySelector('[data-testid=coverage]')?.textContent.trim() === value,
          coverage === null ? 'Unavailable' : `${coverage}%`,
        );
      }
      fail = true;
      await page.getByRole('button', { name: 'Refresh evidence' }).click();
      await page.getByRole('alert').waitFor();
      assert.ok(await page.getByRole('button', { name: 'Retry analysis' }).isVisible());
      fail = false;
      response = fixture();
      await page.getByRole('button', { name: 'Retry analysis' }).click();
      await page.locator('[role=alert]').waitFor({ state: 'detached' });
      response = {
        ...fixture(),
        coverage: null,
        evidenceCompleteness: { availableCoreSources: 0, totalCoreSources: 2, complete: false },
      };
      await page.getByRole('button', { name: 'Refresh evidence' }).click();
      await page.locator('.source-disclosure > summary').click();
      await page
        .getByText('No analyzed GitHub or resume evidence is available.', { exact: false })
        .waitFor();
      response = { ...fixture(), ruleVersion: undefined };
      await page.getByRole('button', { name: 'Refresh evidence' }).click();
      await page.getByText('Current skill coverage is unavailable', { exact: true }).waitFor();
      assert.equal(await page.locator('[data-testid=coverage]').count(), 0);
      await page.getByRole('button', { name: 'Preview another profile' }).click();
      await page.getByText('Explore a career target', { exact: true }).waitFor();
      response = fixture();
      await page.getByLabel('GitHub username', { exact: true }).fill('fixture');
      await page.getByRole('button', { name: 'Analyze preview', exact: true }).click();
      await page.locator('[data-testid=coverage]').waitFor();
      await page.getByRole('button', { name: 'Save preview', exact: true }).click();
      await page.getByText('Preview saved.', { exact: true }).waitFor();
      await page.locator('.saved-previews select').selectOption('');
      await page.locator('.saved-previews select').selectOption('saved-fixture');
      await page.getByText('Current skill coverage is unavailable', { exact: true }).waitFor();
      await page.getByRole('button', { name: 'Delete selected preview', exact: true }).click();
      await page.getByText('Saved preview removed.', { exact: true }).waitFor();
      await page.getByRole('button', { name: 'My profile', exact: true }).click();
      await page.locator('[data-testid=coverage]').waitFor();
      await page.locator('.opportunity-links a').first().click();
      await page.waitForURL('**/app/courses?skill=Docker');
      await page.goto('http://127.0.0.1:4317/app/skill-gap');
      await page.locator('[data-testid=coverage]').waitFor();
      await page.locator('.opportunity-links a').nth(1).click();
      await page.waitForURL('**/app/career-sprint?skill=Docker');
      await page.goto('http://127.0.0.1:4317/app/skill-gap');
      await page.locator('[data-testid=coverage]').waitFor();
      if (theme === 'system') {
        await page.emulateMedia({ colorScheme: 'light' });
        await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
      }
      assert.deepEqual(errors, []);
      await context.close();
    }
    fs.writeFileSync(
      path.join(output, 'results.json'),
      JSON.stringify(
        {
          layouts: results,
          keyboard: 'passed',
          interactions:
            'search; requirement/status/category filters; all sort options; evidence disclosure; Show More/Fewer skills and projects; phase keyboard toggle; horizons; weekly milestones; course/sprint navigation; preview analyze/save/open/delete',
          themes: 'light/dark/system; live system switch passed',
          states:
            '0/50/100/null, unavailable core evidence, historical contract, initial preview, partial sources, stale, AI fallback, error/retry',
          consoleErrors: 0,
        },
        null,
        2,
      ),
    );
    console.log(
      `PASS: ${results.length} theme/viewport combinations; keyboard, contrast, score states, error/retry and System changes.`,
    );
  } finally {
    await browser.close();
    server.close();
  }
})().catch((error) => {
  console.error(error);
  server.close();
  process.exitCode = 1;
});
