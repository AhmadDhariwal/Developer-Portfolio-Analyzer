const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { PNG } = require(process.env.PNGJS_MODULE || 'pngjs');

const phase = process.argv[2];
assert.ok(['before', 'after', 'compare'].includes(phase));
const output = path.resolve(__dirname, '../verification/integrations-component-refactor');
fs.mkdirSync(output, { recursive: true });
const base = process.env.INTEGRATIONS_UI_URL || 'http://127.0.0.1:4200';
const items = [
  ['github', 'GitHub', 'Code Hosting', 'oauth2', 'connected'],
  ['linkedin', 'LinkedIn', 'Professional Network', 'oauth2', 'disconnected'],
  ['leetcode', 'LeetCode', 'Practice Platform', 'manual', 'error'],
  ['kaggle', 'Kaggle', 'Data Science', 'manual', 'disconnected'],
  ['stackoverflow', 'Stack Overflow', 'Developer Community', 'manual', 'pending'],
  ['portfolio', 'Portfolio', 'Personal Website', 'manual', 'disconnected'],
  ['certifications', 'Certifications', 'Credentials', 'manual', 'disconnected'],
  ['devblogs', 'Dev.to', 'Technical Writing', 'manual', 'disconnected'],
].map(([provider, name, category, authMode, status]) => ({
  provider,
  name,
  category,
  authMode,
  status,
  description: `Observe ${name} public profile and activity signals.`,
  externalUsername: provider === 'github' ? 'fixture-developer' : '',
  lastSyncedAt: provider === 'github' ? '2026-10-28T10:00:00Z' : null,
  available: provider !== 'kaggle',
}));

async function session(browser, width, theme, query = '') {
  const context = await browser.newContext({
    viewport: { width, height: 1000 },
    colorScheme: theme,
    timezoneId: 'Asia/Karachi',
  });
  await context.addInitScript(
    ({ theme }) => {
      const OriginalDate = Date;
      globalThis.Date = class extends OriginalDate {
        constructor(...args) {
          super(...(args.length ? args : ['2026-10-29T09:00:00+05:00']));
        }
        static now() {
          return new OriginalDate('2026-10-29T09:00:00+05:00').getTime();
        }
      };
      localStorage.setItem(
        'token',
        'fixture.' +
          btoa(JSON.stringify({ exp: 2000000000, iss: 'devinsight-api', aud: 'devinsight-web' })) +
          '.fixture',
      );
      localStorage.setItem(
        'user',
        JSON.stringify({
          _id: 'fixture',
          name: 'Local Fixture',
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
          isConfigured: true,
        }),
      );
    },
    { theme },
  );
  const page = await context.newPage();
  const requests = [],
    errors = [],
    blocked = [];
  let catalog = structuredClone(items),
    linkedProfile = null;
  let syncError = false;
  await page.route('**/*', async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (url.pathname.startsWith('/api/')) {
      const method = request.method(),
        body = request.postDataJSON();
      requests.push({ path: url.pathname, method, body });
      let json = {};
      if (url.pathname.endsWith('/marketplace')) json = { integrations: catalog };
      else if (url.pathname.endsWith('/insights'))
        json = { integrationScore: 78, providers: [], mergedSkills: [] };
      else if (url.pathname.endsWith('/linked-profiles/kaggle')) {
        if (method === 'POST')
          linkedProfile = {
            provider: 'kaggle',
            username: 'fixture',
            profileUrl: 'https://www.kaggle.com/fixture',
            ownershipVerified: false,
            evidenceKind: 'user-entered-link',
          };
        if (method === 'DELETE') linkedProfile = null;
        json = { linkedProfile };
      } else if (url.pathname.endsWith('/manual/connect')) {
        catalog = catalog.map((item) =>
          item.provider === body.provider
            ? { ...item, status: 'connected', externalUsername: body.externalUsername }
            : item,
        );
        json = { success: true };
      } else if (url.pathname.endsWith('/sync-now') && syncError) {
        return route.fulfill({ status: 503, json: { message: 'Fixture admission unavailable.' } });
      } else if (url.pathname.includes('/connections/')) {
        catalog = catalog.map((item) =>
          item.provider === url.pathname.split('/').pop()
            ? { ...item, status: 'disconnected' }
            : item,
        );
      } else if (url.pathname.endsWith('/oauth/start')) {
        json = { authorizationUrl: base + '/app/integrations?success=github' };
      } else if (url.pathname.includes('/profile')) {
        json = {
          careerStack: 'Frontend',
          experienceLevel: 'Mid-level',
          isConfigured: true,
          profile: { isConfigured: true },
        };
      } else if (url.pathname.endsWith('/auth/me'))
        json = { user: { _id: 'fixture', name: 'Local Fixture', role: 'developer' } };
      return route.fulfill({ json });
    }
    if (url.origin !== new URL(base).origin) {
      blocked.push(url.origin);
      return route.abort();
    }
    return route.continue();
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(base + '/app/integrations' + query);
  await page.locator('.integration-card').first().waitFor();
  await page.locator('#kaggle-linked-input:not(:disabled)').waitFor();
  return {
    page,
    context,
    requests,
    errors,
    blocked,
    failSync: () => {
      syncError = true;
    },
  };
}

async function capture(page, label, results) {
  await page.mouse.move(0, 0);
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await page.addStyleTag({
    content:
      '*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }',
  });
  const root = page.locator('.integrations-page');
  const state = await root.evaluate((root) => {
    const origin = root.getBoundingClientRect();
    return {
      text: root.textContent.replace(/\s+/g, ' ').trim(),
      overflow: document.documentElement.scrollWidth > innerWidth,
      elements: [root, ...root.querySelectorAll('*')].map((el) => {
        const r = el.getBoundingClientRect(),
          s = getComputedStyle(el);
        return {
          tag: el.tagName,
          class: el
            .getAttribute('class')
            ?.replace(/ng-[\w-]+/g, '')
            .trim(),
          x: +(r.x - origin.x).toFixed(2),
          y: +(r.y - origin.y).toFixed(2),
          width: +r.width.toFixed(2),
          height: +r.height.toFixed(2),
          color: s.color,
          background: s.background,
          font: s.font,
          padding: s.padding,
          margin: s.margin,
          border: s.border,
          radius: s.borderRadius,
          display: s.display,
          gap: s.gap,
        };
      }),
      controls: [...root.querySelectorAll('button,input,a')].map((el) => ({
        tag: el.tagName,
        text: el.textContent.trim(),
        label: el.getAttribute('aria-label'),
        type: el.getAttribute('type'),
        disabled: el.disabled,
        tabIndex: el.tabIndex,
      })),
    };
  });
  await root.screenshot({ path: path.join(output, `${phase}-${label}.png`) });
  results.push({ label, ...state });
}

function compare({ results, functional }) {
  const before = JSON.parse(fs.readFileSync(path.join(output, 'before.json')));
  const comparison = results.map((result, i) => {
    const a = PNG.sync.read(fs.readFileSync(path.join(output, `before-${result.label}.png`)));
    const b = PNG.sync.read(fs.readFileSync(path.join(output, `after-${result.label}.png`)));
    let pixels = 0;
    if (a.width === b.width && a.height === b.height)
      for (let p = 0; p < a.data.length; p += 4) {
        if (a.data.subarray(p, p + 4).some((v, c) => v !== b.data[p + c])) pixels++;
      }
    else pixels = -1;
    return {
      label: result.label,
      computedParity: JSON.stringify(before.results[i]) === JSON.stringify(result),
      changedPixels: pixels,
      width: a.width,
      height: a.height,
      dimensionsMatch: a.width === b.width && a.height === b.height,
    };
  });
  // Read responses race independently of callback mutations; preserve exact counts,
  // payloads and mutation order without asserting network arrival ordering of GETs.
  const normalize = (scenarios) =>
    scenarios.map(({ requests, ...rest }) => ({
      ...rest,
      requests: requests.map((r) => JSON.stringify(r)).sort(),
      mutations: requests.filter((r) => r.method !== 'GET'),
    }));
  const arrivalOrderMatch = JSON.stringify(before.functional) === JSON.stringify(functional);
  const requestsMatch =
    JSON.stringify(normalize(before.functional)) === JSON.stringify(normalize(functional));
  fs.writeFileSync(
    path.join(output, 'comparison.json'),
    JSON.stringify({ comparison, requestsMatch, arrivalOrderMatch }, null, 2),
  );
  assert.ok(comparison.every((c) => c.computedParity && c.changedPixels === 0));
  assert.ok(
    requestsMatch,
    'Fixture request counts, payloads and mutation order must remain identical',
  );
}
if (phase === 'compare') {
  compare(JSON.parse(fs.readFileSync(path.join(output, 'after.json'))));
  console.log('Retained evidence comparison PASS');
} else
  (async () => {
    const browser = await chromium.launch({
      headless: true,
      executablePath:
        process.env.CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    });
    const results = [],
      functional = [];
    try {
      for (const width of [1440, 900, 390])
        for (const theme of ['light', 'dark']) {
          const s = await session(browser, width, theme),
            { page } = s;
          await capture(page, `${width}-${theme}-catalog`, results);
          await page.locator('.btn-ghost-terminal').click();
          await capture(page, `${width}-${theme}-terminal`, results);
          await page.getByLabel('Close terminal').click();
          await page.getByLabel('Filter integrations').fill('no-match-fixture');
          await capture(page, `${width}-${theme}-empty`, results);
          await page.getByRole('button', { name: 'Reset Filters' }).click();
          await page.waitForFunction(
            () => document.querySelectorAll('.integration-card').length === 8,
          );
          assert.equal(await page.locator('.integration-card').count(), 8);
          await page.getByRole('button', { name: 'Connected (1)', exact: true }).click();
          await page.waitForFunction(
            () => document.querySelectorAll('.integration-card').length === 1,
          );
          assert.equal(await page.locator('.integration-card').count(), 1);
          await page.getByRole('button', { name: 'All (8)', exact: true }).click();
          await page.locator('#input-leetcode').waitFor();
          const leetcode = page
            .locator('.integration-card')
            .filter({ has: page.locator('#input-leetcode') });
          await leetcode.locator('.connect-btn').click();
          await page.locator('.error-banner').waitFor();
          assert.ok(!s.requests.some((r) => r.path.endsWith('/manual/connect')));
          await page.getByLabel('Dismiss error').click();
          await page.locator('#input-leetcode').fill('fixture-handle');
          await leetcode.locator('.connect-btn').click();
          await page.getByText('fixture-handle', { exact: true }).waitFor();
          assert.equal(s.requests.filter((r) => r.path.endsWith('/manual/connect')).length, 1);
          assert.equal(s.requests.filter((r) => r.path.endsWith('/sync-now')).length, 1);
          const connected = page
            .locator('.integration-card')
            .filter({ has: page.getByText('fixture-handle', { exact: true }) });
          await connected.locator('.sync-btn').click();
          await page.waitForFunction(() => !document.querySelector('.integration-card--busy'));
          await connected.locator('.disconnect-btn').click();
          await page.locator('#input-leetcode').waitFor();
          await page.locator('#kaggle-linked-input').fill('fixture');
          await page.locator('.btn-fallback-save').click();
          await page.getByText('Open fixture on Kaggle').waitFor();
          await page.locator('.btn-fallback-remove').click();
          await page.getByText('Open fixture on Kaggle').waitFor({ state: 'hidden' });
          s.failSync();
          await page.locator('.sync-all-btn').click();
          await page.getByText('Fixture admission unavailable.', { exact: true }).waitFor();
          assert.deepEqual(s.errors, []);
          functional.push({
            label: `${width}-${theme}`,
            requests: s.requests.filter((r) => r.path.includes('/integrations/')),
            errors: s.errors,
            blockedExternalOrigins: [...new Set(s.blocked)],
          });
          await s.context.close();
        }
      for (const query of ['?code=fixture-code&state=opaque-state', '?success=github']) {
        const s = await session(browser, 1440, 'light', query);
        await s.page.waitForURL('**/app/integrations');
        assert.equal(s.requests.filter((r) => r.path.endsWith('/ingest')).length, 1);
        assert.equal(
          s.requests.filter((r) => r.path.endsWith('/oauth/callback')).length,
          query.includes('code=') ? 1 : 0,
        );
        assert.deepEqual(s.errors, []);
        functional.push({
          query,
          requests: s.requests.filter((r) => r.path.includes('/integrations/')),
          errors: s.errors,
        });
        await s.context.close();
      }
      fs.writeFileSync(
        path.join(output, `${phase}.json`),
        JSON.stringify({ results, functional }, null, 2),
      );
      if (phase === 'after') compare({ results, functional });
      console.log(
        JSON.stringify({
          phase,
          screenshots: results.length,
          functionalScenarios: functional.length,
          pass: true,
        }),
      );
    } finally {
      await browser.close();
    }
  })().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
