const { randomBytes } = require('node:crypto');
// Real Angular -> Express -> disposable MongoDB smoke. No API interception.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { execFileSync } = require('node:child_process');
process.env.NODE_ENV = 'test';
process.env.REDIS_URL = '';
process.env.UPSTASH_REDIS_TOKEN = '';
const express = require('express');
const mongoose = require('mongoose');
const { startMongo } = require('../src/tests/fixtures/disposableRequestMongo');
const settings = require('../src/modules/super-admin/services/platformSettingsService');
const User = require('../src/modules/auth/models/user');
const Organization = require('../src/modules/admin/models/organization');
const Team = require('../src/modules/admin/models/team');
const Membership = require('../src/modules/admin/models/membership');
const Application = require('../src/modules/jobs/models/jobApplication');
const Match = require('../src/modules/recruiter/models/RecruiterMatch');
const Shortlist = require('../src/modules/recruiter/models/RecruiterShortlist');
const { sign } = require('../src/modules/auth/utils/authSessionToken');

function browserRuntime() {
  const candidates = [process.env.PLAYWRIGHT_MODULE].filter(Boolean);
  for (const name of ['playwright', 'playwright-core']) {
    try {
      candidates.push(require.resolve(name));
    } catch {
      /* Optional installed runtime. */
    }
  }
  const cache = path.join(process.env.LOCALAPPDATA || '', 'npm-cache', '_npx');
  if (fs.existsSync(cache))
    for (const entry of fs.readdirSync(cache)) {
      const candidate = path.join(cache, entry, 'node_modules/playwright-core');
      if (fs.existsSync(candidate)) candidates.push(candidate);
    }
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch {
      /* Next installed runtime. */
    }
  }
  throw new Error('An installed Playwright runtime or PLAYWRIGHT_MODULE is required.');
}

async function main() {
  const root = path.resolve(__dirname, '../..');
  const dist = path.join(root, 'frontend/verification/recruiter/p1.3a-build-20261122/browser');
  const evidence = path.join(root, 'frontend/verification/recruiter/p1.3a');
  assert.ok(
    fs.existsSync(path.join(dist, 'index.html')),
    'Build current Angular checkout into the documented task build directory first'
  );
  assert.equal(
    execFileSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8' }).trim(),
    'fix/P1-project'
  );
  const result = {
    status: 'running',
    branch: 'fix/P1-project',
    apiMocks: false,
    frontendBuild: dist,
    backendCheckout: path.join(root, 'backend'),
    requests: [],
    checks: {}
  };
  fs.mkdirSync(evidence, { recursive: true });
  const previous = process.env.JWT_SECRET;
  process.env.JWT_SECRET = randomBytes(32).toString('hex');
  const mongo = await startMongo({
    replicaSet: 'discovery-browser',
    temporaryRoot: path.join(root, 'backend/verification')
  });
  let browser, server;
  try {
    await mongoose.connect(mongo.uri);
    await settings.startSettingsSynchronization();
    await Promise.all(
      [User, Organization, Team, Membership, Match, Shortlist, Application].map((model) =>
        model.init()
      )
    );
    const id = () => new mongoose.Types.ObjectId();
    const org = id(),
      owner = id(),
      manager = id(),
      member = id();
    const actors = [owner, manager, member].map((_id, index) => ({
      _id,
      name: ['Owner', 'Manager', 'Member'][index],
      email: `browser-actor-${index}@fixture.test`,
      role: 'recruiter',
      organizationId: org,
      organizationName: 'Browser Org',
      isActive: true,
      sessionRevision: 0,
      createdAt: new Date()
    }));
    await User.collection.insertMany(actors);
    await Organization.create({
      _id: org,
      name: 'Browser Org',
      slug: 'browser-discovery',
      ownerId: owner,
      createdBy: owner
    });
    const team = await Team.create({
      organizationId: org,
      name: 'Explicit team',
      slug: 'browser-team',
      createdBy: owner
    });
    await Membership.create(
      actors.flatMap((actor, index) => [
        { userId: actor._id, organizationId: org, teamId: null, role: 'member' },
        {
          userId: actor._id,
          organizationId: org,
          teamId: team._id,
          role: index === 1 ? 'manager' : 'member'
        }
      ])
    );
    const developers = Array.from({ length: 25 }, (_, index) => ({
      _id: id(),
      name: `Browser candidate ${String(index).padStart(2, '0')}`,
      email: `browser-dev-${index}@fixture.test`,
      role: 'developer',
      organizationId: org,
      isPublic: true,
      isActive: true,
      createdAt: new Date(),
      activeCareerStack: 'Backend'
    }));
    await User.collection.insertMany(developers);
    const app = express();
    app.use(express.json());
    app.use(
      '/api/recruiter-hub',
      require('../src/modules/recruiter/routes/hub/recruiterHubRoutes')
    );
    app.use('/api/tenant', require('../src/modules/admin/routes/tenant.routes'));
    app.use('/api/notifications', require('../src/modules/notifications/notification.routes'));
    app.use('/api/profile', require('../src/modules/profile/profile.routes'));
    app.use(express.static(dist));
    app.use((req, res) => {
      if (req.method === 'GET' && !req.path.startsWith('/api/'))
        return res.sendFile(path.join(dist, 'index.html'));
      return res.status(404).json({ message: 'Route not found.' });
    });
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const origin = `http://127.0.0.1:${server.address().port}`;
    const api = async (actor, url, method = 'GET', body, expected = 200) => {
      const response = await fetch(origin + '/api/recruiter-hub' + url, {
        method,
        headers: {
          Authorization: `Bearer ${sign({ _id: actor })}`,
          'Content-Type': 'application/json'
        },
        ...(body ? { body: JSON.stringify(body) } : {})
      });
      assert.equal(response.status, expected, `${method} ${url}`);
      result.requests.push({
        method,
        url: origin + '/api/recruiter-hub' + url,
        status: response.status
      });
      return response.json();
    };
    const { job } = await api(
      owner,
      '/jobs',
      'POST',
      {
        title: 'Explicit shared evaluation',
        role: 'Engineer',
        location: 'Remote',
        requiredSkills: ['Node.js'],
        teamId: String(team._id),
        teamShared: true,
        evaluationShared: true
      },
      201
    );
    assert.equal(job.evaluationShared, true);
    result.checks.evaluationSharedTrue = true;
    const generated = await api(manager, '/matches/generate', 'POST', {
      jobId: job._id,
      candidateIds: [String(developers[0]._id)]
    });
    assert.equal(generated.matches.length, 1);
    const applicationId = 'e'.repeat(64);
    await Application.create({
      _id: applicationId,
      organizationId: org,
      organizationName: 'Browser Org',
      recruiterId: owner,
      jobId: job._id,
      applicantId: developers[0]._id,
      applicantName: developers[0].name,
      jobTitle: job.title,
      resume: { fileId: id(), fileName: 'private.pdf', sha256: 'fixture', uploadedAt: new Date() },
      resumeBytes: Buffer.from('%PDF-1.4 PRIVATE_APPLICATION'),
      portfolio: { summary: 'NEVER_SHARE_APPLICATION' },
      consent: { version: 'fixture', submittedAt: new Date(), sharePortfolio: true },
      history: [{ from: '', to: 'submitted', actorId: developers[0]._id, at: new Date() }]
    });
    browser = await browserRuntime().chromium.launch({ channel: 'msedge', headless: true });
    async function pageFor(actor) {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        reducedMotion: 'reduce'
      });
      await context.addInitScript(
        ({ token, user }) => {
          localStorage.setItem('token', token);
          localStorage.setItem('user', JSON.stringify(user));
          localStorage.setItem('devinsight_theme', 'light');
        },
        {
          token: sign(actor),
          user: { ...actor, _id: String(actor._id), organizationId: String(org) }
        }
      );
      const page = await context.newPage();
      page.on('response', (response) => {
        const url = new URL(response.url());
        if (/^\/api\/recruiter-hub\/(candidates|matches|jobs)/.test(url.pathname)) {
          if (url.searchParams.has('cursor')) url.searchParams.set('cursor', '[signed-position]');
          result.requests.push({
            method: response.request().method(),
            url: url.toString(),
            status: response.status()
          });
        }
      });
      return page;
    }
    const managerPage = await pageFor(actors[1]);
    await managerPage.goto(`${origin}/app/recruiter/matches?jobId=${job._id}`);
    await managerPage.locator('.match-card').first().waitFor();
    const mutation = managerPage.waitForResponse(
      (response) => response.request().method() === 'PATCH' && response.url().includes('/matches/')
    );
    await managerPage.getByRole('button', { name: 'Reject', exact: true }).click();
    assert.equal((await mutation).status(), 200);
    result.checks.managerMutation = true;
    const memberPage = await pageFor(actors[2]);
    await memberPage.goto(`${origin}/app/recruiter/matches?jobId=${job._id}`);
    await memberPage.locator('.match-card').first().waitFor();
    assert.match(await memberPage.locator('.match-card__status').first().innerText(), /rejected/i);
    assert.equal(await memberPage.getByRole('button', { name: 'Reset', exact: true }).count(), 0);
    assert.equal(
      await memberPage.getByRole('button', { name: 'Shortlist', exact: true }).count(),
      0
    );
    result.checks.memberEvaluationReadOnly = true;
    await memberPage.goto(`${origin}/app/recruiter/jobs/${job._id}`);
    await memberPage.getByRole('heading', { name: job.title, exact: true }).waitFor();
    assert.equal(await memberPage.locator('app-job-applicants').count(), 0);
    assert.ok(!(await memberPage.locator('body').innerText()).includes('NEVER_SHARE_APPLICATION'));
    const privateStatuses = await memberPage.evaluate(
      async ({ root, applicationId, token }) => {
        const paths = [root, `${root}/${applicationId}/resume`];
        const statuses = [];
        for (const path of paths)
          statuses.push(
            (await fetch(path, { headers: { Authorization: `Bearer ${token}` } })).status
          );
        statuses.push(
          (
            await fetch(`${root}/${applicationId}`, {
              method: 'PATCH',
              headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ status: 'reviewing' })
            })
          ).status
        );
        return statuses;
      },
      {
        applicationId,
        root: `/api/recruiter-hub/jobs/${job._id}/applications`,
        token: sign(actors[2])
      }
    );
    assert.deepEqual(privateStatuses, [404, 404, 404]);
    result.checks.privateApplicationsDenied = privateStatuses;
    await memberPage.goto(`${origin}/app/recruiter/candidates`);
    await memberPage.locator('.candidate-card').first().waitFor();
    assert.equal(await memberPage.locator('.candidate-card').count(), 12);
    await memberPage.getByText('25 matching profiles', { exact: true }).waitFor();
    const next = memberPage.waitForResponse(
      (response) =>
        response.url().includes('/api/recruiter-hub/candidates?') &&
        response.url().includes('page=2')
    );
    await memberPage.getByRole('button', { name: 'Next', exact: true }).click();
    const nextResponse = await next;
    assert.equal(nextResponse.status(), 200);
    assert.equal((await nextResponse.json()).meta.pagination, 'cursor');
    await memberPage.locator('.candidate-card').first().waitFor();
    await memberPage.locator('#candidate-search').fill('Browser candidate 24');
    const filtered = memberPage.waitForResponse(
      (response) =>
        response.url().includes('/api/recruiter-hub/candidates?') &&
        response.url().includes('search=Browser')
    );
    await memberPage.getByRole('button', { name: 'Apply Filters', exact: true }).click();
    assert.equal((await filtered).status(), 200);
    await memberPage.getByRole('heading', { name: 'Browser candidate 24', exact: true }).waitFor();
    assert.equal(await memberPage.locator('.candidate-card').count(), 1);
    result.checks.discoveryPaginationAndFilter = true;
    await memberPage.screenshot({
      path: path.join(evidence, 'candidates-real.png'),
      fullPage: true
    });
    result.status = 'passed';
  } finally {
    await browser?.close();
    await require('../src/modules/notifications/services/notificationStreamService').stop();
    if (server) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
    settings.stopSettingsSynchronization();
    await mongoose.disconnect();
    result.mongoCleanup = await mongo.stop();
    if (previous === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previous;
    fs.writeFileSync(
      path.join(evidence, 'real-stack.json'),
      JSON.stringify(result, null, 2) + '\n'
    );
  }
  process.stdout.write(
    JSON.stringify({ status: result.status, checks: result.checks, evidence }) + '\n'
  );
}
main().catch((error) => {
  process.stderr.write(error.message + '\n');
  process.exitCode = 1;
});
