// Real compiled Angular -> production Express routes -> disposable MongoDB.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { startApplicationFixture } = require('../src/tests/fixtures/applicationPerformanceFixture');
const { sign } = require('../src/modules/auth/utils/authSessionToken');
const Application = require('../src/modules/jobs/models/jobApplication');
const Notification = require('../src/modules/notifications/models/notification');

const { startBrowser } = require('../src/tests/fixtures/disposableBrowser');

const root = path.resolve(__dirname, '../..');
const liveAngular = process.argv.includes('--angular-server');
const output = path.join(root, 'frontend/verification/recruiter', liveAngular ? 'p1.5b' : 'p1.5a');
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
  let fixture, browser, angular;
  try {
    fixture = await startApplicationFixture({
      count: 261,
      configure(app) {
        if (liveAngular) return;
        app.use(express.static(dist));
        app.use((req, res, next) =>
          req.method === 'GET' && !req.path.startsWith('/api/')
            ? res.sendFile(path.join(dist, 'index.html'))
            : next()
        );
      }
    });
    if (liveAngular) console.log('Disposable Express API ready; starting Angular dev server.');
    if (liveAngular)
      angular = await require('../src/tests/fixtures/disposableAngular').startAngular(
        fixture.origin
      );
    const uiOrigin = angular?.origin || fixture.origin;
    evidence.angularDevServer = Boolean(angular);
    if (liveAngular) console.log('Angular dev server ready; starting real-browser checks.');
    browser = await startBrowser();
    browser.on('Runtime.exceptionThrown', (event) => {
      evidence.errors.push(
        event.exceptionDetails.exception?.description || event.exceptionDetails.text
      );
    });
    if (liveAngular)
      browser.on('Runtime.consoleAPICalled', (event) => {
        if (event.type === 'error')
          evidence.errors.push(
            event.args.map((item) => String(item.value ?? item.description ?? '')).join(' ')
          );
      });
    browser.on('Network.responseReceived', (event) => {
      const url = new URL(event.response.url);
      if (url.pathname.startsWith('/api/'))
        evidence.requests.push({ path: url.pathname, status: event.response.status });
    });
    async function pageFor(actor, theme = 'light', viewport = { width: 1440, height: 900 }) {
      const seed = {
        token: sign({ _id: actor }),
        theme,
        user: {
          _id: String(actor),
          role: 'recruiter',
          name: 'Fixture recruiter',
          organizationId: String(fixture.organizationId),
          onboardingCompleted: true
        }
      };
      const init = `(() => {
        if (!sessionStorage.getItem('p15a-seeded')) {
          const seed = ${JSON.stringify(seed)};
          localStorage.setItem('token', seed.token);
          localStorage.setItem('user', JSON.stringify(seed.user));
          localStorage.setItem('devinsight_theme', seed.theme);
          sessionStorage.setItem('p15a-seeded', '1');
        }
      })()`;
      const page = await browser.page({ ...viewport, init });
      await page.navigate(uiOrigin + '/app/recruiter/shortlists?source=applications');
      const ready =
        String(actor) === String(fixture.owner)
          ? `document.querySelectorAll('app-shortlist-card').length === 20`
          : `document.body.innerText.includes('No shortlisted candidates yet')`;
      await page.wait(ready, 'authorized shortlist page');
      return page;
    }
    const click = (page, label, selector = 'body', tag = 'button') =>
      page.evaluate(`(() => {
      const scope = document.querySelector(${JSON.stringify(selector)});
      const node = [...(scope?.querySelectorAll(${JSON.stringify(tag)}) || [])]
        .find((item) => item.textContent.trim().includes(${JSON.stringify(label)}));
      if (!node || node.disabled) throw Error('Action unavailable: ' + ${JSON.stringify(label)});
      node.click();
    })()`);
    const status = (page, value) =>
      page.wait(
        `document.querySelector('app-shortlist-card')?.textContent.includes(${JSON.stringify('Application status: ' + value)})`,
        'canonical application status ' + value
      );
    const page = await pageFor(fixture.owner);
    await click(page, 'Next page');
    await page.wait(`document.body.innerText.includes('Page 2 of 14')`, 'second page');
    await click(page, 'Mark application reviewing', 'app-shortlist-card');
    await status(page, 'reviewing');
    await click(page, 'Reject application', 'app-shortlist-card');
    await page.wait(`!!document.querySelector('[role="dialog"]')`, 'rejection confirmation');
    await click(page, 'Cancel', '[role="dialog"]');
    await status(page, 'reviewing');
    await click(page, 'Reject application', 'app-shortlist-card');
    await page.wait(`!!document.querySelector('[role="dialog"]')`, 'rejection confirmation');
    await click(page, 'Reject application', '[role="dialog"]');
    await status(page, 'rejected');
    assert.equal(
      await page.evaluate(`[...document.querySelector('app-shortlist-card').querySelectorAll('button')]
      .filter((button) => button.textContent.includes('Reject application')).length`),
      0
    );
    await click(page, 'View application', 'app-shortlist-card', 'a');
    await page.wait(
      `document.body.innerText.includes('Submitted evidence')`,
      'exact submitted evidence'
    );
    const id = await page.evaluate(`new URL(location.href).searchParams.get('applicationId')`);
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
    assert.equal(await Notification.countDocuments({ userId: application.applicantId }), 2);
    evidence.checks.push(
      'page 2 -> explicit reviewing -> reject cancel/confirm -> terminal -> exact submitted-evidence navigation; two notifications; stale 409'
    );
    await page.close();
    evidence.appearance = [];
    for (const [name, theme, viewport] of [
      ['light-desktop', 'light', { width: 1440, height: 900 }],
      ['dark-mobile', 'dark', { width: 390, height: 844 }],
      ['system-tablet', 'system', { width: 768, height: 1024 }]
    ]) {
      const view = await pageFor(fixture.owner, theme, viewport);
      assert.ok(
        await view.evaluate(`document.documentElement.scrollWidth <= innerWidth + 2`),
        name
      );
      evidence.appearance.push({
        name,
        theme,
        viewport,
        observedTheme: await view.evaluate(`document.documentElement.getAttribute('data-theme')`)
      });
      await view.evaluate(
        `document.querySelector('app-shortlist-card').scrollIntoView({ block: 'center' })`
      );
      await view.screenshot(path.join(output, name + '.png'));
      await view.close();
      if (liveAngular) console.log('Verified responsive appearance: ' + name);
    }
    const peer = await pageFor(fixture.peer);
    assert.equal(await peer.evaluate(`document.querySelectorAll('app-shortlist-card').length`), 0);
    await peer.close();
    if (liveAngular) {
      const analytics = await pageFor(fixture.owner);
      await analytics.navigate(uiOrigin + '/app/recruiter/analytics');
      await analytics.wait(
        `document.body.innerText.includes('Assessment & Match Actions')`,
        'accurate analytics labels'
      );
      assert.equal(
        await analytics.evaluate(`/AI usage trends|AI Actions/.test(document.body.innerText)`),
        false
      );
      await analytics.screenshot(path.join(output, 'analytics-desktop.png'));
      evidence.navigation = [];
      for (const [route, selector] of [
        ['dashboard', 'app-recruiter-dashboard'],
        ['jobs', 'app-recruiter-jobs'],
        [`jobs/${fixture.job._id}`, 'app-recruiter-job-details'],
        ['candidates', 'app-recruiter-candidates'],
        ['matches', 'app-recruiter-matches'],
        ['comparison', 'app-recruiter-comparison'],
        ['shortlists', 'app-recruiter-shortlists'],
        ['activity-logs', 'app-recruiter-activity-logs'],
        ['profile', 'app-recruiter-profile']
      ]) {
        await analytics.navigate(uiOrigin + '/app/recruiter/' + route);
        await analytics.wait(
          `!!document.querySelector(${JSON.stringify(selector)}) && !document.querySelector(${JSON.stringify(selector + ' app-recruiter-loader')})`,
          'live recruiter route ' + route
        );
        evidence.navigation.push({ route, component: selector, rendered: true });
        console.log('Verified recruiter route: ' + route);
      }
      await analytics.close();
      evidence.checks.push(
        'Actual Angular dev server proxies production Express routes; analytics describes assessment/match actions without claiming AI execution.'
      );
    }
    const denied = await fixture.request('/api/recruiter-hub/shortlists/applications', {
      actor: fixture.peer
    });
    assert.equal(denied.body.meta.total, 0);
    evidence.checks.push('Light/Dark/System responsive screenshots and peer owner-only exclusion');
    const session = await pageFor(fixture.owner);
    await session.evaluate(`localStorage.clear()`);
    const current = await session.evaluate(`location.href`);
    await session.navigate(current);
    await session.wait(`location.pathname.includes('/auth/login')`, 'logged-out session');
    evidence.sessionClearing = {
      destination: await session.evaluate(`location.pathname`),
      ng0100: evidence.errors.some((value) => value.includes('NG0100')),
      organization503: evidence.requests.filter(
        (r) => /organizations/.test(r.path) && r.status === 503
      ).length
    };
    await session.close();
    assert.equal(evidence.sessionClearing.ng0100, false);
    assert.equal(evidence.sessionClearing.organization503, 0);
    assert.deepEqual(evidence.errors, []);
    evidence.status = 'passed';
  } finally {
    if (browser) evidence.browserCleanup = await browser.stop();
    if (angular) evidence.angularCleanup = await angular.stop();
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
