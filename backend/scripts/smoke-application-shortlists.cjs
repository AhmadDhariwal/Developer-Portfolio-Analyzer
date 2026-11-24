// Real compiled Angular -> production Express routes -> disposable MongoDB.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { startApplicationFixture } = require('../src/tests/fixtures/applicationPerformanceFixture');
const { sign } = require('../src/modules/auth/utils/authSessionToken');
const Application = require('../src/modules/jobs/models/jobApplication');
const Notification = require('../src/modules/notifications/models/notification');

function browserRuntime() {
  const candidates = [process.env.PLAYWRIGHT_MODULE].filter(Boolean);
  for (const name of ['playwright', 'playwright-core']) {
    try {
      candidates.push(require.resolve(name));
    } catch {
      /* Optional installed runtime. */
    }
  }
  const cache = path.join(process.env.LOCALAPPDATA || '', 'npm-cache/_npx');
  if (fs.existsSync(cache))
    for (const entry of fs.readdirSync(cache))
      candidates.push(path.join(cache, entry, 'node_modules/playwright-core'));
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch {
      /* Next existing runtime. */
    }
  }
  throw Error('An installed Playwright runtime or PLAYWRIGHT_MODULE is required.');
}
const root = path.resolve(__dirname, '../..');
const output = path.join(root, 'frontend/verification/recruiter/p1.5a');
const dist = path.join(root, 'frontend/dist/frontend/browser');
const evidence = {
  status: 'running',
  apiMocks: false,
  productionDataUsed: false,
  requests: [],
  errors: [],
  checks: []
};
async function main() {
  fs.mkdirSync(output, { recursive: true });
  assert.ok(fs.existsSync(path.join(dist, 'index.html')), 'Build current Angular first.');
  let fixture, browser;
  try {
    fixture = await startApplicationFixture({
      count: 261,
      configure(app) {
        app.use(express.static(dist));
        app.use((req, res, next) =>
          req.method === 'GET' && !req.path.startsWith('/api/')
            ? res.sendFile(path.join(dist, 'index.html'))
            : next()
        );
      }
    });
    browser = await browserRuntime().chromium.launch({ channel: 'msedge', headless: true });
    async function pageFor(actor, theme = 'light', viewport = { width: 1440, height: 900 }) {
      const context = await browser.newContext({
        viewport,
        colorScheme: 'dark',
        reducedMotion: 'reduce'
      });
      await context.addInitScript(
        ({ token, user, theme }) => {
          if (!sessionStorage.getItem('p15a-seeded')) {
            localStorage.setItem('token', token);
            localStorage.setItem('user', JSON.stringify(user));
            localStorage.setItem('devinsight_theme', theme);
            sessionStorage.setItem('p15a-seeded', '1');
          }
        },
        {
          token: sign({ _id: actor }),
          theme,
          user: {
            _id: String(actor),
            role: 'recruiter',
            name: 'Fixture recruiter',
            organizationId: String(fixture.organizationId),
            onboardingCompleted: true
          }
        }
      );
      const page = await context.newPage();
      page.on('pageerror', (error) => evidence.errors.push(error.message));
      page.on('response', (response) => {
        const url = new URL(response.url());
        if (url.pathname.startsWith('/api/'))
          evidence.requests.push({
            path: url.pathname,
            method: response.request().method(),
            status: response.status()
          });
      });
      await page.goto(fixture.origin + '/app/recruiter/shortlists?source=applications');
      if (String(actor) === String(fixture.owner))
        await page.getByRole('button', { name: 'Next page', exact: true }).waitFor();
      else await page.getByText('No shortlisted candidates yet', { exact: true }).waitFor();
      return { context, page };
    }
    const { page, context } = await pageFor(fixture.owner);
    await page.getByRole('button', { name: 'Next page', exact: true }).click();
    await page.getByText('Page 2 of 14', { exact: false }).waitFor();
    const card = page.locator('app-shortlist-card').first();
    await card.getByRole('button', { name: 'Mark application reviewing' }).click();
    await card.getByText('Application status: reviewing', { exact: false }).waitFor();
    await card.getByRole('button', { name: 'Reject application', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Reject application', exact: true });
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await card.getByText('Application status: reviewing', { exact: false }).waitFor();
    await card.getByRole('button', { name: 'Reject application', exact: true }).click();
    await dialog.getByRole('button', { name: 'Reject application', exact: true }).click();
    await card.getByText('Application status: rejected', { exact: false }).waitFor();
    assert.equal(
      await card.getByRole('button', { name: 'Reject application', exact: true }).count(),
      0
    );
    await card.getByRole('link', { name: /View application/ }).click();
    await page.getByText('Submitted evidence', { exact: true }).waitFor();
    const id = new URL(page.url()).searchParams.get('applicationId');
    assert.ok(id);
    const application = await Application.findById(id).lean();
    assert.equal(application.status, 'rejected');
    assert.equal(await Notification.countDocuments({ userId: application.applicantId }), 2);
    const stale = await fixture.request(
      `/api/recruiter-hub/jobs/${fixture.job._id}/applications/${id}`,
      {
        method: 'PATCH',
        body: { status: 'reviewing', expectedStatus: 'submitted' }
      }
    );
    assert.equal(stale.status, 409);
    evidence.checks.push(
      'page 2 -> explicit reviewing -> reject cancel/confirm -> terminal -> exact submitted-evidence navigation; two notifications; stale 409'
    );
    await context.close();
    for (const [name, theme, viewport] of [
      ['light-desktop', 'light', { width: 1440, height: 900 }],
      ['dark-mobile', 'dark', { width: 390, height: 844 }],
      ['system-tablet', 'system', { width: 768, height: 1024 }]
    ]) {
      const view = await pageFor(fixture.owner, theme, viewport);
      assert.ok(
        await view.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2),
        name
      );
      await view.page.screenshot({ path: path.join(output, name + '.png'), fullPage: true });
      await view.context.close();
    }
    const peer = await pageFor(fixture.peer);
    assert.equal(await peer.page.locator('app-shortlist-card').count(), 0);
    await peer.context.close();
    const denied = await fixture.request('/api/recruiter-hub/shortlists/applications', {
      actor: fixture.peer
    });
    assert.equal(denied.body.meta.total, 0);
    evidence.checks.push('Light/Dark/System responsive screenshots and peer owner-only exclusion');
    const session = await pageFor(fixture.owner);
    await session.page.evaluate(() => localStorage.clear());
    await session.page.reload();
    await session.page.waitForURL(/auth\/login/);
    evidence.sessionClearing = {
      destination: new URL(session.page.url()).pathname,
      ng0100: evidence.errors.some((value) => value.includes('NG0100')),
      organization503: evidence.requests.filter(
        (r) => /organizations/.test(r.path) && r.status === 503
      ).length
    };
    await session.context.close();
    assert.equal(evidence.sessionClearing.ng0100, false);
    assert.equal(evidence.sessionClearing.organization503, 0);
    assert.deepEqual(evidence.errors, []);
    evidence.status = 'passed';
  } finally {
    await browser?.close();
    if (fixture) evidence.cleanup = await fixture.stop();
  }
}
main()
  .catch((error) => {
    evidence.status = 'failed';
    evidence.failure = error.stack;
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() =>
    fs.writeFileSync(path.join(output, 'real-stack.json'), JSON.stringify(evidence, null, 2) + '\n')
  );
