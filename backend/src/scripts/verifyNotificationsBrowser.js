// Synthetic loopback acceptance only. Uses the real notification routes and a
// disposable replica set; unrelated modules/providers are isolated HTTP fixtures.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomBytes, createHash } = require('node:crypto');
const express = require('express');
const mongoose = require('mongoose');
const { startMongo } = require('../tests/fixtures/disposableRequestMongo');

async function verifyNetwork({ context, page, expect, base, owner, createNotification, results }) {
  const records = [];
  let phase = 'cold-load';
  const attach = async (target, tab) => {
    const session = await context.newCDPSession(target);
    await session.send('Network.enable');
    session.on('Network.requestWillBeSent', (event) => {
      const url = new URL(event.request.url);
      if (!url.pathname.startsWith('/api/notifications')) return;
      const frames = event.initiator.stack?.callFrames || [];
      records.push({
        tab,
        phase,
        method: event.request.method,
        path: url.pathname + url.search,
        initiator: event.initiator.type,
        stack: frames.slice(0, 5).map((frame) => ({
          function: frame.functionName,
          script: frame.url.startsWith(base) ? frame.url.slice(base.length) : 'external',
          line: frame.lineNumber + 1
        }))
      });
    });
  };
  await attach(page, 1);
  const settle = () => page.waitForTimeout(2200);
  await page.goto(base + '/app/notifications');
  const feed = page.locator('app-notifications .notification-list .notification-item');
  await expect(feed).toHaveCount(3);
  await expect(page.locator('app-navbar .notif-count')).toHaveText('3');
  await settle();
  phase = 'mark-read';
  await page.getByRole('button', { name: 'Mark Read', exact: true }).first().click();
  await expect(page.locator('app-navbar .notif-count')).toHaveText('2');
  await settle();
  phase = 'server-burst';
  for (let index = 0; index < 5; index++) {
    await createNotification({
      userId: owner._id,
      type: 'info',
      title: `Network burst ${index + 1}`,
      message: 'Synthetic notification Network acceptance.',
      eventId: `network:burst:${index}`
    });
  }
  await expect(feed).toHaveCount(8);
  await expect(page.locator('app-navbar .notif-count')).toHaveText('7');
  await settle();
  phase = 'preview-reopen';
  for (let index = 0; index < 2; index++) {
    await page.getByRole('button', { name: 'Notifications', exact: true }).click();
    await page.getByRole('button', { name: 'Notifications', exact: true }).click();
  }
  await settle();
  phase = 'second-tab';
  const second = await context.newPage();
  second.on('pageerror', (error) => results.errors.push(error.message));
  await attach(second, 2);
  await second.goto(base + '/app/notifications');
  await expect(second.locator('app-notifications .notification-item')).toHaveCount(8);
  await settle();
  const count = (phase, tab = 1, stream = false) =>
    records.filter(
      (record) =>
        record.phase === phase &&
        record.tab === tab &&
        record.method === 'GET' &&
        record.path.includes('/stream') === stream
    ).length;
  results.network = {
    mode: process.env.NOTIFICATION_NETWORK_PHASE,
    bundleIndexSha256: createHash('sha256')
      .update(
        await fs.readFile(
          path.resolve(__dirname, '../../../frontend/dist/frontend/browser/index.html')
        )
      )
      .digest('hex'),
    sourceHead: require('node:child_process')
      .execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' })
      .trim(),
    getCounts: {
      coldLoad: count('cold-load'),
      markRead: count('mark-read'),
      fiveEventBurst: count('server-burst'),
      previewReopen: count('preview-reopen'),
      secondTabColdLoad: count('second-tab', 2)
    },
    streamConnectionsPerTab: [1, 2].map(
      (tab) =>
        records.filter(
          (record) => record.tab === tab && record.path === '/api/notifications/stream'
        ).length
    ),
    records
  };
  if (process.env.NOTIFICATION_NETWORK_PHASE === 'after') {
    assert.equal(results.network.getCounts.coldLoad, 1, 'One shared initial inbox request');
    assert.equal(
      results.network.getCounts.markRead,
      1,
      'One authoritative reconciliation after local mark-read'
    );
    assert.ok(
      results.network.getCounts.fiveEventBurst <= 2,
      'Bounded reconciliation for five actual producer events'
    );
    assert.equal(results.network.getCounts.previewReopen, 0, 'Reopen preview from shared state');
    assert.equal(
      results.network.getCounts.secondTabColdLoad,
      1,
      'Independent tab has one initial request'
    );
    assert.deepEqual(results.network.streamConnectionsPerTab, [1, 1]);
  }
  assert.equal(results.errors.length, 0);
  results.checks.push(
    'Real CDP request initiators, mutation/burst/reopen counts and two-tab SSE measured'
  );
  console.log(
    JSON.stringify({
      mode: results.network.mode,
      counts: results.network.getCounts,
      streams: results.network.streamConnectionsPerTab
    })
  );
}

async function main() {
  const { chromium } = require(process.env.NOTIFICATION_ACCEPTANCE_PLAYWRIGHT || 'playwright');
  const output = path.resolve(__dirname, '../../../frontend/verification/notifications');
  const artifactPrefix = process.env.NOTIFICATION_BROWSER_PREFIX || '';
  if (artifactPrefix && !/^[a-z0-9-]{1,40}$/.test(artifactPrefix))
    throw Error('Invalid browser artifact prefix');
  if (
    process.env.NOTIFICATION_NETWORK_PHASE &&
    !['before', 'after'].includes(process.env.NOTIFICATION_NETWORK_PHASE)
  )
    throw Error('Invalid Network phase');
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
    if (!process.env.NOTIFICATION_NETWORK_PHASE) {
      results.requests = [];
      context.on('response', async (response) => {
        const request = response.request();
        const url = new URL(request.url());
        if (!url.pathname.startsWith('/api/notifications') || url.pathname.endsWith('/stream'))
          return;
        const record = {
          method: request.method(),
          path: url.pathname + url.search,
          status: response.status()
        };
        results.requests.push(record);
        try {
          const body = await response.json();
          record.returned = body.notifications?.length;
          record.unreadCount = body.unreadCount;
          record.revision = body.revision;
          record.deletedCount = body.deletedCount;
        } catch {
          /* An interrupted request has its status retained. */
        }
      });
    }
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
    if (process.env.NOTIFICATION_NETWORK_PHASE) {
      await verifyNetwork({ context, page, expect, base, owner, createNotification, results });
      return;
    }
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
    // Native actionability and screenshots need the interacted tab's compositor active on Windows.
    await page.bringToFront();
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
    await expect(dialog).toBeVisible();
    const confirmBulk = dialog.getByRole('button', { name: 'Delete selected', exact: true });
    await expect(confirmBulk).toBeEnabled();
    const [bulkCommit] = await Promise.all([
      page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === '/api/notifications/bulk-delete' &&
          response.request().method() === 'POST'
      ),
      confirmBulk.click()
    ]);
    assert.equal(bulkCommit.status(), 200);
    await expect(feed).toHaveCount(1);
    await second.bringToFront();
    await expect(second.locator('app-notifications .notification-item')).toHaveCount(1);
    await page.bringToFront();
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
    await second.bringToFront();
    await expect(second.getByText('Live verification update', { exact: true })).toBeVisible();
    await page.bringToFront();
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
        const filename = `${artifactPrefix ? artifactPrefix + '-' : ''}notifications-${width}-${theme}.png`;
        await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }));
        await page.screenshot({
          path: path.join(output, filename),
          fullPage: true,
          animations: 'disabled',
          caret: 'hide',
          timeout: 60000
        });
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
      path.join(
        output,
        process.env.NOTIFICATION_NETWORK_PHASE
          ? `network-${process.env.NOTIFICATION_NETWORK_PHASE}.json`
          : `${artifactPrefix ? artifactPrefix + '-' : ''}browser-results.json`
      ),
      JSON.stringify(results, null, 2) + '\n'
    );
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
