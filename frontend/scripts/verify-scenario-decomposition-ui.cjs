const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '../..');
const engine = require(root + '/backend/src/services/scoring/scenarioPlanningScore');
const output = root + '/frontend/verification/scenario-simulator/decomposition';
fs.mkdirSync(output, { recursive: true });
const phase = process.argv[2] || 'production';
const context = {
  profile: {
    careerStack: 'Frontend',
    experienceLevel: 'Mid-level',
    githubUsername: 'fixture',
    role: 'frontend',
    level: 'mid',
    baselineHiringScore: 55,
    baselineJobMatch: 48,
  },
  sources: [
    {
      key: 'integrations',
      label: 'Integrations',
      connected: true,
      lastUpdatedAt: '2026-10-25T00:00:00Z',
    },
  ],
  signals: {
    knownSkills: ['JavaScript'],
    missingSkills: ['TypeScript'],
    recommendationSkills: ['Testing'],
    sprintFocus: [],
    connectedProviders: ['github'],
    portfolioProjects: [],
    portfolioCandidates: [{ name: 'Typed application', skills: ['TypeScript'] }],
    completedPortfolioProjects: [],
    topDemandedSkills: ['Angular'],
  },
  suggestedInputs: {
    role: 'frontend',
    experienceLevel: 'mid',
    baselineHiringScore: 55,
    baselineJobMatch: 48,
    durationWeeks: 6,
    skills: ['TypeScript'],
    projects: [{ name: 'Typed application', impact: 60, complexity: 'medium', weeks: 3 }],
  },
  summary: 'Synthetic local verification context.',
};
const input = {
  ...context.suggestedInputs,
  baselineConfirmed: true,
  baselineAuthority: 'user-assumption',
  ruleVersion: 'scenario-planning-v2',
};
const evaluated = engine.calculate(input);
const saved = {
  ...input,
  _id: 'fixture-saved',
  name: 'Saved local plan',
  confidenceScore: evaluated.confidenceScore,
  predicted: evaluated.predicted,
  improvements: evaluated.improvements,
  result: evaluated,
  createdAt: '2026-10-25T00:00:00Z',
  scenarioHash: evaluated.scenarioHash,
};
async function snapshot(page, label, results) {
  const toggle = page.getByRole('button', { name: 'Toggle sidebar', exact: true });
  const desired = page.viewportSize().width > 768 ? 'true' : 'false';
  if ((await toggle.getAttribute('aria-expanded')) !== desired) await toggle.click();
  await page.mouse.move(page.viewportSize().width - 5, 5);
  await page.waitForTimeout(400);
  await page.evaluate(async () => {
    await document.fonts.ready;
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    await new Promise((r) => setTimeout(r, 150));
  });
  const data = await page.locator('.sim-page').evaluate((root) => {
    const selectors = [
      '.sim-page',
      '.studio-top-bar',
      '.input-panel',
      '.result-panel',
      '.history-panel',
      '.scenario-comparison-section',
      '.field-group input',
      '.run-btn',
      '.kpi-card',
      '.history-card',
    ];
    return {
      overflow: document.documentElement.scrollWidth > innerWidth,
      items: selectors.flatMap((selector) =>
        [...root.querySelectorAll(selector)]
          .concat(root.matches(selector) ? [root] : [])
          .filter((el) => el.getBoundingClientRect().width > 0)
          .map((el, index) => {
            const s = getComputedStyle(el),
              b = el.getBoundingClientRect();
            return {
              selector,
              index,
              x: Math.round(b.x),
              y: Math.round(b.y),
              width: Math.round(b.width),
              height: Math.round(b.height),
              color: s.color,
              background: s.backgroundColor,
              font: s.font,
              border: s.border,
              radius: s.borderRadius,
              display: s.display,
              gap: s.gap,
              padding: s.padding,
            };
          }),
      ),
    };
  });
  results.push({ label, ...data });
  await page.screenshot({ path: path.join(output, phase + '-' + label + '.png'), fullPage: true });
}
const http = require('node:http');
const staticRoot = path.join(root, 'frontend/dist/frontend/browser');
const server = http.createServer((req, res) => {
  let file = path.resolve(staticRoot, '.' + new URL(req.url, 'http://127.0.0.1').pathname);
  if (
    !file.startsWith(staticRoot + path.sep) ||
    !fs.existsSync(file) ||
    fs.statSync(file).isDirectory()
  )
    file = path.join(staticRoot, 'index.html');
  res.setHeader(
    'Content-Type',
    {
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.html': 'text/html',
      '.woff2': 'font/woff2',
      '.ttf': 'font/ttf',
    }[path.extname(file)] || 'application/octet-stream',
  );
  fs.createReadStream(file).pipe(res);
});
(async () => {
  await new Promise((resolve) => server.listen(4327, '127.0.0.1', resolve));
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.SCENARIO_CHROMIUM_PATH
      ? { executablePath: process.env.SCENARIO_CHROMIUM_PATH }
      : {}),
  });
  const results = [];
  try {
    for (const width of [1440, 375])
      for (const theme of ['light', 'dark']) {
        const ctx = await browser.newContext({
          viewport: { width, height: 1000 },
          colorScheme: theme,
        });
        await ctx.addInitScript(
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
        const page = await ctx.newPage();
        const errors = [];
        page.on('pageerror', (e) => errors.push(e.message));
        await page.route('**/api/**', (route) => {
          const url = route.request().url();
          let json = {};
          if (url.includes('/simulator/context')) json = { context };
          else if (url.includes('/simulator/history'))
            json = { history: [saved], nextCursor: null };
          else if (url.includes('/simulator/what-if'))
            json = { result: engine.calculate(route.request().postDataJSON()) };
          else if (url.includes('/profile'))
            json = {
              ...context.profile,
              profile: { ...context.profile, isConfigured: true },
              isConfigured: true,
            };
          else if (url.includes('/auth/me'))
            json = { user: { _id: 'fixture', name: 'Local Fixture', role: 'developer' } };
          return route.fulfill({ json });
        });
        await page.route('https://fonts.googleapis.com/**', (route) => route.abort());
        await page.goto('http://127.0.0.1:4327/app/scenario-simulator');
        await page.locator('#targetRole').waitFor();
        await page.waitForFunction(
          (expected) => Boolean(document.querySelector('app-scenario-inputs')) === expected,
          phase !== 'before',
        );
        await snapshot(page, width + '-' + theme + '-draft', results);
        await page.locator('.baseline-consent-card input').check();
        await page.locator('.input-panel .run-btn').click();
        await page.locator('.result-actions').waitFor();
        await snapshot(page, width + '-' + theme + '-result', results);
        if (phase === 'production') {
          assert.deepEqual(errors, []);
          await ctx.close();
          continue;
        }
        for (const tab of ['breakdown', 'roadmap']) {
          await page.locator('#dossierTab-' + tab).click();
          await snapshot(page, width + '-' + theme + '-' + tab, results);
        }
        if (width < 768) await page.getByRole('button', { name: 'Toggle history panel' }).click();
        await page.locator('.action-btn-compare').first().click();
        await page.locator('.comparison-card').waitFor();
        await snapshot(page, width + '-' + theme + '-comparison', results);
        assert.deepEqual(errors, []);
        await ctx.close();
      }
    fs.writeFileSync(path.join(output, phase + '.json'), JSON.stringify(results, null, 2));
    console.log('Visual scenarios captured:', results.length);
    if (phase === 'after') {
      const before = JSON.parse(fs.readFileSync(path.join(output, 'before.json')));
      const differences = [];
      for (let i = 0; i < before.length; i++) {
        if (JSON.stringify(before[i]) !== JSON.stringify(results[i]))
          differences.push({ label: before[i].label, before: before[i], after: results[i] });
      }
      fs.writeFileSync(path.join(output, 'differences.json'), JSON.stringify(differences, null, 2));
      console.log('Computed layout/style differences:', differences.length);
    }
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
