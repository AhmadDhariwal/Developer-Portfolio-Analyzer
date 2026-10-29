const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const express = require('express');
const jwt = require('jsonwebtoken');

async function main() {
  const { chromium } = require(process.env.PROFILE_ACCEPTANCE_PLAYWRIGHT || 'playwright');
  const output = path.resolve(__dirname, '../../verification/profile');
  await fs.mkdir(output, { recursive: true });
  const user = {
    _id: '0123456789abcdef01234567',
    name: 'Profile Fixture',
    email: 'profile@example.test',
    role: 'developer',
    githubUsername: 'octocat',
    activeGithubUsername: 'octocat',
    avatar: '',
    jobTitle: 'Developer',
    location: 'Karachi',
    bio: 'Fixture biography',
    website: '',
    twitter: '',
    linkedin: '',
    careerStack: 'Frontend',
    activeCareerStack: 'Backend',
    experienceLevel: 'Student',
    activeExperienceLevel: 'Intern',
    careerGoal: 'Improve portfolio',
    targetTimeline: 'Immediately',
    learningPreference: 'Reading',
    isConfigured: true,
    isPublic: false,
    notifications: {
      weeklyScoreReport: true,
      skillTrendAlerts: true,
      newRecommendations: false,
      jobMatchAlerts: true
    },
    stats: { developerScore: 50, reposAnalyzed: 2, skillsDetected: 3, memberSince: 'Oct 2026' },
    profileHash: 'fixture-a'
  };
  const token = jwt.sign({ id: user._id }, 'fixture-browser-key', {
    issuer: 'devinsight-api',
    audience: 'devinsight-web',
    expiresIn: '1h'
  });
  let writes = 0;
  const app = express();
  app.use(express.json());
  app.use('/api', (req, res) => {
    if (req.path === '/profile/me' && req.method === 'GET') return res.json(user);
    if (req.path === '/profile/me' && req.method === 'PUT') {
      writes++;
      Object.assign(user, req.body, {
        notifications: { ...user.notifications, ...req.body.notifications }
      });
      return res.json(user);
    }
    if (req.path === '/profile/career') {
      Object.assign(user, req.body, {
        activeCareerStack: req.body.careerStack,
        activeExperienceLevel: req.body.experienceLevel,
        profileHash: 'fixture-b'
      });
      return res.json(user);
    }
    if (req.path === '/profile/visibility') {
      user.isPublic = req.body.isPublic;
      return res.json({ isPublic: user.isPublic });
    }
    if (req.path === '/profile/password')
      return res.status(401).json({
        code: 'CURRENT_PASSWORD_INCORRECT',
        message: 'Current password is incorrect.'
      });
    if (req.path === '/profile/me' && req.method === 'DELETE')
      return res
        .status(409)
        .json({ message: 'Transfer organization ownership before deleting this account.' });
    if (req.path.includes('stream')) return res.status(204).end();
    return res.json({
      notifications: [],
      unreadCount: 0,
      items: [],
      settings: {},
      maintenanceMode: false
    });
  });
  const dist = path.resolve(__dirname, '../../../frontend/dist/frontend/browser');
  app.use(express.static(dist));
  app.get('/{*path}', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  const server = await new Promise((resolve) => {
    const handle = app.listen(0, '127.0.0.1', () => resolve(handle));
  });
  let browser;
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({
      headless: true,
      executablePath:
        process.env.PROFILE_ACCEPTANCE_CHROME ||
        'C:/Program Files/Google/Chrome/Application/chrome.exe'
    });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.route('**/*', (route) =>
      route.request().url().startsWith(base) ? route.continue() : route.abort()
    );
    await context.addInitScript(
      ({ token, user }) => {
        if (!localStorage.getItem('token')) {
          localStorage.setItem('token', token);
          localStorage.setItem('user', JSON.stringify(user));
          localStorage.setItem('loginExpiry', String(Date.now() + 3600000));
        }
      },
      { token, user }
    );
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${base}/app/profile`);
    await page.locator('#profile-full-name').waitFor();
    assert.equal(
      await page.locator('#profile-career-stack').inputValue(),
      'Frontend',
      'settings shows permanent base, while active context differs'
    );
    await page.locator('.btn-save-main').click();
    await page.getByText('No changes detected to save.').waitFor();
    assert.equal(writes, 0);
    await page.locator('#profile-full-name').fill('Edited Fixture');
    await page.locator('#profile-bio').fill('b'.repeat(500));
    await page.locator('.btn-save-main').click();
    await page.getByText('Profile saved successfully!').waitFor();
    assert.equal(user.bio.length, 500);
    assert.equal(writes, 1);
    await page.reload();
    await page.locator('#profile-full-name').waitFor();
    assert.equal(await page.locator('#profile-full-name').inputValue(), 'Edited Fixture');
    await page.getByText('Change Password', { exact: true }).click();
    await page.locator('#profile-current-password').fill('wrong');
    await page.locator('#profile-new-password').fill('Updated-password-2!');
    await page.locator('#profile-confirm-password').fill('Updated-password-2!');
    await page.getByRole('button', { name: 'Update Password', exact: true }).click();
    await page.getByText('Current password is incorrect.').waitFor();
    assert.equal(
      await page.getByRole('button', { name: 'Update Password', exact: true }).isEnabled(),
      true
    );
    await page.getByRole('button', { name: 'Delete Account', exact: true }).click();
    await page.getByRole('button', { name: 'Yes, Delete Account', exact: true }).click();
    await page
      .getByText('Transfer organization ownership before deleting this account.')
      .waitFor();
    await page.evaluate(() => scrollTo(0, 0));
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)
    );
    await page.screenshot({ path: path.join(output, 'profile-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(
      () => document.querySelector('.shell-body')?.getBoundingClientRect().left < 1
    );
    await page.waitForFunction(() =>
      Array.from(document.querySelectorAll('.prof-card')).every((card) => {
        const box = card.getBoundingClientRect();
        return box.left >= 0 && box.right <= innerWidth + 2;
      })
    );
    await page.evaluate(() => scrollTo(0, 0));
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2),
      'mobile has no horizontal overflow'
    );
    await page.screenshot({ path: path.join(output, 'profile-mobile.png'), fullPage: true });
    assert.deepEqual(errors, []);
    await fs.writeFile(
      path.join(output, 'browser-results.json'),
      JSON.stringify(
        {
          status: 'passed',
          frontend: 'production build',
          backend: 'explicit fixture HTTP responses',
          viewports: ['1440x1000', '390x844'],
          checks: [
            'base versus active career display',
            'unchanged save sends no write',
            '500-character biography save',
            'refresh persistence',
            'password failure feedback/loading reset',
            'deletion conflict feedback/loading reset',
            'desktop/mobile overflow',
            'no browser exceptions'
          ],
          externalRequests: 'blocked',
          writes,
          errors
        },
        null,
        2
      )
    );
    console.log(
      'Profile browser acceptance passed (desktop/mobile, fixture APIs, external requests blocked).'
    );
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
