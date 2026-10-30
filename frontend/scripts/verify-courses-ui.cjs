const { chromium } = require('../../backend/node_modules/playwright');
const { catalog, profile, discover } = require('./courses-browser-fixture.cjs');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../dist/frontend/browser');
const output = process.env.COURSES_UI_OUTPUT
  ? path.resolve(process.env.COURSES_UI_OUTPUT)
  : path.resolve(__dirname, '../verification/courses');
const server = http.createServer((req, res) => {
  let file = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory())
    file = path.join(root, 'index.html');
  res.setHeader(
    'Content-Type',
    {
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.html': 'text/html',
      '.ttf': 'font/ttf',
      '.svg': 'image/svg+xml',
    }[path.extname(file)] || 'application/octet-stream',
  );
  fs.createReadStream(file).pipe(res);
});
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function settle(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => {})),
    );
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  });
}
async function count(locator, expected) {
  await settle(locator.page());
  await locator
    .page()
    .waitForFunction(
      ({ selector, expected }) =>
        document.querySelectorAll(selector).length === expected &&
        !document.querySelector('app-courses section[aria-busy="true"]'),
      { selector: 'app-courses app-course-card', expected },
    );
  await settle(locator.page());
  assert.equal(await locator.count(), expected);
}
async function session(browser, theme, initial = 'normal', query = '') {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    colorScheme: theme === 'system' ? 'dark' : theme,
  });
  await context.addInitScript(
    ({ theme, profile, initial }) => {
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
      localStorage.setItem(
        'devinsight_career_profile',
        JSON.stringify({ ...profile, isConfigured: initial !== 'no-profile' }),
      );
      localStorage.setItem('devinsight_theme', theme);
    },
    { theme, profile, initial },
  );
  const page = await context.newPage();
  const errors = [];
  const controls = {
    mode: initial,
    mutation: 'success',
    sprint: 'success',
    requests: [],
    writes: [],
    saved: new Map(),
    sprintIds: new Set(),
  };
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('https://i.ytimg.com/**', (route) => route.fulfill({ status: 404 }));
  await page.route('https://www.youtube.com/**', (route) =>
    route.fulfill({ body: '<html>Provider fixture</html>', contentType: 'text/html' }),
  );
  await page.route('**/api/**', async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    const pathname = url.pathname;
    if (pathname === '/api/courses') {
      controls.requests.push(Object.fromEntries(url.searchParams));
      if (controls.mode === 'loading') await delay(1300);
      if (controls.mode === 'error')
        return route.fulfill({ status: 503, json: { message: 'Temporary course source outage' } });
      if (controls.mode === 'auth')
        return route.fulfill({ status: 401, json: { message: 'Session expired' } });
      return route.fulfill({ json: discover(url.searchParams, controls.mode) });
    }
    if (pathname === '/api/courses/my-learning') {
      if (controls.mode === 'progress-unavailable')
        return route.fulfill({ status: 503, json: { message: 'Saved courses unavailable' } });
      const all = [...controls.saved.values()].filter(
        (record) =>
          !url.searchParams.get('status') || record.status === url.searchParams.get('status'),
      );
      const current = Number(url.searchParams.get('page') || 1),
        limit = Number(url.searchParams.get('limit') || 50);
      return route.fulfill({
        json: {
          courses: all.slice((current - 1) * limit, current * limit),
          total: all.length,
          page: current,
          totalPages: Math.max(1, Math.ceil(all.length / limit)),
        },
      });
    }
    if (/\/courses\/[^/]+\/progress$/.test(pathname)) {
      const id = pathname.split('/').at(-2),
        body = request.method() === 'PUT' ? request.postDataJSON() : null;
      controls.writes.push({ id, method: request.method(), body });
      await delay(150);
      if (controls.mutation === 'error')
        return route.fulfill({ status: 503, json: { message: 'Progress could not be saved' } });
      if (request.method() === 'DELETE') {
        controls.saved.delete(id);
        return route.fulfill({ status: 204 });
      }
      const course = catalog.find((course) => course.id === id),
        previous = controls.saved.get(id);
      const { id: courseId, title, url, platform, topics, instructor, provenance } = course;
      const record = {
        courseId,
        course: { id: courseId, title, url, platform, topics, instructor, provenance },
        notes: '',
        progressPercent: null,
        ...previous,
        ...body,
        progressSource: 'user-entered',
        completionSource: 'self-reported',
        createdAt: previous?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        completedAt: body.status === 'completed' ? new Date().toISOString() : null,
      };
      controls.saved.set(id, record);
      return route.fulfill({ json: record });
    }
    if (pathname.endsWith('/career-sprint') && pathname.includes('/courses/')) {
      const id = pathname.split('/').at(-2);
      await delay(150);
      if (!controls.saved.has(id))
        return route.fulfill({ status: 404, json: { message: 'Save this course first' } });
      if (controls.sprint === 'conflict')
        return route.fulfill({
          status: 409,
          json: { message: 'An existing Sprint task has a different target.' },
        });
      const alreadyAdded = controls.sprintIds.has(id);
      controls.sprintIds.add(id);
      return route.fulfill({
        json: {
          sprintId: 'fixture-sprint',
          courseId: id,
          targetSkill: 'SQL',
          alreadyAdded,
          route: '/app/career-sprint',
        },
      });
    }
    if (pathname.includes('/profile/career'))
      return route.fulfill({ json: { ...profile, isConfigured: initial !== 'no-profile' } });
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
  });
  await page.goto('http://127.0.0.1:4322/app/courses' + query, { waitUntil: 'domcontentloaded' });
  return { context, page, controls, errors };
}
async function contrast(page) {
  return page.locator('.courses-page').evaluate((root) => {
    const rgba = (value) => {
      const parts = (value.match(/[\d.]+/g) || []).map(Number);
      return value.startsWith('color(srgb')
        ? parts.map((part, i) => (i < 3 ? part * 255 : part))
        : parts;
    };
    const blend = (top, bottom) => {
      const a = top[3] ?? 1;
      return [0, 1, 2].map((i) => top[i] * a + bottom[i] * (1 - a));
    };
    const background = (element) => {
      const layers = [];
      for (let node = element; node; node = node.parentElement)
        layers.push(rgba(getComputedStyle(node).backgroundColor));
      return layers.reverse().reduce((base, top) => blend(top, base), [255, 255, 255]);
    };
    const luminance = (rgb) =>
      rgb
        .map((v) => v / 255)
        .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
        .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
    const failures = [];
    let checked = 0;
    for (const el of root.querySelectorAll('h1,h2,h3,p,a,label,small,summary,button,span,select')) {
      if (!el.checkVisibility() || !el.textContent.trim() || false) continue;
      const style = getComputedStyle(el),
        bg = background(el),
        fg = blend(rgba(style.color), bg);
      const values = [luminance(bg), luminance(fg)].sort((a, b) => a - b);
      const ratio = (values[1] + 0.05) / (values[0] + 0.05);
      const large =
        parseFloat(style.fontSize) >= 24 ||
        (parseFloat(style.fontSize) >= 18.66 && Number(style.fontWeight) >= 700);
      checked++;
      if (ratio < (large ? 3 : 4.5))
        failures.push({ text: el.textContent.trim().slice(0, 60), ratio });
    }
    for (const input of root.querySelectorAll('input[placeholder],textarea[placeholder]')) {
      if (!input.getClientRects().length || input.value) continue;
      const style = getComputedStyle(input, '::placeholder'),
        bg = background(input);
      const color = rgba(style.color);
      color[3] = (color[3] ?? 1) * Number(style.opacity);
      const values = [luminance(bg), luminance(blend(color, bg))].sort((a, b) => a - b);
      const ratio = (values[1] + 0.05) / (values[0] + 0.05);
      checked++;
      if (ratio < 4.5) failures.push({ text: `Placeholder: ${input.placeholder}`, ratio });
    }
    return { checked, failures };
  });
}
async function screenshot(page, results, name) {
  if (process.env.COURSES_UI_SCREENSHOTS === '0') return;
  if (name.endsWith('-discover.png')) {
    await page.locator('.courses-page h1').evaluate((el) => {
      for (let node = el; node; node = node.parentElement) node.scrollTop = 0;
      window.scrollTo(0, 0);
    });
  }
  await settle(page);
  await page.screenshot({ path: path.join(output, name) });
  results.screenshots.push(name);
}
async function mobileFilters(page) {
  const previousBodyOverflow = await page.evaluate(() => document.body.style.overflow);
  const trigger = page.getByRole('button', { name: /^Filters/ });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Course filters' });
  await dialog.waitFor();
  assert.equal(await dialog.evaluate((el) => el.matches(':modal')), true);
  assert.equal(await page.evaluate(() => document.body.style.overflow), 'hidden');
  const backgroundScroll = await page.evaluate(() => window.scrollY);
  await page.mouse.move(2, 2);
  await page.mouse.wheel(0, 400);
  await settle(page);
  assert.equal(await page.evaluate(() => window.scrollY), backgroundScroll);
  assert.equal(await page.locator('.main-content').evaluate((el) => el.style.overflow), 'hidden');
  await dialog.getByRole('button', { name: 'Close filters', exact: true }).focus();
  await page.keyboard.press('Shift+Tab');
  assert.equal(await dialog.evaluate((el) => el.contains(document.activeElement)), true);
  await page.keyboard.press('Tab');
  assert.equal(await dialog.evaluate((el) => el.contains(document.activeElement)), true);
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(await trigger.evaluate((el) => el === document.activeElement), true);
  assert.equal(await page.evaluate(() => document.body.style.overflow), previousBodyOverflow);
  assert.notEqual(
    await page.locator('.main-content').evaluate((el) => el.style.overflow),
    'hidden',
  );
}
(async () => {
  fs.mkdirSync(output, { recursive: true });
  await new Promise((resolve) => server.listen(4322, '127.0.0.1', resolve));
  const browser = await chromium.launch({
    headless: true,
    executablePath:
      'C:/Users/ahmad.hassan/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe',
  });
  const results = {
    verifiedAt: new Date().toISOString(),
    bundle: fs.readdirSync(root).find((file) => /^main-.*\.js$/.test(file)),
    synthetic: true,
    backend:
      'Authoritative catalog, ranking and filters; controlled HTTP progress/Sprint fixtures. No live provider or account writes.',
    layouts: [],
    interactions: [],
    states: [],
    screenshots: [],
  };
  try {
    for (const theme of ['light', 'dark', 'system']) {
      const { context, page, controls, errors } = await session(browser, theme);
      const cards = page.locator('app-courses app-course-card');
      await count(cards, 10);
      await page
        .locator('app-course-card button', { hasText: 'Save for Later' })
        .first()
        .waitFor({ state: 'visible' });
      await settle(page);
      assert.deepEqual(
        await cards.locator('h3').allTextContents(),
        catalog.slice(0, 10).map((course) => course.title),
      );
      for (const width of [320, 375, 425, 768, 1024, 1280, 1440, 1600]) {
        await page.setViewportSize({ width, height: width <= 768 ? 900 : 1000 });
        await settle(page);
        const measured = await page.locator('.courses-page').evaluate((root) => {
          const shell = root.closest('.main-content'),
            style = getComputedStyle(shell);
          const visible = [
            ...root.querySelectorAll('button,select,input,textarea,a,summary'),
          ].filter((el) => el.checkVisibility());
          return {
            overflow:
              document.documentElement.scrollWidth > innerWidth ||
              root.scrollWidth > root.clientWidth + 1,
            font: getComputedStyle(root).fontFamily,
            title: getComputedStyle(root.querySelector('h1')).fontSize,
            section: getComputedStyle(root.querySelector('h2')).fontSize,
            pagePadding: getComputedStyle(root).padding,
            workspaceWidth: root.clientWidth,
            shellWidth: shell.clientWidth,
            paddingLeft: parseFloat(style.paddingLeft),
            paddingRight: parseFloat(style.paddingRight),
            minControl: Math.min(...visible.map((el) => el.getBoundingClientRect().height)),
            theme: document.documentElement.getAttribute('data-theme'),
            brokenImages: [...root.querySelectorAll('img')].filter(
              (el) => el.checkVisibility() && el.complete && el.naturalWidth === 0,
            ).length,
          };
        });

        assert.equal(measured.overflow, false, `${theme} ${width} overflow`);
        assert.match(measured.font, /Manrope/);
        assert.equal(measured.title, '28px');
        assert.equal(measured.section, '19px');
        assert.equal(measured.pagePadding, '0px');
        assert.equal(measured.paddingLeft, width <= 768 ? 14 : 24);
        assert.ok(
          Math.abs(
            measured.workspaceWidth -
              (measured.shellWidth - measured.paddingLeft - measured.paddingRight),
          ) <= 1,
        );
        assert.ok(measured.minControl >= 44);
        assert.equal(measured.brokenImages, 0);
        measured.contrast = await contrast(page);
        assert.deepEqual(measured.contrast.failures, [], `${theme} ${width} contrast`);
        results.layouts.push({ preference: theme, width, ...measured });
        if (theme !== 'system' && [375, 1440].includes(width)) {
          await page.locator('.main-content').evaluate((el) => (el.scrollTop = 0));
          await screenshot(page, results, `${theme}-${width}-discover.png`);
          if (width === 375) {
            await mobileFilters(page);
            await page.getByRole('button', { name: /^Filters/ }).click();
            await screenshot(page, results, `${theme}-375-filters.png`);
            await page.keyboard.press('Escape');
            await cards.first().scrollIntoViewIfNeeded();
            await screenshot(page, results, `${theme}-375-course.png`);
          }
        }
      }
      await page.setViewportSize({ width: 1440, height: 1000 });
      await settle(page);
      const filters = page.locator('app-course-filters.desktop-filters');
      const requestCount = controls.requests.length;
      await filters.getByLabel('Search topic or skill').fill('SQL');
      await filters.getByLabel('Platform', { exact: true }).selectOption('Udemy');
      assert.equal(
        controls.requests.length,
        requestCount,
        'Staged filters do not request before Apply',
      );
      await filters.getByRole('button', { name: 'Apply Filters', exact: true }).click();
      await count(
        cards,
        discover(new URLSearchParams('topic=SQL&platform=Udemy&limit=10'), 'normal').courses.length,
      );
      assert.ok(
        (await cards.locator('.provider').allTextContents()).every((value) =>
          value.includes('Udemy'),
        ),
      );
      await filters.getByLabel('Provider review rating').selectOption('4.5');
      await filters.getByLabel('Level', { exact: true }).selectOption('Beginner');
      await filters.getByLabel('Duration', { exact: true }).selectOption('10+');
      await filters.getByRole('button', { name: 'Apply Filters', exact: true }).click();
      await count(cards, 1);
      assert.match(await cards.first().innerText(), /4.7\/5 provider rating/);
      await filters.getByRole('button', { name: 'Clear search', exact: true }).click();
      await page.waitForFunction(
        () =>
          document.querySelector('app-course-filters.desktop-filters input[name=topic]').value ===
          '',
      );
      await filters.getByRole('button', { name: 'Reset', exact: true }).click();
      await count(cards, 10);
      await page.getByRole('button', { name: 'Load more courses', exact: true }).click();
      await count(cards, 20);
      assert.deepEqual(
        await cards.locator('h3').allTextContents(),
        catalog.slice(0, 20).map((course) => course.title),
      );
      controls.mode = 'error';
      await page.getByRole('button', { name: 'Refresh courses', exact: true }).click();
      await page.getByText('Previous recommendations are still shown.', { exact: true }).waitFor();
      await count(cards, 20);
      assert.equal(controls.requests.at(-1).refresh, 'true');
      controls.mode = 'normal';
      await page.getByRole('button', { name: 'Retry courses', exact: true }).click();
      await count(cards, 10);
      const videoIndex = catalog.findIndex((course) => course.platform === 'YouTube');
      const first = cards.nth(videoIndex),
        firstId = catalog[videoIndex].id;
      assert.match(await first.innerText(), /0 views.*0 likes/);
      assert.match(await first.innerText(), /derived engagement/);
      assert.match(await first.innerText(), /Provider rating unavailable/);
      const external = first.getByRole('link', { name: /^Open course:/ });
      assert.equal(await external.getAttribute('target'), '_blank');
      assert.equal(await external.getAttribute('rel'), 'noopener noreferrer');
      const popupPromise = context.waitForEvent('page');
      await external.focus();
      await page.keyboard.press('Enter');
      const popup = await popupPromise;
      await popup.waitForLoadState('domcontentloaded');
      assert.match(popup.url(), /youtube.com/);
      await popup.close();
      controls.mutation = 'error';
      await first.getByRole('button', { name: 'Save for Later', exact: true }).click();
      await first.getByText('Progress could not be saved', { exact: true }).waitFor();
      assert.equal(controls.saved.size, 0);
      controls.mutation = 'success';
      await first.getByRole('button', { name: 'Save for Later', exact: true }).click();
      await first.getByLabel('Learning status').waitFor();
      controls.sprint = 'conflict';
      await first.getByRole('button', { name: 'Add to Sprint', exact: true }).click();
      await first
        .getByText('An existing Sprint task has a different target.', { exact: true })
        .waitFor();
      controls.sprint = 'success';
      controls.sprintIds.add(firstId);
      await first.getByRole('button', { name: 'Add to Sprint', exact: true }).click();
      await first.getByRole('link', { name: 'Open Career Sprint' }).waitFor();
      assert.match(await first.innerText(), /Already in your Career Sprint/);
      await first.getByLabel('Learning status').selectOption('in_progress');
      await first.getByText('Learning progress saved.', { exact: true }).waitFor();
      await first.getByLabel('Learning status').evaluate(async (el) => {
        while (el.value !== 'in_progress') await new Promise(requestAnimationFrame);
      });
      assert.equal(controls.saved.get(firstId).status, 'in_progress');
      await first.getByText('Notes and progress', { exact: true }).click();
      await first
        .getByLabel('Private learning notes')
        .fill('Practice SQL joins with a small project.');
      await first.getByLabel('Progress %').fill('0');
      await first.getByRole('button', { name: 'Save notes and progress' }).click();
      await first.getByText('0% · user-entered progress', { exact: true }).waitFor();
      await page.getByRole('button', { name: 'My Learning', exact: true }).click();
      await count(cards, 1);
      const saved = cards.first();
      await saved.getByText('Notes and progress', { exact: true }).click();
      assert.equal(
        await saved.getByLabel('Private learning notes').inputValue(),
        'Practice SQL joins with a small project.',
      );
      await saved.getByLabel('Learning status').selectOption('completed');
      await saved.getByText(/Completed · self-reported/).waitFor();
      await page.getByLabel('Show learning status').selectOption('completed');
      await count(cards, 1);
      assert.equal(
        await saved.getByRole('button', { name: 'Add to Sprint', exact: true }).count(),
        0,
      );
      const completionContrast = await contrast(page);
      assert.deepEqual(completionContrast.failures, [], 'Completed learning contrast');
      if (theme !== 'system') {
        await page
          .locator('app-my-learning')
          .evaluate((el) => el.scrollIntoView({ block: 'start' }));
        await screenshot(page, results, `${theme}-1440-learning.png`);
        await page.setViewportSize({ width: 375, height: 900 });
        await page
          .locator('app-my-learning')
          .evaluate((el) => el.scrollIntoView({ block: 'start' }));
        await screenshot(page, results, `${theme}-375-learning.png`);
        await page.setViewportSize({ width: 1440, height: 1000 });
      }
      await page.getByLabel('Show learning status').selectOption('saved');
      await count(cards, 0);
      await page.getByText('No courses in this status', { exact: true }).waitFor();
      await page.getByLabel('Show learning status').selectOption('');
      await count(cards, 1);
      await cards.first().getByText('Notes and progress', { exact: true }).click();
      await cards.first().getByRole('button', { name: 'Remove from My Learning' }).click();
      await count(cards, 0);
      await page.getByText('Your learning list starts here', { exact: true }).waitFor();
      await page
        .locator('.view-tabs')
        .getByRole('button', { name: 'Discover Courses', exact: true })
        .click();
      await count(cards, 10);
      await cards.nth(1).getByRole('button', { name: 'Save for Later', exact: true }).click();
      await cards.nth(1).getByLabel('Learning status').waitFor();
      await cards.nth(1).getByRole('button', { name: 'Add to Sprint', exact: true }).click();
      await cards.nth(1).getByText('Added to your Career Sprint.', { exact: true }).waitFor();
      await page.reload();
      await count(cards, 10);
      await cards.nth(1).getByLabel('Learning status').waitFor();
      await page.setViewportSize({ width: 320, height: 900 });
      await mobileFilters(page);
      await page.getByRole('button', { name: /^Filters/ }).click();
      const modal = page.getByRole('dialog');
      await modal.getByLabel('Search topic or skill').fill('no matching topic');
      await modal.getByRole('button', { name: 'Apply Filters', exact: true }).click();
      await modal.waitFor({ state: 'hidden' });
      await page.getByText('No courses match these filters', { exact: true }).waitFor();
      await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
      await count(cards, 10);
      await page.getByRole('button', { name: /^Filters/ }).click();
      await page.mouse.click(2, 2);
      await modal.waitFor({ state: 'hidden' });
      await page.getByRole('button', { name: /^Filters/ }).click();
      await page.setViewportSize({ width: 1024, height: 1000 });
      await modal.waitFor({ state: 'hidden' });
      assert.notEqual(
        await page.locator('.main-content').evaluate((el) => el.style.overflow),
        'hidden',
      );
      if (theme === 'system') {
        await page.emulateMedia({ colorScheme: 'light' });
        await settle(page);
        assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
        await page.emulateMedia({ colorScheme: 'dark' });
        await settle(page);
        assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
      }
      const initialTheme = await page.locator('html').getAttribute('data-theme');
      await page.getByRole('button', { name: /Current theme is/ }).click();
      assert.notEqual(await page.locator('html').getAttribute('data-theme'), initialTheme);
      assert.deepEqual(errors, []);
      results.interactions.push({
        theme,
        stagedFilters: true,
        pagination: true,
        refreshRetention: true,
        providerOpening: true,
        progressCrud: true,
        notes: true,
        explicitZero: true,
        completionSelfReported: true,
        sprintConflictDuplicateSuccess: true,
        persistedReload: true,
        mobileFocusEscapeBackdropResize: true,
        themeSwitch: true,
        pageErrors: errors,
      });
      await context.close();
    }
    for (const mode of [
      'empty',
      'fallback',
      'cached',
      'evidence-unavailable',
      'no-profile',
      'progress-unavailable',
      'loading',
      'error',
      'auth',
    ]) {
      const { context, page, controls, errors } = await session(browser, 'light', mode);
      if (mode === 'auth') await page.waitForURL('**/auth/login**');
      else if (mode === 'empty')
        await page.getByText('No courses available yet', { exact: true }).waitFor();
      else if (mode === 'error') {
        await page.getByText('Courses could not be loaded', { exact: true }).waitFor();
        controls.mode = 'normal';
        await page.getByRole('button', { name: 'Retry courses', exact: true }).click();
        await count(page.locator('app-courses app-course-card'), 10);
      } else if (mode === 'loading') {
        await page.getByLabel('Loading courses', { exact: true }).waitFor();
        await count(page.locator('app-courses app-course-card'), 10);
      } else {
        await count(page.locator('app-courses app-course-card'), 10);
        if (mode === 'fallback')
          await page
            .getByText('YouTube is unavailable. Showing ranked provider alternatives.', {
              exact: true,
            })
            .waitFor();
        if (mode === 'cached') await page.getByText(/cached source pool/).waitFor();
        if (mode === 'evidence-unavailable')
          await page
            .getByText(
              'Skill evidence is unavailable or incompatible; using career context only.',
              { exact: true },
            )
            .waitFor();
        if (mode === 'no-profile')
          await page.getByRole('link', { name: 'Open profile', exact: true }).waitFor();
        if (mode === 'progress-unavailable') {
          await page.getByRole('button', { name: 'Retry saved courses' }).waitFor();
          assert.equal(
            await page
              .locator('app-course-card')
              .first()
              .getByRole('button', { name: 'Save for Later', exact: true })
              .isDisabled(),
            true,
          );
          controls.mode = 'normal';
          await page.getByRole('button', { name: 'Retry saved courses' }).click();
          await page.waitForFunction(
            () => !document.querySelector('app-course-card button').disabled,
          );
        }
      }
      assert.deepEqual(errors, []);
      results.states.push({ mode, verified: true });
      await context.close();
    }
    for (const key of ['skill', 'topic']) {
      const { context, page, controls } = await session(browser, 'light', 'normal', `?${key}=SQL`);
      await page.locator('app-course-card').first().waitFor();
      assert.equal(controls.requests[0].topic, 'SQL');
      results.states.push({ mode: `${key}-deep-link`, verified: true });
      await context.close();
    }
    results.status = 'VERIFIED';
    fs.writeFileSync(path.join(output, 'browser-results.json'), JSON.stringify(results, null, 2));
    console.log(
      JSON.stringify({
        status: results.status,
        layouts: results.layouts.length,
        themes: results.interactions.length,
        states: results.states.length,
        screenshots: results.screenshots.length,
      }),
    );
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
  server.close();
});
