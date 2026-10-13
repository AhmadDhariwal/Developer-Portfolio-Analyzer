const { chromium } = require('../../backend/node_modules/playwright');
const { profile, fixture } = require('./skill-gap-browser-fixture.cjs');
const http = require('node:http'),
  fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../dist/frontend/browser'),
  output = path.resolve(__dirname, '../verification/shared-ui');
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
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('https://api.github.com/**', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/**', (route) => {
    const url = route.request().url();
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
  return { context, page, errors };
}
(async () => {
  fs.mkdirSync(output, { recursive: true });
  await new Promise((resolve) => server.listen(4318, '127.0.0.1', resolve));
  const browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.SKILL_GAP_BROWSER ||
      'C:/Users/ahmad.hassan/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe',
  });
  const layouts = [],
    regressions = [],
    roleChecks = [];
  try {
    for (const theme of ['light', 'dark', 'system']) {
      const { context, page, errors } = await session(browser, theme);
      await page.goto('http://127.0.0.1:4318/app/skill-gap');
      await page.locator('[data-testid=coverage]').waitFor();
      await page.evaluate(() => document.fonts.ready);
      await page.keyboard.press('Tab');
      assert.equal(
        await page.evaluate(() => document.activeElement.classList.contains('skip-link')),
        true,
      );
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.activeElement?.id === 'workspace-main');
      assert.equal(
        await page
          .getByRole('button', { name: 'Toggle sidebar', exact: true })
          .getAttribute('aria-expanded'),
        'true',
      );
      for (const width of [320, 375, 425, 768, 1024, 1280, 1440, 1600]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.waitForFunction(
          () =>
            document.querySelector('.shell-body').classList.contains('shell-body--mobile') ===
            innerWidth <= 768,
        );
        if (width > 768 && (await page.locator('.shell-body.sidebar-closed').count()))
          await page.getByRole('button', { name: 'Toggle sidebar', exact: true }).click();
        await settle(page);
        await page.evaluate(() => scrollTo(0, 0));
        const measurement = await page.evaluate(() => {
          const nav = document.querySelector('.navbar'),
            side = document.querySelector('.sidebar'),
            main = document.querySelector('.main-content'),
            skill = document.querySelector('.skill-gap-page');
          const computed = (el) => {
            const c = getComputedStyle(el),
              r = el.getBoundingClientRect();
            return {
              left: r.left,
              width: r.width,
              font: c.fontFamily,
              size: c.fontSize,
              padding: c.padding,
              shadow: c.boxShadow,
            };
          };
          return {
            navbar: computed(nav),
            sidebar: computed(side),
            main: computed(main),
            skill: computed(skill),
            overflow: document.documentElement.scrollWidth > innerWidth,
            theme: document.documentElement.dataset.theme,
            titleSize: getComputedStyle(document.querySelector('h1')).fontSize,
            sectionSize: getComputedStyle(document.querySelector('#coverage-title')).fontSize,
            coverage: document.querySelector('[data-testid=coverage]').textContent.trim(),
          };
        });
        assert.equal(measurement.overflow, false, `overflow ${theme} ${width}`);
        assert.match(measurement.main.font, /Manrope/);
        assert.equal(measurement.titleSize, '28px');
        assert.equal(measurement.sectionSize, '19px');
        assert.equal(measurement.coverage, '16.67%');
        if (width <= 768) {
          assert.equal(measurement.navbar.left, 0);
          assert.equal(measurement.sidebar.shadow, 'none');
          assert.equal(await page.locator('.sidebar').getAttribute('inert'), '');
        }
        layouts.push({ theme, width, ...measurement });
        await page.screenshot({ path: path.join(output, `${theme}-${width}-fold.png`) });
        if (width === 375 || width === 1440)
          await page.screenshot({
            path: path.join(output, `${theme}-${width}.png`),
            fullPage: true,
          });
        const toggle = page.getByRole('button', { name: 'Toggle sidebar', exact: true });
        if (width <= 768) {
          await toggle.focus();
          await page.keyboard.press('Enter');
          await page.getByRole('dialog', { name: 'Application navigation' }).waitFor();
          await settle(page);
          await page.waitForFunction(() =>
            document.activeElement?.classList.contains('drawer-close'),
          );
          assert.equal(await page.locator('.shell-body').getAttribute('inert'), '');
          assert.equal(await page.evaluate(() => document.body.style.overflow), 'hidden');
          await page.keyboard.press('Shift+Tab');
          assert.equal(
            await page.evaluate(() => document.activeElement.classList.contains('logout-btn')),
            true,
          );
          await page.keyboard.press('Tab');
          assert.equal(
            await page.evaluate(() => document.activeElement.classList.contains('drawer-close')),
            true,
          );
          await page.screenshot({ path: path.join(output, `${theme}-${width}-drawer.png`) });
          await page.keyboard.press('Escape');
          await page.waitForFunction(() =>
            document.activeElement?.classList.contains('menu-toggle'),
          );
          assert.equal(await page.evaluate(() => document.body.style.overflow), '');
          await toggle.click();
          await settle(page);
          await page.mouse.click(width - 8, 500);
          await page.waitForFunction(
            () => !document.querySelector('.sidebar').classList.contains('mobile-open'),
          );
          if (width === 375) {
            await toggle.click();
            await settle(page);
            await page.getByRole('button', { name: 'Close navigation', exact: true }).click();
            await page.waitForFunction(() =>
              document.activeElement?.classList.contains('menu-toggle'),
            );
          }
          await toggle.click();
          await settle(page);
          await page.locator('.sidebar a[href="/app/skill-gap"]').click();
          await page.waitForFunction(
            () => !document.querySelector('.sidebar').classList.contains('mobile-open'),
          );
          assert.equal(await page.locator('.shell-body').getAttribute('inert'), null);
        } else {
          await toggle.focus();
          await page.keyboard.press('Enter');
          await settle(page);
          assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
          assert.equal(
            await page.locator('.sidebar a[href="/app/skill-gap"]').getAttribute('aria-label'),
            'Skill Gap',
          );
          await page.locator('.sidebar a[href="/app/skill-gap"]').focus();
          assert.equal(
            await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle),
            'solid',
          );
          if (width === 1440)
            await page.screenshot({ path: path.join(output, `${theme}-1440-collapsed.png`) });
          await toggle.click();
          await settle(page);
          const analysis = page.getByRole('button', { name: 'Analysis', exact: true });
          await analysis.focus();
          await page.keyboard.press('Enter');
          await settle(page);
          assert.equal(await analysis.getAttribute('aria-expanded'), 'false');
          await page.keyboard.press('Enter');
          await settle(page);
          assert.equal(await analysis.getAttribute('aria-expanded'), 'true');
        }
      }
      const account = page.getByRole('button', { name: 'Account menu', exact: true });
      await account.focus();
      await page.keyboard.press('Enter');
      await page.locator('#workspace-account-menu').waitFor();
      await page.getByTitle('Dark mode', { exact: true }).click();
      await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
      await page.getByTitle('Light mode', { exact: true }).click();
      await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
      await page.getByTitle('System auto', { exact: true }).click();
      await page.emulateMedia({ colorScheme: 'dark' });
      await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
      await page.emulateMedia({ colorScheme: 'light' });
      await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
      await page.keyboard.press('Escape');
      await page.locator('#workspace-account-menu').waitFor({ state: 'detached' });
      assert.equal(await account.getAttribute('aria-expanded'), 'false');
      const search = page.getByRole('combobox', { name: 'Search workspace', exact: true });
      await search.fill('Skill Gap');
      await page.locator('#workspace-search-results [role=option]').first().waitFor();
      await page.keyboard.press('ArrowDown');
      await page.waitForFunction(
        () =>
          document.querySelector('[role=combobox]').getAttribute('aria-activedescendant') ===
          'workspace-suggestion-0',
      );
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.querySelector('[role=combobox]').value === '');
      await page.locator('[data-testid=coverage]').waitFor();
      await page.setViewportSize({ width: 1440, height: 1000 });
      await settle(page);
      for (const route of ['/app/dashboard', '/app/github-analyzer', '/app/resume-analyzer']) {
        await page.goto('http://127.0.0.1:4318' + route);
        await page.locator('.main-content').waitFor();
        await settle(page);
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          true,
          route,
        );
        regressions.push({ theme, route, overflow: false });
        if (theme !== 'system')
          await page.screenshot({
            path: path.join(output, `${theme}-${route.split('/').pop()}-1440.png`),
          });
      }
      assert.deepEqual(errors, []);
      await context.close();
    }
    for (const role of ['recruiter', 'admin']) {
      const { context, page, errors } = await session(browser, 'light', role);
      await page.goto('http://127.0.0.1:4318/app/profile');
      await page.locator('.sidebar').waitFor();
      await settle(page);
      assert.equal(await page.locator('.developer-workspace').count(), 0);
      const font = await page
        .locator('.main-content')
        .evaluate((el) => getComputedStyle(el).fontFamily);
      assert.match(font, /Inter/);
      const routes = await page
        .locator('.sidebar a')
        .evaluateAll((links) => links.map((a) => a.getAttribute('href')));
      if (role === 'recruiter') assert.ok(routes.includes('/app/recruiter/dashboard'));
      else assert.ok(routes.includes('/app/admin/dashboard'));
      await page.screenshot({ path: path.join(output, `${role}-1440.png`) });
      await page.setViewportSize({ width: 375, height: 1000 });
      await settle(page);
      assert.equal(
        await page.locator('.navbar').evaluate((el) => el.getBoundingClientRect().left),
        0,
      );
      roleChecks.push({ role, developerTokens: false, font, routes, mobileInset: 0 });
      assert.deepEqual(errors, []);
      await context.close();
    }
    fs.writeFileSync(
      path.join(output, 'results.json'),
      JSON.stringify(
        {
          layouts,
          regressions,
          roleChecks,
          keyboard:
            'drawer focus entry/trap/Escape/restore; labeled and icon navigation; group Enter; search ArrowDown/Enter; account menu Escape',
          themes: 'Light/Dark/System buttons and live System changes',
          consoleErrors: 0,
        },
        null,
        2,
      ),
    );
    console.log(
      `PASS: ${layouts.length} shell layouts; drawer/keyboard/theme/search checks; ${regressions.length} feature smoke checks; 2 preserved role presentations.`,
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
