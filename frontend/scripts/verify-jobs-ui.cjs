// Use an existing project install or the caller's bundled runtime (NODE_PATH).
const { chromium } = require('playwright');
const { profile, catalog, emptyAction } = require('./jobs-browser-fixture.cjs');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../dist/frontend/browser');
const output = path.resolve(__dirname, '../verification/jobs-hub');
const results = {
  scope:
    'Focused production-build browser checks with synthetic intercepted APIs; no backend or provider requests.',
  checks: [],
  screenshots: [],
};
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
      '.svg': 'image/svg+xml',
    }[path.extname(file)] || 'application/octet-stream',
  );
  fs.createReadStream(file).pipe(res);
});
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function check(name, run) {
  await run();
  results.checks.push(name);
}
async function ready(page, selector = 'app-jobs app-job-card') {
  await page.waitForLoadState('load');
  await page.locator(selector).first().waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => !document.querySelector('app-jobs [aria-busy="true"]'));
}
async function screenshot(page, name) {
  await page.screenshot({
    path: path.join(output, name),
    fullPage: name.includes('details'),
    animations: 'disabled',
  });
  results.screenshots.push(name);
}
async function session(browser, origin, theme, mobile = false, mode = 'normal') {
  const context = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
    colorScheme: theme === 'system' ? 'dark' : theme,
    reducedMotion: 'reduce',
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
          name: 'Fixture Developer',
          role: 'developer',
          activeGithubUsername: 'fixture',
        }),
      );
      localStorage.setItem('devinsight_career_profile', JSON.stringify(profile));
      localStorage.setItem('devinsight_theme', theme);
    },
    { theme, profile },
  );
  const controls = {
    mode,
    mutation: 'normal',
    requests: [],
    writes: [],
    saved: new Map(),
    blocked: [],
  };
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await context.route('**/*', async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      pathname = url.pathname;
    if (pathname.includes('/api/')) {
      if (pathname === '/api/jobs') {
        controls.requests.push(Object.fromEntries(url.searchParams));
        if (controls.mode === 'loading') await delay(900);
        if (['503', '429'].includes(controls.mode))
          return route.fulfill({
            status: Number(controls.mode),
            headers: { 'Retry-After': '60' },
            json: {},
          });
        let all = catalog.filter((job) => !controls.saved.get(job.id)?.hidden);
        if (url.searchParams.get('skills'))
          all = all.filter((job) =>
            (job.title + job.skills.join(' '))
              .toLowerCase()
              .includes(url.searchParams.get('skills').toLowerCase()),
          );
        if (url.searchParams.get('platform'))
          all = all.filter((job) => job.platform === url.searchParams.get('platform'));
        if (controls.mode === 'empty') all = [];
        const page = Number(url.searchParams.get('page') || 1),
          limit = Number(url.searchParams.get('limit') || 10);
        return route.fulfill({
          json: {
            jobs: all.slice((page - 1) * limit, page * limit).map((job) => ({
              ...job,
              actions: controls.saved.get(job.id) || emptyAction(job.id),
            })),
            page,
            total: all.length,
            totalPages: Math.max(1, Math.ceil(all.length / limit)),
            hasMore: page * limit < all.length,
            fromCache: true,
            sourceMessage: 'Source data retained; confirm employer availability.',
            diagnostics: {
              cacheFallback: {
                stale: controls.mode === 'stale',
                used: true,
                available: all.length,
              },
            },
            sourceFailures:
              controls.mode === 'stale' ? [{ source: 'Jooble', reason: 'cooldown' }] : [],
          },
        });
      }
      if (pathname === '/api/jobs/actions') {
        const state = url.searchParams.get('state');
        const all = [...controls.saved.values()].filter((action) => !state || action[state]);
        const page = Number(url.searchParams.get('page') || 1),
          limit = Number(url.searchParams.get('limit') || 10);
        return route.fulfill({
          json: {
            actions: all.slice((page - 1) * limit, page * limit),
            page,
            hasMore: page * limit < all.length,
          },
        });
      }
      if (/\/jobs\/[^/]+\/actions$/.test(pathname)) {
        const id = decodeURIComponent(pathname.split('/').at(-2)),
          patch = request.postDataJSON();
        controls.writes.push({ id, patch });
        await delay(150);
        if (controls.mutation === '503') return route.fulfill({ status: 503, json: {} });
        if (controls.mutation === '429')
          return route.fulfill({ status: 429, headers: { 'Retry-After': '60' }, json: {} });
        const action = { ...(controls.saved.get(id) || emptyAction(id)), ...patch };
        controls.saved.set(id, action);
        return route.fulfill({ json: { action } });
      }
      if (/\/jobs\/[^/]+$/.test(pathname)) {
        const id = decodeURIComponent(pathname.split('/').at(-1));
        const job = catalog.find((job) => job.id === id);
        return route.fulfill(
          job
            ? { json: { job: { ...job, actions: controls.saved.get(id) || emptyAction(id) } } }
            : { status: 404, json: {} },
        );
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
          user: { _id: 'fixture', role: 'developer' },
        },
      });
    }
    if (url.origin === origin) return route.continue();
    if (url.hostname === 'example.com')
      return route.fulfill({
        contentType: 'text/html',
        body: '<html>Synthetic employer fixture</html>',
      });
    controls.blocked.push(url.origin);
    return route.abort();
  });
  await page.goto(origin + '/app/jobs', { waitUntil: 'domcontentloaded' });
  return { page, context, controls, errors };
}
async function main() {
  fs.mkdirSync(output, { recursive: true });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  try {
    for (const mobile of [false, true])
      for (const theme of ['light', 'dark']) {
        const { page, context, controls, errors } = await session(browser, origin, theme, mobile);
        const label = `${mobile ? 'mobile' : 'desktop'}-${theme}`;
        await check(label + ': responsive cards, Manrope and theme', async () => {
          await ready(page);
          assert.equal(await page.locator('app-job-card').count(), 10);
          assert.equal(await page.locator('html').getAttribute('data-theme'), theme);
          assert.equal(
            await page
              .locator('.job-card')
              .first()
              .evaluate((el) => getComputedStyle(el).backgroundColor),
            theme === 'dark' ? 'rgb(21, 29, 42)' : 'rgb(255, 255, 255)',
          );
          assert.match(
            await page.locator('.jobs-page').evaluate((el) => getComputedStyle(el).fontFamily),
            /Manrope/,
          );
          assert(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
            'horizontal document overflow',
          );
          if (mobile) {
            await page.getByRole('button', { name: 'Filters', exact: true }).click();
            await page.locator('#job-source').waitFor({ state: 'visible' });
            await page.getByRole('button', { name: 'Filters', exact: true }).click();
          }
          await screenshot(page, label + '.png');
        });
        await check(label + ': Save, track, Hide and Unhide', async () => {
          await page
            .locator('app-job-card')
            .first()
            .getByRole('button', { name: 'Save job', exact: true })
            .click();
          await page
            .locator('app-job-card')
            .first()
            .getByRole('button', { name: 'Remove saved job', exact: true })
            .waitFor();
          await page
            .locator('app-job-card')
            .first()
            .getByRole('button', { name: 'Mark applied', exact: true })
            .click();
          await page
            .getByRole('status')
            .filter({ hasText: 'No application was submitted' })
            .waitFor();
          await page.getByRole('button', { name: 'Saved jobs', exact: true }).click();
          await page.getByRole('heading', { name: 'Your next possibilities' }).waitFor();
          await ready(page);
          assert.equal(await page.locator('app-job-card').count(), 1);
          await page.getByRole('button', { name: 'Application tracker', exact: true }).click();
          await page.getByRole('heading', { name: 'Your application journey' }).waitFor();
          await ready(page);
          assert.match(await page.locator('.library').innerText(), /do not submit or verify/);
          if (!mobile && theme === 'dark') await screenshot(page, 'desktop-dark-tracker.png');
          await page
            .locator('app-job-card')
            .getByRole('button', { name: 'Hide', exact: true })
            .click();
          await page.locator('.unavailable').waitFor();
          await page.getByRole('button', { name: 'Hidden', exact: true }).click();
          await page
            .locator('.unavailable')
            .getByRole('button', { name: 'Unhide', exact: true })
            .click();
          await page.getByRole('heading', { name: 'Nothing hidden' }).waitFor();
          assert.equal(controls.saved.get('fixture-job-1').hidden, false);
          await page.getByRole('button', { name: 'Discover', exact: true }).click();
          await page.getByRole('heading', { name: 'Opportunities for you' }).waitFor();
          await ready(page);
        });
        if (!mobile && theme === 'light') {
          await check(
            'details: source, salary, evidence, learning and safe external apply without mutation',
            async () => {
              await page
                .locator('app-job-card')
                .first()
                .getByRole('link', { name: /View details/ })
                .click();
              await ready(page, '.detail-heading');
              assert.match(
                await page.locator('.job-details-page').innerText(),
                /Evidence to review/,
              );
              assert.match(
                await page.locator('.job-details-page').innerText(),
                /PostgreSQL foundations/,
              );
              assert.match(
                await page.locator('.job-details-page').innerText(),
                /60,000 – 85,000 USD/,
              );
              await screenshot(page, 'desktop-light-details.png');
              const before = controls.writes.length;
              const popup = page.waitForEvent('popup');
              await page.getByRole('link', { name: 'Visit application site' }).click();
              await (await popup).close();
              assert.equal(controls.writes.length, before);
              await page.getByRole('link', { name: 'Back to Jobs Hub' }).click();
              await ready(page);
            },
          );
          await check(
            'account reload picks up remote activity and preserves expired history',
            async () => {
              controls.saved.set('fixture-job-2', { ...emptyAction('fixture-job-2'), saved: true });
              controls.saved.set('expired-fixture', {
                ...emptyAction('expired-fixture'),
                saved: true,
              });
              await page.reload();
              await ready(page);
              await page.getByRole('button', { name: 'Saved jobs', exact: true }).click();
              await page.getByRole('heading', { name: 'Your next possibilities' }).waitFor();
              await ready(page);
              assert.equal(await page.locator('app-job-card').count(), 2);
              assert.match(await page.locator('.unavailable').innerText(), /expired-fixture/);
              assert.match(
                await page.locator('.unavailable').innerText(),
                /Listing currently unavailable/,
              );
              await page
                .locator('.unavailable')
                .getByRole('button', { name: 'Remove saved', exact: true })
                .click();
              await page.locator('.unavailable').waitFor({ state: 'detached' });
              assert.equal(controls.saved.get('expired-fixture').saved, false);
              await page.getByRole('button', { name: 'Discover', exact: true }).click();
              await page.getByRole('heading', { name: 'Opportunities for you' }).waitFor();
              await ready(page);
            },
          );
          await check('search, source filter, explicit page sorting and pagination', async () => {
            await page.getByRole('button', { name: 'Next →', exact: true }).click();
            await page.getByText('Page 2 of 2', { exact: true }).waitFor();
            assert.equal(await page.locator('app-job-card').count(), 2);
            await page.getByRole('searchbox').fill('TypeScript');
            await page.getByRole('button', { name: 'Search jobs', exact: true }).click();
            await ready(page);
            assert.equal(controls.requests.at(-1).skills, 'TypeScript');
            await page.locator('#job-source').selectOption('Remotive');
            await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
            await page.waitForFunction(
              () => document.querySelectorAll('app-job-card').length === 2,
            );
            await ready(page);
            assert.equal(controls.requests.at(-1).platform, 'Remotive');
            assert.equal(await page.locator('app-job-card').count(), 2);
            await page.getByRole('combobox', { name: 'Sort this page' }).selectOption('company');
            assert(controls.requests.every((params) => !('forceRefresh' in params)));
          });
          await check('503 revalidation retains jobs; offline preserves usable data', async () => {
            controls.mode = '503';
            await page.getByRole('button', { name: 'Recheck listings' }).click();
            await page.getByRole('alert').waitFor();
            assert.equal(await page.locator('app-job-card').count(), 2);
            await context.setOffline(true);
            await page.getByRole('status').filter({ hasText: "You're offline" }).waitFor();
            assert.equal(await page.locator('app-job-card').count(), 2);
            await context.setOffline(false);
          });
        }
        assert.deepEqual(errors, [], label + ' runtime errors');
        await context.close();
      }
    const system = await session(browser, origin, 'system', false, 'stale');
    await ready(system.page);
    await check('System follows OS preference; stale/provider-limited notice', async () => {
      assert.equal(await system.page.locator('html').getAttribute('data-theme'), 'dark');
      assert.match(await system.page.locator('.results').innerText(), /retained listings/);
      assert.match(
        await system.page.locator('.results').innerText(),
        /Some sources are temporarily unavailable/,
      );
      await system.page.emulateMedia({ colorScheme: 'light' });
      await system.page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
    });
    await system.context.close();
    for (const mode of ['empty', 'loading', '429']) {
      const current = await session(browser, origin, 'light', false, mode);
      await check(mode + ' state', async () => {
        if (mode === 'empty')
          await current.page.getByRole('heading', { name: 'No matches just yet' }).waitFor();
        else if (mode === 'loading') {
          await current.page.locator('.skeleton').first().waitFor();
          await ready(current.page);
        } else {
          await current.page.getByRole('alert').waitFor();
          const before = current.controls.requests.length;
          assert(await current.page.getByRole('button', { name: 'Try again' }).isDisabled());
          assert.equal(current.controls.requests.length, before);
        }
      });
      await current.context.close();
    }
    const failure = await session(browser, origin, 'light');
    await ready(failure.page);
    await check(
      'failed mutations never claim saved state; 429 disables further writes',
      async () => {
        failure.controls.mutation = '503';
        await failure.page
          .locator('app-job-card')
          .first()
          .getByRole('button', { name: 'Save job', exact: true })
          .click();
        await failure.page.getByRole('alert').waitFor();
        assert.equal(failure.controls.saved.size, 0);
        assert.equal(
          await failure.page
            .locator('app-job-card')
            .first()
            .getByRole('button', { name: 'Save job', exact: true })
            .count(),
          1,
        );
        failure.controls.mutation = '429';
        await failure.page
          .locator('app-job-card')
          .first()
          .getByRole('button', { name: 'Save job', exact: true })
          .click();
        await failure.page.getByRole('alert').filter({ hasText: 'request limit' }).waitFor();
        assert(
          await failure.page
            .locator('app-job-card')
            .last()
            .getByRole('button', { name: 'Save job', exact: true })
            .isDisabled(),
        );
      },
    );
    await failure.context.close();
    results.passed = results.checks.length;
    console.log(JSON.stringify(results, null, 2));
    fs.writeFileSync(
      path.join(output, 'browser-results.json'),
      JSON.stringify(results, null, 2) + '\n',
    );
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}
main().catch((error) => {
  console.error(error);
  server.close();
  process.exitCode = 1;
});
