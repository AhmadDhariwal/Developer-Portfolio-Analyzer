// Compiled Angular + real Express + disposable MongoDB only. No target API mocks.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { randomBytes, createHash } = require('node:crypto');
require('dotenv').config = () => ({ parsed: {} });
process.env.NODE_ENV = 'test';
process.env.REDIS_URL = '';
process.env.JWT_SECRET = randomBytes(32).toString('hex');
for (const key of [
  'OPENAI_API_KEY',
  'GEMINI_API_KEY',
  'GROQ_API_KEY',
  'ANTHROPIC_API_KEY',
  'XAI_API_KEY',
  'SENDGRID_API_KEY'
])
  process.env[key] = '';
const express = require('express');
const mongoose = require('mongoose');
const { startMongo } = require('../src/tests/fixtures/disposableRequestMongo');
const root = path.resolve(__dirname, '../..');
const output = path.join(root, 'frontend/verification/admin/p1.6c.2');
const dist = path.join(root, 'frontend/dist/frontend/browser');
const result = {
  status: 'running',
  apiMocks: false,
  productionDataUsed: false,
  externalDelivery: false,
  requests: [],
  policyChecks: [],
  profiles: [],
  consoleErrors: [],
  runtimeErrors: [],
  unexpectedHttp: [],
  expectedHttp: [],
  checks: {},
  auditCommits: []
};
const policies = [
  ['recruiterJobCreation', 'Allow Recruiter job creation'],
  ['recruiterJobPublication', 'Allow Recruiter job publication'],
  ['teamSharedJobs', 'Allow team-shared jobs'],
  ['sharedPublicEvaluations', 'Allow shared public evaluations'],
  ['teamManagerEvaluationManagement', 'Allow team managers to manage shared evaluations'],
  ['candidateMatching', 'Allow candidate matching and ranking'],
  ['invitationCreation', 'Allow invitations and pending acceptance'],
  ['managerTeamAdministration', 'Allow organization managers to administer teams']
];
function playwright() {
  const candidates = ['playwright', 'playwright-core'];
  const cache = path.join(process.env.LOCALAPPDATA || '', 'npm-cache/_npx');
  if (fs.existsSync(cache))
    for (const entry of fs.readdirSync(cache))
      candidates.push(path.join(cache, entry, 'node_modules/playwright-core'));
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch {}
  }
  throw Error('An installed Playwright runtime is required.');
}
async function main() {
  assert.ok(fs.existsSync(path.join(dist, 'index.html')), 'Compile Angular before this smoke.');
  fs.mkdirSync(path.join(output, 'screenshots'), { recursive: true });
  const mongo = await startMongo({
    replicaSet: 'organization-control-center-smoke',
    readinessAttempts: 200
  });
  let browser, server;
  let expectedFault = false;
  const pendingAudits = new Set();
  const settings = require('../src/modules/super-admin/services/platformSettingsService');
  const streams = require('../src/modules/notifications/services/notificationStreamService');
  try {
    await mongoose.connect(mongo.uri);
    const User = require('../src/modules/auth/models/user');
    const Organization = require('../src/modules/admin/models/organization');
    const Membership = require('../src/modules/admin/models/membership');
    const Team = require('../src/modules/admin/models/team');
    const Invitation = require('../src/modules/admin/models/invitation');
    const Audit = require('../src/modules/admin/models/auditLog');
    const Job = require('../src/modules/recruiter/models/Job');
    const Match = require('../src/modules/recruiter/models/RecruiterMatch');
    const Shortlist = require('../src/modules/recruiter/models/RecruiterShortlist');
    const Application = require('../src/modules/jobs/models/jobApplication');
    const { sign } = require('../src/modules/auth/utils/authSessionToken');
    const originalAudit = Audit.create;
    Audit.create = function (...args) {
      const promise = originalAudit.apply(this, args);
      pendingAudits.add(promise);
      promise.then(
        () => pendingAudits.delete(promise),
        () => pendingAudits.delete(promise)
      );
      return promise;
    };
    require('../src/core/messaging/emailService').sendRecruiterInvitationEmail = async () => ({
      sent: false,
      reason: 'Local smoke; external delivery prohibited'
    });
    require('../src/core/messaging/invitationEmailService').sendInvitationEmail = async () => ({
      sent: false,
      reason: 'Local smoke; external delivery prohibited'
    });
    const app = express();
    app.use(express.json());
    let streamsActive = 0;
    app.use((request, response, next) => {
      const requestPath = request.path;
      if (request.path.startsWith('/api/'))
        response.once('finish', () =>
          result.requests.push({
            method: request.method,
            path: requestPath.replace(/\/accept\/[a-f0-9]{24,128}/g, '/accept/[token]'),
            status: response.statusCode
          })
        );
      if (request.path === '/api/notifications/stream') {
        streamsActive++;
        result.checks.maxConcurrentStreams = Math.max(
          result.checks.maxConcurrentStreams || 0,
          streamsActive
        );
        response.once('close', () => streamsActive--);
      }
      next();
    });
    app.use(require('../src/core/middleware/auditLogMiddleware').auditLogMiddleware);
    for (const [prefix, module] of [
      ['admin', 'admin/routes/admin.routes'],
      ['admin-console', 'admin/routes/adminConsole.routes'],
      ['tenant', 'admin/routes/tenant.routes'],
      ['audit-logs', 'admin/routes/audit.routes'],
      ['profile', 'profile/profile.routes'],
      ['notifications', 'notifications/notification.routes'],
      ['auth', 'auth/auth.routes'],
      ['resume', 'resume/resume.routes'],
      ['recruiter-hub', 'recruiter/routes/hub/recruiterHubRoutes'],
      ['recruiter', 'recruiter/routes/recruiter.routes'],
      ['jobs', 'jobs/jobRoutes']
    ])
      app.use(`/api/${prefix}`, require(`../src/modules/${module}`));
    for (const model of Object.values(mongoose.models)) {
      await model.createCollection();
      await model.createIndexes();
    }
    await settings.startSettingsSynchronization();
    await settings.updateSettings({
      organization: { recruiterLimitPerOrg: 5, maxTeamsPerOrganization: 10 },
      recruiter: { enableRecruiterAccess: true, candidateVisibility: 'public' }
    });
    let serial = 0;
    const account = (name, role, extra = {}) =>
      User.create({
        name,
        email: `actor-${++serial}@control-center.test`,
        role,
        isActive: true,
        isVerified: true,
        providers: ['github'],
        ...extra
      });
    const admin = await account('Control Center Admin', 'admin');
    const adminB = await account('Independent Organization Admin', 'admin');
    const organization = await Organization.create({
      name: 'Control Center Engineering and Responsible Recruitment Organization',
      slug: 'control-center-a',
      ownerId: admin._id,
      createdBy: admin._id
    });
    const foreign = await Organization.create({
      name: 'Independent Organization B',
      slug: 'control-center-b',
      ownerId: adminB._id,
      createdBy: adminB._id
    });
    admin.organizationId = organization._id;
    adminB.organizationId = foreign._id;
    await Promise.all([admin.save(), adminB.save()]);
    const secondAdmin = await account('Second Authorized Admin', 'admin', {
      organizationId: organization._id
    });
    const owner = await account('Recruiter Job Owner', 'recruiter', {
      organizationId: organization._id
    });
    const manager = await account('Recruiter Team Manager', 'recruiter', {
      organizationId: organization._id
    });
    const member = await account('Regular Team Recruiter', 'recruiter', {
      organizationId: organization._id
    });
    const foreignRecruiter = await account('Independent Recruiter B', 'recruiter', {
      organizationId: foreign._id
    });
    const publicDeveloper = await account('Public Developer', 'developer', { isPublic: true });
    const applicant = await account('Private Direct Applicant', 'developer', { isPublic: false });
    const recipient = await account('Pending Recruiter Recipient', 'developer');
    const revokedInviter = await account('Revoked Direct Admin', 'admin', {
      organizationId: organization._id
    });
    const team = await Team.create({
      organizationId: organization._id,
      name: 'Platform Engineering and Responsible Hiring Collaboration Team',
      slug: 'control-center-team',
      createdBy: admin._id
    });
    await Membership.create([
      { organizationId: organization._id, userId: admin._id, role: 'admin' },
      { organizationId: organization._id, userId: secondAdmin._id, role: 'admin' },
      { organizationId: foreign._id, userId: adminB._id, role: 'admin' },
      { organizationId: foreign._id, userId: foreignRecruiter._id, role: 'member' },
      {
        organizationId: organization._id,
        userId: revokedInviter._id,
        role: 'admin',
        status: 'disabled'
      },
      ...[owner, manager, member].flatMap((actor) => [
        {
          organizationId: organization._id,
          userId: actor._id,
          role: actor === manager ? 'manager' : 'member'
        },
        {
          organizationId: organization._id,
          userId: actor._id,
          teamId: team._id,
          role: actor === manager ? 'manager' : 'member'
        }
      ])
    ]);
    const largeDirectory = Array.from({ length: 205 }, (_, index) => ({
      _id: new mongoose.Types.ObjectId(),
      name: `Internal member ${String(index).padStart(3, '0')}`,
      email: `internal-${index}@control-center.test`,
      role: 'developer',
      isActive: index % 9 !== 0,
      isPublic: false,
      isVerified: true,
      organizationId: organization._id
    }));
    await User.collection.insertMany(largeDirectory);
    await Membership.insertMany(
      largeDirectory.map((actor) => ({
        userId: actor._id,
        organizationId: organization._id,
        role: 'member',
        status: actor.isActive ? 'active' : 'disabled'
      }))
    );
    const job = await Job.create({
      organizationId: organization._id,
      recruiterId: owner._id,
      teamId: team._id,
      title: 'Shared Platform Engineer',
      role: 'Engineer',
      requiredSkills: ['TypeScript'],
      status: 'open',
      teamShared: true,
      evaluationShared: true
    });
    const published = await Job.create({
      organizationId: organization._id,
      recruiterId: owner._id,
      title: 'Published Application Engineer',
      role: 'Engineer',
      requiredSkills: ['TypeScript'],
      status: 'open',
      published: true
    });
    const match = await Match.create({
      organizationId: organization._id,
      recruiterId: owner._id,
      teamId: team._id,
      jobId: job._id,
      candidateId: publicDeveloper._id,
      matchScore: 72
    });
    const shortlist = await Shortlist.create({
      organizationId: organization._id,
      recruiterId: owner._id,
      teamId: team._id,
      jobId: job._id,
      candidateId: publicDeveloper._id,
      notes: 'Retained shared public assessment'
    });
    const invitation = await Invitation.create({
      organizationId: organization._id,
      invitedBy: admin._id,
      role: 'recruiter',
      name: recipient.name,
      email: recipient.email,
      token: randomBytes(24).toString('hex'),
      expiresAt: new Date(Date.now() + 3600000)
    });
    const revokedAuthorityInvitation = await Invitation.create({
      organizationId: organization._id,
      invitedBy: revokedInviter._id,
      role: 'recruiter',
      email: 'revoked-recipient@control-center.test',
      token: randomBytes(24).toString('hex'),
      expiresAt: new Date(Date.now() + 3600000)
    });
    const bytes = Buffer.from('%PDF-1.4 immutable submitted evidence');
    const applicationId = createHash('sha256')
      .update(`${published._id}:${applicant._id}`)
      .digest('hex');
    const submittedAt = new Date();
    await Application.collection.insertOne({
      _id: applicationId,
      jobId: published._id,
      recruiterId: owner._id,
      organizationId: organization._id,
      applicantId: applicant._id,
      applicantName: applicant.name,
      organizationName: organization.name,
      jobTitle: published.title,
      resume: {
        fileName: 'submitted.pdf',
        sha256: createHash('sha256').update(bytes).digest('hex')
      },
      resumeBytes: bytes,
      portfolio: {
        headline: 'Immutable private portfolio snapshot',
        skills: ['TypeScript'],
        projects: []
      },
      consent: { version: 'direct-apply-v1', submittedAt, sharePortfolio: true },
      status: 'submitted',
      history: [{ from: '', to: 'submitted', actorId: applicant._id, at: submittedAt }],
      createdAt: submittedAt,
      updatedAt: submittedAt,
      __v: 0
    });
    await Shortlist.create({
      organizationId: organization._id,
      recruiterId: owner._id,
      jobId: published._id,
      candidateId: applicant._id,
      applicationId,
      notes: 'Owner-only private application notes'
    });
    app.use(express.static(dist));
    app.use((request, response) =>
      request.path.startsWith('/api/')
        ? response.status(404).json({ message: 'Unknown fixture endpoint.' })
        : response.sendFile(path.join(dist, 'index.html'))
    );
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const origin = `http://127.0.0.1:${server.address().port}`;
    const request = async (actor, route, body, method = body === undefined ? 'GET' : 'POST') => {
      const response = await fetch(origin + route, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(actor ? { Authorization: `Bearer ${sign(actor)}` } : {})
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(20000)
      });
      return {
        status: response.status,
        data: response.headers.get('content-type')?.includes('application/json')
          ? await response.json()
          : Buffer.from(await response.arrayBuffer())
      };
    };
    const chrome = [
      'C:/Program Files/Google/Chrome/Application/chrome.exe',
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
    ].find((file) => fs.existsSync(file));
    browser = await playwright().chromium.launch({
      headless: true,
      ...(chrome ? { executablePath: chrome } : {})
    });
    async function session(
      actor,
      org,
      profile = { width: 1440, height: 900, theme: 'light', scheme: 'light' }
    ) {
      const context = await browser.newContext({
        viewport: { width: profile.width, height: profile.height },
        colorScheme: profile.scheme || 'light',
        reducedMotion: 'reduce'
      });
      await context.addInitScript(
        ({ token, actor, organization, theme }) => {
          localStorage.setItem('token', token);
          localStorage.setItem('user', JSON.stringify(actor));
          localStorage.setItem('loginExpiry', String(Date.now() + 3600000));
          if (organization) {
            localStorage.setItem(
              'devinsight_tenant_context',
              JSON.stringify({
                organizationId: organization.id,
                organizationName: organization.name,
                myRole: actor.role === 'admin' ? 'admin' : 'member',
                teamId: '',
                teamName: ''
              })
            );
          }
          localStorage.setItem('devinsight_theme', theme);
          localStorage.setItem('devinsight_resume_prompt_permanent_dismiss', 'true');
        },
        {
          token: sign(actor),
          actor: {
            _id: actor.id,
            name: actor.name,
            email: actor.email,
            role: actor.role,
            organizationId: org ? org.id : null,
            isVerified: true
          },
          organization: org ? { id: org.id, name: org.name } : null,
          theme: profile.theme
        }
      );
      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      await page.route('**/*', (route) => {
        const url = new URL(route.request().url());
        if (url.origin === origin) return route.continue();
        assert.ok(!url.pathname.startsWith('/api/'), 'No external application API substitutions.');
        return route.fulfill({
          status: 200,
          contentType: route.request().resourceType() === 'stylesheet' ? 'text/css' : 'text/plain',
          body: ''
        });
      });
      page.on('console', (message) => {
        if (message.type() === 'error')
          (expectedFault ? result.expectedHttp : result.consoleErrors).push(message.text());
      });
      page.on('pageerror', (error) => result.runtimeErrors.push(error.message));
      page.on('response', (response) => {
        if (response.url().includes('/api/') && response.status() >= 400)
          (expectedFault ? result.expectedHttp : result.unexpectedHttp).push({
            path: new URL(response.url()).pathname,
            status: response.status()
          });
      });
      return { context, page };
    }
    const pages = [
      ['organization', 'Organization overview'],
      ['organization/settings', 'General settings'],
      ['organization/policies', 'Policies & permissions'],
      ['organization/members', 'Members & access'],
      ['organization/invitations', 'Invitations'],
      ['organization/usage', 'Resource usage']
    ];
    async function go(page, route, heading, { forceReload = false } = {}) {
      const targetPath = '/app/' + route.split('?')[0];
      const currentUrl = page.url();
      const inSpa = currentUrl.startsWith(origin + '/app/');
      if (!forceReload && inSpa && !route.includes('?')) {
        if (new URL(currentUrl).pathname !== targetPath) {
          let link = page.locator(`a[href="${targetPath}"]`).first();
          if (!(await link.isVisible().catch(() => false))) {
            const menuButton = page
              .locator(
                'button[aria-controls="application-navigation"], button[aria-label*="navigation" i], button.menu-btn, button.menu-toggle'
              )
              .first();
            if (await menuButton.isVisible().catch(() => false)) {
              await menuButton.click();
              await page.waitForTimeout(150);
            }
          }
          if (!(await link.isVisible().catch(() => false))) {
            const orgToggle = page
              .locator('aside#application-navigation button[aria-label*="Organization" i]')
              .first();
            if (await orgToggle.isVisible().catch(() => false)) {
              await orgToggle.click();
              await page.waitForTimeout(150);
            }
          }
          if (await link.isVisible().catch(() => false)) {
            await link.click();
          } else {
            await page.goto(origin + '/app/' + route, { waitUntil: 'domcontentloaded' });
          }
        }
      } else {
        await page.goto(origin + '/app/' + route, { waitUntil: 'domcontentloaded' });
      }
      if (heading)
        await page.getByRole('heading', { level: 1, name: heading, exact: true }).waitFor();
      await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'));
      await page.waitForFunction(
        () =>
          !document.querySelector('app-recruiter-loader') &&
          !document.body.innerText.includes('Checking organization permissions')
      );
    }
    async function shot(page, name) {
      await page.screenshot({
        path: path.join(output, 'screenshots', name + '.png'),
        fullPage: true
      });
    }
    const primary = await session(admin, organization);
    const editor = primary.page;
    await go(editor, 'admin/organization/settings', 'General settings');
    await editor.locator('#industry').fill('Responsible technology');
    const saved = editor.waitForResponse(
      (response) =>
        response.request().method() === 'PATCH' && response.url().endsWith('/governance')
    );
    await editor.getByRole('button', { name: 'Save organization', exact: true }).click();
    assert.equal((await saved).status(), 200);
    await editor.getByText('Organization settings saved.', { exact: true }).waitFor();
    await editor.reload();
    await editor.locator('#industry').waitFor();
    assert.equal(await editor.locator('#industry').inputValue(), 'Responsible technology');
    result.checks.metadataPersistence = true;
    for (const [id, title] of policies) {
      await go(editor, 'admin/organization/policies', 'Policies & permissions');
      const versionBefore = (await Organization.findById(organization._id)).governance.version;
      const countBefore = result.requests.filter(
        (row) => row.path === '/api/admin-console/governance' && row.method === 'PATCH'
      ).length;
      await editor.getByRole('checkbox', { name: title, exact: true }).uncheck();
      assert.equal(
        result.requests.filter(
          (row) => row.path === '/api/admin-console/governance' && row.method === 'PATCH'
        ).length,
        countBefore
      );
      await editor.getByRole('button', { name: 'Review and save policies' }).click();
      const commit = editor.waitForResponse(
        (response) =>
          response.request().method() === 'PATCH' && response.url().endsWith('/governance')
      );
      await editor.getByRole('button', { name: 'Save policies', exact: true }).click();
      assert.equal((await commit).status(), 200);
      await editor.getByText('Organization policies saved.', { exact: false }).waitFor();
      const off = await Organization.findById(organization._id).lean();
      assert.equal(off.governance.policies[id], false);
      assert.equal(off.governance.version, versionBefore + 1);
      let denial;
      if (id === 'recruiterJobCreation') {
        const actor = await session(owner, organization);
        await go(actor.page, 'recruiter/jobs', 'Jobs');
        assert.equal(await actor.page.getByTestId('toggle-job-editor').isDisabled(), true);
        await shot(actor.page, 'recruiter-job-creation-restricted');
        await actor.context.close();
        denial = await request(owner, '/api/recruiter-hub/jobs', {
          title: 'Denied creation',
          role: 'Engineer',
          requiredSkills: ['TypeScript'],
          stack: 'Full Stack',
          location: 'Remote',
          status: 'draft'
        });
      }
      if (id === 'recruiterJobPublication') {
        const data = await request(owner, `/api/recruiter-hub/jobs/${job.id}`);
        denial = await request(
          owner,
          `/api/recruiter-hub/jobs/${job.id}`,
          { published: true, expectedVersion: data.data.job.version },
          'PATCH'
        );
        assert.equal((await Job.findById(published._id)).published, true);
      }
      if (id === 'teamSharedJobs') {
        denial = await request(manager, `/api/recruiter-hub/jobs/${job.id}`);
        assert.equal((await Job.findById(job._id)).teamShared, true);
        const actor = await session(manager, organization);
        await go(actor.page, 'recruiter/jobs', 'Jobs');
        assert.equal(await actor.page.getByText(job.title, { exact: true }).count(), 0);
        await shot(actor.page, 'team-job-sharing-withdrawn');
        await actor.context.close();
      }
      if (id === 'sharedPublicEvaluations') {
        denial = await request(manager, `/api/recruiter-hub/matches?jobId=${job.id}`);
        const metadata = await request(manager, `/api/recruiter-hub/jobs/${job.id}`);
        assert.equal(metadata.status, 200);
        assert.equal(metadata.data.job.access.evaluationView, false);
        assert.equal((await Job.findById(job._id)).evaluationShared, true);
      }
      if (id === 'teamManagerEvaluationManagement') {
        denial = await request(
          manager,
          `/api/recruiter-hub/shortlists/${shortlist.id}`,
          { notes: 'Denied manager overwrite', expectedVersion: 0 },
          'PATCH'
        );
        const actor = await session(manager, organization);
        await go(actor.page, 'recruiter/shortlists', 'Shortlists');
        await actor.page.getByText('Retained shared public assessment', { exact: true }).waitFor();
        assert.equal(
          await actor.page.getByRole('button', { name: 'Edit Note', exact: true }).count(),
          0
        );
        await shot(actor.page, 'team-evaluation-read-only');
        await actor.context.close();
        assert.equal(
          (await Shortlist.findById(shortlist._id)).notes,
          'Retained shared public assessment'
        );
      }
      if (id === 'candidateMatching') {
        denial = await request(owner, '/api/recruiter-hub/matches/generate', { jobId: job.id });
        const actor = await session(owner, organization);
        await go(actor.page, `recruiter/matches?jobId=${job.id}`, 'Matches');
        assert.equal(
          await actor.page
            .getByRole('button', { name: 'Generate Matches', exact: true })
            .isDisabled(),
          true
        );
        await shot(actor.page, 'recruiter-matching-restricted');
        await actor.context.close();
        assert.equal((await request(owner, '/api/recruiter-hub/candidates')).status, 200);
      }
      if (id === 'invitationCreation') {
        denial = await request(recipient, `/api/tenant/invitations/${invitation.id}/accept`, {});
        await go(editor, 'admin/organization/invitations', 'Invitations');
        assert.equal(
          await editor.getByRole('button', { name: 'Create invitation', exact: true }).isDisabled(),
          true
        );
        assert.equal(
          await editor.getByRole('button', { name: 'Resend', exact: true }).first().isDisabled(),
          true
        );
        assert.equal(
          await editor.getByRole('button', { name: 'Revoke', exact: true }).first().isEnabled(),
          true
        );
        await shot(editor, 'admin-invitation-policy-restricted');
      }
      if (id === 'managerTeamAdministration')
        denial = await request(manager, `/api/tenant/organizations/${organization.id}/teams`, {
          name: 'Denied manager team',
          slug: 'denied-manager-team'
        });
      assert.ok(
        [403, 404].includes(denial.status),
        `${id} direct request must be denied; received ${denial.status}`
      );
      assert.equal((await Organization.findById(foreign._id)).governance.version, 0);
      const other = await request(foreignRecruiter, '/api/recruiter-hub/capabilities');
      assert.equal(other.status, 200);
      assert.equal(other.data.capabilities.candidateMatching.allowed, true);
      await go(editor, 'admin/organization/policies', 'Policies & permissions');
      await editor.getByRole('checkbox', { name: title, exact: true }).check();
      await editor.getByRole('button', { name: 'Review and save policies' }).click();
      const restore = editor.waitForResponse(
        (response) =>
          response.request().method() === 'PATCH' && response.url().endsWith('/governance')
      );
      await editor.getByRole('button', { name: 'Save policies', exact: true }).click();
      assert.equal((await restore).status(), 200);
      await editor.getByText('Organization policies saved.', { exact: false }).waitFor();
      const on = await Organization.findById(organization._id).lean();
      assert.equal(on.governance.policies[id], true);
      assert.equal(on.governance.version, versionBefore + 2);
      result.policyChecks.push({
        id,
        uiOff: true,
        directDeniedStatus: denial.status,
        uiOn: true,
        persistedVersion: on.governance.version,
        organizationBUnchanged: true
      });
    }
    assert.equal(
      (await request(manager, `/api/recruiter-hub/jobs/${job.id}`)).data.job.access
        .evaluationManage,
      true
    );
    const revoked = await request(null, '/api/auth/accept-invite', {
      token: revokedAuthorityInvitation.token,
      password: 'Disposable-Password-77!'
    });
    assert.equal(revoked.status, 403);
    assert.equal(await User.countDocuments({ email: revokedAuthorityInvitation.email }), 0);
    result.checks.revokedInviterNotRestored = true;
    const second = await session(secondAdmin, organization);
    await go(editor, 'admin/organization/settings', 'General settings');
    await go(second.page, 'admin/organization/settings', 'General settings');
    await editor.locator('#description').fill('First administrator committed description');
    await second.page.locator('#description').fill('Second administrator unsaved description');
    const firstSave = editor.waitForResponse(
      (response) =>
        response.request().method() === 'PATCH' && response.url().endsWith('/governance')
    );
    await editor.getByRole('button', { name: 'Save organization', exact: true }).click();
    assert.equal((await firstSave).status(), 200);
    await editor.getByText('Organization settings saved.', { exact: true }).waitFor();
    expectedFault = true;
    const stale = second.page.waitForResponse((response) => response.status() === 409);
    await second.page.getByRole('button', { name: 'Save organization', exact: true }).click();
    assert.equal((await stale).status(), 409);
    await second.page.getByRole('heading', { name: 'Review concurrent changes' }).waitFor();
    assert.equal(
      await second.page.locator('#description').inputValue(),
      'Second administrator unsaved description'
    );
    assert.equal(
      await second.page
        .getByRole('button', { name: 'Save organization', exact: true })
        .isDisabled(),
      true
    );
    await second.page.getByRole('button', { name: 'I reviewed the server changes' }).click();
    const secondSave = second.page.waitForResponse(
      (response) =>
        response.request().method() === 'PATCH' && response.url().endsWith('/governance')
    );
    await second.page.getByRole('button', { name: 'Save organization', exact: true }).click();
    assert.equal((await secondSave).status(), 200);
    await second.page.getByText('Organization settings saved.', { exact: true }).waitFor();
    expectedFault = false;
    result.checks.staleForm = { status: 409, preservedDraft: true, explicitReviewAndNewSave: true };
    await second.context.close();
    // Simultaneous restrictive public policies leave the private application workflow independent.
    const current = await request(admin, '/api/admin-console/governance');
    assert.equal(
      (
        await request(
          admin,
          '/api/admin-console/governance',
          {
            expectedVersion: current.data.version,
            policies: {
              candidateMatching: false,
              teamSharedJobs: false,
              sharedPublicEvaluations: false
            }
          },
          'PATCH'
        )
      ).status,
      200
    );
    const privateSession = await session(owner, organization);
    await go(privateSession.page, 'recruiter/shortlists?source=applications', 'Shortlists');
    await privateSession.page.getByText(applicant.name, { exact: true }).first().waitFor();
    assert.equal(
      await privateSession.page
        .getByRole('button', { name: 'Edit Note', exact: true })
        .first()
        .isEnabled(),
      true
    );
    await shot(privateSession.page, 'private-applications-preserved');
    await privateSession.context.close();
    const resumeRoute = `/api/recruiter-hub/jobs/${published.id}/applications/${applicationId}/resume`;
    const resume = await request(owner, resumeRoute);
    assert.equal(resume.status, 200);
    assert.deepEqual(resume.data, bytes);
    assert.ok([403, 404].includes((await request(manager, resumeRoute)).status));
    assert.equal(
      (
        await request(applicant, `/api/jobs/internal/applications/${applicationId}/withdraw`, {
          expectedStatus: 'submitted'
        })
      ).status,
      200
    );
    const retained = await Application.findById(applicationId).select('+resumeBytes').lean();
    assert.equal(retained.status, 'withdrawn');
    assert.equal(String(retained.recruiterId), owner.id);
    assert.equal(retained.portfolio.headline, 'Immutable private portfolio snapshot');
    result.checks.privateApplicationPreserved = true;
    const restricted = await request(admin, '/api/admin-console/governance');
    await request(
      admin,
      '/api/admin-console/governance',
      {
        expectedVersion: restricted.data.version,
        policies: { candidateMatching: true, teamSharedJobs: true, sharedPublicEvaluations: true }
      },
      'PATCH'
    );
    // Provider delivery is displayed honestly by the actual invitation creation form.
    await go(editor, 'admin/organization/invitations', 'Invitations');
    await editor
      .getByRole('textbox', { name: 'Name', exact: true })
      .fill('Local invitation recipient');
    await editor
      .getByRole('textbox', { name: 'Email', exact: true })
      .fill('new-recipient@control-center.test');
    await editor.getByRole('button', { name: 'Create invitation', exact: true }).click();
    await editor.getByText('Email was not delivered.', { exact: false }).waitFor();
    result.checks.deliveryFailureHonest = true;
    const profiles = [
      { width: 1440, height: 900, theme: 'light', scheme: 'light' },
      { width: 1440, height: 900, theme: 'dark', scheme: 'dark' },
      { width: 1024, height: 768, theme: 'system', scheme: 'light' },
      { width: 768, height: 1024, theme: 'light', scheme: 'light' },
      { width: 390, height: 844, theme: 'light', scheme: 'light' },
      { width: 390, height: 844, theme: 'dark', scheme: 'dark' },
      { width: 320, height: 640, theme: 'light', scheme: 'light' }
    ];
    for (const profile of profiles) {
      const view = await session(admin, organization, profile);
      for (const [route, heading] of pages) {
        await go(view.page, 'admin/' + route, heading);
        const overflow = await view.page.evaluate(() => ({
          document: document.documentElement.scrollWidth,
          viewport: innerWidth
        }));
        assert.ok(
          overflow.document <= overflow.viewport + 1,
          `${route} overflows ${profile.width}`
        );
        const name = `${profile.width}-${profile.height}-${profile.theme}-${route.replaceAll('/', '-')}`;
        await shot(view.page, name);
        result.profiles.push({
          ...profile,
          route,
          overflow: false,
          screenshot: `screenshots/${name}.png`
        });
      }
      await view.context.close();
    }
    const navigation = await session(owner, organization);
    await go(navigation.page, 'recruiter/jobs', 'Jobs');
    const countStart = result.requests.filter((row) => row.path.endsWith('/capabilities')).length;
    for (const [label, heading] of [
      ['Match Results', 'Matches'],
      ['Shortlists', 'Shortlists'],
      ['Comparison', 'Candidate Comparison'],
      ['Jobs', 'Jobs']
    ]) {
      await navigation.page.getByRole('link', { name: label, exact: true }).first().click();
      await navigation.page
        .getByRole('heading', { name: heading, exact: true, level: 1 })
        .waitFor();
    }
    result.checks.capabilityRequestsDuringSpaNavigation =
      result.requests.filter((row) => row.path.endsWith('/capabilities')).length - countStart;
    assert.ok(result.checks.capabilityRequestsDuringSpaNavigation <= 1);
    await go(navigation.page, 'recruiter/dashboard', null);
    await navigation.page.waitForTimeout(300);
    const recruiterDashOverflow = await navigation.page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1
    );
    assert.ok(recruiterDashOverflow, 'Recruiter dashboard must not overflow');
    await shot(navigation.page, 'existing-recruiter-dashboard');
    await navigation.context.close();

    const devView = await session(publicDeveloper, null);
    await go(devView.page, 'profile', null);
    await devView.page.waitForTimeout(300);
    const devDashOverflow = await devView.page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1
    );
    assert.ok(devDashOverflow, 'Developer profile must not overflow');
    await shot(devView.page, 'existing-developer-profile');
    await devView.context.close();

    await go(editor, 'admin/dashboard', null);
    await editor.waitForTimeout(300);
    const adminDashOverflow = await editor.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1
    );
    assert.ok(adminDashOverflow, 'Admin dashboard must not overflow');
    await shot(editor, 'existing-admin-dashboard');
    result.checks.existingWorkspacesVerified = {
      adminDashboard: adminDashOverflow,
      recruiterDashboard: recruiterDashOverflow,
      developerDashboard: devDashOverflow
    };

    await go(
      editor,
      'admin/activity-logs?action=ORGANIZATION_CONFIGURATION_UPDATED',
      'Activity Logs'
    );
    await editor
      .getByText('ORGANIZATION_CONFIGURATION_UPDATED', { exact: false })
      .first()
      .waitFor();
    await shot(editor, 'governance-audit-activity');
    const audits = await Audit.find({
      organizationId: organization._id,
      action: 'ORGANIZATION_CONFIGURATION_UPDATED'
    }).lean();
    const version = (await Organization.findById(organization._id)).governance.version;
    assert.equal(audits.length, version);
    for (let committed = 1; committed <= version; committed++)
      assert.equal(audits.filter((audit) => audit.after.version === committed).length, 1);
    result.auditCommits = audits.map((audit) => ({
      previousVersion: audit.before.version,
      version: audit.after.version,
      policyFields: Object.keys(audit.after.values).filter((key) =>
        policies.some(([id]) => id === key)
      ),
      metadataFields: Object.keys(audit.after.values.general || {}),
      dashboardChanged: Object.hasOwn(audit.after.values, 'dashboardConfig')
    }));
    assert.equal(result.consoleErrors.length, 0, JSON.stringify(result.consoleErrors));
    assert.equal(result.runtimeErrors.length, 0, JSON.stringify(result.runtimeErrors));
    assert.equal(result.unexpectedHttp.length, 0, JSON.stringify(result.unexpectedHttp));
    result.status = 'passed';
  } catch (error) {
    result.status = 'failed';
    result.failure = error.message;
    throw error;
  } finally {
    await browser?.close();
    if (server) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
    await Promise.allSettled([...pendingAudits]);
    settings.stopSettingsSynchronization();
    await streams.stop();
    await mongoose.disconnect();
    result.cleanup = await mongo.stop();
    fs.writeFileSync(
      path.join(output, 'real-stack-smoke.json'),
      JSON.stringify(result, null, 2) + '\n'
    );
  }
}
main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
