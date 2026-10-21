// Controlled browser verification only. No real credentials or backend requests.
// Start ng serve on 4220, then set PORTFOLIO_PLAYWRIGHT_MODULE to the installed
// Playwright module when it is provided by the desktop runtime rather than npm.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require(process.env.PORTFOLIO_PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.PORTFOLIO_PREVIEW_URL || 'http://127.0.0.1:4220';
const polishOnly = process.env.PORTFOLIO_VERIFY_SCOPE === 'polish';
assert.ok(
  ['127.0.0.1', 'localhost'].includes(new URL(base).hostname),
  'Local fixture target required',
);
const output = path.resolve(__dirname, '../verification/public-portfolio');
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aC1sAAAAASUVORK5CYII=',
  'base64',
);
const sections = {
  hero: {
    greetingLabel: 'Hello, I’m',
    roleLabel: '',
    titleLineOne: 'Thoughtful products.',
    titleLineTwo: 'Built to',
    titleHighlight: 'make a difference.',
    titleLineSuffix: '',
    tagline: 'Design-minded. Detail-driven. Always curious.',
  },
  skills: {
    headline: '',
    highlight: '',
    headlineSuffix: '',
    subheadline: 'The tools I use to turn complex problems into simple experiences.',
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
};
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
  sections,
  skills: [
    'TypeScript',
    'Angular',
    'Node.js',
    'PostgreSQL',
    'Accessibility',
    'Design systems',
    'Figma',
  ].map((name) => ({ name, score: 0 })),
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
      repoUrl: '',
      tech: ['Node.js', 'PostgreSQL', 'Accessibility'],
      status: 'completed',
    },
  ],
  upcomingProjects: [],
  testimonials: [
    {
      name: 'Alex Morgan',
      role: 'Product designer · synthetic fixture',
      quote:
        'Maya brings clarity to complex problems and a remarkable level of care to the experience. A thoughtful collaborator from the first sketch to the final release.',
    },
  ],
  workExperiences: [
    {
      title: 'Product engineering',
      description:
        'Working across the product lifecycle: defining the problem, prototyping a useful solution, and delivering maintainable, accessible software.',
      icon: '',
      ctaLabel: '',
      ctaUrl: '',
    },
  ],
  completedCourses: [
    {
      title: 'Accessible interface design',
      provider: 'Learning programme · synthetic fixture',
      completionDate: '2026-09-18',
      isVisible: true,
      description:
        'Practical approaches to keyboard navigation, semantic structure and inclusive interaction.',
      skills: ['Accessibility'],
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
    jobTitle: 'Product engineer',
    location: 'Singapore · Working globally',
    avatar: '',
    githubUsername: owner.githubUsername,
    email: owner.email,
  },
  email: owner.email,
  analytics: { totalViews: 18, uniqueViews: 18, lastViewedAt: '2026-10-20T08:00:00Z' },
  defaultResumeUrl: '/api/public-profiles/me/resume',
  resumeUrl: '/api/public-profiles/me/resume',
};
const results = {
  synthetic: true,
  target: base,
  checks: [],
  screenshots: [],
  pageErrors: [],
  apiRequests: [],
};
let browser;
let diagnosticPage;
async function session(role = null) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'reduce',
  });
  const account = role ? { ...owner, role } : null;
  const state = {
    profile: structuredClone(fixture),
    readStatus: 200,
    contactStatus: 200,
    uploadStatus: 201,
    analyticsStatus: 200,
    zero: false,
  };
  await context.addInitScript(
    ({ account, origin }) => {
      if (location.origin !== origin) return;
      if (localStorage.getItem('portfolio_fixture_initialized')) return;
      localStorage.setItem('portfolio_fixture_initialized', '1');
      localStorage.setItem('devinsight_theme', 'light');
      localStorage.setItem('devinsight_resume_prompt_permanent_dismiss', 'true');
      if (account) {
        const encode = (value) =>
          btoa(JSON.stringify(value)).replaceAll('=', '').replaceAll('+', '-').replaceAll('/', '_');
        localStorage.setItem(
          'token',
          `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ id: account._id, exp: Math.floor(Date.now() / 1000) + 3600, iss: 'devinsight-api', aud: 'devinsight-web' })}.fixture`,
        );
        localStorage.setItem('user', JSON.stringify(account));
        localStorage.setItem('loginExpiry', String(Date.now() + 3600000));
      }
    },
    { account, origin: new URL(base).origin },
  );
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== new URL(base).origin) return route.abort();
    if (url.pathname.startsWith('/uploads/portfolio-images/'))
      return route.fulfill({ contentType: 'image/png', body: png });
    if (!url.pathname.startsWith('/api/')) return route.continue();
    results.apiRequests.push({ method: request.method(), path: url.pathname });
    const json = (body, status = 200, headers = {}) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        headers,
        body: JSON.stringify(body),
      });
    const profile = state.profile;
    if (url.pathname === '/api/public-profiles/me/analytics') {
      if (state.analyticsStatus !== 200)
        return json({ message: 'Analytics unavailable.' }, state.analyticsStatus);
      return json({
        totalViews: state.zero ? 0 : 18,
        uniqueViews: state.zero ? 0 : 18,
        lastViewedAt: state.zero ? null : '2026-10-20T08:00:00Z',
        last7Days: [1, 3, 2, 5, 0, 4, 3].map((count, i) => ({
          date: `2026-10-${14 + i}`,
          count: state.zero ? 0 : count,
        })),
      });
    }
    if (url.pathname === '/api/public-profiles/me/project-image')
      return json(
        state.uploadStatus === 201
          ? { imageUrl: '/uploads/portfolio-images/fixture-cover.png' }
          : { message: 'Storage unavailable.' },
        state.uploadStatus,
      );
    if (url.pathname === '/api/public-profiles/me') {
      if (request.method() === 'PUT') {
        Object.assign(profile, request.postDataJSON());
        profile.defaultResumeUrl = '/api/public-profiles/me/resume';
        profile.sections.cta.resumeUrl = profile.defaultResumeUrl;
      }
      return json(profile);
    }
    if (url.pathname.startsWith('/api/public-profiles/')) {
      const parts = url.pathname.split('/');
      const slug = parts[3];
      if (parts[4] === 'contact')
        return json(
          state.contactStatus === 200 ? { sent: true } : { message: 'Contact unavailable.' },
          state.contactStatus,
          state.contactStatus === 429 ? { 'Retry-After': '60' } : {},
        );
      if (parts[4] === 'resume') {
        if (
          slug !== 'me' &&
          (!profile.isPublic || slug !== profile.slug || !profile.sections.visibility.cta)
        )
          return json({ message: 'Not available.' }, 404);
        return route.fulfill({
          contentType: 'application/pdf',
          headers: { 'Content-Disposition': 'attachment; filename="portfolio.pdf"' },
          body: Buffer.from('%PDF-1.4\nSynthetic fixture\n%%EOF'),
        });
      }
      if (state.readStatus !== 200)
        return json({ message: 'Public profile unavailable.' }, state.readStatus);
      if (slug !== profile.slug || (!profile.isPublic && !url.searchParams.has('preview')))
        return json({ message: 'Not found.' }, 404);
      if (url.searchParams.has('preview'))
        return account ? json(profile) : json({ message: 'Not found.' }, 404);
      const visible = structuredClone(profile);
      delete visible.email;
      delete visible.analytics;
      delete visible.user.email;
      visible.sections.contact.email = '';
      visible.momentum = null;
      visible.defaultResumeUrl = `/api/public-profiles/${slug}/resume`;
      visible.resumeUrl = visible.defaultResumeUrl;
      return json(visible);
    }
    if (url.pathname.includes('/profile'))
      return json({
        ...owner,
        activeCareerStack: 'Full Stack',
        activeExperienceLevel: '3-5 years',
        activeGithubUsername: 'maya-chen',
        profileCompleted: true,
        resumeContext: { hasResume: true },
        stats: { memberSince: '2024-01-01' },
      });
    if (url.pathname.includes('onboarding'))
      return json({ hasResume: true, shouldPrompt: false, completed: true });
    if (url.pathname.includes('notifications')) return json({ notifications: [], unreadCount: 0 });
    if (url.pathname.includes('organizations')) return json({ organizations: [] });
    return json({});
  });
  context.on('page', (page) => {
    page.on('pageerror', (error) => results.pageErrors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error' && /NG0|ERROR|SecurityError/.test(message.text()))
        console.error(message.text());
    });
  });
  const page = await context.newPage();
  diagnosticPage = page;
  page.setDefaultTimeout(15000);
  return { context, page, state };
}
async function checkLayout(page, name, component) {
  await page.evaluate(() => document.fonts.ready);
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    true,
    `Horizontal overflow: ${name}`,
  );
  const family = await page
    .locator(`${component} h1`)
    .first()
    .evaluate((element) => getComputedStyle(element).fontFamily);
  assert.ok(family.includes('Manrope'), `Manrope missing: ${family}`);
  await page.screenshot({
    path: path.join(output, name + '.png'),
    fullPage: false,
    animations: 'disabled',
  });
  results.screenshots.push(name + '.png');
}
async function run() {
  await fs.mkdir(output, { recursive: true });
  browser = await chromium.launch({
    headless: true,
    channel: process.env.PORTFOLIO_BROWSER_CHANNEL || 'msedge',
  });
  try {
    if (polishOnly) {
      const publicView = await session();
      await publicView.page.goto(base + '/p/maya-chen');
      await publicView.page.getByRole('heading', { name: 'Maya Chen', exact: true }).waitFor();
      await checkLayout(publicView.page, 'public-light-desktop', 'app-public-portfolio');
      await publicView.context.close();
      const studio = await session('developer');
      await studio.page.goto(base + '/app/portfolio');
      await studio.page.getByRole('heading', { name: 'Portfolio studio' }).waitFor();
      assert.equal(await studio.page.locator('.step-label').last().innerText(), 'Tue');
      await checkLayout(studio.page, 'settings-light-desktop', 'app-portfolio-settings');
      results.checks.push('Final typography/label polish and UTC analytics calendar label');
      await studio.context.close();
      results.status = 'VERIFIED';
      return;
    }
    const anonymous = await session();
    const page = anonymous.page;
    await page.goto(base + '/p/maya-chen');
    console.log('Public preview loaded');
    await page.getByRole('heading', { name: 'Maya Chen', exact: true }).waitFor();
    assert.ok(!(await page.locator('main').innerText()).includes(owner.email));
    for (const width of [1440, 390])
      for (const theme of ['light', 'dark']) {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
        await page.getByLabel('Appearance', { exact: true }).selectOption(theme);
        await checkLayout(
          page,
          `public-${theme}-${width === 390 ? 'mobile' : 'desktop'}`,
          'app-public-portfolio',
        );
      }
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.getByLabel('Appearance', { exact: true }).selectOption('system');
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
    await page.emulateMedia({ colorScheme: 'light' });
    await page.waitForFunction(
      () => document.documentElement.getAttribute('data-theme') === 'light',
    );
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
    results.checks.push(
      'Public Light/Dark desktop/mobile, System preference, Manrope and no horizontal overflow',
    );
    anonymous.state.readStatus = 503;
    await page.reload();
    await page.getByText('Temporarily unavailable.', { exact: false }).waitFor();
    assert.equal(await page.locator('app-project-card').count(), 0);
    anonymous.state.readStatus = 404;
    await page.getByRole('button', { name: 'Try again' }).click();
    await page.getByRole('heading', { name: 'Nothing public here yet.' }).waitFor();
    results.checks.push('503 and 404 clear prior portfolio content');
    await anonymous.context.close();
    const recruiter = await session('recruiter');
    await recruiter.page.goto(base + '/p/maya-chen');
    await recruiter.page
      .getByLabel('Your message')
      .fill('I would like to discuss a product engineering opportunity with your team.');
    for (const status of [503, 429, 403, 200]) {
      recruiter.state.contactStatus = status;
      await recruiter.page.getByRole('button', { name: 'Send enquiry' }).click();
      await recruiter.page
        .getByText(
          status === 503
            ? 'Message delivery is unavailable.'
            : status === 429
              ? 'Try again in 60 seconds.'
              : status === 403
                ? 'Your account does not have access'
                : 'Message accepted for delivery.',
          { exact: false },
        )
        .waitFor();
    }
    results.checks.push(
      'Recruiter contact handles 503, 429/Retry-After, 403 and server acknowledgement',
    );
    await recruiter.context.close();
    const studio = await session('developer');
    await studio.page.goto(base + '/app/portfolio');
    await studio.page.getByRole('heading', { name: 'Portfolio studio' }).waitFor();
    const settings = studio.page.locator('app-portfolio-settings');
    for (const width of [1440, 390])
      for (const theme of ['light', 'dark']) {
        await studio.page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
        await settings.getByLabel('Appearance', { exact: true }).selectOption(theme);
        await checkLayout(
          studio.page,
          `settings-${theme}-${width === 390 ? 'mobile' : 'desktop'}`,
          'app-portfolio-settings',
        );
      }
    await settings.getByRole('button', { name: 'Projects', exact: true }).click();
    await settings
      .locator('input[type=file]')
      .first()
      .setInputFiles({ name: 'bad.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg>') });
    await settings.getByText('Choose a PNG, JPG or WebP image up to 2 MiB.').waitFor();
    studio.state.uploadStatus = 503;
    await settings
      .locator('input[type=file]')
      .first()
      .setInputFiles({ name: 'cover.png', mimeType: 'image/png', buffer: png });
    await settings.getByText('Temporarily unavailable.', { exact: false }).waitFor();
    studio.state.uploadStatus = 201;
    await settings
      .locator('input[type=file]')
      .first()
      .setInputFiles({ name: 'cover.png', mimeType: 'image/png', buffer: png });
    await studio.page.waitForFunction(
      () =>
        document.querySelector('#project-image-0')?.value ===
        '/uploads/portfolio-images/fixture-cover.png',
    );
    results.checks.push('Upload validation, local preview, server failure and accepted image URL');
    await settings.getByRole('button', { name: 'Profile & copy', exact: true }).click();
    const observer = await studio.context.newPage();
    await observer.goto(base + '/p/maya-chen');
    await observer.getByRole('heading', { name: 'Maya Chen', exact: true }).waitFor();
    await studio.page.bringToFront();
    await settings.locator('#slug-input').fill('maya-renamed');
    await settings.locator('#visibility-toggle').uncheck();
    await settings.getByRole('button', { name: 'Save changes', exact: true }).click();
    await settings.getByText('Portfolio changes saved.').waitFor();
    assert.equal(studio.state.profile.slug, 'maya-renamed');
    assert.equal(studio.state.profile.isPublic, false);
    await observer.bringToFront();
    await observer.getByRole('heading', { name: 'Nothing public here yet.' }).waitFor();
    results.checks.push(
      'Saved slug/unpublish acknowledged; another tab clears cached public state',
    );
    await studio.page.bringToFront();
    const previewPromise = studio.context.waitForEvent('page');
    await settings.getByRole('button', { name: 'Preview', exact: true }).click();
    const preview = await previewPromise;
    await preview.getByRole('heading', { name: 'Maya Chen', exact: true }).waitFor();
    assert.equal(
      await preview.locator('meta[name=robots]').getAttribute('content'),
      'noindex, nofollow',
    );
    assert.ok(!(await preview.locator('main').innerText()).includes(owner.email));
    assert.equal(await preview.locator('meta[property="og:title"]').count(), 0);
    results.checks.push(
      'Authenticated saved preview has no private contacts, public SEO or contact delivery',
    );
    await preview.close();
    studio.state.analyticsStatus = 503;
    await studio.page.reload();
    await settings.getByRole('button', { name: 'Retry analytics' }).waitFor();
    studio.state.analyticsStatus = 200;
    studio.state.zero = true;
    await settings.getByRole('button', { name: 'Retry analytics' }).click();
    await settings.getByText('No recorded views yet.', { exact: false }).waitFor();
    results.checks.push('Analytics unavailable and true-zero states remain distinct');
    await studio.context.close();
    assert.deepEqual(results.pageErrors, []);
    results.status = 'VERIFIED';
  } finally {
    if (!results.status && diagnosticPage && !diagnosticPage.isClosed()) {
      console.error(
        'Preview diagnostic:',
        diagnosticPage.url(),
        (await diagnosticPage.locator('body').innerText()).slice(0, 1800),
      );
      console.error(
        await diagnosticPage
          .locator('script')
          .evaluateAll((elements) => elements.map((element) => element.src)),
      );
    }
    await fs.writeFile(
      path.join(output, polishOnly ? 'polish-results.json' : 'browser-results.json'),
      JSON.stringify(results, null, 2),
    );
    await browser?.close();
  }
}
run()
  .then(() =>
    console.log(
      JSON.stringify({
        status: results.status,
        checks: results.checks.length,
        screenshots: results.screenshots.length,
        pageErrors: results.pageErrors,
      }),
    ),
  )
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
