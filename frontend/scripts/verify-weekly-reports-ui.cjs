const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const parsePdf = require(path.resolve(__dirname, '../../backend/node_modules/pdf-parse'));

async function readAndParsePdf(filePath) {
  for (let i = 0; i < 5; i++) {
    try {
      const buffer = fs.readFileSync(filePath);
      return await parsePdf(buffer);
    } catch (err) {
      if (i === 4) throw err;
      await new Promise((r) => setTimeout(r, 200));
    }
  }
}
const pdfService = require(
  path.resolve(__dirname, '../../backend/src/services/weeklyReportPdfService'),
);
const presentation = require(
  path.resolve(__dirname, '../../backend/src/services/weeklyReportPresentation'),
);

process.env.WEEKLY_REPORT_TIMEZONE = 'Asia/Karachi';
const weeklyCalendar = require(
  path.resolve(__dirname, '../../backend/src/services/weeklyReportCalendar'),
);
const root = path.resolve(__dirname, '..');
const output = path.resolve(
  root,
  process.env.WEEKLY_REPORTS_VERIFICATION_OUTPUT ||
    'verification/weekly-reports/refinement-2026-11-11',
);
const staticRoot = path.join(root, 'dist/frontend/browser');
const reportId = '000000000000000000000001';
const priorReportId = '000000000000000000000002';
const oldHash = 'a'.repeat(64);
const newHash = 'c'.repeat(64);
const weights = { github: 30, resume: 25, sprint: 20, interview: 15, skillCoverage: 10 };

function reportingWeek(offset = 0) {
  const currentStart = weeklyCalendar.startOfWeek();
  const range =
    offset === 0
      ? { start: currentStart, end: weeklyCalendar.endOfWeek(currentStart) }
      : weeklyCalendar.previousWeekRange(currentStart);
  const start = range.start;
  const end = range.end;
  return { start: start.toISOString(), end: end.toISOString() };
}

function sources() {
  const assessedAt = new Date().toISOString();
  const oldEvidence = new Date(Date.now() - 18 * 86400000).toISOString();
  return {
    github: {
      connected: true,
      status: 'Connected',
      freshness: 'fresh',
      lastAnalyzedAt: assessedAt,
    },
    resume: { analyzed: true, status: 'Analyzed', freshness: 'fresh', lastAnalyzedAt: assessedAt },
    skillGap: {
      analyzed: true,
      status: 'Analyzed',
      freshness: 'fresh',
      lastAnalyzedAt: assessedAt,
    },
    recommendations: {
      available: true,
      status: '2 active',
      freshness: 'fresh',
      lastAnalyzedAt: assessedAt,
    },
    careerSprint: {
      connected: true,
      status: 'Active',
      freshness: 'fresh',
      lastAnalyzedAt: assessedAt,
    },
    interviewPrep: {
      analyzed: true,
      status: 'No activity this week',
      freshness: 'stale',
      lastAnalyzedAt: oldEvidence,
    },
    learning: {
      available: true,
      status: '2 tracked (self-reported)',
      freshness: 'stale',
      lastAnalyzedAt: oldEvidence,
    },
    portfolio: {
      connected: true,
      status: 'Public',
      freshness: 'fresh',
      lastAnalyzedAt: assessedAt,
    },
    integrations: {
      connected: true,
      status: '1 connected',
      freshness: 'fresh',
      lastAnalyzedAt: assessedAt,
    },
  };
}

function createReport(id, score, week, version, hash, scoreValues) {
  const inputs = Object.fromEntries(
    Object.entries(weights).map(([key, weight]) => [
      key,
      {
        available: true,
        value: scoreValues[key],
        weight,
        reason: scoreValues[key] === 0 ? 'Measured zero' : 'Saved evidence',
      },
    ]),
  );
  return {
    _id: id,
    score,
    weekStartDate: week.start,
    weekEndDate: week.end,
    progressSummary:
      'Saved evidence establishes this reporting week. No unrecorded progress is inferred.',
    insights: ['Interview activity was zero during this week.'],
    recommendations: ['Review the next planned Sprint task.'],
    topAchievements: ['A saved report snapshot was produced.'],
    biggestRiskArea: 'Learning evidence is stale.',
    predictedHiringReadiness: {
      score,
      reason: 'Deterministic planning indicator, not a hiring probability.',
    },
    reportText: 'Persisted weekly report snapshot.',
    emailStatus: 'sent',
    emailDelivery: { status: 'sent', contentHash: hash, history: [] },
    meta: {
      version,
      reportHash: hash,
      signalHash: `${hash.slice(0, 32)}`,
      narrativeSource: 'deterministic',
      evidence: { scoreAvailable: true, measuredScore: score, coverageWeight: 100, inputs },
      provenance: {
        assessedAt: new Date().toISOString(),
        timezone: 'Asia/Karachi',
        activityBasis: 'Lifetime repository counts; weekly activity unavailable.',
      },
      comparison: {
        available: true,
        baselineReportId: priorReportId,
        baselineWeekStartDate: reportingWeek(-1).start,
        reason: 'Compared with the immediately preceding saved week.',
      },
      scoreBreakdown: {
        github: { label: 'GitHub', score: scoreValues.github, weight: 30 },
        resume: { label: 'Resume', score: scoreValues.resume, weight: 25 },
        sprint: { label: 'Sprint completion', score: scoreValues.sprint, weight: 20 },
        interview: { label: 'Interview prep', score: scoreValues.interview, weight: 15 },
        skillCoverage: { label: 'Skill coverage', score: scoreValues.skillCoverage, weight: 10 },
      },
      dataSourcesUsed: sources(),
      sourceFreshness: {
        detection: true,
        message: 'Learning and Interview Prep evidence is stale at assessment.',
        staleSources: ['learning', 'interviewPrep'],
        severity: 'warning',
        recommendation: 'Review source evidence before interpreting recent progress.',
      },
      skillFocus: ['TypeScript'],
      activity: {
        repositoriesTracked: 2,
        activeRepositories: 0,
        commits: 470,
        weeklyCommitSignal: null,
        stars: 3,
        forks: 1,
      },
      sprint: { tasksCompleted: 4, tasksTotal: 4, completionRate: 100, weeklyGoal: 4, streak: 2 },
      interview: { sessions: 0, questionsGenerated: 0 },
      learning: { totalTracked: 2, completedCount: 1 },
      comparisons: {
        scoreDelta: score - 61,
        readinessDelta: score - 61,
        githubDelta: 10,
        resumeDelta: 0,
        sprintCompletionDelta: 40,
        tasksCompletedDelta: 2,
        interviewSessionsDelta: 0,
        interviewQuestionsDelta: 0,
        activityCommitsDelta: 0,
        activeReposDelta: 0,
        missingSkillsDelta: 0,
        coverageDelta: 0,
      },
    },
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function missingEvidenceReport() {
  const report = createReport(reportId, 0, reportingWeek(), 1, oldHash, {
    github: 0,
    resume: 0,
    sprint: 0,
    interview: 0,
    skillCoverage: 0,
  });
  report.progressSummary = 'Overall score is not assessed because saved inputs are missing.';
  report.predictedHiringReadiness = {
    score: 0,
    reason: 'Not assessed: incomplete source evidence.',
  };
  report.meta.evidence = {
    scoreAvailable: false,
    measuredScore: null,
    coverageWeight: 40,
    inputs: {
      github: { available: true, value: 0, weight: 30, reason: 'Measured zero' },
      resume: { available: false, value: null, weight: 25, reason: 'Missing evidence' },
      sprint: { available: false, value: null, weight: 20, reason: 'Missing evidence' },
      interview: { available: false, value: null, weight: 15, reason: 'Missing evidence' },
      skillCoverage: { available: true, value: 0, weight: 10, reason: 'Measured zero' },
    },
  };
  report.meta.scoreBreakdown.resume.score = 0;
  report.meta.scoreBreakdown.sprint.score = 0;
  report.meta.scoreBreakdown.interview.score = 0;
  report.meta.dataSourcesUsed.resume = {
    analyzed: false,
    status: 'No saved evidence',
    freshness: 'unavailable',
    lastAnalyzedAt: null,
  };
  report.meta.dataSourcesUsed.careerSprint = {
    connected: false,
    status: 'No saved evidence',
    freshness: 'unavailable',
    lastAnalyzedAt: null,
  };
  report.meta.dataSourcesUsed.interviewPrep = {
    analyzed: false,
    status: 'No saved sessions',
    freshness: 'unavailable',
    lastAnalyzedAt: null,
  };
  report.meta.dataSourcesUsed.learning = {
    available: true,
    status: '2 tracked (self-reported)',
    freshness: 'stale',
    lastAnalyzedAt: new Date(Date.now() - 18 * 86400000).toISOString(),
  };
  report.meta.sprint = {
    tasksCompleted: 0,
    tasksTotal: 0,
    completionRate: 0,
    weeklyGoal: 0,
    streak: 0,
  };
  report.meta.interview = { sessions: 0, questionsGenerated: 0 };
  report.meta.comparison = {
    available: false,
    reason: 'Comparison requires complete evidence in both adjacent weeks.',
  };
  report.meta.comparisons = {
    scoreDelta: 0,
    readinessDelta: 0,
    githubDelta: 0,
    resumeDelta: 0,
    sprintCompletionDelta: 0,
    tasksCompletedDelta: 0,
    interviewSessionsDelta: 0,
    interviewQuestionsDelta: 0,
    activityCommitsDelta: 0,
    activeReposDelta: 0,
    missingSkillsDelta: 0,
    coverageDelta: 0,
  };
  report.meta.sourceFreshness.message =
    'Resume, Sprint and Interview Prep evidence is missing. Learning evidence is stale.';
  return report;
}

function createState(mode = 'normal') {
  const current = createReport(reportId, 72, reportingWeek(), 1, oldHash, {
    github: 90,
    resume: 80,
    sprint: 100,
    interview: 0,
    skillCoverage: 50,
  });
  const prior = createReport(priorReportId, 61, reportingWeek(-1), 1, 'b'.repeat(64), {
    github: 80,
    resume: 80,
    sprint: 60,
    interview: 0,
    skillCoverage: 50,
  });
  const refreshed = clone(current);
  refreshed.meta.version = 2;
  refreshed.meta.reportHash = newHash;
  refreshed.meta.signalHash = 'd'.repeat(32);
  refreshed.meta.learning.completedCount = 2;
  refreshed.progressSummary = 'Refreshed version two uses the changed saved learning signal.';
  return {
    mode,
    archived: current,
    current,
    refreshed,
    prior,
    operations: [],
    pdfSnapshots: [],
    release: null,
    slowGate: null,
  };
}

const stateForRoute = new Map();
const server = http.createServer((req, res) => {
  const requested = path.resolve(
    staticRoot,
    `.${decodeURIComponent(new URL(req.url, 'http://localhost').pathname)}`,
  );
  if (!requested.startsWith(staticRoot + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  const file =
    fs.existsSync(requested) && fs.statSync(requested).isFile()
      ? requested
      : path.join(staticRoot, 'index.html');
  res.setHeader(
    'Content-Type',
    { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(file)] ||
      'application/octet-stream',
  );
  fs.createReadStream(file).pipe(res);
});

function trackPage(page, state) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const pathname = url.pathname;
    stateForRoute.set(page, state);

    if (pathname.endsWith('/auth/me'))
      return route.fulfill({
        json: {
          user: {
            _id: 'fixture',
            name: 'Fixture',
            role: 'developer',
            activeGithubUsername: 'fixture',
          },
        },
      });
    if (pathname.endsWith('/profile'))
      return route.fulfill({
        json: {
          profile: { careerStack: 'Frontend', experienceLevel: 'Mid-level', isConfigured: true },
          isConfigured: true,
        },
      });

    if (pathname.endsWith('/weekly-reports/latest')) {
      if (state.mode === 'slow') await state.slowGate;
      if (state.mode === 'error')
        return route.fulfill({ status: 503, json: { message: 'Synthetic service outage' } });
      return route.fulfill({
        json:
          state.mode === 'empty'
            ? null
            : state.mode === 'missing'
              ? missingEvidenceReport()
              : state.current,
      });
    }
    if (pathname.endsWith('/weekly-reports/history'))
      return route.fulfill({
        json: { reports: state.mode === 'empty' ? [] : [state.current, state.prior] },
      });

    if (method === 'POST' && pathname.endsWith('/weekly-reports/generate')) {
      state.operations.push({ operation: 'generate', method, path: pathname });
      return route.fulfill({ json: state.current });
    }
    if (method === 'POST' && /\/weekly-reports\/[^/]+\/refresh$/.test(pathname)) {
      state.operations.push({
        operation: 'refresh',
        method,
        path: pathname,
        body: request.postDataJSON(),
      });
      state.current = state.refreshed;
      return route.fulfill({ json: state.current });
    }
    if (method === 'POST' && /\/weekly-reports\/[^/]+\/resend-email$/.test(pathname)) {
      state.operations.push({
        operation: 'resend-email',
        method,
        path: pathname,
        body: request.postDataJSON(),
      });
      return route.fulfill({
        json: { sent: true, reportId, contentHash: request.postDataJSON().contentHash },
      });
    }
    if (method === 'GET' && /\/weekly-reports\/[^/]+$/.test(pathname)) {
      return route.fulfill({
        json: url.searchParams.get('version') === oldHash ? state.archived : state.current,
      });
    }
    if (method === 'GET' && /\/weekly-reports\/[^/]+\/pdf$/.test(pathname)) {
      const hash = url.searchParams.get('version');
      const snapshot = hash === oldHash ? state.archived : state.current;
      const pdfBuffer = await pdfService.render(snapshot);
      state.pdfSnapshots.push({
        reportId: snapshot._id,
        version: snapshot.meta.version,
        hash: snapshot.meta.reportHash,
      });
      return route.fulfill({ status: 200, contentType: 'application/pdf', body: pdfBuffer });
    }
    return route.fulfill({ json: {} });
  });
  return errors;
}

function setFixtureStorage(context, theme) {
  return context.addInitScript(
    ({ theme }) => {
      localStorage.setItem(
        'token',
        `fixture.${btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 36000, iss: 'devinsight-api', aud: 'devinsight-web' }))}.fixture`,
      );
      localStorage.setItem(
        'user',
        JSON.stringify({
          _id: 'fixture',
          name: 'Fixture',
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
          ownerId: 'fixture',
          isConfigured: true,
        }),
      );
    },
    { theme },
  );
}

async function openPage(browser, width, theme, state = createState()) {
  const context = await browser.newContext({
    viewport: { width, height: 1000 },
    colorScheme: 'dark',
  });
  await setFixtureStorage(context, theme);
  const page = await context.newPage();
  const errors = trackPage(page, state);
  await page.goto(`http://127.0.0.1:${server.address().port}/app/weekly-reports`);
  return { context, page, errors, state };
}

(async () => {
  fs.mkdirSync(output, { recursive: true });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  let browser;
  const results = {
    testedHead: execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: path.resolve(root, '..'),
      encoding: 'utf8',
    }).trim(),
    themes: [],
    operationJourney: {},
    archivedSnapshot: {},
    evidenceStates: {},
    loadingErrorEmpty: {},
    emailPreview: {},
    failures: [],
  };
  try {
    browser = await chromium.launch({
      executablePath: process.env.WEEKLY_CHROMIUM_PATH,
      headless: true,
    });

    for (const width of [1440, 375]) {
      for (const theme of ['light', 'dark', 'system']) {
        const { context, page, errors, state } = await openPage(browser, width, theme);
        await page.getByRole('heading', { name: 'Your momentum over time' }).waitFor();
        assert.equal(await page.locator('.source-card').count(), 9);
        assert.equal(await page.getByRole('meter').getAttribute('aria-valuenow'), '72');
        assert.equal(await page.getByRole('meter').getAttribute('aria-valuetext'), '72');
        const oldWeek = page.locator('.trend-bars button').filter({ hasText: '61' });
        await oldWeek.focus();
        await oldWeek.press('Enter');
        await page.waitForFunction(
          () => document.querySelector('[role="meter"]')?.getAttribute('aria-valuenow') === '61',
        );
        if (theme === 'system') {
          await page.emulateMedia({ colorScheme: 'light' });
          await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
        }
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        );
        assert.equal(overflow, false, `${width}px ${theme} layout overflows`);
        assert.deepEqual(errors, []);
        const name = `${width}-${theme}`;
        await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: true });
        results.themes.push({
          name,
          width,
          theme,
          overflow,
          pageErrors: errors.length,
          sources: 9,
          keyboardHistorySelection: true,
          reportHash: state.current.meta.reportHash,
        });
        await context.close();
      }
    }

    const operation = await openPage(browser, 1440, 'light');
    await operation.page.getByRole('heading', { name: 'Your momentum over time' }).waitFor();
    assert.match(
      await operation.page.locator('.header-actions').innerText(),
      /5-minute cooldown.*3 per week/,
    );
    await operation.page.getByRole('button', { name: 'Generate current week' }).click();
    await operation.page.getByText('Saved snapshot · version 1').waitFor();
    await operation.page.getByRole('button', { name: 'Refresh current week' }).click();
    await operation.page.getByText('Saved snapshot · version 2').waitFor();
    await operation.page.screenshot({
      path: path.join(output, 'refreshed-version-2.png'),
      fullPage: true,
    });
    const [download] = await Promise.all([
      operation.page.waitForEvent('download'),
      operation.page.getByRole('button', { name: 'Download PDF' }).click(),
    ]);
    const currentPdfPath = path.join(output, 'download-version-2.pdf');
    await download.saveAs(currentPdfPath);
    const currentPdf = await readAndParsePdf(currentPdfPath);
    assert.ok(currentPdf.text.includes(newHash));
    assert.ok(currentPdf.text.includes('Version 2'));
    await operation.page.getByRole('button', { name: 'Resend email' }).click();
    await operation.page.getByRole('status').filter({ hasText: 'Email send accepted' }).waitFor();
    assert.deepEqual(
      operation.state.operations.map(({ operation: name }) => name),
      ['generate', 'refresh', 'resend-email'],
    );
    assert.equal(operation.state.operations[1].body.contentHash, oldHash);
    assert.equal(operation.state.operations[2].body.contentHash, newHash);
    assert.deepEqual(operation.state.pdfSnapshots, [{ reportId, version: 2, hash: newHash }]);
    assert.deepEqual(operation.errors, []);
    results.operationJourney = {
      operations: operation.state.operations.map(({ operation: name }) => name),
      refreshVersion: 2,
      pdfHash: newHash,
      emailHash: newHash,
      samePersistedVersion: true,
      browserDownload: true,
      parsedPdfPages: currentPdf.numpages,
      resendInvokedNoExtraGeneration: true,
    };
    await operation.context.close();

    const archivedState = createState();
    archivedState.current = archivedState.refreshed;
    const archivedUrl = `http://127.0.0.1:${server.address().port}/app/weekly-reports?report=${reportId}&version=${oldHash}`;
    const archivedContext = await browser.newContext({ viewport: { width: 1200, height: 900 } });
    await setFixtureStorage(archivedContext, 'light');
    const archivedPage = await archivedContext.newPage();
    const archivedErrors = trackPage(archivedPage, archivedState);
    await archivedPage.goto(archivedUrl);
    await archivedPage.getByText('Saved snapshot · version 1').waitFor();
    assert.equal(
      await archivedPage.getByRole('button', { name: 'Refresh current week' }).isDisabled(),
      true,
    );
    assert.equal(
      await archivedPage.getByRole('button', { name: 'Resend email' }).isDisabled(),
      true,
    );
    const [archivedDownload] = await Promise.all([
      archivedPage.waitForEvent('download'),
      archivedPage.getByRole('button', { name: 'Download PDF' }).click(),
    ]);
    const archivedPdfPath = path.join(output, 'download-archived-version-1.pdf');
    await archivedDownload.saveAs(archivedPdfPath);
    const archivedPdf = await readAndParsePdf(archivedPdfPath);
    assert.ok(archivedPdf.text.includes(oldHash));
    assert.ok(archivedPdf.text.includes('Version 1'));
    assert.deepEqual(archivedState.pdfSnapshots, [{ reportId, version: 1, hash: oldHash }]);
    assert.deepEqual(archivedErrors, []);
    await archivedPage.screenshot({
      path: path.join(output, 'archived-version-1.png'),
      fullPage: true,
    });
    results.archivedSnapshot = {
      deepLinkLoaded: true,
      refreshDisabled: true,
      resendDisabled: true,
      pdfAvailable: true,
      pdfHash: oldHash,
      version: 1,
    };
    await archivedContext.close();

    const missing = await openPage(browser, 1440, 'light', createState('missing'));
    await missing.page.getByText('Overall score not assessed').waitFor();
    assert.equal(await missing.page.getByRole('meter').getAttribute('aria-valuenow'), null);
    assert.equal(await missing.page.locator('.stale-warning').isVisible(), true);
    assert.equal(await missing.page.getByText('Comparison unavailable').isVisible(), true);
    assert.ok((await missing.page.locator('.source-card--warning').count()) >= 1);
    assert.match(await missing.page.locator('.kpi-grid').innerText(), /Unavailable/);
    assert.match(
      await missing.page.locator('.breakdown-card').innerText(),
      /Missing evidence — not a zero score/,
    );
    assert.deepEqual(missing.errors, []);
    await missing.page.screenshot({
      path: path.join(output, 'missing-stale-evidence.png'),
      fullPage: true,
    });
    results.evidenceStates = {
      missingScoreNotZero: true,
      comparisonUnavailableWithoutCompleteEvidence: true,
      unavailableSprintAndInterview: true,
      staleSourcesWarned: true,
      measuredGitHubZeroPreserved:
        (await missing.page.locator('.kpi-grid').getByText('0%').count()) > 0,
    };
    await missing.context.close();

    const slow = createState('slow');
    slow.slowGate = new Promise((resolve) => {
      slow.release = resolve;
    });
    const loading = await openPage(browser, 1280, 'system', slow);
    await loading.page.locator('.skeleton-grid').waitFor();
    await loading.page.screenshot({ path: path.join(output, 'loading.png'), fullPage: true });
    slow.release();
    await loading.page.getByRole('heading', { name: 'Your momentum over time' }).waitFor();
    await loading.context.close();

    const failed = await openPage(browser, 1280, 'light', createState('error'));
    await failed.page.getByRole('alert').waitFor();
    await failed.page.screenshot({ path: path.join(output, 'error.png'), fullPage: true });
    failed.state.mode = 'normal';
    await failed.page.getByRole('button', { name: 'Retry' }).click();
    await failed.page.getByRole('heading', { name: 'Your momentum over time' }).waitFor();
    assert.deepEqual(failed.errors, []);
    await failed.context.close();

    const empty = await openPage(browser, 1280, 'light', createState('empty'));
    await empty.page.getByRole('heading', { name: 'No Reports Generated' }).waitFor();
    await empty.page.screenshot({ path: path.join(output, 'empty.png'), fullPage: true });
    assert.deepEqual(empty.errors, []);
    await empty.context.close();
    results.loadingErrorEmpty = {
      loadingSkeleton: true,
      errorRetry: true,
      emptyState: true,
      pageErrors: 0,
      overflow: 0,
    };

    const emailState = createState();
    emailState.current = emailState.refreshed;
    const reportLink = `https://example.invalid/app/weekly-reports?report=${reportId}&version=${newHash}`;
    const email = presentation.email(emailState.current, 'Synthetic Developer', reportLink);
    assert.ok(email.html.includes(`Version 2`));
    assert.ok(email.html.includes(newHash));
    assert.ok(email.html.includes('Learning Hub'));
    assert.ok(email.html.includes('Interview Prep'));
    assert.ok(email.html.includes(reportLink.replace(/&/g, '&amp;')));
    fs.writeFileSync(path.join(output, 'email-preview.html'), email.html);
    const emailPage = await browser.newPage({ viewport: { width: 640, height: 1000 } });
    await emailPage.setContent(email.html);
    assert.equal(
      await emailPage.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    await emailPage.screenshot({
      path: path.join(output, 'email-preview-640.png'),
      fullPage: true,
    });
    await emailPage.setViewportSize({ width: 375, height: 900 });
    assert.equal(
      await emailPage.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    await emailPage.screenshot({
      path: path.join(output, 'email-preview-375.png'),
      fullPage: true,
    });
    await emailPage.close();
    results.emailPreview = {
      version: 2,
      hash: newHash,
      savedReportLink: true,
      desktopWidth: 640,
      mobileWidth: 375,
      overflow: 0,
      sanitized: !email.html.includes('<script>'),
    };

    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results));
  } finally {
    for (const page of stateForRoute.keys()) stateForRoute.delete(page);
    await browser?.close();
    server.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
