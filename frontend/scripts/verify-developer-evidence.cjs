const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { profile } = require('./skill-gap-browser-fixture.cjs');
const githubFixture = require('./github-browser-fixture.cjs');
const { fixture: recommendationFixture } = require('./recommendations-browser-fixture.cjs');
const {
  languagePresentation,
} = require('../../backend/src/modules/github/services/githubLanguagePresentation');

const dist = path.resolve(__dirname, '../dist/frontend/browser');
const output = path.resolve(
  process.env.DEVELOPER_EVIDENCE_OUTPUT || '../backend/verification/data-freshness/widget-closure',
);
const mime = {
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.html': 'text/html',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};
const server = http.createServer((req, res) => {
  const relative = new URL(req.url, 'http://127.0.0.1').pathname;
  let file = path.resolve(dist, '.' + relative);
  if (!file.startsWith(dist + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    file = path.join(dist, 'index.html');
  }
  res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});
const at = '2026-11-18T10:40:41.365Z';
const code = languagePresentation({
  JavaScript: 11706615,
  TypeScript: 6728422,
  HTML: 4349801,
  SCSS: 3753679,
  Python: 4911,
  Batchfile: 237,
});
const codeMap = Object.fromEntries(
  code.mainLanguageDistribution.map(({ language, percentage }) => [language, percentage]),
);
const expected = ['63.48%', '36.49%', '0.03%', '<0.01%'];
const fixtureUser = {
  _id: 'fixture',
  name: 'Fixture Developer',
  role: 'developer',
  activeGithubUsername: 'fixture',
};
const otherUser = {
  ...fixtureUser,
  _id: 'alternate',
  name: 'Alternate Developer',
  activeGithubUsername: 'alternate',
};
const tokenFor = (id) =>
  [
    'fixture',
    Buffer.from(
      JSON.stringify({
        id,
        exp: Math.floor(Date.now() / 1000) + 3600,
        iss: 'devinsight-api',
        aud: 'devinsight-web',
      }),
    ).toString('base64url'),
    'fixture',
  ].join('.');
const requests = { summary: { fixture: 0, alternate: 0 }, sync: 0, savedGithub: 0, ai: 0 };
let revision = 1;
let aiUsed = false;
const skillsMissing =
  'No saved Skill Gap assessment for this profile. Open Skill Gap to assess the available evidence.';

function summary(owner) {
  const main = owner === 'fixture';
  return {
    userName: main ? fixtureUser.name : otherUser.name,
    githubHandle: owner,
    repositories: main ? 8 + revision : 3,
    score: main ? 51 : 25,
    readinessScore: main ? 49 : 25,
    readinessMeasurement: { value: main ? 49 : 25, basis: 'github' },
    readinessBreakdown: {
      codeQuality: 51,
      skillCoverage: null,
      industryReadiness: 65,
      projectImpact: 47,
    },
    lastAnalyzedAt: at,
    updatedAt: at,
    dashboardContext: {
      ...profile,
      signalHash: owner + revision,
      contextVersion: 'fixture-' + revision,
    },
    languageSnapshot: { data: main ? codeMap : { Rust: 100 }, available: true },
    activitySnapshot: { data: [], available: false },
    skillsSnapshot: { topSkills: [], missingSkills: [], coveragePercentage: null },
    recommendationSnapshot: {
      items: [
        {
          title: 'Evidence-based fixture card',
          priority: 'High',
          priorityType: 'high',
          category: 'Project',
        },
      ],
      stale: false,
      message: aiUsed
        ? ''
        : 'AI Refresh Recommended. Evidence-based recommendations reflect the saved inputs.',
    },
    sourceFreshness: {
      github: { available: true, status: 'fresh', lastUpdated: at, label: 'Fresh' },
      skillGap: {
        available: false,
        status: 'missing',
        reason: skillsMissing,
        label: 'Refresh Recommended',
        refreshRecommended: true,
      },
      news: {
        available: true,
        status: 'stale',
        lastUpdated: at,
        reason: 'Check the Tech News feed for newer articles.',
      },
    },
    integration: { providers: [], mergedSkills: [], score: 0 },
    resume: { analyzed: true, atsScore: 65 },
    progress: {
      history: {
        status: 'missing',
        points: [],
        reason: 'Current portfolio has no scoring-rule provenance.',
      },
      sprint: {
        available: true,
        weightedCompletion: null,
        velocity: [],
        undatedCompletions: 0,
        basis: 'Active sprint completions over the last seven UTC days.',
      },
      skills: { available: false, claimed: null, proven: null },
      evidence: { totalSources: 3, available: 2, fresh: 1, stale: 1, missing: 1 },
      github: { available: true, activity: [], historyStatus: 'No comparable history.' },
      completedCourses: [],
    },
  };
}

async function run() {
  let browser;
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const results = [];
  try {
    browser = await chromium.launch({
      headless: true,
      executablePath: process.env.ACCEPTANCE_CHROME,
    });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addInitScript(
      ({ user, token, profile }) => {
        if (localStorage.getItem('token')) return;
        localStorage.setItem('token', token);
        localStorage.setItem('user', JSON.stringify(user));
        localStorage.setItem(
          'devinsight_career_profile',
          JSON.stringify({ ...profile, ownerId: user._id }),
        );
        localStorage.setItem('devinsight_theme', 'light');
      },
      { user: fixtureUser, token: tokenFor('fixture'), profile },
    );
    await context.route('**/*', async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      if (url.origin !== origin) return route.abort();
      if (!url.pathname.startsWith('/api/')) return route.continue();
      const auth = req.headers().authorization?.split('.')[1];
      const decoded = auth ? JSON.parse(Buffer.from(auth, 'base64url')) : null;
      const id = decoded?.id === 'alternate' ? 'alternate' : 'fixture';
      const user = id === 'fixture' ? fixtureUser : otherUser;
      const json = (value) => route.fulfill({ json: value });
      if (url.pathname === '/api/dashboard/summary') {
        requests.summary[id] += 1;
        return json(summary(id));
      }
      if (url.pathname === '/api/dashboard/languages')
        return json({ data: summary(id).languageSnapshot.data });
      if (url.pathname === '/api/profile/career')
        return json({ ...profile, activeGithubUsername: id });
      if (url.pathname.endsWith('/active-username')) return json({ username: id });
      if (url.pathname.includes('/github/analyze')) {
        const body = req.postDataJSON() || {};
        if (body.forceRefresh) {
          requests.sync += 1;
          revision += 1;
        } else if (body.savedOnly) {
          requests.savedGithub += 1;
        } else {
          return route.fulfill({
            status: 409,
            json: { message: 'Expected passive saved snapshot or explicit Sync' },
          });
        }
        return json({
          ...githubFixture,
          ...code,
          languageDistributionSource: 'language_bytes',
          cache: {
            source: body.forceRefresh ? 'fresh' : 'cache',
            cachedAt: at,
            expiresAt: new Date(Date.now() + 3600000).toISOString(),
          },
        });
      }
      if (/\/recommendations(?:\/generate)?$/.test(url.pathname)) {
        if (req.method() === 'POST' && req.postDataJSON()?.forceRefresh) {
          requests.ai += 1;
          aiUsed = true;
        }
        return json({
          ...recommendationFixture(),
          aiUsed,
          aiRefreshRecommended: !aiUsed,
          aiStatus: aiUsed ? 'included' : 'Refresh Recommended',
        });
      }
      return json({
        data: [],
        notifications: [],
        files: [],
        resumes: [],
        profiles: [],
        previews: [],
        integrations: [],
        organizations: [],
        teams: [],
        profile: user,
        user,
      });
    });

    const first = await context.newPage();
    const otherTab = await context.newPage();
    const dash = '/app/dashboard';
    const dashValues = (page) => page.locator('.lang-legend .legend-pct');
    async function assertValues(locator, values) {
      await locator.last().waitFor({ state: 'visible' });
      assert.deepEqual(
        (await locator.allTextContents()).map((value) => value.trim()),
        values,
      );
    }
    await first.goto(origin + dash);
    await assertValues(dashValues(first), expected);
    await first.getByRole('link', { name: 'Open Skill Gap' }).waitFor();
    assert.equal(
      await first.getByRole('link', { name: 'Open Skill Gap' }).getAttribute('href'),
      '/app/skill-gap',
    );
    await first
      .getByRole('img', { name: 'Readiness dimensions; values listed in Score Breakdown below' })
      .waitFor();
    await first.locator('.gap-card').getByText(skillsMissing, { exact: true }).waitFor();
    assert.equal(await first.locator('.gap-card .cov-score').count(), 0);
    await first.getByText(/no verified monthly/i).waitFor();
    await first.getByText(/No dated task completions from the active sprint/i).waitFor();
    await first
      .locator('.history-empty')
      .getByText('Current portfolio has no scoring-rule provenance.')
      .waitFor();
    await first.getByText(/AI Refresh Recommended\. Evidence-based/).waitFor();
    assert.equal(await first.locator('.velocity').count(), 0);
    results.push('Dashboard exact percentages, partial radar and unavailable evidence states');
    fs.mkdirSync(output, { recursive: true });
    await first.getByRole('region', { name: 'Analytics Overview' }).screenshot({
      path: path.join(output, 'dashboard-language-radar.png'),
    });
    await first.getByRole('region', { name: 'Skill Gaps and Recommendations' }).screenshot({
      path: path.join(output, 'dashboard-skill-gap-recommendations.png'),
    });
    await first.locator('article[aria-labelledby="sprint-velocity-title"]').screenshot({
      path: path.join(output, 'dashboard-sprint-velocity.png'),
    });

    await first.reload();
    await assertValues(dashValues(first), expected);
    const devtools = await first.context().newCDPSession(first);
    await Promise.all([
      first.waitForEvent('domcontentloaded'),
      devtools.send('Page.reload', { ignoreCache: true }),
    ]);
    await assertValues(dashValues(first), expected);
    results.push('Normal and cache-bypassing reload preserve measured labels');

    await otherTab.goto(origin + dash);
    await assertValues(dashValues(otherTab), expected);
    await first.goto(origin + '/app/github-analyzer');
    await assertValues(first.locator('.lang-legend-list .legend-lang-pct'), expected);
    assert.deepEqual(
      (await first.locator('.support-chip').allTextContents()).map((value) => value.trim()),
      ['HTML 16.39%', 'SCSS 14.14%'],
    );
    assert.equal(requests.sync, 0);
    assert.equal(requests.ai, 0);
    assert.ok(requests.savedGithub > 0);
    // Chart.js draws its default introduction animation on the canvas.
    await first.waitForTimeout(1100);
    await first
      .locator('section[aria-label="Languages and Activity"]')
      .screenshot({ path: path.join(output, 'github-language-evidence.png') });
    results.push('Analyzer and Dashboard match, with support bytes and passive saved-only reads');

    const otherTabRefresh = otherTab.waitForResponse(
      (response) => new URL(response.url()).pathname === '/api/dashboard/summary' && response.ok(),
    );
    await first.getByRole('button', { name: 'Sync GitHub', exact: true }).click();
    assert.equal((await (await otherTabRefresh).json()).repositories, 10);
    assert.equal(requests.sync, 1);
    assert.equal(requests.ai, 0);
    results.push('Explicit GitHub sync refreshes the other tab without an AI request');

    await first.goto(origin + '/app/recommendations');
    await first.getByText('Refresh Recommended', { exact: true }).first().waitFor();
    assert.equal(requests.ai, 0);
    results.push(
      'Recommendations page and Dashboard show the same AI freshness during passive reads',
    );

    await first.evaluate(
      ({ user, token }) => {
        localStorage.setItem('user', JSON.stringify(user));
        localStorage.setItem('token', token);
      },
      { user: otherUser, token: tokenFor('alternate') },
    );
    await otherTab.getByText('Rust', { exact: true }).waitFor();
    await assertValues(dashValues(otherTab), ['100%']);
    assert.ok(requests.summary.alternate > 0);
    assert.equal(await otherTab.getByText('Rust', { exact: true }).count(), 1);
    assert.equal(await otherTab.getByText('Python', { exact: true }).count(), 0);
    results.push(
      'A shared-browser account switch reloads Dashboard with only the new owner’s data',
    );

    const report = { results, requests, providerTraffic: 'Blocked outside the loopback fixture' };
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}
run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
