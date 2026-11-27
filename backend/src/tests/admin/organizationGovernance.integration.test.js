const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { randomBytes } = require('node:crypto');
const express = require('express');
const mongoose = require('mongoose');
const { startMongo } = require('../fixtures/disposableRequestMongo');
const settings = require('../../modules/super-admin/services/platformSettingsService');
const User = require('../../modules/auth/models/user');
const Organization = require('../../modules/admin/models/organization');
const Membership = require('../../modules/admin/models/membership');
const Team = require('../../modules/admin/models/team');
const Invitation = require('../../modules/admin/models/invitation');
const AuditLog = require('../../modules/admin/models/auditLog');
const Job = require('../../modules/recruiter/models/Job');
const Match = require('../../modules/recruiter/models/RecruiterMatch');
const Shortlist = require('../../modules/recruiter/models/RecruiterShortlist');
const Application = require('../../modules/jobs/models/jobApplication');
const { sign } = require('../../modules/auth/utils/authSessionToken');
const governance = require('../../modules/admin/services/organizationGovernanceService');
const jobService = require('../../modules/recruiter/services/hub/recruiterJobService');
const { POLICY_CATALOG } = require('../../modules/admin/config/organizationPolicies');

test(
  'organization governance: isolated replica-set enforcement and atomic transitions',
  { timeout: 180000 },
  async (t) => {
    const mongo = await startMongo({ replicaSet: 'organization-governance' });
    const previousSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = randomBytes(32).toString('hex');
    let server;
    t.after(async () => {
      if (server) await new Promise((resolve) => server.close(resolve));
      settings.stopSettingsSynchronization();
      await mongoose.disconnect();
      await mongo.stop();
      if (previousSecret === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = previousSecret;
    });
    await mongoose.connect(mongo.uri);
    await settings.startSettingsSynchronization();
    await settings.updateSettings({
      organization: { recruiterLimitPerOrg: 30, maxTeamsPerOrganization: 30 }
    });
    for (const model of [
      User,
      Organization,
      Membership,
      Team,
      Invitation,
      AuditLog,
      Job,
      Match,
      Shortlist,
      Application
    ])
      await model.init();
    const account = (name, role = 'recruiter', extra = {}) =>
      User.create({
        name,
        email: `${name}@governance.test`,
        role,
        providers: ['github'],
        isVerified: true,
        ...extra
      });
    const admin = await account('admin', 'admin');
    const foreignAdmin = await account('foreign-admin', 'admin');
    const org = await Organization.create({
      name: 'Governed organization',
      slug: 'governed',
      ownerId: admin._id,
      createdBy: admin._id
    });
    const other = await Organization.create({
      name: 'Other organization',
      slug: 'other-governed',
      ownerId: foreignAdmin._id,
      createdBy: foreignAdmin._id
    });
    await User.updateOne({ _id: admin._id }, { $set: { organizationId: org._id } });
    await User.updateOne({ _id: foreignAdmin._id }, { $set: { organizationId: other._id } });
    const owner = await account('recruiter', 'recruiter', { organizationId: org._id });
    const manager = await account('team-manager', 'recruiter', { organizationId: org._id });
    const member = await account('team-member', 'recruiter', { organizationId: org._id });
    const orgManager = await account('org-manager', 'developer', { organizationId: org._id });
    const candidate = await account('public-candidate', 'developer', {
      organizationId: org._id,
      isPublic: true
    });
    const outsider = await account('affiliated-admin', 'admin', { organizationId: org._id });
    const superAdmin = await account('super-admin', 'super_admin', { organizationId: org._id });
    const foreignRecruiter = await account('foreign-recruiter', 'recruiter', {
      organizationId: other._id
    });
    const team = await Team.create({
      organizationId: org._id,
      name: 'Hiring',
      slug: 'hiring',
      createdBy: admin._id
    });
    const secondTeam = await Team.create({
      organizationId: org._id,
      name: 'Second',
      slug: 'second',
      createdBy: admin._id
    });
    await Membership.create([
      { organizationId: org._id, userId: admin._id, role: 'admin' },
      { organizationId: org._id, userId: orgManager._id, role: 'manager' },
      ...[owner, manager, member].map((user) => ({
        organizationId: org._id,
        userId: user._id,
        role: 'member'
      })),
      ...[owner, manager, member].map((user) => ({
        organizationId: org._id,
        userId: user._id,
        teamId: team._id,
        role: user === manager ? 'manager' : 'member'
      })),
      { organizationId: org._id, userId: member._id, teamId: secondTeam._id, role: 'member' }
    ]);
    const email = require('../../core/messaging/emailService');
    const delivery = t.mock.method(email, 'sendRecruiterInvitationEmail', async () => ({
      sent: false,
      reason: 'isolated test provider'
    }));
    const app = express();
    app.use(express.json());
    app.use('/api/admin-console', require('../../modules/admin/routes/adminConsole.routes'));
    app.use('/api/admin', require('../../modules/admin/routes/admin.routes'));
    app.use('/api/tenant', require('../../modules/admin/routes/tenant.routes'));
    app.use('/api/recruiter-hub', require('../../modules/recruiter/routes/hub/recruiterHubRoutes'));
    app.use('/api/recruiter', require('../../modules/recruiter/routes/recruiter.routes'));
    app.post('/api/auth/accept-invite', require('../../modules/auth/authcontroller').acceptInvite);
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}`;
    const request = async (route, method = 'GET', body, actor = admin) => {
      const response = await fetch(base + route, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(actor && { Authorization: `Bearer ${sign(actor)}` })
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
      return { status: response.status, data: await response.json() };
    };
    const policy = async (policies, actor = admin) => {
      const current = await request('/api/admin-console/governance', 'GET', undefined, actor);
      assert.equal(current.status, 200, JSON.stringify(current.data));
      const response = await request(
        '/api/admin-console/governance',
        'PATCH',
        { expectedVersion: current.data.version, policies },
        actor
      );
      assert.equal(response.status, 200, JSON.stringify(response.data));
      return response.data;
    };
    const jobPayload = {
      title: 'Engineer',
      role: 'Engineer',
      description: 'Build useful software',
      stack: 'Full Stack',
      requiredSkills: ['JavaScript'],
      location: 'Remote',
      status: 'draft'
    };
    const ownerScope = { recruiterId: owner.id, organizationId: org.id, sessionRevision: 0 };
    const invite = (extra = {}) =>
      Invitation.create({
        organizationId: org._id,
        email: 'recipient@governance.test',
        invitedBy: admin._id,
        role: 'recruiter',
        token: randomBytes(24).toString('hex'),
        expiresAt: new Date(Date.now() + 60000),
        ...extra
      });
    let shared;
    let match;
    let shortlist;

    await t.test(
      'legacy organizations retain all defaults; organization B stays isolated',
      async () => {
        await Organization.collection.updateOne({ _id: org._id }, { $unset: { governance: '' } });
        const result = await request('/api/admin-console/governance');
        assert.equal(result.status, 200);
        assert.equal(result.data.version, 0);
        assert.deepEqual(
          result.data.policies,
          Object.fromEntries(Object.keys(POLICY_CATALOG).map((key) => [key, true]))
        );
        shared = await jobService.createRecruiterJob({
          ...ownerScope,
          payload: {
            ...jobPayload,
            teamId: team.id,
            teamShared: true,
            evaluationShared: true,
            published: true,
            status: 'open'
          }
        });
        match = await Match.create({
          recruiterId: owner._id,
          organizationId: org._id,
          jobId: shared._id,
          candidateId: candidate._id,
          matchScore: 80
        });
        shortlist = await Shortlist.create({
          recruiterId: owner._id,
          organizationId: org._id,
          jobId: shared._id,
          candidateId: candidate._id,
          notes: 'Retained historical notes'
        });
        await policy({ recruiterJobCreation: false });
        assert.equal(
          (await request('/api/recruiter-hub/jobs', 'POST', jobPayload, owner)).status,
          403
        );
        assert.equal(
          (await request('/api/recruiter-hub/jobs', 'POST', jobPayload, foreignRecruiter)).status,
          201
        );
        assert.equal(
          (await request('/api/admin-console/governance', 'GET', undefined, foreignAdmin)).data
            .policies.recruiterJobCreation,
          true
        );
        await policy({ recruiterJobCreation: true });
      }
    );

    await t.test(
      'exact Admin authority; affiliation, team manager, Developer, Super Admin and foreign resource payloads never grant settings access',
      async () => {
        for (const actor of [owner, manager, orgManager, outsider, superAdmin]) {
          assert.equal(
            (await request('/api/admin-console/governance', 'GET', undefined, actor)).status,
            403
          );
          assert.equal(
            (
              await request(
                '/api/admin-console/governance',
                'PATCH',
                { expectedVersion: 0, policies: { candidateMatching: false } },
                actor
              )
            ).status,
            403
          );
        }
        const current = (await request('/api/admin-console/governance')).data;
        for (const field of [
          'organizationId',
          'ownerId',
          'slug',
          'isSuspended',
          'providerApiKey',
          'limits'
        ]) {
          const response = await request('/api/admin-console/governance', 'PATCH', {
            expectedVersion: current.version,
            general: { [field]: other.id }
          });
          assert.equal(response.status, 400, field);
        }
        assert.equal(
          (
            await request('/api/admin-console/governance', 'PATCH', {
              expectedVersion: current.version,
              organizationId: other.id,
              policies: { candidateMatching: false }
            })
          ).status,
          400
        );
      }
    );

    await t.test(
      'metadata validates types, HTTPS URLs, timezone, exact fields and immutable slug',
      async () => {
        const current = (await request('/api/admin-console/governance')).data;
        for (const general of [
          { name: 'x' },
          { description: 'x'.repeat(501) },
          { website: 'javascript:alert(1)' },
          { website: 'https://example.test/?secret=abc' },
          { timezone: 'Mars/City' },
          { branding: { logoUrl: 'http://example.test/logo' } },
          { industry: [] }
        ]) {
          assert.equal(
            (
              await request('/api/admin-console/governance', 'PATCH', {
                expectedVersion: current.version,
                general
              })
            ).status,
            400
          );
        }
        const response = await request('/api/admin-console/governance', 'PATCH', {
          expectedVersion: current.version,
          general: {
            name: 'Updated organization',
            industry: 'Software',
            website: 'https://example.test',
            timezone: 'Asia/Karachi',
            branding: { logoUrl: 'https://example.test/logo.png' }
          }
        });
        assert.equal(response.status, 200, JSON.stringify(response.data));
        assert.equal(response.data.organization.slug, 'governed');
        assert.equal(response.data.organization.industry, 'Software');
        for (const policies of [{ candidateMatching: 'false' }, { unknown: false }])
          assert.equal(
            (
              await request('/api/admin-console/governance', 'PATCH', {
                expectedVersion: response.data.version,
                policies
              })
            ).status,
            400
          );
      }
    );

    await t.test(
      'optimistic concurrency rejects stale and missing versions across governance and compatibility preferences',
      async () => {
        const current = (await request('/api/admin-console/governance')).data;
        const results = await Promise.all([
          request('/api/admin-console/governance', 'PATCH', {
            expectedVersion: current.version,
            policies: { candidateMatching: false }
          }),
          request('/api/admin-console/governance', 'PATCH', {
            expectedVersion: current.version,
            policies: { recruiterJobCreation: false }
          })
        ]);
        assert.deepEqual(results.map((row) => row.status).sort(), [200, 409]);
        assert.equal(
          (
            await request('/api/admin-console/governance', 'PATCH', {
              policies: { candidateMatching: true }
            })
          ).status,
          400
        );
        assert.equal(
          (
            await request('/api/admin-console/preferences', 'PATCH', {
              expectedVersion: current.version,
              name: 'Stale'
            })
          ).status,
          409
        );
        const preferences = (await request('/api/admin-console/preferences')).data.organization;
        const saved = await request('/api/admin-console/preferences', 'PATCH', {
          expectedVersion: preferences.governanceVersion,
          name: preferences.name,
          description: '',
          dashboardConfig: { showKpiCards: false }
        });
        assert.equal(saved.status, 200, JSON.stringify(saved.data));
        await policy({ candidateMatching: true, recruiterJobCreation: true });
      }
    );

    await t.test(
      'configuration audit failure rolls back policy and metadata; safe old/new values are retained',
      async () => {
        const before = (await request('/api/admin-console/governance')).data;
        const count = await AuditLog.countDocuments({
          action: 'ORGANIZATION_CONFIGURATION_UPDATED'
        });
        const original = AuditLog.create;
        AuditLog.create = async () => {
          throw new Error('Injected audit persistence failure');
        };
        try {
          const result = await request('/api/admin-console/governance', 'PATCH', {
            expectedVersion: before.version,
            general: { name: 'Must roll back' },
            policies: { candidateMatching: false }
          });
          assert.equal(result.status, 500);
        } finally {
          AuditLog.create = original;
        }
        const after = (await request('/api/admin-console/governance')).data;
        assert.equal(after.version, before.version);
        assert.equal(after.organization.name, before.organization.name);
        assert.equal(after.policies.candidateMatching, true);
        assert.equal(
          await AuditLog.countDocuments({ action: 'ORGANIZATION_CONFIGURATION_UPDATED' }),
          count
        );
        const audit = await AuditLog.findOne({
          action: 'ORGANIZATION_CONFIGURATION_UPDATED',
          'after.values.general.name': { $exists: true }
        }).lean();
        assert.equal(audit.after.values.general.name, '[REDACTED]');
        assert.equal(String(audit.actor), admin.id);
        assert.equal(String(audit.organizationId), org.id);
        assert.ok(audit.timestamp);
        assert.ok(!JSON.stringify(audit).includes('https://example.test'));
      }
    );

    await t.test(
      'job creation is enforced through both current and compatibility APIs, including team managers',
      async () => {
        await policy({ recruiterJobCreation: false });
        for (const actor of [owner, manager])
          for (const route of ['/api/recruiter-hub/jobs', '/api/recruiter/job'])
            assert.equal((await request(route, 'POST', jobPayload, actor)).status, 403);
        assert.equal(
          (await request('/api/admin/jobs', 'POST', jobPayload)).status,
          201,
          'Existing Admin resource authority remains separate'
        );
        await policy({ recruiterJobCreation: true });
      }
    );

    await t.test(
      'publication restriction blocks new publication and reopening; drafts, published history and closing remain',
      async () => {
        await policy({ recruiterJobPublication: false });
        assert.equal(
          (
            await request(
              '/api/recruiter-hub/jobs',
              'POST',
              { ...jobPayload, published: true },
              owner
            )
          ).status,
          403
        );
        const draft = await jobService.createRecruiterJob({ ...ownerScope, payload: jobPayload });
        assert.equal(
          (
            await request(
              `/api/recruiter-hub/jobs/${draft._id}`,
              'PATCH',
              { published: true },
              owner
            )
          ).status,
          403
        );
        assert.equal((await Job.findById(shared._id)).published, true);
        assert.equal(
          (
            await request(
              `/api/recruiter-hub/jobs/${shared._id}`,
              'PATCH',
              { status: 'closed' },
              owner
            )
          ).status,
          200
        );
        for (const [route, method, actor] of [
          [`/api/recruiter-hub/jobs/${shared._id}`, 'PATCH', manager],
          [`/api/recruiter/job/${shared._id}`, 'PUT', owner]
        ])
          assert.equal((await request(route, method, { status: 'open' }, actor)).status, 403);
        await policy({ recruiterJobPublication: true });
        await jobService.updateRecruiterJob({
          ...ownerScope,
          jobId: shared._id,
          payload: { status: 'open' }
        });
      }
    );

    await t.test(
      'sharing restriction revokes existing job reads and mutations without erasing ownership or history',
      async () => {
        await policy({ teamSharedJobs: false });
        assert.equal(
          (await request(`/api/recruiter-hub/jobs/${shared._id}`, 'GET', undefined, manager))
            .status,
          404
        );
        assert.equal(
          (
            await request(
              `/api/recruiter-hub/jobs/${shared._id}`,
              'PATCH',
              { title: 'Bypass' },
              manager
            )
          ).status,
          404
        );
        const list = await request('/api/recruiter-hub/jobs', 'GET', undefined, member);
        assert.ok(!list.data.jobs.some((job) => String(job._id) === String(shared._id)));
        assert.equal(
          (await request(`/api/recruiter-hub/jobs/${shared._id}`, 'GET', undefined, owner)).status,
          200
        );
        assert.equal((await Job.findById(shared._id)).teamShared, true);
        assert.equal(await Match.countDocuments({ _id: match._id }), 1);
        assert.equal(await Shortlist.countDocuments({ _id: shortlist._id }), 1);
        await policy({ teamSharedJobs: true });
      }
    );

    await t.test(
      'evaluation sharing revokes retained shared matches/shortlists; manager management is separately restricted',
      async () => {
        await policy({ sharedPublicEvaluations: false });
        for (const route of [
          `/api/recruiter-hub/matches?jobId=${shared._id}`,
          `/api/recruiter-hub/shortlists?jobId=${shared._id}`
        ])
          assert.equal((await request(route, 'GET', undefined, manager)).status, 404);
        assert.equal(
          (await request(`/api/recruiter-hub/jobs/${shared._id}`, 'GET', undefined, manager))
            .status,
          200
        );
        await policy({ sharedPublicEvaluations: true, teamManagerEvaluationManagement: false });
        assert.equal(
          (
            await request(
              `/api/recruiter-hub/matches?jobId=${shared._id}`,
              'GET',
              undefined,
              manager
            )
          ).status,
          200
        );
        assert.equal(
          (
            await request(
              `/api/recruiter-hub/matches/${match.id}/status`,
              'PATCH',
              { status: 'rejected' },
              manager
            )
          ).status,
          403
        );
        assert.equal(
          (
            await request(
              `/api/recruiter-hub/shortlists/${shortlist.id}`,
              'PATCH',
              { notes: 'Bypass' },
              manager
            )
          ).status,
          403
        );
        assert.equal(
          (
            await request(
              '/api/recruiter-hub/matches/generate',
              'POST',
              { jobId: String(shared._id), candidateIds: [candidate.id] },
              manager
            )
          ).status,
          403
        );
        assert.equal(
          (
            await request(
              `/api/recruiter-hub/shortlists/${shortlist.id}`,
              'PATCH',
              { notes: 'Owner retained' },
              owner
            )
          ).status,
          200
        );
        await policy({ teamManagerEvaluationManagement: true });
      }
    );

    await t.test(
      'shared-policy transitions preserve submitted evidence and exact creator-only application access',
      async () => {
        const applications = require('../../modules/jobs/services/jobApplicationService');
        const applicationId = applications.canonicalApplicationId(shared._id, candidate._id);
        const bytes = Buffer.from('isolated immutable application evidence');
        await Application.create({
          _id: applicationId,
          organizationId: org._id,
          organizationName: org.name,
          recruiterId: owner._id,
          jobId: shared._id,
          jobTitle: shared.title,
          applicantId: candidate._id,
          applicantName: candidate.name,
          resume: { fileName: 'fixture.pdf' },
          resumeBytes: bytes,
          consent: { version: 'direct-apply-v1', submittedAt: new Date(), sharePortfolio: false }
        });
        await policy({ teamSharedJobs: false, sharedPublicEvaluations: false });
        const submitted = await applications.submittedResume(
          ownerScope,
          String(shared._id),
          applicationId
        );
        assert.deepEqual(
          Buffer.isBuffer(submitted) ? submitted : Buffer.from(submitted.buffer),
          bytes
        );
        await assert.rejects(
          applications.submittedResume(
            { recruiterId: manager.id, organizationId: org.id },
            String(shared._id),
            applicationId
          ),
          (error) => error.statusCode === 404
        );
        const retained = await Application.findById(applicationId).select('+resumeBytes').lean();
        assert.deepEqual(
          retained.resumeBytes.buffer
            ? Buffer.from(retained.resumeBytes.buffer)
            : retained.resumeBytes,
          bytes
        );
        assert.equal(retained.status, 'submitted');
        assert.equal(String(retained.recruiterId), owner.id);
        await policy({ teamSharedJobs: true, sharedPublicEvaluations: true });
      }
    );

    await t.test(
      'matching restriction covers generation, legacy match/rank and comparison scoring; history and discovery survive',
      async () => {
        await policy({ candidateMatching: false });
        for (const [route, body] of [
          [
            '/api/recruiter-hub/matches/generate',
            { jobId: String(shared._id), candidateIds: [candidate.id] }
          ],
          ['/api/recruiter/match', { jobId: String(shared._id) }],
          ['/api/recruiter/ai-rank', { job: jobPayload, candidates: [{ id: candidate.id }] }],
          [
            '/api/recruiter-hub/comparison',
            { jobId: String(shared._id), candidateIds: [candidate.id, owner.id] }
          ]
        ])
          assert.equal((await request(route, 'POST', body, owner)).status, 403, route);
        assert.equal(
          (await request(`/api/recruiter-hub/matches?jobId=${shared._id}`, 'GET', undefined, owner))
            .status,
          200
        );
        assert.equal(
          (await request('/api/recruiter/candidates', 'GET', undefined, owner)).status,
          200
        );
        await policy({ candidateMatching: true });
      }
    );

    await t.test(
      'invitation restriction blocks all creation/resend/acceptance paths while preserving revocation and existing memberships',
      async () => {
        const pending = await invite();
        const onboarding = await invite({ role: 'member', email: 'onboarding@governance.test' });
        const recipient = await account('recipient', 'developer');
        const beforeMemberships = await Membership.countDocuments();
        await policy({ invitationCreation: false });
        const beforeDeliveries = delivery.mock.callCount();
        for (const route of ['/api/admin/invite-recruiter', '/api/admin/recruiter'])
          assert.equal(
            (await request(route, 'POST', { name: 'Invite', email: 'new@governance.test' })).status,
            403
          );
        assert.equal(
          (
            await request(
              `/api/tenant/organizations/${org.id}/invitations`,
              'POST',
              { email: 'member@governance.test', role: 'member' },
              orgManager
            )
          ).status,
          403
        );
        assert.equal(
          (await request(`/api/admin/invitations/${pending.id}/resend`, 'POST', {})).status,
          403
        );
        for (const [route, actor, body] of [
          [`/api/tenant/invitations/${pending.id}/accept`, recipient, {}],
          [`/api/tenant/invitations/accept/${pending.token}`, recipient, {}],
          [
            `/api/tenant/invitations/accept/${onboarding.token}/onboard`,
            null,
            { password: 'Fixture-Hiring-92!', name: 'Recipient' }
          ],
          [
            '/api/auth/accept-invite',
            null,
            { token: pending.token, password: 'Fixture-Hiring-92!' }
          ]
        ])
          assert.equal((await request(route, 'POST', body, actor)).status, 403, route);
        assert.equal(delivery.mock.callCount(), beforeDeliveries);
        assert.equal((await Invitation.findById(pending._id)).status, 'pending');
        assert.equal(await Membership.countDocuments(), beforeMemberships);
        assert.equal(
          (await request(`/api/admin/invitations/${pending.id}/revoke`, 'PATCH', {})).status,
          200
        );
        assert.equal((await Invitation.findById(pending._id)).status, 'revoked');
        await policy({ invitationCreation: true });
        const accepted = await invite();
        assert.equal(
          (await request(`/api/tenant/invitations/${accepted.id}/accept`, 'POST', {}, recipient))
            .status,
          200
        );
        assert.equal((await Invitation.findById(accepted._id)).status, 'accepted');
      }
    );

    await t.test(
      'organization manager team administration remains subordinate; Admin recovery and account-role boundaries remain',
      async () => {
        await policy({ managerTeamAdministration: false });
        assert.equal(
          (
            await request(
              `/api/tenant/organizations/${org.id}/teams`,
              'POST',
              { name: 'Forbidden team' },
              orgManager
            )
          ).status,
          403
        );
        const membership = await Membership.findOne({ userId: member._id, teamId: team._id });
        assert.equal(
          (
            await request(
              `/api/tenant/memberships/${membership.id}/role`,
              'PATCH',
              { role: 'member' },
              orgManager
            )
          ).status,
          403
        );
        assert.equal(
          (
            await request(
              `/api/tenant/memberships/${membership.id}/role`,
              'PATCH',
              { role: 'member' },
              manager
            )
          ).status,
          403
        );
        assert.equal(
          (await request('/api/admin-console/teams', 'POST', { name: 'Admin recovery' })).status,
          201
        );
        assert.equal((await User.findById(member._id)).role, 'recruiter');
        await policy({ managerTeamAdministration: true });
      }
    );

    await t.test(
      'directory distinguishes memberships, teams and account activity without public talent or duplicate users',
      async () => {
        const directory = await request('/api/admin-console/members');
        assert.equal(directory.status, 200);
        const ids = directory.data.members.map((user) => user._id);
        assert.equal(new Set(ids).size, ids.length);
        assert.ok(!ids.includes(candidate.id));
        const row = directory.data.members.find((user) => user._id === member.id);
        assert.equal(row.accountRole, 'recruiter');
        assert.equal(row.organizationMembership.role, 'member');
        assert.equal(row.teams.length, 2);
        assert.equal(directory.data.publicDevelopersIncluded, false);
        assert.ok(!JSON.stringify(directory.data).includes('password'));
        assert.equal(
          (await request('/api/admin-console/members', 'GET', undefined, outsider)).status,
          403
        );
      }
    );

    await t.test(
      'invitation workspace derives expiry and retains all lifecycle states without tokens',
      async () => {
        const expired = await invite({
          expiresAt: new Date(Date.now() - 1000),
          email: 'expired@governance.test'
        });
        await invite({ status: 'accepted', email: 'accepted@governance.test' });
        const result = await request('/api/admin-console/invitations');
        assert.equal(result.status, 200);
        assert.ok(result.data.invitations.some((row) => row.status === 'accepted'));
        assert.ok(result.data.invitations.some((row) => row.status === 'revoked'));
        assert.equal(
          result.data.invitations.find((row) => row._id === expired.id).status,
          'expired'
        );
        assert.equal(
          (await Invitation.findById(expired._id)).status,
          'pending',
          'Read must not modify historical state'
        );
        assert.ok(!JSON.stringify(result.data).includes('token'));
        assert.equal((await request('/api/admin-console/invitations?status=invalid')).status, 400);
      }
    );

    await t.test(
      'platform restriction cannot be overridden; capability reasons reflect effective platform and organization constraints',
      async () => {
        await policy({ candidateMatching: false });
        let capabilities = await request(
          '/api/recruiter-hub/capabilities',
          'GET',
          undefined,
          owner
        );
        assert.equal(
          capabilities.data.capabilities.candidateMatching.reason,
          'organization_policy'
        );
        await settings.updateSettings({ recruiter: { enableRecruiterAccess: false } });
        for (const route of ['/api/recruiter-hub/capabilities', '/api/recruiter/capabilities']) {
          capabilities = await request(route, 'GET', undefined, owner);
          assert.equal(capabilities.status, 200);
          assert.equal(capabilities.data.capabilities.candidateMatching.reason, 'platform_policy');
        }
        await policy({ candidateMatching: true });
        await assert.rejects(
          jobService.createRecruiterJob({ ...ownerScope, payload: jobPayload }),
          (error) => error.restriction?.reason === 'platform_policy'
        );
        assert.equal(
          (await request('/api/recruiter-hub/jobs', 'POST', jobPayload, owner)).status,
          403
        );
        await settings.updateSettings({
          recruiter: { enableRecruiterAccess: true, candidateVisibility: 'private' }
        });
        assert.equal(
          (await request('/api/recruiter/ai-rank', 'POST', { job: jobPayload }, owner)).status,
          403
        );
        await settings.updateSettings({ recruiter: { candidateVisibility: 'public' } });
        capabilities = await request('/api/recruiter-hub/capabilities', 'GET', undefined, owner);
        assert.equal(capabilities.data.capabilities.invitationCreation.reason, 'role_or_ownership');
      }
    );

    await t.test(
      'capacity remains serialized across both team creation APIs and direct Recruiter activation',
      async () => {
        const teamCount = await Team.countDocuments({ organizationId: org._id });
        await settings.updateSettings({ organization: { maxTeamsPerOrganization: teamCount + 1 } });
        const teams = await Promise.all([
          request('/api/admin-console/teams', 'POST', { name: 'Capacity console' }),
          request(`/api/tenant/organizations/${org.id}/teams`, 'POST', { name: 'Capacity tenant' })
        ]);
        assert.deepEqual(teams.map((row) => row.status).sort(), [201, 400].sort());
        const inactive = await account('inactive-seat', 'recruiter', {
          organizationId: org._id,
          isActive: false
        });
        const active = await User.countDocuments({
          organizationId: org._id,
          role: 'recruiter',
          isActive: { $ne: false }
        });
        await settings.updateSettings({ organization: { recruiterLimitPerOrg: active + 1 } });
        const seats = await Promise.all([
          request(`/api/admin/recruiters/${inactive.id}/active`, 'PATCH', { isActive: true }),
          request('/api/admin/recruiters/direct', 'POST', {
            name: 'Capacity direct',
            email: 'capacity-direct@governance.test',
            password: 'Fixture-Hiring-92!'
          })
        ]);
        assert.equal(seats.filter((row) => row.status < 300).length, 1, JSON.stringify(seats));
        assert.equal(
          await User.countDocuments({
            organizationId: org._id,
            role: 'recruiter',
            isActive: { $ne: false }
          }),
          active + 1
        );
        const resources = (await request('/api/admin-console/governance')).data.resources;
        assert.equal(resources.editable, false);
        assert.equal(resources.usage.activeRecruiters, active + 1);
        assert.equal(resources.usage.teams, teamCount + 1);
        assert.equal(
          (
            await request('/api/admin-console/governance', 'PATCH', {
              expectedVersion: 0,
              limits: { teams: 0 }
            })
          ).status,
          400
        );
        await settings.updateSettings({
          organization: { recruiterLimitPerOrg: 30, maxTeamsPerOrganization: 30 }
        });
      }
    );

    await t.test(
      'a committed policy revocation wins over an in-flight operation that has not acquired its fence',
      async () => {
        const current = (await request('/api/admin-console/governance')).data;
        let enter;
        const entered = new Promise((resolve) => {
          enter = resolve;
        });
        let release;
        const released = new Promise((resolve) => {
          release = resolve;
        });
        const original = AuditLog.create;
        let held = false;
        AuditLog.create = async function (...args) {
          if (!held && args[0]?.[0]?.action === 'ORGANIZATION_CONFIGURATION_UPDATED') {
            held = true;
            enter();
            await released;
          }
          return original.apply(this, args);
        };
        try {
          const update = request('/api/admin-console/governance', 'PATCH', {
            expectedVersion: current.version,
            policies: { recruiterJobCreation: false }
          });
          await entered;
          const create = jobService.createRecruiterJob({ ...ownerScope, payload: jobPayload }).then(
            () => ({ allowed: true }),
            (error) => ({ error })
          );
          release();
          assert.equal((await update).status, 200);
          assert.equal((await create).error?.restriction?.reason, 'organization_policy');
        } finally {
          release();
          AuditLog.create = original;
        }
        await policy({ recruiterJobCreation: true });
      }
    );

    await t.test(
      'an operation holding the fence commits before a rival policy update; later operations are denied',
      async () => {
        let enter;
        const entered = new Promise((resolve) => {
          enter = resolve;
        });
        let release;
        const released = new Promise((resolve) => {
          release = resolve;
        });
        const original = Job.create;
        let held = false;
        Job.create = async function (...args) {
          if (!held) {
            held = true;
            enter();
            await released;
          }
          return original.apply(this, args);
        };
        const version = Number((await Organization.findById(org._id).lean()).governance.version);
        try {
          const create = jobService.createRecruiterJob({ ...ownerScope, payload: jobPayload });
          await entered;
          const update = governance.updateGovernance(
            { actorId: admin.id, organizationId: org.id, sessionRevision: 0 },
            { expectedVersion: version, policies: { recruiterJobCreation: false } }
          );
          release();
          assert.ok((await create)._id);
          await update;
          await assert.rejects(
            jobService.createRecruiterJob({ ...ownerScope, payload: jobPayload }),
            (error) => error.restriction?.reason === 'organization_policy'
          );
        } finally {
          release();
          Job.create = original;
        }
        await policy({ recruiterJobCreation: true });
      }
    );

    await t.test(
      'membership and session revocation fail closed; shared access grants no private evidence',
      async () => {
        await Membership.updateOne(
          { organizationId: org._id, userId: owner._id, teamId: null },
          { $set: { status: 'disabled' } }
        );
        await assert.rejects(
          jobService.createRecruiterJob({ ...ownerScope, payload: jobPayload }),
          /membership is not active/
        );
        await Membership.updateOne(
          { organizationId: org._id, userId: owner._id, teamId: null },
          { $set: { status: 'active' } }
        );
        await User.updateOne({ _id: owner._id }, { $inc: { sessionRevision: 1 } });
        await assert.rejects(
          jobService.createRecruiterJob({ ...ownerScope, payload: jobPayload }),
          (error) => error.statusCode === 403
        );
        const result = await jobService.getAccessibleRecruiterJob({
          recruiterId: manager.id,
          organizationId: org.id,
          jobId: String(shared._id)
        });
        assert.equal(result.access.privateEvidence, false);
        assert.equal(result.access.isOwner, false);
        assert.equal(String((await Job.findById(shared._id)).recruiterId), owner.id);
        assert.equal((await User.findById(candidate._id)).role, 'developer');
      }
    );
  }
);
