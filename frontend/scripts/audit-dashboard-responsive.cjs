// Complete Responsive Design & Accessibility Audit for Dashboard module
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const assert = require('node:assert/strict');

const playwrightPath =
  process.env.PLAYWRIGHT_MODULE ||
  (fs.existsSync('C:/Users/ahmad.hassan/Desktop/Agrivio/node_modules/playwright')
    ? 'C:/Users/ahmad.hassan/Desktop/Agrivio/node_modules/playwright'
    : 'playwright');
const { chromium } = require(playwrightPath);

const phase = process.argv[2] || 'before';
const chromePath =
  process.env.ACCEPTANCE_CHROME ||
  (fs.existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe')
    ? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
    : undefined);

const dist = path.resolve(__dirname, '../dist/frontend/browser');
const outputDir = path.resolve(__dirname, '../verification/dashboard/responsive-audit');
const screenshotsDir = path.join(outputDir, phase);
fs.mkdirSync(screenshotsDir, { recursive: true });

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

const mockUser = {
  _id: 'user-fixture',
  name: 'Alex Morgan',
  email: 'alex.morgan@example.com',
  role: 'developer',
  careerStack: 'Frontend',
  experienceLevel: 'Mid-level',
  githubUsername: 'alexmorgandev',
  activeGithubUsername: 'alexmorgandev',
  isConfigured: true,
};

const mockSummary = {
  score: 82,
  readinessScore: 84,
  readinessMeasurement: { value: 84, basis: 'portfolio' },
  githubHandle: 'alexmorgandev',
  lastAnalyzedAt: '2026-11-12T18:30:00.000Z',
  scoreChangeFromLastMonth: 5,
  rateLimited: false,
  noUsername: false,
  repositories: 24,
  stars: 142,
  forks: 38,
  followers: 67,
  sourcesUsed: {
    github: { connected: true, available: true, status: 'fresh' },
    resume: { connected: true, available: true, status: 'fresh' },
    skillGap: { connected: true, available: true, status: 'fresh' },
    recommendations: { connected: true, available: true, status: 'fresh' },
    integrations: { connected: true, available: true, status: 'fresh' },
  },
  dashboardContext: {
    careerStack: 'Frontend',
    experienceLevel: 'Mid-level',
    signalHash: 'sig_dash_abc123',
    dependencySignalHash: 'dep_dash_xyz789',
    contextVersion: 'v2026.11',
    lastUpdated: '2026-11-12T18:30:00.000Z',
    stale: false,
  },
  readinessBreakdown: {
    codeQuality: 88,
    skillCoverage: 82,
    industryReadiness: 79,
    projectImpact: 86,
  },
  readinessModel: {
    weights: {
      codeQuality: 25,
      skillCoverage: 30,
      industryReadiness: 25,
      projectImpact: 20,
    },
    basis: 'recorded',
  },
  readinessCenter: [
    { key: 'codeQuality', label: 'Code Quality', value: 88, tone: 'blue' },
    { key: 'skillCoverage', label: 'Skill Coverage', value: 82, tone: 'green' },
    { key: 'industryReadiness', label: 'Industry Readiness', value: 79, tone: 'cyan' },
    { key: 'projectImpact', label: 'Project Impact', value: 86, tone: 'violet' },
    { key: 'resumeAts', label: 'Resume ATS Alignment', value: 91, tone: 'amber' },
    { key: 'velocity', label: 'Sprint Velocity', value: 85, tone: 'primary' },
  ],
  commandCenter: [
    {
      key: 'skill-gap',
      label: 'Close High-Demand Skill Gaps',
      value: '4 missing skills detected for Frontend stack: TypeScript, Next.js, GraphQL, Docker.',
      source: 'Skill Gap',
      route: '/app/skill-gap',
    },
    {
      key: 'recommendations',
      label: 'Review Architecture Recommendation',
      value: 'Publish full-stack architectural case study with benchmark telemetry.',
      source: 'AI Insights',
      route: '/app/recommendations',
    },
    {
      key: 'resume',
      label: 'Optimize Keyword Density',
      value: 'ATS keyword match currently 91%; add distributed systems keywords.',
      source: 'Resume Analyzer',
      route: '/app/resume-analyzer',
    },
  ],
  sourceFreshness: {
    github: {
      status: 'fresh',
      updatedAt: '2026-11-12T18:00:00Z',
      policy: 'age-and-dependencies',
      refreshRecommended: false,
    },
    resume: {
      status: 'fresh',
      updatedAt: '2026-11-11T12:00:00Z',
      policy: 'durable-record',
      refreshRecommended: false,
    },
    skillGap: {
      status: 'fresh',
      updatedAt: '2026-11-12T18:15:00Z',
      policy: 'age-and-dependencies',
      refreshRecommended: false,
    },
    recommendations: {
      status: 'fresh',
      updatedAt: '2026-11-12T18:20:00Z',
      policy: 'age-and-dependencies',
      refreshRecommended: false,
    },
    integrations: {
      status: 'fresh',
      updatedAt: '2026-11-12T17:45:00Z',
      policy: 'age-and-dependencies',
      refreshRecommended: false,
    },
  },
  skillsSnapshot: {
    coveragePercentage: 82,
    topSkills: ['TypeScript', 'Angular', 'RxJS', 'HTML/SCSS', 'Node.js', 'Playwright', 'Git'],
    missingSkills: ['Kubernetes', 'AWS Lambda', 'Kafka', 'Terraform'],
  },
  recommendationSnapshot: [
    {
      title: 'Publish an end-to-end full-stack portfolio case study',
      priority: 'High',
      category: 'Project',
      priorityType: 'high',
      icon: 'project',
    },
    {
      title: 'Obtain AWS Certified Developer - Associate certification',
      priority: 'Medium',
      category: 'Certification',
      priorityType: 'medium',
      icon: 'certification',
    },
    {
      title: 'Contribute component accessibility patches to open-source UI libraries',
      priority: 'Medium',
      category: 'Open Source',
      priorityType: 'medium',
      icon: 'opensource',
    },
    {
      title: 'Demonstrate Cloudflare Workers or serverless edge computing',
      priority: 'Low',
      category: 'Technology',
      priorityType: 'low',
      icon: 'technology',
    },
  ],
  activitySnapshot: {
    available: true,
    data: [
      { month: 'Jun', count: 35 },
      { month: 'Jul', count: 48 },
      { month: 'Aug', count: 72 },
      { month: 'Sep', count: 64 },
      { month: 'Oct', count: 96 },
      { month: 'Nov', count: 82 },
    ],
  },
  languageSnapshot: {
    available: true,
    data: {
      TypeScript: 52,
      JavaScript: 22,
      HTML: 14,
      SCSS: 8,
      Python: 4,
    },
  },
  progress: {
    history: {
      status: 'available',
      reason: 'Regular verified bi-weekly assessments recorded over the last quarter.',
      points: [
        { at: '2026-09-01T10:00:00Z', value: 71 },
        { at: '2026-09-15T10:00:00Z', value: 74 },
        { at: '2026-10-01T10:00:00Z', value: 78 },
        { at: '2026-10-15T10:00:00Z', value: 80 },
        { at: '2026-11-01T10:00:00Z', value: 82 },
        { at: '2026-11-12T10:00:00Z', value: 84 },
      ],
    },
    sprint: {
      available: true,
      weightedCompletion: 86,
      basis: 'Active 2-week career sprint (Milestone: Modern Frontend & Architecture)',
      undatedCompletions: 0,
      velocity: [
        { day: '2026-11-06', completed: 3, points: 15 },
        { day: '2026-11-07', completed: 2, points: 10 },
        { day: '2026-11-08', completed: 0, points: 0 },
        { day: '2026-11-09', completed: 4, points: 22 },
        { day: '2026-11-10', completed: 3, points: 18 },
        { day: '2026-11-11', completed: 5, points: 28 },
        { day: '2026-11-12', completed: 2, points: 12 },
      ],
    },
    evidence: {
      totalSources: 5,
      available: 5,
      fresh: 5,
      stale: 0,
      missing: 0,
    },
    skills: {
      available: true,
      proven: 18,
      claimed: 4,
      basis: 'Verified through linked GitHub repositories and portfolio code artifacts',
    },
    github: {
      available: true,
      historyStatus: 'Continuous activity synchronized with 365-day commit telemetry.',
      activity: [
        { month: 'Jun', count: 35 },
        { month: 'Jul', count: 48 },
        { month: 'Aug', count: 72 },
        { month: 'Sep', count: 64 },
        { month: 'Oct', count: 96 },
        { month: 'Nov', count: 82 },
      ],
    },
    completedCourses: [
      { title: 'Advanced Angular Reactive Patterns', completedAt: '2026-10-20T14:00:00Z' },
      { title: 'TypeScript 5 Enterprise Architecture', completedAt: '2026-11-02T16:30:00Z' },
      { title: 'Web Accessibility (WCAG 2.2) Masterclass', completedAt: '2026-11-10T11:00:00Z' },
    ],
  },
  learningSnapshot: {
    totalTracked: 8,
    savedCount: 3,
    inProgressCount: 2,
    completedCount: 3,
  },
  integration: {
    score: 88,
  },
};

const mockContributions = {
  available: true,
  data: [
    { month: 'Jun', count: 35 },
    { month: 'Jul', count: 48 },
    { month: 'Aug', count: 72 },
    { month: 'Sep', count: 64 },
    { month: 'Oct', count: 96 },
    { month: 'Nov', count: 82 },
  ],
};

const mockLanguages = {
  source: 'github_live_profile',
  data: {
    TypeScript: 52,
    JavaScript: 22,
    HTML: 14,
    SCSS: 8,
    Python: 4,
  },
};

const mockIntegrationAnalytics = {
  connectedCount: 3,
  providers: ['github', 'leetcode', 'linkedin'],
  syncCount: 46,
  failedSyncCount: 1,
  days: 7,
  lastSyncedAt: '2026-11-12T17:45:00Z',
  cards: [
    {
      provider: 'github',
      activityScore: 92,
      profileScore: 88,
      confidence: 95,
      trendDelta: 6,
      trendAvailable: true,
      successRate: 100,
      syncCount: 28,
      lastSyncedAt: '2026-11-12T17:45:00Z',
    },
    {
      provider: 'leetcode',
      activityScore: 84,
      profileScore: 78,
      confidence: 90,
      trendDelta: 4,
      trendAvailable: true,
      successRate: 98,
      syncCount: 12,
      lastSyncedAt: '2026-11-11T20:10:00Z',
    },
    {
      provider: 'linkedin',
      activityScore: 76,
      profileScore: 85,
      confidence: 88,
      trendDelta: -2,
      trendAvailable: true,
      successRate: 100,
      syncCount: 6,
      lastSyncedAt: '2026-11-10T14:30:00Z',
    },
  ],
  insights: {
    leetcode: {
      provider: 'leetcode',
      profileScore: 78,
      activityScore: 84,
      confidence: 90,
      inferredSkills: ['Algorithms', 'Data Structures', 'Dynamic Programming', 'Binary Trees'],
      normalized: {
        profile: {
          username: 'alexmorgandev',
          ranking: 18450,
          reputation: 420,
          solvedProblems: 345,
        },
        activity: {
          easy: 180,
          medium: 135,
          hard: 30,
          profileCompleteness: 90,
          accountTrust: 95,
          accountActivityProxy: 88,
        },
      },
      syncedAt: '2026-11-11T20:10:00Z',
    },
    linkedin: {
      provider: 'linkedin',
      profileScore: 85,
      activityScore: 76,
      confidence: 88,
      inferredSkills: ['Angular Architecture', 'Team Leadership', 'System Design'],
      normalized: {
        profile: {
          name: 'Alex Morgan',
        },
        activity: {
          profileCompleteness: 94,
          accountTrust: 96,
          accountActivityProxy: 82,
        },
      },
      syncedAt: '2026-11-10T14:30:00Z',
    },
  },
};

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

async function main() {
  await new Promise((resolve) => server.listen(4208, resolve));
  const port = server.address().port;
  console.log(`[Dashboard Audit] Test server running on http://localhost:${port}`);

  const browser = await chromium.launch({
    executablePath: chromePath,
    headless: true,
  });

  const auditResults = {
    phase,
    timestamp: new Date().toISOString(),
    viewportsTested: [],
    overflowViolations: [],
    touchTargetViolations: [],
    interactiveChecks: [],
  };

  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });

    await context.addInitScript(
      ({ themeVal, activeProfile, usr }) => {
        const exp = Math.floor(Date.now() / 1000) + 36000;
        const userId = usr._id;
        const payload = btoa(
          JSON.stringify({
            exp,
            iss: 'devinsight-api',
            aud: 'devinsight-web',
          }),
        );
        localStorage.setItem('token', `fixture.${payload}.fixture`);
        localStorage.setItem('user', JSON.stringify(usr));
        localStorage.setItem('devinsight_theme', themeVal);
        localStorage.setItem(
          'devinsight_career_profile',
          JSON.stringify({
            ...activeProfile,
            ownerId: userId,
            isConfigured: true,
            activeGithubUsername: usr.activeGithubUsername,
          }),
        );
      },
      { themeVal: 'dark', activeProfile: mockUser, usr: mockUser },
    );

    const page = await context.newPage();

    // Mock network responses
    await page.route('**/api/**', async (route) => {
      const url = new URL(route.request().url());

      if (url.pathname.includes('/notifications/stream')) {
        return route.fulfill({ contentType: 'text/event-stream', body: ': heartbeat\n\n' });
      }
      if (url.pathname.includes('/auth/me')) {
        return route.fulfill({
          json: { user: mockUser },
        });
      }
      if (
        url.pathname.includes('/profile/career') ||
        (url.pathname.includes('/profile') && !url.pathname.includes('/profile/me'))
      ) {
        return route.fulfill({
          json: {
            ...mockUser,
            isConfigured: true,
          },
        });
      }
      if (url.pathname.includes('/dashboard/summary')) {
        return route.fulfill({
          json: mockSummary,
        });
      }
      if (url.pathname.includes('/dashboard/contributions')) {
        return route.fulfill({
          json: mockContributions,
        });
      }
      if (url.pathname.includes('/dashboard/languages')) {
        return route.fulfill({
          json: mockLanguages,
        });
      }
      if (url.pathname.includes('/dashboard/integration-analytics')) {
        return route.fulfill({
          json: mockIntegrationAnalytics,
        });
      }
      if (url.pathname.includes('/notifications')) {
        return route.fulfill({
          json: { notifications: [], unreadCount: 0 },
        });
      }
      return route.fulfill({
        json: {},
      });
    });

    console.log(`\n======================================================`);
    console.log(` PHASE 1: 12 VIEWPORTS x 3 THEMES (36 RUNS)`);
    console.log(`======================================================`);

    for (const vp of VIEWPORTS) {
      for (const theme of THEMES) {
        await page.setViewportSize({ width: vp.width, height: vp.height });

        // Navigate
        await page.goto(`http://localhost:${port}/app/dashboard`, {
          waitUntil: 'networkidle',
        });
        await page.waitForSelector('app-dashboard', { timeout: 15000 });

        // Apply theme
        await page.evaluate((t) => {
          document.documentElement.setAttribute('data-theme', t);
          if (t === 'light') {
            document.documentElement.classList.remove('dark');
            document.documentElement.classList.add('light');
          } else if (t === 'dark') {
            document.documentElement.classList.remove('light');
            document.documentElement.classList.add('dark');
          }
        }, theme);

        await page.waitForTimeout(150);

        // Check horizontal overflow
        const overflow = await page.evaluate(() => {
          const doc = document.documentElement;
          const body = document.body;
          const scrollWidth = Math.max(doc.scrollWidth, body.scrollWidth);
          const clientWidth = doc.clientWidth;
          const hasOverflow = scrollWidth > clientWidth + 1;

          // Find overflowing element if any
          let offendingElement = null;
          if (hasOverflow) {
            const all = document.querySelectorAll('app-dashboard *');
            for (const el of all) {
              const rect = el.getBoundingClientRect();
              if (rect.right > clientWidth + 1) {
                offendingElement = {
                  tag: el.tagName,
                  className: el.className,
                  rectRight: rect.right,
                  clientWidth,
                };
                break;
              }
            }
          }

          return {
            hasOverflow,
            scrollWidth,
            clientWidth,
            diff: scrollWidth - clientWidth,
            offendingElement,
          };
        });

        // Touch target check on interactive controls
        const touchTargets = await page.evaluate(() => {
          const interactives = Array.from(
            document.querySelectorAll(
              'app-dashboard button, app-dashboard a, app-dashboard select, app-dashboard input, app-dashboard summary',
            ),
          );
          const smallTargets = [];
          for (const el of interactives) {
            const rect = el.getBoundingClientRect();
            // Visible elements only
            if (rect.width > 0 && rect.height > 0 && rect.top < window.innerHeight * 3) {
              if (rect.height < 32 || rect.width < 32) {
                smallTargets.push({
                  tag: el.tagName,
                  className: el.className,
                  text: (el.textContent || '').trim().slice(0, 30),
                  width: Math.round(rect.width),
                  height: Math.round(rect.height),
                });
              }
            }
          }
          return smallTargets;
        });

        if (overflow.hasOverflow) {
          console.error(
            `❌ [${vp.name}][${theme}] Horizontal overflow: scrollWidth=${overflow.scrollWidth}, clientWidth=${overflow.clientWidth} (diff=${overflow.diff}px)`,
          );
          auditResults.overflowViolations.push({
            viewport: vp.name,
            theme,
            overflow,
          });
        } else {
          console.log(`✓ [${vp.name}][${theme}] 0 overflow (clientWidth=${overflow.clientWidth})`);
        }

        if (touchTargets.length > 0) {
          auditResults.touchTargetViolations.push({
            viewport: vp.name,
            theme,
            count: touchTargets.length,
            targets: touchTargets,
          });
        }

        // Save screenshot
        const screenshotName = `${vp.name}-${theme}.png`;
        await page.screenshot({
          path: path.join(screenshotsDir, screenshotName),
          fullPage: true,
        });

        auditResults.viewportsTested.push({
          viewport: vp.name,
          category: vp.category,
          dimensions: `${vp.width}x${vp.height}`,
          theme,
          overflow: overflow.hasOverflow ? 'FAIL' : 'PASS',
          smallTouchTargetCount: touchTargets.length,
        });
      }
    }

    console.log(`\n======================================================`);
    console.log(` PHASE 2: INTERACTIVE DISCLOSURES & TABLES`);
    console.log(`======================================================`);

    for (const testWidth of [375, 768, 1440]) {
      await page.setViewportSize({ width: testWidth, height: 800 });
      await page.goto(`http://localhost:${port}/app/dashboard`, {
        waitUntil: 'networkidle',
      });
      await page.waitForSelector('app-dashboard');

      // Expand all details accordions
      const detailsCount = await page.evaluate(() => {
        const details = document.querySelectorAll('app-dashboard details');
        details.forEach((d) => (d.open = true));
        return details.length;
      });

      await page.waitForTimeout(200);

      const overflowDetails = await page.evaluate(() => {
        const doc = document.documentElement;
        return {
          scrollWidth: doc.scrollWidth,
          clientWidth: doc.clientWidth,
          hasOverflow: doc.scrollWidth > doc.clientWidth + 1,
        };
      });

      console.log(
        `✓ [Width ${testWidth}px] Expanded ${detailsCount} details disclosures; overflow: ${overflowDetails.hasOverflow ? 'FAIL' : 'PASS'}`,
      );

      await page.screenshot({
        path: path.join(screenshotsDir, `details-expanded-${testWidth}.png`),
        fullPage: true,
      });

      auditResults.interactiveChecks.push({
        action: 'expand-all-details',
        viewportWidth: testWidth,
        overflow: overflowDetails.hasOverflow ? 'FAIL' : 'PASS',
      });
    }

    console.log(`\n======================================================`);
    console.log(` PHASE 3: STALE & DEGRADED ALERT STATES`);
    console.log(`======================================================`);

    // Override summary to return stale + rate limited + secondary errors
    await page.route('**/api/dashboard/summary**', (route) => {
      const staleSummary = {
        ...mockSummary,
        rateLimited: true,
        dashboardContext: {
          ...mockSummary.dashboardContext,
          stale: true,
          refreshRecommended: true,
        },
      };
      return route.fulfill({
        json: staleSummary,
      });
    });

    for (const testWidth of [375, 1440]) {
      await page.setViewportSize({ width: testWidth, height: 800 });
      await page.goto(`http://localhost:${port}/app/dashboard`, {
        waitUntil: 'networkidle',
      });
      await page.waitForSelector('app-dashboard');
      await page.waitForTimeout(300);

      const overflowDegraded = await page.evaluate(() => {
        const doc = document.documentElement;
        return {
          scrollWidth: doc.scrollWidth,
          clientWidth: doc.clientWidth,
          hasOverflow: doc.scrollWidth > doc.clientWidth + 1,
        };
      });

      console.log(
        `✓ [Width ${testWidth}px] Degraded & Stale alerts: overflow: ${overflowDegraded.hasOverflow ? 'FAIL' : 'PASS'}`,
      );

      await page.screenshot({
        path: path.join(screenshotsDir, `stale-degraded-${testWidth}.png`),
        fullPage: true,
      });

      auditResults.interactiveChecks.push({
        action: 'stale-degraded-state',
        viewportWidth: testWidth,
        overflow: overflowDegraded.hasOverflow ? 'FAIL' : 'PASS',
      });
    }

    // Save machine-readable results
    const resultsFile = path.join(outputDir, `audit-results-${phase}.json`);
    fs.writeFileSync(resultsFile, JSON.stringify(auditResults, null, 2));
    console.log(`\nAudit results written to: ${resultsFile}`);
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  console.error('Audit execution error:', err);
  process.exit(1);
});
