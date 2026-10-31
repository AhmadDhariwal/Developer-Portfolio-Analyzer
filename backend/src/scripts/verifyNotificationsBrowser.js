// Synthetic loopback acceptance only. Uses the real notification routes and a
// disposable replica set; unrelated modules/providers are isolated HTTP fixtures.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const express = require('express');
const mongoose = require('mongoose');
const { startMongo } = require('../tests/fixtures/disposableRequestMongo');

async function main() {
  const { chromium } = require(process.env.NOTIFICATION_ACCEPTANCE_PLAYWRIGHT || 'playwright');
  const output = path.resolve(__dirname, '../../../frontend/verification/notifications');
  await fs.mkdir(output, { recursive: true });
  const runtime = await startMongo({ replicaSet: 'notification-browser', temporaryRoot: output });
  const originalSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = randomBytes(32).toString('hex');
  const results = {
    synthetic: true,
    productionDataUsed: false,
    checks: [],
    screenshots: [],
    errors: []
  };
  let browser;
  let server;
  try {
    await mongoose.connect(runtime.uri, { autoIndex: false });
    const User = require('../models/user');
    const Notification = require('../models/notification');
    for (const Model of [
      User,
      Notification,
      require('../models/notificationReceipt'),
      require('../models/notificationState'),
      require('../models/membership')
    ]) {
      await Model.createCollection();
      await Model.createIndexes();
    }
    const owner = await User.create({
      name: 'Notification Verification',
      email: 'notifications@example.test',
      providers: ['google'],
      role: 'developer',
      careerStack: 'Frontend',
      activeCareerStack: 'Frontend',
      experienceLevel: 'Intern',
      activeExperienceLevel: 'Intern',
      careerProfileSetAt: new Date()
    });
    const user = {
      ...owner.toObject(),
      isConfigured: true,
      stats: { developerScore: 60, reposAnalyzed: 1, skillsDetected: 3 }
    };
    const token = require('../utils/authSessionToken').sign(owner, '1h');
    const { createNotification } = require('../services/notificationService');
    for (const [index, type, title, message] of [
      [1, 'profile_update', 'Profile settings updated', 'Your notification preferences are saved.'],
      [
        2,
        'resume_upload',
        'Resume analysis completed',
        'Your saved resume analysis is ready to review.'
      ],
      [
        3,
        'info',
        'Support request received',
        'Open Help & Support to see the latest ticket details.'
      ]
    ])
      await createNotification({
        userId: owner._id,
        type,
        title,
        message,
        eventId: `browser:${index}`
      });
    const app = express();
    app.use(express.json());
    app.use('/api/notifications', require('../routes/notification.routes'));
    app.use('/api', (req, res) => {
      if (req.path === '/profile/me') return res.json(user);
      return res.json({
        organizations: [],
        teams: [],
        items: [],
        settings: {},
        maintenanceMode: false,
        notifications: [],
        unreadCount: 0
      });
    });
    const dist = path.resolve(__dirname, '../../../frontend/dist/frontend/browser');
    app.use(express.static(dist));
    app.get('/{*path}', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
    server = await new Promise((resolve) => {
      const handle = app.listen(0, '127.0.0.1', () => resolve(handle));
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({
      headless: true,
      executablePath:
        process.env.NOTIFICATION_ACCEPTANCE_CHROME ||
        'C:/Program Files/Google/Chrome/Application/chrome.exe'
    });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.route('**/*', (route) =>
      route.request().url().startsWith(base) ? route.continue() : route.abort()
    );
    await context.addInitScript(
      ({ token, user }) => {
        localStorage.setItem('token', token);
        localStorage.setItem('user', JSON.stringify(user));
        localStorage.setItem('loginExpiry', String(Date.now() + 3600000));
        localStorage.setItem('devinsight_theme', 'dark');
      },
      { token, user }
    );
    const page = await context.newPage();
    const streams = [];
    context.on('request', (request) => {
      if (new URL(request.url()).pathname.endsWith('/notifications/stream'))
        streams.push({
          url: request.url(),
          bearer: Boolean(request.headers().authorization?.startsWith('Bearer '))
        });
    });
    page.on('pageerror', (error) => results.errors.push(error.message));
    const { expect } = require(
      process.env.NOTIFICATION_ACCEPTANCE_PLAYWRIGHT
        ? path.join(
            path.dirname(require.resolve(process.env.NOTIFICATION_ACCEPTANCE_PLAYWRIGHT)),
            'test'
          )
        : 'playwright/test'
    );
    await page.goto(base + '/app/notifications');
    const feed = page.locator('app-notifications .notification-list .notification-item');
    await expect(feed).toHaveCount(3);
    await expect(page.locator('app-navbar .notif-count')).toHaveText('3');
    await page.getByRole('button', { name: 'Mark Read', exact: true }).first().click();
    await expect(page.locator('app-navbar .notif-count')).toHaveText('2');
    await expect(page.locator('.hero-stats .stat-card strong').first()).toHaveText('2');
    results.checks.push('navbar/page mark-read synchronization PASS');
    const second = await context.newPage();
    second.on('pageerror', (error) => results.errors.push(error.message));
    await second.goto(base + '/app/notifications');
    await expect(second.locator('app-notifications .notification-item')).toHaveCount(3);
    await page
      .getByRole('checkbox', { name: /^Select / })
      .nth(0)
      .check();
    await page
      .getByRole('checkbox', { name: /^Select / })
      .nth(1)
      .check();
    await page.getByRole('button', { name: 'Delete selected', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Delete selected notifications?' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    assert.ok(await dialog.evaluate((element) => element.contains(document.activeElement)));
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    assert.equal(await Notification.countDocuments({ userId: owner._id }), 3);
    await page.getByRole('button', { name: 'Delete selected', exact: true }).click();
    await dialog.getByRole('button', { name: 'Delete selected', exact: true }).click();
    await expect(feed).toHaveCount(1);
    await expect(second.locator('app-notifications .notification-item')).toHaveCount(1);
    results.checks.push(
      'bounded bulk delete confirmation, keyboard focus, Escape and second-tab synchronization PASS'
    );
    await createNotification({
      userId: owner._id,
      type: 'info',
      title: 'Live verification update',
      message: 'A committed update delivered through the real stream.',
      eventId: 'browser:live'
    });
    await expect(feed).toHaveCount(2);
    await expect(second.getByText('Live verification update', { exact: true })).toBeVisible();
    assert.ok(
      streams.length >= 2 &&
        streams.every((stream) => !stream.url.includes('token') && stream.bearer)
    );
    results.checks.push('real bearer SSE and multi-tab production PASS');
    await page.getByRole('textbox', { name: 'Search', exact: true }).fill('Live verification');
    await page.getByRole('button', { name: 'Apply Filters', exact: true }).click();
    await expect(feed).toHaveCount(1);
    await page
      .getByRole('textbox', { name: 'Search', exact: true })
      .fill('unmatched-synthetic-query');
    await page.getByRole('button', { name: 'Apply Filters', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'No notifications found', exact: true })
    ).toBeVisible();
    await page.getByRole('button', { name: 'Reset', exact: true }).click();
    await expect(feed).toHaveCount(2);
    let failOnce = true;
    await page.route('**/api/notifications?*', (route) => {
      if (failOnce) {
        failOnce = false;
        return route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: '{"message":"Synthetic outage"}'
        });
      }
      return route.continue();
    });
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Notifications could not be loaded' })
    ).toBeVisible();
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(page.locator('app-notifications .inbox-card')).toHaveAttribute(
      'aria-busy',
      'false'
    );
    await expect(feed).toHaveCount(2);
    results.checks.push('search, empty state, explicit error and retry PASS');
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      for (const theme of ['dark', 'light']) {
        if ((await page.locator('html').getAttribute('data-theme')) !== theme)
          await page.locator('app-navbar .theme-toggle-btn').click();
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        const dimensions = await page.evaluate(() => ({
          viewport: innerWidth,
          document: document.documentElement.scrollWidth
        }));
        assert.ok(
          dimensions.document <= dimensions.viewport + 1,
          `Horizontal overflow at ${width}px ${theme}`
        );
        for (const selector of ['.page-hero h2', '.page-hero p', '.stat-card strong']) {
          const colors = await page
            .locator(selector)
            .first()
            .evaluate((element) => ({
              foreground: getComputedStyle(element).color,
              background: getComputedStyle(element.closest('.page-hero')).backgroundColor
            }));
          const luminance = (value) => {
            const rgb = value
              .match(/[\d.]+/g)
              .slice(0, 3)
              .map(Number)
              .map((channel) => channel / 255)
              .map((channel) =>
                channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
              );
            return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
          };
          const levels = [luminance(colors.foreground), luminance(colors.background)].sort(
            (left, right) => right - left
          );
          assert.ok(
            (levels[0] + 0.05) / (levels[1] + 0.05) >= 4.5,
            `Low text contrast: ${selector}, ${theme}, ${width}px`
          );
        }
        const filename = `notifications-${width}-${theme}.png`;
        await page.screenshot({ path: path.join(output, filename), fullPage: true });
        results.screenshots.push(filename);
      }
    }
    results.checks.push('desktop/mobile light/dark and overflow PASS');
    assert.equal(results.errors.length, 0, 'Browser runtime errors');
  } finally {
    await browser?.close();
    await require('../services/notificationStreamService').stop();
    if (server) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
    await mongoose.disconnect();
    results.cleanup = await runtime.stop();
    if (originalSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalSecret;
    await fs.writeFile(
      path.join(output, 'browser-results.json'),
      JSON.stringify(results, null, 2) + '\n'
    );
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
