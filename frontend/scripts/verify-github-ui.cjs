const { chromium } = require('../../backend/node_modules/playwright');
const { profile, fixture } = require('./skill-gap-browser-fixture.cjs');
const githubFixture = require('./github-browser-fixture.cjs');
const http = require('node:http'),
  fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../dist/frontend/browser'),
  output = path.resolve(__dirname, '../verification/github-ui');
const mime = {
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.html': 'text/html',
  '.ttf': 'font/ttf',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
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
async function settle(page) {
  await page.evaluate(async () => {
    await new Promise(requestAnimationFrame);
    await Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {})));
  });
}
async function session(browser, theme, role = 'developer') {
  const context = await browser.newContext({
    colorScheme: theme === 'system' ? 'dark' : theme,
    viewport: { width: 1440, height: 1000 },
  });
  await context.addInitScript(
    ({ theme, profile, role }) => {
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
          role,
          name: 'Fixture Developer',
          activeGithubUsername: 'fixture',
        }),
      );
      localStorage.setItem('devinsight_career_profile', JSON.stringify(profile));
      localStorage.setItem('devinsight_theme', theme);
    },
    { theme, profile, role },
  );
  const page = await context.newPage(),
    errors = [];
  const controls = { failRefresh: false };
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('https://api.github.com/**', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/**', (route) => {
    const url = route.request().url();
    if (url.includes('/github/analyze')) {
      const body = route.request().postDataJSON();
      if (controls.failRefresh && body.forceRefresh)
        return route.fulfill({ status: 503, json: { message: 'Temporary upstream outage' } });
      if (body.username === 'loading-profile')
        return new Promise((resolve) =>
          setTimeout(() => resolve(route.fulfill({ json: githubFixture })), 600),
        );
      if (body.username === 'octocat')
        return route
          .fetch({ url: 'http://127.0.0.1:5000/api/github/analyze' })
          .then((response) => route.fulfill({ response }));
      if (body.username === 'missing-profile')
        return route.fulfill({ status: 404, json: { message: 'GitHub profile not found' } });
      if (body.username === 'empty-profile')
        return route.fulfill({ json: { ...githubFixture, repoCount: 0, repositories: [] } });
      if (body.username === 'stale-profile')
        return route.fulfill({
          json: {
            ...githubFixture,
            cache: { source: 'stale-cache', hit: true, stale: true },
            rateLimited: true,
            warning: 'GitHub rate limit; showing cached evidence',
          },
        });
      if (body.username === 'partial-profile')
        return route.fulfill({
          json: {
            ...githubFixture,
            summary: undefined,
            explanation: undefined,
            strengths: [],
            weakAreas: [],
            recruiterInsights: undefined,
            scoring: { ...githubFixture.scoring, score: null, breakdown: {} },
            scores: {},
            languageDistribution: [],
            mainLanguageDistribution: [],
            repositoryActivity: [],
            technologies: [],
            technologyCategories: {},
          },
        });
      return route.fulfill({ json: githubFixture });
    }
    if (url.includes('/skillgap/skill-gap')) return route.fulfill({ json: fixture() });
    if (url.includes('/profile/career')) return route.fulfill({ json: profile });
    if (url.includes('active-username')) return route.fulfill({ json: { username: 'fixture' } });
    return route.fulfill({
      json: {
        data: [],
        notifications: [],
        resumes: [],
        previews: [],
        integrations: [],
        organizations: [],
        teams: [],
        profile: {},
        user: { _id: 'fixture', role },
      },
    });
  });
  return { context, page, errors, controls };
}
(async () => {
  fs.mkdirSync(output, { recursive: true });
  await new Promise((r) => server.listen(4319, '127.0.0.1', r));
  const browser = await chromium.launch({
    headless: true,
    executablePath:
      'C:/Users/ahmad.hassan/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe',
  });
  const layouts = [],
    interactions = [];
  try {
    for (const theme of ['light', 'dark', 'system']) {
      const { context, page, errors, controls } = await session(browser, theme);
      const requests = [];
      page.on('request', (r) => {
        if (r.url().includes('/github/analyze'))
          requests.push({ url: r.url(), body: r.postDataJSON() });
      });
      await page.goto('http://127.0.0.1:4319/app/github-analyzer');
      await page.locator('.exec-score-number').waitFor();
      await page.evaluate(() => document.fonts.ready);
      assert.equal((await page.locator('.exec-score-number').innerText()).trim(), '82');
      assert.equal(await page.locator('.breakdown-row').count(), 6);
      assert.equal(await page.locator('tbody tr').count(), 5);
      for (const width of [320, 375, 425, 768, 1024, 1280, 1440, 1600]) {
        await page.setViewportSize({ width, height: 1000 });
        if (width > 768 && (await page.locator('.shell-body.sidebar-closed').count()))
          await page.getByRole('button', { name: 'Toggle sidebar', exact: true }).click();
        await settle(page);
        const measurement = await page.evaluate(() => {
          const p = document.querySelector('.analyzer-page'),
            c = getComputedStyle(p),
            main = document.querySelector('.main-content');
          return {
            overflow: document.documentElement.scrollWidth > innerWidth,
            font: c.fontFamily,
            pageWidth: p.getBoundingClientRect().width,
            mainPadding: getComputedStyle(main).padding,
            title: getComputedStyle(document.querySelector('h1')).fontSize,
            section: getComputedStyle(document.querySelector('.panel-title')).fontSize,
            score: getComputedStyle(document.querySelector('.exec-score-number')).fontSize,
            theme: document.documentElement.dataset.theme,
            charts: [...document.querySelectorAll('canvas')].map((el) => ({
              width: el.width,
              height: el.height,
              displayWidth: el.getBoundingClientRect().width,
            })),
          };
        });
        assert.equal(measurement.overflow, false, `overflow ${theme} ${width}`);
        assert.match(measurement.font, /Manrope/);
        assert.equal(measurement.title, '28px');
        assert.equal(measurement.section, '19px');
        assert.equal(measurement.score, '44px');
        await page.evaluate(() => {
          document.querySelector('.main-content').scrollTop = 0;
          window.scrollTo(0, 0);
        });
        await page.screenshot({ path: path.join(output, `${theme}-${width}.png`), fullPage: true });
        await page.screenshot({ path: path.join(output, `${theme}-${width}-fold.png`) });
        // Full document screenshots retain native width; region screenshots supplement the shell view.
        await page
          .locator('.analyzer-page')
          .screenshot({ path: path.join(output, `${theme}-${width}-page.png`) });
        layouts.push({ theme, width, ...measurement });
      }
      await page.setViewportSize({ width: 1440, height: 1000 });
      await settle(page);
      await page.getByRole('button', { name: 'View All Repositories (8)', exact: true }).click();
      await page.waitForFunction(() => document.querySelectorAll('tbody tr').length === 8);
      assert.equal(await page.locator('tbody tr').count(), 8);
      await page.locator('th').getByRole('button', { name: 'Stars', exact: true }).click();
      await page.waitForFunction(
        () => document.querySelector('.table-repo-name').textContent.trim() === 'web-components',
      );
      assert.equal(
        await page.locator('tbody tr').first().locator('.table-repo-name').innerText(),
        'web-components',
      );
      await page.locator('th').getByRole('button', { name: 'Stars', exact: true }).click();
      await page.waitForFunction(
        () => document.querySelector('.table-repo-name').textContent.trim() === 'atlas-api',
      );
      assert.equal(
        await page.locator('tbody tr').first().locator('.table-repo-name').innerText(),
        'atlas-api',
      );
      await page.locator('th').getByRole('button', { name: 'Repository', exact: true }).click();
      await page.waitForFunction(
        () => document.querySelector('th').getAttribute('aria-sort') === 'ascending',
      );
      assert.equal(
        await page.locator('tbody tr').first().locator('.table-repo-name').innerText(),
        'atlas-api',
      );
      await page.locator('th').getByRole('button', { name: 'Repository', exact: true }).click();
      await page.waitForFunction(
        () => document.querySelector('th').getAttribute('aria-sort') === 'descending',
      );
      assert.equal(
        await page.locator('tbody tr').first().locator('.table-repo-name').innerText(),
        'web-components',
      );
      const disclosure = page.locator('.repository-evidence summary').first();
      await disclosure.focus();
      await page.keyboard.press('Enter');
      assert.equal(await disclosure.locator('..').getAttribute('open'), '');
      assert.ok(
        await page
          .locator('.repository-evidence')
          .first()
          .innerText()
          .then((t) => t.includes('README detected')),
      );
      await page.getByRole('button', { name: 'Analysis Details & Audit', exact: true }).click();
      await page.getByRole('dialog').waitFor();
      await page.getByRole('dialog').getByText('Source Metadata', { exact: true }).waitFor();
      await page.keyboard.press('Tab');
      assert.ok(await page.getByRole('dialog').locator(':focus').count());
      await page.keyboard.press('Shift+Tab');
      assert.ok(await page.getByRole('dialog').locator(':focus').count());
      await page.keyboard.press('Escape');
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      await page.getByRole('button', { name: 'Refresh Analysis', exact: true }).click();
      await page.waitForFunction(() => !document.querySelector('.search-input-field').disabled);
      assert.ok(
        requests.some((r) => r.url.endsWith('/github/analyze-save') && r.body.forceRefresh),
      );
      controls.failRefresh = true;
      await page.getByRole('button', { name: 'Refresh Analysis', exact: true }).click();
      await page.getByRole('alert').filter({ hasText: 'Refresh Issue' }).waitFor();
      assert.equal((await page.locator('.exec-score-number').innerText()).trim(), '82');
      controls.failRefresh = false;
      const username = page.getByRole('textbox', { name: 'GitHub username' });
      await username.fill('loading-profile');
      await username.press('Enter');
      await page.locator('.loading-skeleton-container').waitFor();
      await page.locator('.exec-score-number').waitFor();
      await page.setViewportSize({ width: 375, height: 1000 });
      await settle(page);
      const mobileEvidence = page.locator('.repository-evidence summary').nth(1);
      await mobileEvidence.focus();
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.querySelectorAll('.repository-evidence')[1].open);
      assert.equal(
        await mobileEvidence.evaluate((el) => getComputedStyle(el).outlineStyle),
        'solid',
      );
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      );
      await page.screenshot({ path: path.join(output, `${theme}-mobile-repository-evidence.png`) });
      await page.getByRole('button', { name: 'Toggle sidebar', exact: true }).click();
      await page.getByRole('button', { name: 'Close navigation', exact: true }).waitFor();
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.querySelector('.shell-backdrop'));
      await page.setViewportSize({ width: 1440, height: 1000 });
      await settle(page);
      await username.fill('preview-profile');
      await username.press('Enter');
      await page.getByText('Previewing @preview-profile', { exact: true }).waitFor();
      assert.ok(
        requests.some(
          (r) => r.url.endsWith('/github/analyze') && r.body.username === 'preview-profile',
        ),
      );
      await page
        .getByRole('button', { name: 'Return to My Profile (@fixture)', exact: true })
        .first()
        .click();
      await page.locator('.identity-username-link').filter({ hasText: '@fixture' }).waitFor();
      for (const name of ['missing-profile', 'empty-profile', 'stale-profile', 'partial-profile']) {
        await username.fill(name);
        await username.press('Enter');
        if (name === 'missing-profile')
          await page.getByText('GitHub Profile Not Found', { exact: true }).waitFor();
        if (name === 'empty-profile')
          await page.getByText('No Public Repositories Found', { exact: true }).waitFor();
        if (name === 'stale-profile')
          await page.getByText('GitHub API Rate Limit Reached', { exact: true }).waitFor();
        if (name === 'partial-profile') {
          await page.getByText('Unavailable', { exact: true }).first().waitFor();
          await page
            .getByText('AI qualitative narrative is temporarily unavailable', { exact: false })
            .waitFor();
        }
      }
      const liveResponse = page.waitForResponse(
        (r) =>
          r.url().includes('/github/analyze') && r.request().postDataJSON()?.username === 'octocat',
      );
      await username.fill('octocat');
      await username.press('Enter');
      await page.locator('.identity-username-link').filter({ hasText: '@octocat' }).waitFor();
      const liveScore = Number(await page.locator('.exec-score-number').innerText());
      assert.equal(liveScore, (await (await liveResponse).json()).scoring.score);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: path.join(output, `${theme}-live-octocat-1440.png`),
        fullPage: true,
      });
      interactions.push({ theme, liveBackend: true, username: 'octocat', score: liveScore });
      if (theme === 'system') {
        await page.emulateMedia({ colorScheme: 'light' });
        await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
        await page.emulateMedia({ colorScheme: 'dark' });
        await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
      }
      assert.deepEqual(errors, []);
      interactions.push({
        theme,
        sorting: true,
        viewAll: true,
        keyboardEvidence: true,
        drawerEscape: true,
        refreshSaved: true,
        previewUnsaved: true,
        returnSaved: true,
        notFound: true,
        empty: true,
        stale: true,
        partial: true,
        loading: true,
        refreshRecovery: true,
        mobileEvidence: true,
        mobileNavigation: true,
        consoleErrors: errors,
      });
      await page.goto('http://127.0.0.1:4319/app/skill-gap');
      await page.locator('[data-testid=coverage]').waitFor();
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(() => window.scrollTo(0, 0));
      const reference = await page.evaluate(() => ({
        font: getComputedStyle(document.querySelector('.skill-gap-page')).fontFamily,
        title: getComputedStyle(document.querySelector('h1')).fontSize,
        section: getComputedStyle(document.querySelector('#coverage-title')).fontSize,
        padding: getComputedStyle(document.querySelector('.main-content')).padding,
      }));
      assert.match(reference.font, /Manrope/);
      assert.equal(reference.title, '28px');
      assert.equal(reference.section, '19px');
      assert.equal(reference.padding, '24px');
      await page.screenshot({ path: path.join(output, `${theme}-skill-gap-reference.png`) });
      interactions.push({ theme, skillGapReference: reference });
      for (const route of ['/app/dashboard', '/app/resume-analyzer']) {
        await page.goto('http://127.0.0.1:4319' + route);
        await page.locator('.main-content').waitFor();
        await settle(page);
        if (route.includes('dashboard'))
          await page.getByRole('heading', { name: 'Dashboard Overview', exact: true }).waitFor();
        else await page.getByRole('heading', { name: 'Resume Analyzer', exact: true }).waitFor();
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
          false,
        );
        interactions.push({ theme, regressionRoute: route, loaded: true, overflow: false });
      }
      assert.deepEqual(errors, []);
      await context.close();
    }
    fs.writeFileSync(
      path.join(output, 'results.json'),
      JSON.stringify({ layouts, interactions }, null, 2),
    );
    console.log(JSON.stringify({ layouts: layouts.length, interactions }, null, 2));
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => {
  console.error(e);
  server.close();
  process.exitCode = 1;
});
