const { chromium } = require('../../backend/node_modules/playwright');
const { fixture, hash } = require('./recommendations-browser-fixture.cjs');
const { profile } = require('./skill-gap-browser-fixture.cjs');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../dist/frontend/browser');
const output = path.resolve(__dirname, '../verification/recommendations/refinement');
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
async function session(browser, theme, initial = 'normal') {
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
          role: 'developer',
          name: 'Fixture Developer',
          activeGithubUsername: initial === 'no-profile' ? '' : 'fixture',
        }),
      );
      localStorage.setItem('devinsight_career_profile', JSON.stringify(profile));
      localStorage.setItem('devinsight_theme', theme);
    },
    { theme, profile, initial },
  );
  const page = await context.newPage();
  const errors = [];
  const controls = { mode: initial, sprint: 'success', handoffs: [], requests: [] };
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/**', async (route) => {
    const url = route.request().url();
    if (url.includes('/recommendations/') && url.endsWith('/career-sprint')) {
      controls.handoffs.push({ url, body: route.request().postDataJSON() });
      await new Promise((resolve) => setTimeout(resolve, 150));
      return route.fulfill(
        controls.sprint === 'error'
          ? { status: 409, json: { message: 'Refresh before starting a sprint.' } }
          : {
              json: {
                sprintId: 'fixture',
                alreadyAdded: controls.sprint === 'duplicate',
                route: '/app/career-sprint',
              },
            },
      );
    }
    if (url.endsWith('/recommendations') || url.endsWith('/recommendations/generate')) {
      controls.requests.push(route.request().postDataJSON());
      if (controls.mode === 'loading') await new Promise((resolve) => setTimeout(resolve, 1200));
      if (controls.mode === 'error')
        return route.fulfill({ status: 503, json: { message: 'Temporary source outage' } });
      const data = fixture();
      if (controls.mode === 'no-profile') data.username = '';
      if (controls.mode === 'empty') {
        data.recommendations = [];
        data.structuredRecommendations = {};
        data.projects = [];
        data.technologies = [];
      }
      if (controls.mode === 'legacy') {
        delete data.recommendations;
        data.verified = false;
      }
      if (controls.mode === 'partial') {
        data.cacheMetadata.partial = true;
        data.sourceMetadata.github.available = false;
        data.sourceMetadata.github.freshness = 'STALE';
      }
      if (controls.mode === 'ai') {
        data.aiUsed = true;
        data.aiSuggestions = [
          {
            suggestion: 'Practice TypeScript with a focused example.',
            aiGenerated: true,
            kind: 'learningIdea',
          },
        ];
      }
      return route.fulfill({ json: data });
    }
    if (url.includes('/profile/career')) return route.fulfill({ json: profile });
    if (url.includes('active-username'))
      return route.fulfill({ json: { username: initial === 'no-profile' ? '' : 'fixture' } });
    if (url.includes('saved-previews')) {
      if (route.request().method() === 'DELETE') return route.fulfill({ status: 204 });
      return route.fulfill({
        json: {
          previews: [],
          preview: {
            _id: 'saved',
            title: 'Saved fixture preview',
            module: 'recommendations',
            githubUsername: 'fixture',
            careerStack: 'Backend',
            experienceLevel: 'Student',
            resultSummary: { ...fixture(), verified: false },
          },
        },
      });
    }
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
  await page.goto('http://127.0.0.1:4321/app/recommendations', { waitUntil: 'domcontentloaded' });
  return { context, page, controls, errors };
}
async function settle(page) {
  await page.evaluate(async () => {
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    await Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => {})),
    );
  });
}
async function expectCount(locator, expected) {
  if (expected > 0) await locator.nth(expected - 1).waitFor({ state: 'visible' });
  await locator.nth(expected).waitFor({ state: 'hidden' });
  assert.equal(await locator.count(), expected);
}
const section = (page, id) => page.locator(`section[aria-labelledby="${id}"]`);
(async () => {
  fs.mkdirSync(output, { recursive: true });
  await new Promise((resolve) => server.listen(4321, '127.0.0.1', resolve));
  const browser = await chromium.launch({
    headless: true,
    executablePath:
      'C:/Users/ahmad.hassan/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe',
  });
  const results = { synthetic: true, layouts: [], interactions: [], states: [], screenshots: [] };
  try {
    for (const theme of ['light', 'dark', 'system']) {
      const { context, page, controls, errors } = await session(browser, theme);
      await section(page, 'top-title').waitFor();
      await page.evaluate(() => document.fonts.ready);
      await settle(page);
      const priorityPositions = await section(page, 'top-title')
        .locator('h3')
        .evaluateAll((nodes) =>
          nodes.map((node) => ({
            title: node.textContent.trim(),
            bottom: node.getBoundingClientRect().bottom,
          })),
        );
      assert.ok(
        priorityPositions.every((item) => item.bottom <= 1000),
        'All three priority titles are visible in the first desktop viewport',
      );
      results.interactions.push({ theme, firstViewportPriorities: priorityPositions });
      if (theme !== 'system') {
        const file = `${theme}-1440.png`;
        await page.screenshot({ path: path.join(output, file) });
        results.screenshots.push(file);
      }
      for (const width of [320, 375, 425, 768, 1024, 1280, 1440, 1600]) {
        await page.setViewportSize({ width, height: width < 769 ? 900 : 1000 });
        await settle(page);
        const measured = await page.locator('.rec-page').evaluate((el) => ({
          overflow:
            document.documentElement.scrollWidth > innerWidth ||
            el.scrollWidth > el.clientWidth + 1,
          font: getComputedStyle(el).fontFamily,
          title: getComputedStyle(el.querySelector('h1')).fontSize,
          section: getComputedStyle(el.querySelector('h2')).fontSize,
          titleWeight: getComputedStyle(el.querySelector('h1')).fontWeight,
          workspaceWidth: el.getBoundingClientRect().width,
        }));
        assert.equal(measured.overflow, false, `${theme} ${width} overflow`);
        assert.match(measured.font, /Manrope/);
        assert.equal(measured.title, '28px');
        assert.equal(measured.section, '19px');
        assert.equal(measured.titleWeight, '600');
        measured.layout = await page.locator('.rec-page').evaluate((root) => {
          const shell = root.closest('.main-content');
          const style = getComputedStyle(shell);
          return {
            paddingLeft: parseFloat(style.paddingLeft),
            paddingRight: parseFloat(style.paddingRight),
            shellClientWidth: shell.clientWidth,
            pagePadding: getComputedStyle(root).padding,
            bodySize: getComputedStyle(root).fontSize,
            controlRadius: getComputedStyle(root.querySelector('button')).borderRadius,
            minimumControlHeight: Math.min(
              ...[
                ...root.querySelectorAll(
                  'button,input:not([type=checkbox]),select,textarea,a,label.include-featured',
                ),
              ]
                .filter((el) => el.getClientRects().length)
                .map((el) => el.getBoundingClientRect().height),
            ),
          };
        });
        assert.equal(measured.layout.paddingLeft, width <= 768 ? 14 : 24);
        assert.equal(measured.layout.paddingRight, width <= 768 ? 14 : 24);
        assert.equal(measured.layout.pagePadding, '0px');
        assert.equal(measured.layout.bodySize, '14px');
        assert.equal(measured.layout.controlRadius, '6px');
        assert.ok(measured.layout.minimumControlHeight >= 44);
        assert.ok(
          Math.abs(
            measured.workspaceWidth -
              (measured.layout.shellClientWidth -
                measured.layout.paddingLeft -
                measured.layout.paddingRight),
          ) <= 1,
        );

        const contrast = await page.locator('.rec-page').evaluate((root) => {
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
          for (const el of root.querySelectorAll(
            'h1,h2,h3,p,a,label,small,summary,button,span,select',
          )) {
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
        assert.deepEqual(contrast.failures, [], `Text contrast ${theme} ${width}`);
        measured.contrast = contrast;

        results.layouts.push({ theme, width, ...measured });
        if (theme !== 'system' && width === 375) {
          await page.evaluate(() => (document.querySelector('.main-content').scrollTop = 0));
          const file = `${theme}-${width}.png`;
          await page.screenshot({ path: path.join(output, file), fullPage: false });
          results.screenshots.push(file);
          if (width === 375) {
            for (const [id, suffix] of [
              ['top-title', 'actions'],
              ['all-title', 'filters'],
            ]) {
              await section(page, id).evaluate((el) => el.scrollIntoView({ block: 'start' }));
              const detail = `${theme}-375-${suffix}.png`;
              await page.screenshot({ path: path.join(output, detail) });
              results.screenshots.push(detail);
            }
          }
        }
      }
      await page.setViewportSize({ width: 1440, height: 1000 });
      await settle(page);
      const all = section(page, 'all-title');
      const original = fixture().recommendations;
      assert.deepEqual(
        await section(page, 'top-title').locator('h3').allTextContents(),
        original.slice(0, 3).map((c) => c.title),
      );
      await expectCount(all.locator('app-recommendation-row'), 8);
      await all.getByRole('button', { name: 'Show more', exact: true }).click();
      await expectCount(all.locator('app-recommendation-row'), original.length - 3);
      assert.deepEqual(
        await all.locator('h3').allTextContents(),
        original.slice(3).map((c) => c.title),
      );
      await all.getByLabel('Include the top 3 featured actions').check();
      await all.getByRole('button', { name: 'Show more', exact: true }).click();
      await expectCount(all.locator('app-recommendation-row'), original.length);
      assert.deepEqual(
        await all.locator('h3').allTextContents(),
        original.map((c) => c.title),
      );
      await all.getByRole('button', { name: 'Show fewer', exact: true }).click();
      await all.getByLabel('Search recommendations').fill('TypeScript');
      await expectCount(all.locator('app-recommendation-row'), 1);
      await all.getByRole('button', { name: 'Clear filters' }).click();
      await all.getByLabel('Category', { exact: true }).selectOption('resume');
      await expectCount(all.locator('app-recommendation-row'), 1);
      await all.getByRole('button', { name: 'Clear filters' }).click();
      await all.getByLabel('Priority', { exact: true }).selectOption('Low');
      await expectCount(
        all.locator('app-recommendation-row'),
        original.filter((c) => c.priority === 'Low').length,
      );
      assert.ok(
        (await all.locator('h3').allTextContents()).every(
          (title) => original.find((c) => c.title === title).priority === 'Low',
        ),
      );
      await all.getByRole('button', { name: 'Clear filters' }).click();
      await all.getByLabel('Source', { exact: true }).selectOption('skillGap');
      assert.ok((await all.locator('app-recommendation-row').count()) > 0);
      await all.getByRole('button', { name: 'Clear filters' }).click();
      if (theme !== 'system') {
        await all.scrollIntoViewIfNeeded();
        await all.evaluate((el) => el.scrollIntoView({ block: 'start' }));
        const file = `${theme}-1440-explorer.png`;
        await page.screenshot({ path: path.join(output, file) });
        results.screenshots.push(file);
      }
      const compact = all.locator('app-recommendation-row').first();
      await compact.locator('summary').click();
      assert.equal(await compact.locator('details').getAttribute('open'), '');
      await compact.getByText('Why this matters', { exact: true }).waitFor();
      await compact.locator('summary').click();
      const focus = section(page, 'development-title');
      await focus.getByRole('button', { name: 'View Resume actions', exact: true }).click();
      await expectCount(all.locator('app-recommendation-row'), 1);
      assert.equal(await all.getByLabel('Category', { exact: true }).inputValue(), 'resume');
      await all.getByRole('button', { name: 'Clear filters' }).click();
      const resources = section(page, 'projects-title');
      const projects = resources
        .locator('.resource-panel')
        .filter({ has: page.locator('summary', { hasText: 'Suggested projects' }) });
      await projects.locator(':scope > summary').click();
      const project = projects.locator('.resource-item').first();
      await project.locator('summary').click();
      await project.getByText('Deliverable:', { exact: false }).waitFor();
      assert.equal(
        await project.getByRole('link', { name: 'Review project source' }).getAttribute('href'),
        '/app/github-analyzer',
      );
      await projects.locator(':scope > summary').click();
      if (theme !== 'system') {
        await focus.evaluate((el) => el.scrollIntoView({ block: 'start' }));
        const file = `${theme}-1440-focus-resources.png`;
        await page.screenshot({ path: path.join(output, file) });
        results.screenshots.push(file);
      }
      const first = section(page, 'top-title').locator('app-recommendation-row').first();
      const summary = first.locator('summary');
      await summary.focus();
      await page.keyboard.press('Enter');
      assert.equal(await first.locator('details').getAttribute('open'), '');
      assert.equal(await summary.evaluate((el) => getComputedStyle(el).outlineStyle), 'solid');
      assert.ok((await first.locator('a[href^="/app/"]').count()) > 0);
      controls.sprint = 'error';
      await first.getByRole('button', { name: 'Add to Career Sprint' }).click();
      await first.getByText('Refresh before starting a sprint.', { exact: true }).waitFor();
      controls.sprint = 'duplicate';
      await first.getByRole('button', { name: 'Add to Career Sprint' }).click();
      await first.getByText('Already in your Career Sprint.', { exact: true }).waitFor();
      assert.equal(
        await first.getByRole('link', { name: 'Open Career Sprint' }).getAttribute('href'),
        '/app/career-sprint',
      );
      assert.deepEqual(controls.handoffs[0].body, { signalHash: hash });
      const second = section(page, 'top-title').locator('app-recommendation-row').nth(1);
      controls.sprint = 'success';
      await second.getByRole('button', { name: 'Add to Career Sprint' }).click();
      await second.getByText('Added to your Career Sprint.', { exact: true }).waitFor();
      controls.mode = 'error';
      await page.getByRole('button', { name: 'Refresh recommendations', exact: true }).click();
      await page.getByRole('alert').waitFor();
      assert.equal(await section(page, 'top-title').locator('h3').count(), 3);
      controls.mode = 'normal';
      await page.getByRole('button', { name: 'Retry', exact: true }).click();
      await page.getByRole('alert').waitFor({ state: 'hidden' });
      await page.getByRole('button', { name: 'Preview Candidate', exact: true }).click();
      await page.getByLabel('GitHub username', { exact: true }).fill('preview-fixture');
      await page.getByLabel('Target stack', { exact: true }).selectOption('Backend');
      await page.getByLabel('Experience', { exact: true }).selectOption('3-5 years');
      await page.getByText('Temporary resume input', { exact: true }).click();
      await page
        .getByLabel('Or paste resume text', { exact: true })
        .fill('Recorded preview resume text');
      await page.getByRole('button', { name: 'Generate preview', exact: true }).click();
      await section(page, 'top-title').waitFor();
      await expectCount(page.getByRole('button', { name: 'Add to Career Sprint' }), 0);
      await page.getByRole('button', { name: 'Save preview', exact: true }).click();
      await page.getByText('Preview saved.', { exact: true }).waitFor();
      await page.getByLabel('Saved previews', { exact: true }).selectOption('');
      await page.getByLabel('Saved previews', { exact: true }).selectOption('saved');
      await page.getByText('Historical or legacy result.', { exact: false }).waitFor();
      await expectCount(page.getByRole('button', { name: 'Add to Career Sprint' }), 0);
      await page.getByRole('button', { name: 'Remove saved preview', exact: true }).click();
      await page.getByText('Saved preview removed.', { exact: true }).waitFor();
      await page.getByRole('button', { name: 'Return to My Profile', exact: true }).click();
      await section(page, 'top-title').waitFor();
      const initialTheme = await page.locator('html').getAttribute('data-theme');
      await page.getByRole('button', { name: /Current theme is/ }).click();
      await settle(page);
      assert.notEqual(await page.locator('html').getAttribute('data-theme'), initialTheme);
      const courses = page.getByRole('link', { name: 'Browse learning resources', exact: true });
      await courses.click();
      await page.waitForURL('**/app/courses');
      await page.goBack();
      await section(page, 'top-title').waitFor();
      await page.getByRole('link', { name: 'Inspect GitHub analysis', exact: true }).click();
      await page.waitForURL('**/app/github-analyzer');
      await page.goBack();
      await section(page, 'top-title').waitFor();
      await page.getByRole('link', { name: 'Inspect Resume analysis', exact: true }).click();
      await page.waitForURL('**/app/resume-analyzer');
      await page.goBack();
      await section(page, 'top-title').waitFor();
      await section(page, 'sprint-title')
        .getByRole('link', { name: 'Open Career Sprint', exact: true })
        .click();
      await page.waitForURL('**/app/career-sprint');
      assert.equal(errors.length, 0, errors.join('\n'));
      results.interactions.push({
        theme,
        featuredExcludedByDefault: true,
        fullSetOrderPreserved: true,
        filters: true,
        search: true,
        pagination: true,
        keyboardDisclosure: true,
        focus: true,
        sprintErrorDuplicateSuccess: true,
        refreshRetry: true,
        previewGenerateOpenSaveDelete: true,
        projectDisclosureAndRoute: true,
        focusCategoryNavigation: true,
        compactDisclosure: true,
        runtimeErrors: errors,
      });
      await context.close();
    }
    for (const mode of ['loading', 'empty', 'legacy', 'partial', 'ai', 'error', 'no-profile']) {
      const { context, page, errors } = await session(browser, 'light', mode);
      if (mode === 'loading')
        await page.getByRole('status').filter({ hasText: 'Gathering' }).waitFor();
      if (mode !== 'error') await section(page, 'overview-title').waitFor();
      if (mode === 'empty') {
        assert.equal(await page.locator('app-recommendation-row').count(), 0);
        await page
          .getByText('No relevant recommendation actions were returned.', { exact: false })
          .waitFor();
      }
      if (mode === 'legacy') {
        await page.getByText('Historical or legacy result.', { exact: false }).waitFor();
        await expectCount(page.getByRole('button', { name: 'Add to Career Sprint' }), 0);
      }
      if (mode === 'partial') {
        await page.getByText('Partial result:', { exact: false }).waitFor();
        await page.getByText('Some evidence is stale.', { exact: false }).waitFor();
      }
      if (mode === 'ai') {
        const ideas = page
          .locator('.resource-panel')
          .filter({ has: page.locator('summary', { hasText: 'AI-assisted ideas' }) });
        await ideas.locator('summary').click();
        await ideas
          .getByText('Practice TypeScript with a focused example.', { exact: true })
          .waitFor();
        await ideas
          .getByText('Supplemental advice, separate from source facts', { exact: true })
          .waitFor();
      }
      if (mode === 'error') await page.getByRole('alert').waitFor();
      if (mode === 'no-profile')
        await page
          .getByText('Your profile has no connected GitHub username.', { exact: false })
          .waitFor();
      assert.equal(errors.length, 0, errors.join('\n'));
      results.states.push({ mode, pass: true });
      await context.close();
    }
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2) + '\n');
    console.log(
      JSON.stringify({
        layouts: results.layouts.length,
        interactions: results.interactions.length,
        states: results.states.length,
        screenshots: results.screenshots,
      }),
    );
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error);
  server.close();
  process.exitCode = 1;
});
