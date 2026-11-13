// Complete Responsive Design Audit for Interview Prep module across all required viewports and themes.
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');

const playwrightPath = process.env.PLAYWRIGHT_MODULE || 'D:/Agrivio/node_modules/playwright';
const { chromium } = require(playwrightPath);

const phase = process.argv[2] || 'before';
const chromePath =
  process.env.ACCEPTANCE_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const dist = path.resolve(__dirname, '../dist/frontend/browser');
const outputDir = path.resolve(__dirname, '../verification/interview-prep/responsive-audit');
fs.mkdirSync(outputDir, { recursive: true });

const {
  buildSeedRecordsForTopic,
  getImportantTopicByKey,
} = require('../../backend/src/services/interviewQuestionSeedCatalog');

const profile = { careerStack: 'Frontend', experienceLevel: 'Student', isConfigured: true };
const user = {
  _id: 'user-fixture',
  name: 'Fixture Developer',
  email: 'dev@example.com',
  role: 'developer',
  ...profile,
};

const VIEWPORTS = [
  // Mobile
  { name: 'mobile-320', width: 320, height: 640, category: 'Mobile' },
  { name: 'mobile-375', width: 375, height: 667, category: 'Mobile' },
  { name: 'mobile-390', width: 390, height: 844, category: 'Mobile' },
  { name: 'mobile-430', width: 430, height: 932, category: 'Mobile' },
  // Tablet
  { name: 'tablet-768', width: 768, height: 1024, category: 'Tablet' },
  { name: 'tablet-820', width: 820, height: 1180, category: 'Tablet' },
  { name: 'tablet-1024', width: 1024, height: 768, category: 'Tablet' },
  // Laptop
  { name: 'laptop-1280', width: 1280, height: 800, category: 'Laptop' },
  { name: 'laptop-1366', width: 1366, height: 768, category: 'Laptop' },
  // Desktop
  { name: 'desktop-1440', width: 1440, height: 900, category: 'Desktop' },
  { name: 'desktop-1920', width: 1920, height: 1080, category: 'Desktop' },
  // Large screen
  { name: 'large-2560', width: 2560, height: 1440, category: 'Large screen' },
];

const THEMES = ['dark', 'light', 'system'];

const server = http.createServer((req, res) => {
  const relative = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(
    /^\/+/,
    '',
  );
  let file = path.resolve(dist, relative);
  if (
    !file.startsWith(dist + path.sep) ||
    !fs.existsSync(file) ||
    fs.statSync(file).isDirectory()
  ) {
    file = path.join(dist, 'index.html');
  }
  const mime = {
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.html': 'text/html',
    '.ttf': 'font/ttf',
    '.woff2': 'font/woff2',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
  };
  res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});

async function initPageContext(browser, { width, height, theme = 'dark', username = 'fixture' }) {
  const colorScheme = theme === 'system' ? 'dark' : theme;
  const context = await browser.newContext({
    viewport: { width, height },
    colorScheme,
    reducedMotion: 'reduce',
  });

  await context.addInitScript(
    ({ themeVal, activeUser, activeProfile }) => {
      const exp = Math.floor(Date.now() / 1000) + 36000;
      const userId = 'user-fixture';
      const payload = btoa(
        JSON.stringify({
          exp,
          iss: 'devinsight-api',
          aud: 'devinsight-web',
        }),
      );
      localStorage.setItem('token', `fixture.${payload}.fixture`);
      localStorage.setItem(
        'user',
        JSON.stringify({
          _id: userId,
          role: 'developer',
          name: 'Fixture Developer',
          email: 'dev@example.com',
          activeGithubUsername: activeUser,
        }),
      );
      localStorage.setItem('devinsight_theme', themeVal);
      localStorage.setItem(
        'devinsight_career_profile',
        JSON.stringify({
          ...activeProfile,
          ownerId: userId,
          isConfigured: true,
          activeGithubUsername: activeUser,
        }),
      );
    },
    { themeVal: theme, activeUser: username, activeProfile: profile },
  );

  return context;
}

function getMockQuestions(skill = 'react') {
  const topic = getImportantTopicByKey(skill);
  if (!topic) return [];
  return buildSeedRecordsForTopic(topic).map((question, index) => ({
    ...question,
    _id: `fixture-${skill}-${index}`,
    verificationStatus: 'verified',
    sourceType: 'verified_seed',
    source: 'verified_seed',
    sourceUrl: 'https://react.dev/reference',
  }));
}

async function attachDefaultRoutes(page, mode = 'normal') {
  const rawQuestions = getMockQuestions('react');
  let currentSessions = [
    {
      _id: 'fixture-session-1',
      kind: 'practice',
      topicKey: 'react',
      careerStack: 'Frontend',
      experienceLevel: 'Student',
      status: 'in_progress',
      progress: { 0: 'comfortable' },
      progressVersion: 1,
      questions: rawQuestions.slice(0, 5),
      createdAt: new Date(Date.now() - 86400000 * 2).toISOString(),
    },
    {
      _id: 'fixture-session-2',
      kind: 'custom',
      topicKey: 'react',
      careerStack: 'Frontend',
      experienceLevel: 'Student',
      status: 'completed',
      progress: { 0: 'comfortable' },
      progressVersion: 1,
      questions: [
        {
          _id: 'fixture-custom-q1',
          question: 'How do React Server Components differ from Client Components?',
          shortAnswer:
            'Server Components execute only on the server and send zero JavaScript to the client bundle.',
          explanation:
            'RSC allows developers to keep data fetching, sensitive credentials, and heavy dependencies on the server, streaming serialized JSX to the client.',
          keyPoints: [
            'Zero client bundle size impact',
            'Direct access to server-side data stores',
            'Cannot use React hooks or browser APIs',
          ],
          codeSnippet:
            '// Server Component (default in App Router)\nasync function UserProfile({ id }) {\n  const user = await db.user.findUnique({ where: { id } });\n  return <div>{user.name}</div>;\n}',
          difficulty: 'senior',
          category: 'architecture',
          topicKey: 'react',
          tags: ['rsc', 'architecture', 'nextjs'],
          verificationStatus: 'unverified',
          sourceType: 'ai_generated',
          source: 'ai_generated',
        },
      ],
      createdAt: new Date(Date.now() - 86400000 * 4).toISOString(),
    },
  ];

  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (!url.includes('/api/')) {
      return route.continue().catch(() => {});
    }
    const request = route.request();
    const endpoint = new URL(url).pathname;
    const method = request.method();
    let data = {};
    try {
      data = request.postDataJSON() || {};
    } catch {
      data = {};
    }

    const send = (json, status = 200) => {
      try {
        return route.fulfill({ status, json: JSON.parse(JSON.stringify(json)) });
      } catch {
        // Ignored if route already aborted
      }
    };

    if (mode === 'error') {
      return send({ message: 'Interview prep service temporarily unavailable.' }, 500);
    }

    if (endpoint.includes('/profile/career')) {
      return send(profile);
    }
    if (endpoint.includes('/profile') || endpoint.includes('/auth/me')) {
      return send({ ...user, user });
    }
    if (endpoint.includes('/notifications')) {
      return send({ notifications: [], unreadCount: 0 });
    }

    if (
      endpoint.endsWith('/interview-prep/questions') ||
      endpoint.endsWith('/interview-prep/search')
    ) {
      if (mode === 'empty') {
        return send({
          questions: [],
          total: 0,
          totalPages: 1,
          page: 1,
          limit: 10,
          topicKey: 'react',
          source: 'db',
        });
      }
      return send({
        questions: rawQuestions.slice(0, 10),
        total: rawQuestions.length,
        totalPages: Math.ceil(rawQuestions.length / 10),
        page: 1,
        limit: 10,
        topicKey: 'react',
        source: 'db',
      });
    }

    if (endpoint.endsWith('/interview-prep/history')) {
      if (mode === 'empty_history') {
        return send({ sessions: [] });
      }
      return send({ sessions: currentSessions });
    }

    const sessionMatch = endpoint.match(
      /\/api\/interview-prep\/sessions\/([^/]+)(?:\/(progress|complete))?$/,
    );
    if (sessionMatch) {
      const sessId = sessionMatch[1];
      const sess = currentSessions.find((s) => s._id === sessId) || currentSessions[0];
      if (sessionMatch[2] === 'complete') {
        sess.status = 'completed';
        return send(sess);
      }
      if (sessionMatch[2] === 'progress') {
        sess.progress = sess.progress || {};
        sess.progress[data.questionIndex || 0] = data.selfCheck || 'comfortable';
        return send(sess);
      }
      return send(sess);
    }

    if (endpoint.endsWith('/interview-prep/ask-question')) {
      const answer = {
        _id: 'fixture-asked-q',
        question: data.question || 'How does the event loop handle microtasks vs macrotasks?',
        shortAnswer:
          'Microtasks execute immediately after the currently running script and before the next task.',
        explanation:
          'Promises and queueMicrotask populate the microtask queue, which drains completely before requestAnimationFrame or timers run.',
        keyPoints: [
          'Promises and MutationObservers schedule microtasks',
          'setTimeout and setInterval schedule macrotasks',
          'Microtasks can starve macrotasks if scheduled recursively',
        ],
        codeSnippet:
          'console.log("start");\nPromise.resolve().then(() => console.log("microtask"));\nsetTimeout(() => console.log("macrotask"), 0);\nconsole.log("end");',
        difficulty: 'medium',
        category: 'core',
        topicKey: 'react',
        tags: ['event-loop', 'async', 'promises'],
        verificationStatus: 'unverified',
        sourceType: 'ai_generated',
        source: 'ai_generated',
      };
      return send(answer);
    }

    if (endpoint.endsWith('/interview-prep/generate') || endpoint === '/api/interview-prep') {
      const count = Number(data.target || data.limit || 5);
      const questions = rawQuestions.slice(0, count);
      const newSession = {
        _id: `fixture-session-${Date.now()}`,
        kind: 'practice',
        topicKey: data.skill || 'react',
        careerStack: 'Frontend',
        experienceLevel: 'Student',
        status: 'in_progress',
        progress: {},
        progressVersion: 0,
        questions,
        createdAt: new Date().toISOString(),
      };
      currentSessions.unshift(newSession);
      return send({
        questions,
        page: 1,
        total: questions.length,
        totalPages: 1,
        limit: count,
        source: 'db',
        aiGeneratedCount: 0,
        sessionId: newSession._id,
      });
    }

    return send({ success: true });
  });
}

async function main() {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  console.log(`[audit-interview-prep-responsive] Static server running at ${base}`);

  const browser = await chromium.launch({
    headless: true,
    executablePath: chromePath,
  });

  const auditReport = {
    phase,
    timestamp: new Date().toISOString(),
    viewportsTested: VIEWPORTS.length,
    themesTested: THEMES.length,
    matrixResults: [],
    scenarioChecks: {},
    overflowDefects: [],
    touchTargetDefects: [],
    layoutDefects: [],
    accessibilityDefects: [],
  };

  const matrixDir = path.join(outputDir, phase, 'matrix');
  const scenariosDir = path.join(outputDir, phase, 'scenarios');
  fs.mkdirSync(matrixDir, { recursive: true });
  fs.mkdirSync(scenariosDir, { recursive: true });

  try {
    // 1. Matrix verification: 12 viewports x 3 themes = 36 runs
    console.log(`\n--- Starting 36-cell Viewport & Theme Matrix Audit (${phase}) ---`);
    for (const vp of VIEWPORTS) {
      for (const theme of THEMES) {
        const context = await initPageContext(browser, {
          width: vp.width,
          height: vp.height,
          theme,
          username: 'fixture',
        });

        const page = await context.newPage();
        const pageErrors = [];
        page.on('pageerror', (err) => pageErrors.push(err.message));

        await attachDefaultRoutes(page, 'normal');

        try {
          await page.goto(`${base}/app/interview-prep`, { waitUntil: 'domcontentloaded' });
          await page.locator('.interview-prep-page').waitFor({ timeout: 15000 });
        } catch {
          await page.reload({ waitUntil: 'domcontentloaded' });
          await page.locator('.interview-prep-page').waitFor({ timeout: 20000 });
        }
        await page.locator('.command-hub').waitFor({ timeout: 20000 });
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(200);

        // Sidebar check: On desktop/laptop (> 768), ensure shell isn't blocking view
        if (vp.width > 768 && (await page.locator('.shell-body.sidebar-closed').count())) {
          const toggleBtn = page.getByRole('button', { name: 'Toggle sidebar', exact: true });
          if (await toggleBtn.isVisible()) {
            await toggleBtn.click();
            await page.waitForTimeout(150);
          }
        }

        // Measure layout & check overflow
        const measurement = await page.evaluate(() => {
          const doc = document.documentElement;
          const body = document.body;
          const scrollWidth = Math.max(doc.scrollWidth, body.scrollWidth);
          const clientWidth = doc.clientWidth || window.innerWidth;
          const pageEl = document.querySelector('.interview-prep-page');
          const pageScroll = pageEl ? pageEl.scrollWidth : 0;
          const pageClient = pageEl ? pageEl.clientWidth : 0;

          // Find any elements exceeding viewport width
          const overflowing = [];
          document.querySelectorAll('.interview-prep-page *').forEach((el) => {
            const rect = el.getBoundingClientRect();
            if (rect.right > clientWidth + 1.5 && rect.width > 0) {
              const tag = el.tagName.toLowerCase();
              const cls =
                el.className && typeof el.className === 'string' ? el.className.trim() : '';
              overflowing.push({
                tag,
                cls,
                right: Math.round(rect.right),
                width: Math.round(rect.width),
              });
            }
          });

          // Check touch targets (buttons, links, inputs, selects)
          const smallTouchTargets = [];
          document
            .querySelectorAll(
              '.interview-prep-page button, .interview-prep-page a, .interview-prep-page input, .interview-prep-page select',
            )
            .forEach((el) => {
              const rect = el.getBoundingClientRect();
              if (rect.width > 0 && rect.height > 0) {
                if (
                  rect.height < 32 ||
                  (rect.height < 36 && !el.classList.contains('inline-link'))
                ) {
                  const text = (el.textContent || '').trim().slice(0, 30);
                  const cls = typeof el.className === 'string' ? el.className : '';
                  smallTouchTargets.push({
                    tag: el.tagName.toLowerCase(),
                    cls,
                    text,
                    height: Math.round(rect.height),
                    width: Math.round(rect.width),
                  });
                }
              }
            });

          // Measure key section layout details
          const hubBox = document.querySelector('.command-hub')?.getBoundingClientRect();
          const filtersGridBox = document.querySelector('.filters-grid')?.getBoundingClientRect();
          const questionListBox = document.querySelector('.question-list')?.getBoundingClientRect();

          return {
            scrollWidth,
            clientWidth,
            pageScroll,
            pageClient,
            hasHorizontalOverflow: scrollWidth > clientWidth + 1 || pageScroll > pageClient + 1,
            overflowingElements: overflowing.slice(0, 5),
            smallTouchTargets: smallTouchTargets.slice(0, 8),
            totalSmallTouchTargets: smallTouchTargets.length,
            hubWidth: hubBox ? Math.round(hubBox.width) : null,
            filtersGridWidth: filtersGridBox ? Math.round(filtersGridBox.width) : null,
            questionListWidth: questionListBox ? Math.round(questionListBox.width) : null,
          };
        });

        // Screenshot
        const screenshotName = `${theme}-${vp.name}.png`;
        const screenshotPath = path.join(matrixDir, screenshotName);
        await page.screenshot({ path: screenshotPath, fullPage: true });

        const cellResult = {
          viewport: vp.name,
          category: vp.category,
          width: vp.width,
          height: vp.height,
          theme,
          pass: !measurement.hasHorizontalOverflow && pageErrors.length === 0,
          hasHorizontalOverflow: measurement.hasHorizontalOverflow,
          pageErrors,
          measurement,
          screenshot: screenshotName,
        };

        auditReport.matrixResults.push(cellResult);
        if (measurement.hasHorizontalOverflow) {
          auditReport.overflowDefects.push({
            viewport: vp.name,
            theme,
            overflowingElements: measurement.overflowingElements,
          });
        }
        if (measurement.totalSmallTouchTargets > 0) {
          auditReport.touchTargetDefects.push({
            viewport: vp.name,
            theme,
            count: measurement.totalSmallTouchTargets,
            samples: measurement.smallTouchTargets,
          });
        }

        console.log(
          `  [${vp.name}] ${theme.toUpperCase()} -> ${cellResult.pass ? 'PASS' : 'FAIL'} (scroll: ${measurement.scrollWidth}px / client: ${measurement.clientWidth}px, overflow elements: ${measurement.overflowingElements.length}, small touch targets: ${measurement.totalSmallTouchTargets})`,
        );
        await context.close();
      }
    }

    // 2. Specialized Scenarios & UI States across Representative Viewports
    const scenarioViewports = [
      { name: 'mobile-320', width: 320, height: 640 },
      { name: 'mobile-375', width: 375, height: 667 },
      { name: 'tablet-768', width: 768, height: 1024 },
      { name: 'desktop-1440', width: 1440, height: 900 },
    ];

    console.log(`\n--- Running Targeted UI Scenarios & States ---`);

    // Scenario 1: Question Library with Expanded Question Cards
    console.log(`\nScenario 1: Question Library with Expanded Question Cards`);
    for (const svp of scenarioViewports) {
      const context = await initPageContext(browser, {
        width: svp.width,
        height: svp.height,
        theme: 'dark',
      });
      const page = await context.newPage();
      await attachDefaultRoutes(page, 'normal');
      await page.goto(`${base}/app/interview-prep`, { waitUntil: 'domcontentloaded' });
      await page.locator('.interview-prep-page').waitFor({ timeout: 25000 });

      // Click "Reveal answer" on first 2 questions
      const revealButtons = page.locator('.answer-toggle');
      if (await revealButtons.count()) {
        await revealButtons.first().click();
        await page.waitForTimeout(200);
      }

      const ofCheck = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: window.innerWidth,
        pass: document.documentElement.scrollWidth <= window.innerWidth,
      }));
      const scName = `scenario-expanded-answers-${svp.name}.png`;
      await page.screenshot({ path: path.join(scenariosDir, scName), fullPage: true });
      auditReport.scenarioChecks[`expanded_answers_${svp.name}`] = {
        pass: ofCheck.pass,
        ...ofCheck,
        screenshot: scName,
      };
      console.log(
        `  -> ${svp.name}: ${ofCheck.pass ? 'PASS' : 'FAIL'} (${ofCheck.scrollWidth}px / ${ofCheck.clientWidth}px)`,
      );
      await context.close();
    }

    // Scenario 2: Active Search & Filter Chips
    console.log(`\nScenario 2: Active Search & Filter Chips`);
    for (const svp of scenarioViewports) {
      const context = await initPageContext(browser, {
        width: svp.width,
        height: svp.height,
        theme: 'dark',
      });
      const page = await context.newPage();
      await attachDefaultRoutes(page, 'normal');
      await page.goto(`${base}/app/interview-prep`, { waitUntil: 'domcontentloaded' });
      await page.locator('.interview-prep-page').waitFor({ timeout: 25000 });

      // Set difficulty and enter search query
      await page.locator('.level-pill:has-text("Medium")').click();
      await page.locator('#library-search').fill('architecture and lifecycle');
      await page.locator('.apply-button').click();
      await page.waitForTimeout(200);

      const ofCheck = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: window.innerWidth,
        pass: document.documentElement.scrollWidth <= window.innerWidth,
      }));
      const scName = `scenario-filters-active-${svp.name}.png`;
      await page.screenshot({ path: path.join(scenariosDir, scName), fullPage: true });
      auditReport.scenarioChecks[`filters_active_${svp.name}`] = {
        pass: ofCheck.pass,
        ...ofCheck,
        screenshot: scName,
      };
      console.log(
        `  -> ${svp.name}: ${ofCheck.pass ? 'PASS' : 'FAIL'} (${ofCheck.scrollWidth}px / ${ofCheck.clientWidth}px)`,
      );
      await context.close();
    }

    // Scenario 3: Question Generator Tab: Drill Runner
    console.log(`\nScenario 3: Question Generator Tab: Practice Drill Runner`);
    for (const svp of scenarioViewports) {
      const context = await initPageContext(browser, {
        width: svp.width,
        height: svp.height,
        theme: 'dark',
      });
      const page = await context.newPage();
      await attachDefaultRoutes(page, 'normal');
      await page.goto(`${base}/app/interview-prep`, { waitUntil: 'domcontentloaded' });
      await page.locator('.interview-prep-page').waitFor({ timeout: 25000 });

      // Switch to Generate Questions tab
      await page.locator('.nav-tab:has-text("Generate Questions")').click();
      await page.locator('.studio-section').waitFor({ timeout: 10000 });
      // Click "Generate Questions"
      await page.locator('.submit-drill-btn').click();
      await page.locator('.practice-result').waitFor({ timeout: 10000 });
      await page.waitForTimeout(200);

      const ofCheck = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: window.innerWidth,
        pass: document.documentElement.scrollWidth <= window.innerWidth,
      }));
      const scName = `scenario-drill-runner-${svp.name}.png`;
      await page.screenshot({ path: path.join(scenariosDir, scName), fullPage: true });
      auditReport.scenarioChecks[`drill_runner_${svp.name}`] = {
        pass: ofCheck.pass,
        ...ofCheck,
        screenshot: scName,
      };
      console.log(
        `  -> ${svp.name}: ${ofCheck.pass ? 'PASS' : 'FAIL'} (${ofCheck.scrollWidth}px / ${ofCheck.clientWidth}px)`,
      );
      await context.close();
    }

    // Scenario 4: Question Generator Tab: Custom Q&A Answer
    console.log(`\nScenario 4: Question Generator Tab: Custom Q&A Answer`);
    for (const svp of scenarioViewports) {
      const context = await initPageContext(browser, {
        width: svp.width,
        height: svp.height,
        theme: 'dark',
      });
      const page = await context.newPage();
      await attachDefaultRoutes(page, 'normal');
      await page.goto(`${base}/app/interview-prep`, { waitUntil: 'domcontentloaded' });
      await page.locator('.interview-prep-page').waitFor({ timeout: 25000 });

      // Switch to Generate Questions tab
      await page.locator('.nav-tab:has-text("Generate Questions")').click();
      await page.locator('.studio-section').waitFor({ timeout: 10000 });
      // Ask custom question
      await page
        .locator('#custom-question')
        .fill('How does the event loop prioritize microtasks vs macrotasks?');
      await page.locator('.submit-ask-btn').click();
      await page.locator('.custom-result-section').waitFor({ timeout: 10000 });
      await page.waitForTimeout(200);

      const ofCheck = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: window.innerWidth,
        pass: document.documentElement.scrollWidth <= window.innerWidth,
      }));
      const scName = `scenario-custom-answer-${svp.name}.png`;
      await page.screenshot({ path: path.join(scenariosDir, scName), fullPage: true });
      auditReport.scenarioChecks[`custom_answer_${svp.name}`] = {
        pass: ofCheck.pass,
        ...ofCheck,
        screenshot: scName,
      };
      console.log(
        `  -> ${svp.name}: ${ofCheck.pass ? 'PASS' : 'FAIL'} (${ofCheck.scrollWidth}px / ${ofCheck.clientWidth}px)`,
      );
      await context.close();
    }

    // Scenario 5: Sessions & History Master-Detail View
    console.log(`\nScenario 5: Sessions & History Master-Detail View`);
    for (const svp of scenarioViewports) {
      const context = await initPageContext(browser, {
        width: svp.width,
        height: svp.height,
        theme: 'dark',
      });
      const page = await context.newPage();
      await attachDefaultRoutes(page, 'normal');
      await page.goto(`${base}/app/interview-prep`, { waitUntil: 'domcontentloaded' });
      await page.locator('.interview-prep-page').waitFor({ timeout: 25000 });

      // Switch to Sessions & history tab
      await page.locator('.nav-tab:has-text("Sessions & history")').click();
      await page.locator('.history-section').waitFor({ timeout: 10000 });
      await page.locator('.session-row').first().click();
      await page.waitForTimeout(200);

      const ofCheck = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: window.innerWidth,
        pass: document.documentElement.scrollWidth <= window.innerWidth,
      }));
      const scName = `scenario-history-detail-${svp.name}.png`;
      await page.screenshot({ path: path.join(scenariosDir, scName), fullPage: true });
      auditReport.scenarioChecks[`history_detail_${svp.name}`] = {
        pass: ofCheck.pass,
        ...ofCheck,
        screenshot: scName,
      };
      console.log(
        `  -> ${svp.name}: ${ofCheck.pass ? 'PASS' : 'FAIL'} (${ofCheck.scrollWidth}px / ${ofCheck.clientWidth}px)`,
      );
      await context.close();
    }

    // Scenario 6: Completed Session View with Locked Progress
    console.log(`\nScenario 6: Completed Session View with Locked Progress`);
    for (const svp of scenarioViewports) {
      const context = await initPageContext(browser, {
        width: svp.width,
        height: svp.height,
        theme: 'dark',
      });
      const page = await context.newPage();
      await attachDefaultRoutes(page, 'normal');
      await page.goto(`${base}/app/interview-prep`, { waitUntil: 'domcontentloaded' });
      await page.locator('.interview-prep-page').waitFor({ timeout: 25000 });

      // Switch to Sessions & history tab, select second session (completed)
      await page.locator('.nav-tab:has-text("Sessions & history")').click();
      await page.locator('.history-section').waitFor({ timeout: 10000 });
      const rows = page.locator('.session-row');
      if ((await rows.count()) > 1) {
        await rows.nth(1).click();
      }
      await page.waitForTimeout(200);

      const ofCheck = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: window.innerWidth,
        pass: document.documentElement.scrollWidth <= window.innerWidth,
      }));
      const scName = `scenario-history-completed-${svp.name}.png`;
      await page.screenshot({ path: path.join(scenariosDir, scName), fullPage: true });
      auditReport.scenarioChecks[`history_completed_${svp.name}`] = {
        pass: ofCheck.pass,
        ...ofCheck,
        screenshot: scName,
      };
      console.log(
        `  -> ${svp.name}: ${ofCheck.pass ? 'PASS' : 'FAIL'} (${ofCheck.scrollWidth}px / ${ofCheck.clientWidth}px)`,
      );
      await context.close();
    }

    // Scenario 7: Empty Library State
    console.log(`\nScenario 7: Empty Question Library State`);
    for (const svp of scenarioViewports) {
      const context = await initPageContext(browser, {
        width: svp.width,
        height: svp.height,
        theme: 'dark',
      });
      const page = await context.newPage();
      await attachDefaultRoutes(page, 'empty');
      await page.goto(`${base}/app/interview-prep`, { waitUntil: 'domcontentloaded' });
      await page.locator('.empty-state').waitFor({ timeout: 25000 });
      await page.waitForTimeout(200);

      const ofCheck = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: window.innerWidth,
        pass: document.documentElement.scrollWidth <= window.innerWidth,
      }));
      const scName = `scenario-empty-library-${svp.name}.png`;
      await page.screenshot({ path: path.join(scenariosDir, scName), fullPage: true });
      auditReport.scenarioChecks[`empty_library_${svp.name}`] = {
        pass: ofCheck.pass,
        ...ofCheck,
        screenshot: scName,
      };
      console.log(
        `  -> ${svp.name}: ${ofCheck.pass ? 'PASS' : 'FAIL'} (${ofCheck.scrollWidth}px / ${ofCheck.clientWidth}px)`,
      );
      await context.close();
    }

    // Scenario 8: Error / Reconnect State
    console.log(`\nScenario 8: Error / Reconnect State`);
    for (const svp of scenarioViewports) {
      const context = await initPageContext(browser, {
        width: svp.width,
        height: svp.height,
        theme: 'dark',
      });
      const page = await context.newPage();
      await attachDefaultRoutes(page, 'error');
      await page.goto(`${base}/app/interview-prep`, { waitUntil: 'domcontentloaded' });
      await page.locator('.notice.error').waitFor({ timeout: 25000 });
      await page.waitForTimeout(200);

      const ofCheck = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: window.innerWidth,
        pass: document.documentElement.scrollWidth <= window.innerWidth,
      }));
      const scName = `scenario-error-${svp.name}.png`;
      await page.screenshot({ path: path.join(scenariosDir, scName), fullPage: true });
      auditReport.scenarioChecks[`error_${svp.name}`] = {
        pass: ofCheck.pass,
        ...ofCheck,
        screenshot: scName,
      };
      console.log(
        `  -> ${svp.name}: ${ofCheck.pass ? 'PASS' : 'FAIL'} (${ofCheck.scrollWidth}px / ${ofCheck.clientWidth}px)`,
      );
      await context.close();
    }

    // Scenario 9: Empty History State
    console.log(`\nScenario 9: Empty History State`);
    for (const svp of scenarioViewports) {
      const context = await initPageContext(browser, {
        width: svp.width,
        height: svp.height,
        theme: 'dark',
      });
      const page = await context.newPage();
      await attachDefaultRoutes(page, 'empty_history');
      await page.goto(`${base}/app/interview-prep`, { waitUntil: 'domcontentloaded' });
      await page.locator('.interview-prep-page').waitFor({ timeout: 25000 });

      // Click Sessions & history tab
      await page.locator('.nav-tab:has-text("Sessions & history")').click();
      await page
        .locator('.empty-state:has-text("Your next session starts here")')
        .waitFor({ timeout: 10000 });
      await page.waitForTimeout(200);

      const ofCheck = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: window.innerWidth,
        pass: document.documentElement.scrollWidth <= window.innerWidth,
      }));
      const scName = `scenario-empty-history-${svp.name}.png`;
      await page.screenshot({ path: path.join(scenariosDir, scName), fullPage: true });
      auditReport.scenarioChecks[`empty_history_${svp.name}`] = {
        pass: ofCheck.pass,
        ...ofCheck,
        screenshot: scName,
      };
      console.log(
        `  -> ${svp.name}: ${ofCheck.pass ? 'PASS' : 'FAIL'} (${ofCheck.scrollWidth}px / ${ofCheck.clientWidth}px)`,
      );
      await context.close();
    }

    // Scenario 10: Landscape Orientations
    console.log(`\nScenario 10: Landscape Orientations`);
    const landscapeViewports = [
      { name: 'mobile-landscape-667x375', width: 667, height: 375 },
      { name: 'mobile-landscape-844x390', width: 844, height: 390 },
      { name: 'tablet-landscape-1024x768', width: 1024, height: 768 },
    ];
    for (const lvp of landscapeViewports) {
      const context = await initPageContext(browser, {
        width: lvp.width,
        height: lvp.height,
        theme: 'dark',
      });
      const page = await context.newPage();
      await attachDefaultRoutes(page, 'normal');
      await page.goto(`${base}/app/interview-prep`, { waitUntil: 'domcontentloaded' });
      await page.locator('.interview-prep-page').waitFor({ timeout: 25000 });
      await page.waitForTimeout(200);

      const ofCheck = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: window.innerWidth,
        pass: document.documentElement.scrollWidth <= window.innerWidth,
      }));
      const scName = `scenario-orientation-${lvp.name}.png`;
      await page.screenshot({ path: path.join(scenariosDir, scName), fullPage: true });
      auditReport.scenarioChecks[`orientation_${lvp.name}`] = {
        pass: ofCheck.pass,
        ...ofCheck,
        screenshot: scName,
      };
      console.log(
        `  -> ${lvp.name}: ${ofCheck.pass ? 'PASS' : 'FAIL'} (${ofCheck.scrollWidth}px / ${ofCheck.clientWidth}px)`,
      );
      await context.close();
    }

    // Scenario 11: Browser Zoom Reflow
    console.log(`\nScenario 11: Browser Zoom Reflow`);
    const zoomLevels = [1.25, 1.5, 1.75, 2.0];
    for (const zoom of zoomLevels) {
      const vpWidth = Math.round(1280 / zoom);
      const vpHeight = Math.round(800 / zoom);
      const context = await initPageContext(browser, {
        width: vpWidth,
        height: vpHeight,
        theme: 'dark',
      });
      const page = await context.newPage();
      await attachDefaultRoutes(page, 'normal');
      await page.goto(`${base}/app/interview-prep`, { waitUntil: 'domcontentloaded' });
      await page.locator('.interview-prep-page').waitFor({ timeout: 25000 });
      await page.waitForTimeout(200);

      const ofCheck = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: window.innerWidth,
        pass: document.documentElement.scrollWidth <= window.innerWidth,
      }));
      const scName = `scenario-zoom-${Math.round(zoom * 100)}.png`;
      await page.screenshot({ path: path.join(scenariosDir, scName), fullPage: true });
      auditReport.scenarioChecks[`zoom_${Math.round(zoom * 100)}`] = {
        pass: ofCheck.pass,
        ...ofCheck,
        screenshot: scName,
      };
      console.log(
        `  -> Zoom ${Math.round(zoom * 100)}% (effective vp ${vpWidth}px): ${ofCheck.pass ? 'PASS' : 'FAIL'} (${ofCheck.scrollWidth}px / ${ofCheck.clientWidth}px)`,
      );
      await context.close();
    }

    // Scenario 12: Keyboard Navigation & Focus Rings
    console.log(`\nScenario 12: Keyboard Navigation & Focus Rings`);
    {
      const context = await initPageContext(browser, { width: 1440, height: 900, theme: 'dark' });
      const page = await context.newPage();
      await attachDefaultRoutes(page, 'normal');
      await page.goto(`${base}/app/interview-prep`, { waitUntil: 'domcontentloaded' });
      await page.locator('.interview-prep-page').waitFor({ timeout: 25000 });

      // Tab through elements
      for (let i = 0; i < 6; i++) {
        await page.keyboard.press('Tab');
      }
      await page.waitForTimeout(150);

      const focusedTag = await page.evaluate(() => document.activeElement?.tagName.toLowerCase());
      const scName = `scenario-keyboard-focus.png`;
      await page.screenshot({ path: path.join(scenariosDir, scName) });
      auditReport.scenarioChecks['keyboard_focus'] = {
        pass: !!focusedTag && focusedTag !== 'body',
        focusedTag,
        screenshot: scName,
      };
      console.log(`  -> Active element on Tab navigation: <${focusedTag}>`);
      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }

  // Save audit JSON report
  const reportPath = path.join(outputDir, `${phase}-results.json`);
  fs.writeFileSync(reportPath, JSON.stringify(auditReport, null, 2), 'utf8');
  console.log(`\nAudit completed! Report saved to ${reportPath}`);
}

main().catch((err) => {
  console.error('[audit-interview-prep-responsive] Fatal error:', err);
  process.exit(1);
});
