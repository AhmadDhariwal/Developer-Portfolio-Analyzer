const { chromium } = require('playwright');
const { profile, catalog, response, artwork } = require('./news-browser-fixture.cjs');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../dist/frontend/browser');
const output = path.resolve(__dirname, '../verification/tech-news');
const results = {
  scope:
    'Focused frontend verification using synthetic HTTP fixtures; no provider or backend traffic.',
  checks: [],
  screenshots: [],
  errors: [],
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
      '.ico': 'image/x-icon',
    }[path.extname(file)] || 'application/octet-stream',
  );
  fs.createReadStream(file).pipe(res);
});
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function check(name, action) {
  await action();
  if (!results.checks.includes(name)) results.checks.push(name);
}
async function ready(page) {
  await page.locator('app-news').waitFor();
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
  );
  await page.evaluate(() => document.fonts.ready);
}
async function session(browser, origin, theme, mobile) {
  const context = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
    colorScheme: theme,
    reducedMotion: 'reduce',
  });
  await context.addInitScript(
    ({ theme, profile }) => {
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
        localStorage.setItem('devinsight_career_profile', JSON.stringify(profile));
        localStorage.setItem('devinsight_theme', theme);
      }
    },
    { theme, profile },
  );
  const controls = {
    mode: 'normal',
    writes: [],
    reads: [],
    saved: new Map(),
    blocked: [],
    mutation: 'normal',
  };
  const page = await context.newPage();
  page.on('pageerror', (error) => results.errors.push(error.message));
  const ownerOf = (req) => {
    try {
      return JSON.parse(Buffer.from(req.headers().authorization.split('.')[1], 'base64').toString())
        .id;
    } catch {
      return 'one';
    }
  };
  await context.route('**/*', async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      pathname = url.pathname,
      owner = ownerOf(req);
    if (pathname.startsWith('/api/')) {
      if (pathname === '/api/news') {
        const params = url.searchParams;
        controls.reads.push(Object.fromEntries(params));
        const mode = controls.mode;
        if (mode === 'slow' || params.get('search') === 'Old') await delay(650);
        if (mode === '429' || mode === '503')
          return route.fulfill({ status: Number(mode), headers: { 'Retry-After': '2' }, json: {} });
        let items = ['empty', 'warming'].includes(mode) ? [] : catalog;
        if (params.get('search'))
          items = items.filter((item) =>
            item.title.toLowerCase().includes(params.get('search').toLowerCase()),
          );
        if (params.get('source'))
          items = items.filter((item) => item.source === params.get('source'));
        if (params.get('category'))
          items = items.filter((item) => item.category === params.get('category'));
        if (params.get('popularity') === 'high')
          items = items.filter((item) => item.popularity >= 200);
        return route.fulfill({ json: response(items, params, mode) }).catch(() => {});
      }
      if (pathname === '/api/news/saved') {
        const type = url.searchParams.get('type'),
          page = Number(url.searchParams.get('page') || 1),
          limit = Number(url.searchParams.get('limit') || 50);
        const all = [...controls.saved.values()].filter(
          (item) => item.owner === owner && item.type === type,
        );
        return route.fulfill({
          json: {
            items: all.slice((page - 1) * limit, page * limit),
            total: all.length,
            page,
            limit,
            hasMore: page * limit < all.length,
            totalPages: Math.max(1, Math.ceil(all.length / limit)),
          },
        });
      }
      if (pathname.startsWith('/api/news/save')) {
        controls.writes.push({ method: req.method(), owner, pathname });
        if (controls.mutation === 'failure')
          return route.fulfill({ status: 503, headers: { 'Retry-After': '1' }, json: {} });
        if (req.method() === 'POST') {
          await delay(180);
          const body = req.postDataJSON(),
            existing = [...controls.saved.values()].find(
              (item) => item.owner === owner && item.url === body.url && item.type === body.type,
            );
          const item = existing || {
            ...body,
            id: `saved-${controls.saved.size + 1}`,
            owner,
            readAt: null,
            firstReadAt: null,
            lastReadAt: null,
            readCount: 0,
            createdAt: new Date().toISOString(),
          };
          controls.saved.set(item.id, item);
          return route.fulfill({ json: { item } });
        }
        const id = pathname.split('/')[4],
          item = controls.saved.get(id);
        if (!item || item.owner !== owner) return route.fulfill({ status: 404, json: {} });
        if (req.method() === 'DELETE') {
          controls.saved.delete(id);
          return route.fulfill({ json: { id } });
        }
        const read = req.postDataJSON()?.read ?? true;
        if (read && !item.readAt) {
          item.readAt = new Date().toISOString();
          item.firstReadAt ||= item.readAt;
          item.lastReadAt = item.readAt;
          item.readCount = (item.readCount || 0) + 1;
        } else if (!read) item.readAt = null;
        return route.fulfill({ json: { item } });
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
          user: { _id: owner, role: 'developer' },
        },
      });
    }
    if (url.hostname === 'news-fixture.example') {
      if (pathname.startsWith('/images/'))
        return route.fulfill({
          contentType: 'image/svg+xml',
          body: artwork(Number(pathname.split('/').at(-1))),
        });
      return route.fulfill({
        contentType: 'text/html',
        body: '<h1>Synthetic original source fixture</h1>',
      });
    }
    if (url.origin === origin) return route.continue();
    controls.blocked.push(url.origin);
    return route.abort();
  });
  await page.goto(origin + '/app/news');
  await page.locator('app-news-card').first().waitFor();
  await ready(page);
  return { page, context, controls };
}
(async () => {
  fs.mkdirSync(output, { recursive: true });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  try {
    const cases = [
      ['light', false],
      ['dark', false],
      ['light', true],
      ['dark', true],
    ];
    for (const [theme, mobile] of cases) {
      const { page, context, controls } = await session(browser, origin, theme, mobile);
      const label = `${mobile ? 'mobile' : 'desktop'}-${theme}`;
      await check(label + ': Manrope, responsive layout and theme', async () => {
        assert.equal(await page.locator('app-news-card').count(), 12);
        assert.equal(await page.locator('html').getAttribute('data-theme'), theme);
        assert.match(
          await page.locator('.news-page').evaluate((el) => getComputedStyle(el).fontFamily),
          /Manrope/,
        );
        assert.ok(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        );
        const color = await page
          .locator('.news-card')
          .first()
          .evaluate((el) => getComputedStyle(el).backgroundColor);
        assert.equal(color, theme === 'light' ? 'rgb(255, 255, 255)' : 'rgb(21, 29, 42)');
        await page.screenshot({ path: path.join(output, label + '.png'), animations: 'disabled' });
        if (!results.screenshots.includes(label + '.png')) results.screenshots.push(label + '.png');
      });
      if (!mobile && theme === 'light') {
        await check('pagination replaces articles with the requested server page', async () => {
          await page.getByRole('button', { name: 'Next', exact: true }).click();
          await page.waitForFunction(
            () => document.querySelector('[aria-current="page"]')?.textContent.trim() === '2',
          );
          assert.equal(controls.reads.at(-1).page, '2');
          assert.equal(await page.locator('app-news-card').count(), 12);
        });
        await check(
          'saved acknowledgements, duplicate protection, Mark Read and server reading history',
          async () => {
            const first = page.locator('app-news-card').first();
            await first.getByRole('button', { name: /^Bookmark:/ }).click();
            assert.equal(
              await first.getByRole('button', { name: /^Bookmark:/ }).getAttribute('aria-pressed'),
              'false',
            );
            await first.getByRole('button', { name: /^Remove bookmark:/ }).waitFor();
            await first.getByRole('button', { name: /^Read Later:/ }).click();
            await first.getByRole('button', { name: /^Remove from Read Later:/ }).waitFor();
            await page
              .locator('.view-tabs')
              .getByRole('button', { name: 'Read Later', exact: true })
              .click();
            await ready(page);
            await page.getByRole('button', { name: 'Mark read', exact: true }).click();
            await page.getByRole('button', { name: 'Mark unread', exact: true }).waitFor();
            await page.getByRole('button', { name: 'Reading history', exact: true }).click();
            assert.equal(await page.locator('.saved-card').count(), 1);
            assert.ok(
              [...controls.saved.values()].find((item) => item.type === 'read_later').readAt,
            );
            await page.screenshot({
              path: path.join(output, 'desktop-reading-history.png'),
              animations: 'disabled',
            });
            results.screenshots.push('desktop-reading-history.png');
            await page.reload();
            await ready(page);
            await page
              .locator('.view-tabs')
              .getByRole('button', { name: 'Bookmarks', exact: true })
              .click();
            await ready(page);
            assert.equal(await page.locator('.saved-card').count(), 1);
            await page.getByRole('button', { name: 'Remove', exact: true }).click();
            await page.locator('.empty-state').waitFor();
            assert.equal(
              [...controls.saved.values()].filter((item) => item.type === 'bookmark').length,
              0,
            );
          },
        );
        await check('all five views and honest article details', async () => {
          for (const name of ['Trending', 'Latest', 'For You']) {
            await page.locator('.view-tabs').getByRole('button', { name, exact: true }).click();
            await ready(page);
          }
          await page.locator('app-news-card').first().locator('summary').click();
          assert.match(
            await page.locator('app-news-card').first().innerText(),
            /50% relevance, 30% recency and 20%/,
          );
          assert.match(await page.locator('app-news-card').first().innerText(), /Rank score\s*0/);
          const link = page
            .locator('app-news-card')
            .first()
            .getByRole('link', { name: /opens in a new tab/ });
          assert.equal(await link.getAttribute('rel'), 'noopener noreferrer');
          assert.match(await link.getAttribute('href'), /^https:\/\/news-fixture.example\//);
        });
        await check(
          'filters, keyboard submission, resets and cancelled outdated search',
          async () => {
            await page.locator('#news-search').fill('Old');
            await page.locator('#news-search').press('Enter');
            await page.locator('#news-search').fill('React');
            await page.locator('#news-search').press('Enter');
            await ready(page);
            assert.ok(
              (await page.locator('app-news-card h3').allTextContents()).every((title) =>
                title.includes('React'),
              ),
            );
            await page.locator('#news-source').selectOption({ label: 'Dev.to' });
            await page.getByRole('button', { name: 'Apply Filters', exact: true }).click();
            await ready(page);
            assert.equal(controls.reads.at(-1).source, 'Dev.to');
            await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
            await ready(page);
            assert.equal(await page.locator('app-news-card').count(), 12);
          },
        );
        await check('stale, partial, warming and empty responses', async () => {
          controls.mode = 'stale';
          await page
            .locator('.view-tabs')
            .getByRole('button', { name: 'Trending', exact: true })
            .click();
          await ready(page);
          assert.match(await page.locator('.feed-status').innerText(), /Stale snapshot/);
          controls.mode = 'partial';
          await page
            .locator('.view-tabs')
            .getByRole('button', { name: 'Latest', exact: true })
            .click();
          await ready(page);
          assert.match(await page.locator('.feed-status').innerText(), /Some sources/);
          controls.mode = 'warming';
          await page
            .locator('.view-tabs')
            .getByRole('button', { name: 'For You', exact: true })
            .click();
          await ready(page);
          assert.match(await page.locator('.empty-state').innerText(), /warming up/);
          controls.mode = 'empty';
          await page
            .locator('.view-tabs')
            .getByRole('button', { name: 'Latest', exact: true })
            .click();
          await ready(page);
          assert.match(await page.locator('.empty-state').innerText(), /No articles found/);
          controls.mode = 'normal';
          await page
            .locator('.view-tabs')
            .getByRole('button', { name: 'For You', exact: true })
            .click();
          await ready(page);
        });
        await check(
          '429 retains articles, honors Retry-After, then revalidates without quota bypass',
          async () => {
            controls.mode = '429';
            await page.getByRole('button', { name: 'Refresh feed', exact: true }).click();
            await page.locator('.error-message').waitFor();
            assert.equal(await page.locator('app-news-card').count(), 12);
            assert.ok(await page.getByRole('button', { name: /^Retry in/ }).isDisabled());
            const reads = controls.reads.length;
            await delay(500);
            assert.equal(controls.reads.length, reads);
            controls.mode = 'normal';
            await page.getByRole('button', { name: 'Try again', exact: true }).waitFor();
            await page.getByRole('button', { name: 'Try again', exact: true }).click();
            await ready(page);
            assert.equal(controls.reads.at(-1).refresh, undefined);
          },
        );
        await check('503 and offline retain usable articles', async () => {
          controls.mode = '503';
          await page.getByRole('button', { name: 'Refresh feed', exact: true }).click();
          await page.locator('.error-message').waitFor();
          assert.equal(await page.locator('app-news-card').count(), 12);
          await context.setOffline(true);
          await page.waitForFunction(() =>
            document.querySelector('.feed-status')?.textContent.includes('Offline'),
          );
          assert.equal(await page.locator('app-news-card').count(), 12);
          controls.mode = 'normal';
          await context.setOffline(false);
          await delay(2300);
        });
        await check('new-account reload cannot expose old saved records', async () => {
          await page.evaluate(() => {
            localStorage.setItem(
              'user',
              JSON.stringify({
                _id: 'two',
                iss: 'devinsight-api',
                aud: 'devinsight-web',
                name: 'Second Fixture',
                role: 'developer',
                activeCareerStack: 'Frontend',
              }),
            );
            localStorage.setItem(
              'token',
              `fixture.${btoa(JSON.stringify({ id: 'two', iss: 'devinsight-api', aud: 'devinsight-web', exp: Math.floor(Date.now() / 1000) + 36000 }))}.fixture`,
            );
          });
          await page.reload();
          await ready(page);
          await page
            .locator('.view-tabs')
            .getByRole('button', { name: 'Read Later', exact: true })
            .click();
          await ready(page);
          assert.equal(await page.locator('.saved-card').count(), 0);
        });
        await check('System theme follows operating-system preference', async () => {
          await page.getByRole('button', { name: 'Account menu', exact: true }).click();
          await page.getByTitle('System auto', { exact: true }).click();
          await page.emulateMedia({ colorScheme: 'dark' });
          await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
          await page.emulateMedia({ colorScheme: 'light' });
          await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
        });
      }
      if (mobile && theme === 'dark')
        await check('mobile search disclosure and accessible controls', async () => {
          const toggle = page.getByRole('button', { name: 'Search & filters', exact: true });
          await toggle.click();
          await page.locator('#news-search').waitFor({ state: 'visible' });
          assert.equal(await page.locator('#news-search').isVisible(), true);
          await page.locator('#news-category').selectOption({ label: 'Backend' });
          await page.getByRole('button', { name: 'Apply Filters', exact: true }).click();
          await ready(page);
          assert.equal(controls.reads.at(-1).category, 'Backend');
          assert.ok(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
          );
          await page.locator('app-news-card').first().scrollIntoViewIfNeeded();
          await page.screenshot({
            path: path.join(output, 'mobile-dark-articles.png'),
            animations: 'disabled',
          });
          if (!results.screenshots.includes('mobile-dark-articles.png'))
            results.screenshots.push('mobile-dark-articles.png');
        });
      await context.close();
    }
    assert.deepEqual(results.errors, []);
    results.status = 'VERIFIED';
  } catch (error) {
    results.status = 'FAILED';
    results.failure = error.stack;
    process.exitCode = 1;
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    fs.writeFileSync(path.join(output, 'browser-results.json'), JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results, null, 2));
  }
})();
