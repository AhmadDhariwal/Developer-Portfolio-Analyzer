// Complete Responsive Audit for Public Portfolio & Portfolio Studio across all required viewports, themes, and states.
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const assert = require('node:assert/strict');

const playwrightPath =
  process.env.PLAYWRIGHT_MODULE || 'D:/Agrivio/node_modules/playwright';
const { chromium } = require(playwrightPath);

const phase = process.argv[2] || 'before';
const chromePath =
  process.env.ACCEPTANCE_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const dist = path.resolve(__dirname, '../dist/frontend/browser');
const outputDir = path.resolve(__dirname, '../verification/public-portfolio/responsive-audit');
fs.mkdirSync(outputDir, { recursive: true });

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

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aC1sAAAAASUVORK5CYII=',
  'base64',
);

const owner = {
  _id: '000000000000000000000001',
  name: 'Maya Chen',
  email: 'private-owner@example.test',
  role: 'developer',
  isActive: true,
  isVerified: true,
  emailVerified: true,
  githubUsername: 'maya-chen',
  careerStack: 'Full Stack',
  experienceLevel: '3-5 years',
  onboardingCompleted: true,
  isPublic: true,
  hasResume: true,
  defaultResumeFileId: '000000000000000000000002',
};

const fixture = {
  slug: 'maya-chen',
  isPublic: true,
  headline: 'Product engineer · thoughtful systems, useful software',
  summary:
    'I’m a product engineer who cares about the details. I work across design and development to build accessible digital experiences that are clear, considered, and a pleasure to use.',
  seoTitle: 'Maya Chen — Product engineer',
  seoDescription: 'Selected projects, experience and professional connections.',
  sections: {
    hero: {
      greetingLabel: 'Hello, I’m',
      roleLabel: 'A Developer who',
      titleLineOne: 'Thoughtful products.',
      titleLineTwo: 'Built to',
      titleHighlight: 'make a difference.',
      titleLineSuffix: '',
      tagline: 'Design-minded. Detail-driven. Always curious.',
    },
    skills: {
      headline: 'Core Technical',
      highlight: 'Architecture',
      headlineSuffix: '& Ecosystem',
      subheadline: 'The tools and patterns I use to turn complex problems into simple, resilient experiences.',
    },
    contact: {
      heading: 'Let’s make something that matters.',
      message:
        'Have a product challenge, an interesting role, or an idea worth exploring? I’d love to hear about it.',
      email: 'private-owner@example.test',
    },
    upcoming: { heading: 'In the making', subheading: 'A small look at what comes next.' },
    testimonials: {
      heading: 'Good work happens together.',
      subheading: 'A few words from people I’ve worked with.',
    },
    cta: {
      heading: 'Open to a good conversation.',
      subtext: 'Find me through my professional profiles, or send a recruiter enquiry.',
      primaryLabel: 'Let’s connect',
      secondaryLabel: 'Download resume ↓',
      resumeUrl: '/api/public-profiles/me/resume',
    },
    visibility: { projects: true, upcoming: true, testimonials: true, cta: true },
  },
  skills: [
    { name: 'TypeScript', score: 92 },
    { name: 'Angular', score: 95 },
    { name: 'Node.js', score: 88 },
    { name: 'PostgreSQL', score: 80 },
    { name: 'Accessibility', score: 90 },
    { name: 'Design systems', score: 85 },
    { name: 'Figma', score: 78 },
  ],
  projects: [
    {
      title: 'Atlas workspace',
      description:
        'A calmer home for collaborative work. An accessible project workspace that brings decisions, documents and delivery into one clear view.',
      url: 'https://example.com/atlas',
      repoUrl: 'https://github.com/example/atlas',
      tech: ['Angular', 'TypeScript', 'Design systems'],
      status: 'completed',
    },
    {
      title: 'Open trails',
      description:
        'Helping people find their next favourite place. A responsive discovery experience with considered navigation and a focus on inclusive design.',
      url: 'https://example.com/trails',
      repoUrl: 'https://github.com/example/trails',
      tech: ['Node.js', 'PostgreSQL', 'Accessibility'],
      status: 'completed',
    },
  ],
  upcomingProjects: [
    {
      title: 'Pulse Analytics',
      description: 'Privacy-preserving telemetry dashboard for engineering teams.',
      expectedDate: 'Q1 2027',
      tech: ['Angular', 'WebAssembly', 'DuckDB'],
      status: 'in-progress',
    },
  ],
  testimonials: [
    {
      name: 'Alex Morgan',
      role: 'Staff Product Designer',
      quote:
        'Maya brings clarity to complex problems and a remarkable level of care to the experience. A thoughtful collaborator from the first sketch to the final release.',
    },
    {
      name: 'David Kim',
      role: 'Engineering Lead',
      quote:
        'Exceptional attention to performance and accessibility. Maya elevated our team standards and delivered a stellar design system.',
    },
  ],
  workExperiences: [
    {
      title: 'Senior Product Engineer',
      description:
        'Led architecture of next-generation collaborative design canvas, improving render performance by 40% and WCAG AA compliance.',
      icon: 'rocket',
      ctaLabel: 'Case Study',
      ctaUrl: 'https://example.com/case-study',
    },
    {
      title: 'Design Systems Architect',
      description:
        'Created multi-brand component library adopted across 14 product teams, with full dark mode and keyboard navigation support.',
      icon: 'palette',
      ctaLabel: 'Docs',
      ctaUrl: 'https://example.com/ds',
    },
  ],
  completedCourses: [
    {
      title: 'Advanced Accessibility & Inclusive Design',
      provider: 'W3C Education Guild',
      completionDate: '2026-09-18',
      isVisible: true,
      description:
        'Practical approaches to keyboard navigation, semantic structure and screen-reader accessibility.',
      skills: ['Accessibility', 'ARIA'],
      certificateUrl: 'https://example.com/credential',
    },
  ],
  socialLinks: {
    github: 'https://github.com/example',
    linkedin: 'https://www.linkedin.com/in/example',
    website: 'https://example.com',
  },
  user: {
    name: owner.name,
    jobTitle: 'Senior Product Engineer',
    location: 'San Francisco, CA · Working globally',
    avatar: '',
    githubUsername: owner.githubUsername,
    email: owner.email,
  },
  email: owner.email,
  analytics: { totalViews: 42, uniqueViews: 38, lastViewedAt: '2026-11-12T14:30:00Z' },
  defaultResumeUrl: '/api/public-profiles/maya-chen/resume',
  resumeUrl: '/api/public-profiles/maya-chen/resume',
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

async function initPageContext(browser, { width, height, theme = 'dark', role = null, isOwner = false }) {
  const colorScheme = theme === 'system' ? 'dark' : theme;
  const context = await browser.newContext({
    viewport: { width, height },
    colorScheme,
    reducedMotion: 'reduce',
  });

  const account = role ? { ...owner, role } : (isOwner ? owner : null);

  await context.addInitScript(
    ({ themeVal, accountVal }) => {
      const exp = Math.floor(Date.now() / 1000) + 36000;
      const encode = (val) =>
        btoa(JSON.stringify(val)).replaceAll('=', '').replaceAll('+', '-').replaceAll('/', '_');
      
      localStorage.setItem('devinsight_theme', themeVal);
      localStorage.setItem('portfolio_fixture_initialized', '1');
      localStorage.setItem('devinsight_resume_prompt_permanent_dismiss', 'true');

      if (accountVal) {
        localStorage.setItem(
          'token',
          `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ id: accountVal._id, exp, iss: 'devinsight-api', aud: 'devinsight-web' })}.fixture`,
        );
        localStorage.setItem('user', JSON.stringify(accountVal));
        localStorage.setItem('loginExpiry', String(Date.now() + 3600000));
      }
    },
    { themeVal: theme, accountVal: account },
  );

  return context;
}

function attachRoutes(page, state) {
  return page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (url.pathname.startsWith('/uploads/portfolio-images/')) {
      return route.fulfill({ contentType: 'image/png', body: png });
    }

    if (!url.pathname.startsWith('/api/')) {
      return route.continue();
    }

    const json = (body, status = 200, headers = {}) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        headers,
        body: JSON.stringify(body),
      });

    // Public Profiles API
    if (url.pathname === '/api/public-profiles/me/analytics') {
      if (state.analyticsStatus !== 200) {
        return json({ message: 'Analytics unavailable.' }, state.analyticsStatus);
      }
      return json({
        totalViews: state.zero ? 0 : 42,
        uniqueViews: state.zero ? 0 : 38,
        lastViewedAt: state.zero ? null : '2026-11-12T14:30:00Z',
        last7Days: [2, 5, 4, 8, 3, 10, 10].map((count, i) => ({
          date: `2026-11-${6 + i}`,
          count: state.zero ? 0 : count,
        })),
      });
    }

    if (url.pathname === '/api/public-profiles/me/project-image') {
      return json(
        state.uploadStatus === 201
          ? { imageUrl: '/uploads/portfolio-images/fixture-cover.png' }
          : { message: 'Storage unavailable.' },
        state.uploadStatus || 201,
      );
    }

    if (url.pathname === '/api/public-profiles/me') {
      if (request.method() === 'PUT') {
        Object.assign(state.profile, request.postDataJSON());
        state.profile.defaultResumeUrl = '/api/public-profiles/me/resume';
        state.profile.sections.cta.resumeUrl = state.profile.defaultResumeUrl;
      }
      return json(state.profile);
    }

    if (url.pathname.startsWith('/api/public-profiles/')) {
      const parts = url.pathname.split('/');
      const slug = parts[3];

      if (parts[4] === 'contact') {
        if (state.contactStatus === 429) {
          return json({ message: 'Too many requests' }, 429, { 'Retry-After': '60' });
        }
        return json(
          state.contactStatus === 200 ? { sent: true } : { message: 'Contact delivery unavailable.' },
          state.contactStatus || 200,
        );
      }

      if (parts[4] === 'resume') {
        return route.fulfill({
          contentType: 'application/pdf',
          headers: { 'Content-Disposition': 'attachment; filename="maya-chen-resume.pdf"' },
          body: Buffer.from('%PDF-1.4\nSynthetic portfolio resume\n%%EOF'),
        });
      }

      if (state.readStatus && state.readStatus !== 200) {
        return json({ message: state.readStatus === 404 ? 'Not found.' : 'Public portfolio unavailable.' }, state.readStatus);
      }

      if (slug !== state.profile.slug) {
        return json({ message: 'Not found.' }, 404);
      }

      if (url.searchParams.has('preview')) {
        return json(state.profile);
      }

      const visible = structuredClone(state.profile);
      delete visible.email;
      delete visible.analytics;
      delete visible.user.email;
      visible.sections.contact.email = '';
      visible.momentum = null;
      visible.defaultResumeUrl = `/api/public-profiles/${slug}/resume`;
      visible.resumeUrl = visible.defaultResumeUrl;
      return json(visible);
    }

    if (url.pathname.includes('/profile')) {
      return json({
        ...owner,
        activeCareerStack: 'Full Stack',
        activeExperienceLevel: '3-5 years',
        activeGithubUsername: 'maya-chen',
        profileCompleted: true,
        resumeContext: { hasResume: true },
        stats: { memberSince: '2024-01-01' },
      });
    }

    if (url.pathname.includes('onboarding')) {
      return json({ hasResume: true, shouldPrompt: false, completed: true });
    }

    if (url.pathname.includes('notifications')) {
      return json({ notifications: [], unreadCount: 0 });
    }

    return json({});
  });
}

async function auditLayout(page, { name, componentSelector }) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);

  const measurement = await page.evaluate((selector) => {
    const doc = document.documentElement;
    const body = document.body;
    const scrollWidth = Math.max(doc.scrollWidth, body.scrollWidth);
    const clientWidth = doc.clientWidth || window.innerWidth;
    const hasDocOverflow = scrollWidth > clientWidth + 1;

    const comp = document.querySelector(selector);
    const compScrollWidth = comp ? comp.scrollWidth : 0;
    const compClientWidth = comp ? comp.clientWidth : 0;
    const hasCompOverflow = compScrollWidth > compClientWidth + 1;

    // Detect all overflowing elements
    const offenders = [];
    if (hasDocOverflow || hasCompOverflow) {
      const all = document.querySelectorAll(`${selector} *`);
      for (const el of all) {
        const r = el.getBoundingClientRect();
        if (r.right > clientWidth + 2) {
          offenders.push({
            tag: el.tagName.toLowerCase(),
            className: el.className ? String(el.className).slice(0, 70) : '',
            right: Math.round(r.right),
            width: Math.round(r.width),
            clientWidth,
            excess: Math.round(r.right - clientWidth),
          });
        }
      }
    }

    // Touch targets (< 40px interactive controls)
    const smallTargets = [];
    const interactives = document.querySelectorAll(
      `${selector} button, ${selector} a, ${selector} select, ${selector} input, ${selector} textarea, ${selector} summary`,
    );
    for (const el of interactives) {
      if (!el.checkVisibility()) continue;
      if (el.closest('.sr-only')) continue;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && (r.height < 36 || r.width < 36)) {
        smallTargets.push({
          tag: el.tagName.toLowerCase(),
          className: el.className ? String(el.className).slice(0, 60) : '',
          text: (el.innerText || el.getAttribute('aria-label') || '').slice(0, 30).trim(),
          width: Math.round(r.width),
          height: Math.round(r.height),
        });
      }
    }

    // Header & Section Spacing Check
    const brand = document.querySelector('.brand');
    const brandRect = brand ? brand.getBoundingClientRect() : null;

    return {
      scrollWidth,
      clientWidth,
      hasDocOverflow,
      compScrollWidth,
      compClientWidth,
      hasCompOverflow,
      overflowPx: Math.max(0, scrollWidth - clientWidth),
      offenders: offenders.slice(0, 8),
      smallTargets: smallTargets.slice(0, 10),
      brandWidth: brandRect ? Math.round(brandRect.width) : 0,
    };
  }, componentSelector);

  return measurement;
}

async function main() {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  console.log(`[audit-portfolio-responsive] Static server running at ${base} (Phase: ${phase})`);

  const browser = await chromium.launch({
    headless: true,
    executablePath: chromePath,
  });

  const matrixDir = path.join(outputDir, phase, 'matrix');
  const statesDir = path.join(outputDir, phase, 'states');
  const zoomDir = path.join(outputDir, phase, 'zoom');
  const orientDir = path.join(outputDir, phase, 'orientation');
  const studioDir = path.join(outputDir, phase, 'studio');
  fs.mkdirSync(matrixDir, { recursive: true });
  fs.mkdirSync(statesDir, { recursive: true });
  fs.mkdirSync(zoomDir, { recursive: true });
  fs.mkdirSync(orientDir, { recursive: true });
  fs.mkdirSync(studioDir, { recursive: true });

  const auditReport = {
    phase,
    timestamp: new Date().toISOString(),
    viewportsTested: VIEWPORTS.length,
    themesTested: THEMES.length,
    matrixResults: [],
    stateChecks: [],
    orientationChecks: [],
    zoomChecks: [],
    studioChecks: [],
    overflowDefects: [],
    touchTargetDefects: [],
  };

  try {
    // -------------------------------------------------------------------------
    // 1. Core Matrix: 12 Viewports x 3 Themes = 36 runs for Public Portfolio
    // -------------------------------------------------------------------------
    console.log(`\n=== 1. Starting 36-cell Viewport & Theme Matrix Audit for Public Portfolio (${phase}) ===`);
    for (const vp of VIEWPORTS) {
      for (const theme of THEMES) {
        const context = await initPageContext(browser, {
          width: vp.width,
          height: vp.height,
          theme,
        });

        const page = await context.newPage();
        const pageErrors = [];
        page.on('pageerror', (err) => pageErrors.push(err.message));

        const state = {
          profile: structuredClone(fixture),
          readStatus: 200,
          contactStatus: 200,
          uploadStatus: 201,
          analyticsStatus: 200,
          zero: false,
        };
        await attachRoutes(page, state);

        await page.goto(`${base}/p/maya-chen`);
        await page.locator('app-public-portfolio').waitFor({ timeout: 10000 });
        await page.locator('.hero-name').waitFor({ timeout: 10000 });
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(150);

        const measurement = await auditLayout(page, {
          name: `public-${vp.name}-${theme}`,
          componentSelector: 'app-public-portfolio',
        });

        const screenshotName = `public-${theme}-${vp.name}.png`;
        const screenshotPath = path.join(matrixDir, screenshotName);
        await page.screenshot({ path: screenshotPath, fullPage: false });

        const cellStatus = !measurement.hasDocOverflow && !measurement.hasCompOverflow ? 'PASS' : 'FAIL';
        console.log(
          `[Matrix] ${vp.name.padEnd(12)} | ${theme.padEnd(6)} | Doc: ${measurement.scrollWidth}/${measurement.clientWidth}px | Status: ${cellStatus}`,
        );

        if (cellStatus === 'FAIL') {
          auditReport.overflowDefects.push({
            viewport: vp.name,
            theme,
            overflowPx: measurement.overflowPx,
            offenders: measurement.offenders,
          });
        }

        if (measurement.smallTargets.length > 0) {
          auditReport.touchTargetDefects.push({
            viewport: vp.name,
            theme,
            smallTargets: measurement.smallTargets,
          });
        }

        auditReport.matrixResults.push({
          viewport: vp.name,
          category: vp.category,
          dimensions: `${vp.width}x${vp.height}`,
          theme,
          scrollWidth: measurement.scrollWidth,
          clientWidth: measurement.clientWidth,
          hasDocOverflow: measurement.hasDocOverflow,
          hasCompOverflow: measurement.hasCompOverflow,
          overflowPx: measurement.overflowPx,
          screenshot: screenshotName,
          status: cellStatus,
          errors: pageErrors,
        });

        await context.close();
      }
    }

    // -------------------------------------------------------------------------
    // 2. Interactive Workflows & UI States
    // -------------------------------------------------------------------------
    console.log(`\n=== 2. Dedicated Interactive Workflows & UI States (${phase}) ===`);

    // State A: Owner Preview Mode (sticky top preview mode strip)
    for (const testVp of [
      { name: 'mobile-375', width: 375, height: 667 },
      { name: 'tablet-768', width: 768, height: 1024 },
      { name: 'desktop-1440', width: 1440, height: 900 },
    ]) {
      const context = await initPageContext(browser, {
        width: testVp.width,
        height: testVp.height,
        theme: 'dark',
        isOwner: true,
      });
      const page = await context.newPage();
      const state = { profile: structuredClone(fixture), readStatus: 200 };
      await attachRoutes(page, state);
      await page.goto(`${base}/p/maya-chen?preview=true`);
      await page.locator('.preview-mode-bar').waitFor({ timeout: 10000 });
      await page.waitForTimeout(150);

      const m = await auditLayout(page, {
        name: `owner-preview-${testVp.name}`,
        componentSelector: 'app-public-portfolio',
      });
      const shot = `owner-preview-${testVp.name}.png`;
      await page.screenshot({ path: path.join(statesDir, shot) });

      auditReport.stateChecks.push({
        state: 'Owner Preview Strip',
        viewport: testVp.name,
        overflowPx: m.overflowPx,
        status: m.hasDocOverflow ? 'FAIL' : 'PASS',
        screenshot: shot,
      });
      console.log(`[State] Owner Preview Strip (${testVp.name}): ${m.hasDocOverflow ? 'FAIL' : 'PASS'}`);
      await context.close();
    }

    // State B: Recruiter Enquiry Modal & Form Submission
    for (const testVp of [
      { name: 'mobile-375', width: 375, height: 667 },
      { name: 'desktop-1440', width: 1440, height: 900 },
    ]) {
      const context = await initPageContext(browser, {
        width: testVp.width,
        height: testVp.height,
        theme: 'dark',
        role: 'recruiter',
      });
      const page = await context.newPage();
      const state = { profile: structuredClone(fixture), readStatus: 200, contactStatus: 200 };
      await attachRoutes(page, state);
      await page.goto(`${base}/p/maya-chen#contact`);
      await page.locator('#contact-message').waitFor({ timeout: 10000 });

      // Fill message
      await page.locator('#contact-message').fill('We are excited to discuss a Senior Product Engineer role at our company.');
      await page.waitForTimeout(100);

      const m = await auditLayout(page, {
        name: `recruiter-form-${testVp.name}`,
        componentSelector: 'app-public-portfolio',
      });
      const shot = `recruiter-form-${testVp.name}.png`;
      await page.screenshot({ path: path.join(statesDir, shot) });

      // Submit and verify success state
      await page.getByRole('button', { name: 'Send enquiry' }).click();
      await page.getByText('Message accepted for delivery').waitFor({ timeout: 10000 });
      const successShot = `recruiter-success-${testVp.name}.png`;
      await page.screenshot({ path: path.join(statesDir, successShot) });

      auditReport.stateChecks.push({
        state: 'Recruiter Enquiry & Success',
        viewport: testVp.name,
        overflowPx: m.overflowPx,
        status: m.hasDocOverflow ? 'FAIL' : 'PASS',
        screenshot: shot,
      });
      console.log(`[State] Recruiter Enquiry & Success (${testVp.name}): ${m.hasDocOverflow ? 'FAIL' : 'PASS'}`);
      await context.close();
    }

    // State C: Anonymous / Non-Recruiter Restricted View
    {
      const context = await initPageContext(browser, { width: 375, height: 667, theme: 'light' });
      const page = await context.newPage();
      const state = { profile: structuredClone(fixture), readStatus: 200 };
      await attachRoutes(page, state);
      await page.goto(`${base}/p/maya-chen#contact`);
      await page.locator('.contact-restricted').waitFor({ timeout: 10000 });
      const m = await auditLayout(page, {
        name: 'contact-restricted-mobile-375',
        componentSelector: 'app-public-portfolio',
      });
      const shot = 'contact-restricted-mobile-375.png';
      await page.screenshot({ path: path.join(statesDir, shot) });
      auditReport.stateChecks.push({
        state: 'Non-Recruiter Restricted Notice',
        viewport: 'mobile-375',
        overflowPx: m.overflowPx,
        status: m.hasDocOverflow ? 'FAIL' : 'PASS',
        screenshot: shot,
      });
      console.log(`[State] Non-Recruiter Restricted Notice: ${m.hasDocOverflow ? 'FAIL' : 'PASS'}`);
      await context.close();
    }

    // State D: Error 404 & Error 503 States
    for (const errCode of [404, 503]) {
      const context = await initPageContext(browser, { width: 375, height: 667, theme: 'dark' });
      const page = await context.newPage();
      const state = { profile: structuredClone(fixture), readStatus: errCode };
      await attachRoutes(page, state);
      await page.goto(`${base}/p/maya-chen`);
      await page.locator('.page-state').waitFor({ timeout: 10000 });
      const m = await auditLayout(page, {
        name: `error-${errCode}-mobile-375`,
        componentSelector: 'app-public-portfolio',
      });
      const shot = `error-${errCode}-mobile-375.png`;
      await page.screenshot({ path: path.join(statesDir, shot) });
      auditReport.stateChecks.push({
        state: `Error ${errCode} Page State`,
        viewport: 'mobile-375',
        overflowPx: m.overflowPx,
        status: m.hasDocOverflow ? 'FAIL' : 'PASS',
        screenshot: shot,
      });
      console.log(`[State] Error ${errCode} Page State: ${m.hasDocOverflow ? 'FAIL' : 'PASS'}`);
      await context.close();
    }

    // -------------------------------------------------------------------------
    // 3. Landscape Orientations
    // -------------------------------------------------------------------------
    console.log(`\n=== 3. Landscape Orientations (${phase}) ===`);
    const orientations = [
      { name: 'mobile-375-landscape', width: 667, height: 375 },
      { name: 'mobile-390-landscape', width: 844, height: 390 },
      { name: 'mobile-430-landscape', width: 932, height: 430 },
      { name: 'tablet-1024-portrait', width: 768, height: 1024 },
    ];
    for (const orient of orientations) {
      const context = await initPageContext(browser, {
        width: orient.width,
        height: orient.height,
        theme: 'dark',
      });
      const page = await context.newPage();
      const state = { profile: structuredClone(fixture), readStatus: 200 };
      await attachRoutes(page, state);
      await page.goto(`${base}/p/maya-chen`);
      await page.locator('.hero-name').waitFor({ timeout: 10000 });
      await page.waitForTimeout(150);

      const m = await auditLayout(page, {
        name: orient.name,
        componentSelector: 'app-public-portfolio',
      });
      const shot = `${orient.name}.png`;
      await page.screenshot({ path: path.join(orientDir, shot) });
      auditReport.orientationChecks.push({
        orientation: orient.name,
        dimensions: `${orient.width}x${orient.height}`,
        overflowPx: m.overflowPx,
        status: m.hasDocOverflow ? 'FAIL' : 'PASS',
        screenshot: shot,
      });
      console.log(`[Orientation] ${orient.name.padEnd(22)}: ${m.hasDocOverflow ? 'FAIL' : 'PASS'}`);
      await context.close();
    }

    // -------------------------------------------------------------------------
    // 4. Zoom & Text Scaling Matrix (125%, 150%)
    // -------------------------------------------------------------------------
    console.log(`\n=== 4. Zoom & Text Scaling Checks (${phase}) ===`);
    const zoomTests = [
      { name: 'mobile-375-zoom125', width: 300, height: 533, scale: 1.25 },
      { name: 'mobile-375-zoom150', width: 250, height: 444, scale: 1.5 },
      { name: 'desktop-1440-zoom125', width: 1152, height: 720, scale: 1.25 },
      { name: 'desktop-1440-zoom150', width: 960, height: 600, scale: 1.5 },
    ];
    for (const z of zoomTests) {
      const context = await initPageContext(browser, {
        width: z.width,
        height: z.height,
        theme: 'dark',
      });
      const page = await context.newPage();
      const state = { profile: structuredClone(fixture), readStatus: 200 };
      await attachRoutes(page, state);
      await page.goto(`${base}/p/maya-chen`);
      await page.locator('.hero-name').waitFor({ timeout: 10000 });
      await page.waitForTimeout(150);

      const m = await auditLayout(page, {
        name: z.name,
        componentSelector: 'app-public-portfolio',
      });
      const shot = `${z.name}.png`;
      await page.screenshot({ path: path.join(zoomDir, shot) });
      auditReport.zoomChecks.push({
        zoom: z.name,
        effectiveDimensions: `${z.width}x${z.height}`,
        scale: `${z.scale * 100}%`,
        overflowPx: m.overflowPx,
        status: m.hasDocOverflow ? 'FAIL' : 'PASS',
        screenshot: shot,
      });
      console.log(`[Zoom] ${z.name.padEnd(24)}: ${m.hasDocOverflow ? 'FAIL' : 'PASS'}`);
      await context.close();
    }

    // -------------------------------------------------------------------------
    // 5. Portfolio Studio Settings Page (/app/portfolio)
    // -------------------------------------------------------------------------
    console.log(`\n=== 5. Portfolio Studio Settings Page Audit (${phase}) ===`);
    for (const testVp of [
      { name: 'mobile-320', width: 320, height: 640 },
      { name: 'mobile-375', width: 375, height: 667 },
      { name: 'tablet-768', width: 768, height: 1024 },
      { name: 'desktop-1440', width: 1440, height: 900 },
    ]) {
      const context = await initPageContext(browser, {
        width: testVp.width,
        height: testVp.height,
        theme: 'dark',
        role: 'developer',
      });
      const page = await context.newPage();
      const state = {
        profile: structuredClone(fixture),
        readStatus: 200,
        analyticsStatus: 200,
      };
      await attachRoutes(page, state);
      await page.goto(`${base}/app/portfolio`);
      await page.locator('app-portfolio-settings').waitFor({ timeout: 10000 });
      await page.locator('.settings-tabs').waitFor({ timeout: 10000 });
      await page.waitForTimeout(200);

      const m = await auditLayout(page, {
        name: `studio-${testVp.name}`,
        componentSelector: 'app-portfolio-settings',
      });
      const shot = `studio-${testVp.name}.png`;
      await page.screenshot({ path: path.join(studioDir, shot) });

      auditReport.studioChecks.push({
        viewport: testVp.name,
        overflowPx: m.overflowPx,
        offenders: m.offenders,
        status: m.hasDocOverflow ? 'FAIL' : 'PASS',
        screenshot: shot,
      });
      console.log(`[Studio] ${testVp.name.padEnd(16)}: ${m.hasDocOverflow ? 'FAIL' : 'PASS'} (Overflow: ${m.overflowPx}px)`);
      await context.close();
    }

    // Save report json
    const jsonPath = path.join(outputDir, `${phase}-results.json`);
    fs.writeFileSync(jsonPath, JSON.stringify(auditReport, null, 2), 'utf8');
    console.log(`\nAudit complete. Saved results to ${jsonPath}`);
    console.log(`Total overflow defects: ${auditReport.overflowDefects.length}`);
    console.log(`Total touch target defects: ${auditReport.touchTargetDefects.length}`);
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  console.error('[audit-portfolio-responsive] FATAL ERROR:', err);
  process.exit(1);
});
