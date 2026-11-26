const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { once } = require('node:events');
const express = require('express');
const mongoose = require('mongoose');
const { startMongo } = require('../fixtures/disposableRequestMongo');
const { sign } = require('../../modules/auth/utils/authSessionToken');
const { acceptInvite } = require('../../modules/auth/authcontroller');
const User = require('../../modules/auth/models/user');
const Organization = require('../../modules/admin/models/organization');
const Membership = require('../../modules/admin/models/membership');
const Team = require('../../modules/admin/models/team');
const AuditLog = require('../../modules/admin/models/auditLog');
const Invitation = require('../../modules/admin/models/invitation');
const Job = require('../../modules/recruiter/models/Job');
const { auditLogMiddleware } = require('../../core/middleware/auditLogMiddleware');
const platformSettings = require('../../modules/super-admin/services/platformSettingsService');
const { isDuplicateOrganizationTeamSlug } = require('../../modules/admin/services/teamCapacityService');
const adminRoutes = require('../../modules/admin/routes/admin.routes');
const adminConsoleRoutes = require('../../modules/admin/routes/adminConsole.routes');
const tenantRoutes = require('../../modules/admin/routes/tenant.routes');
const auditRoutes = require('../../modules/admin/routes/audit.routes');

test('team slug conflict detection leaves unrelated duplicate-key errors untouched', () => {
  assert.equal(isDuplicateOrganizationTeamSlug({ code: 11000, keyPattern: { organizationId: 1, slug: 1 } }), true);
  assert.equal(isDuplicateOrganizationTeamSlug({ code: 11000, keyPattern: { organizationId: 1, userId: 1 } }), false);
  assert.equal(isDuplicateOrganizationTeamSlug({ code: 11000, message: 'some unrelated duplicate key' }), false);
});

test(
  'Admin organization suspension, audit scope, and analytics use isolated organization data',
  { timeout: 120000 },
  async (t) => {
    const mongo = await startMongo({
      replicaSet: 'admin-scope-analytics',
      temporaryRoot: path.resolve(__dirname, '../../../verification')
    });
    let server;
    const previousSecret = process.env.JWT_SECRET;
    const originalAuditCreate = AuditLog.create;
    const pendingAuditWrites = new Set();
    const failedAuditWrites = [];
    process.env.JWT_SECRET = 'disposable-admin-scope-regression-secret';

    t.after(async () => {
      try {
        if (server) await new Promise((resolve) => server.close(resolve));
        await Promise.allSettled([...pendingAuditWrites]);
        assert.deepEqual(failedAuditWrites, [], 'Audit writes must settle before the disposable DB closes.');
      } finally {
        AuditLog.create = originalAuditCreate;
        platformSettings.stopSettingsSynchronization();
        await mongoose.disconnect();
        await mongo.stop();
        if (previousSecret === undefined) delete process.env.JWT_SECRET;
        else process.env.JWT_SECRET = previousSecret;
      }
    });

    const disposableDatabaseUri = new URL(mongo.uri);
    disposableDatabaseUri.pathname = '/p1_6a_admin_scope_analytics';
    await mongoose.connect(disposableDatabaseUri.toString());
    await platformSettings.startSettingsSynchronization();
    await Promise.all([
      User.init(),
      Organization.init(),
      Membership.init(),
      Team.init(),
      AuditLog.init(),
      Invitation.init(),
      Job.init()
    ]);

    const organizationA = await Organization.create({
      name: 'Northwind A',
      slug: 'northwind-a',
      ownerId: new mongoose.Types.ObjectId(),
      createdBy: new mongoose.Types.ObjectId()
    });
    const organizationB = await Organization.create({
      name: 'Northwind B',
      slug: 'northwind-b',
      ownerId: new mongoose.Types.ObjectId(),
      createdBy: new mongoose.Types.ObjectId()
    });
    const suspendedOrganization = await Organization.create({
      name: 'Suspended tenant',
      slug: 'suspended-tenant',
      ownerId: new mongoose.Types.ObjectId(),
      createdBy: new mongoose.Types.ObjectId(),
      isSuspended: true
    });

    const organizationAdmin = await User.create({
      name: 'Northwind Admin',
      email: 'northwind-admin@example.test',
      role: 'admin',
      organizationId: organizationA._id,
      providers: ['github'],
      authProvider: 'github'
    });
    const organizationBAdmin = await User.create({
      name: 'Northwind B Admin',
      email: 'northwind-b-admin@example.test',
      role: 'admin',
      organizationId: organizationB._id,
      providers: ['github'],
      authProvider: 'github'
    });
    const suspendedAdmin = await User.create({
      name: 'Suspended Admin',
      email: 'suspended-admin@example.test',
      role: 'admin',
      organizationId: suspendedOrganization._id,
      providers: ['github'],
      authProvider: 'github'
    });
    const superAdmin = await User.create({
      name: 'Platform Admin',
      email: 'platform-admin@example.test',
      role: 'super_admin',
      providers: ['github'],
      authProvider: 'github'
    });
    const recruiter = await User.create({
      name: 'Northwind Recruiter',
      email: 'northwind-recruiter@example.test',
      role: 'recruiter',
      organizationId: organizationA._id,
      providers: ['github'],
      authProvider: 'github'
    });

    const suspendedTeam = await Team.create({
      organizationId: suspendedOrganization._id,
      name: 'Suspended team',
      slug: 'suspended-team',
      createdBy: suspendedAdmin._id
    });
    await Membership.create([
      {
        organizationId: organizationA._id,
        userId: organizationAdmin._id,
        role: 'admin',
        status: 'active'
      },
      {
        organizationId: organizationB._id,
        userId: organizationAdmin._id,
        role: 'admin',
        status: 'active'
      },
      {
        organizationId: organizationB._id,
        userId: organizationBAdmin._id,
        role: 'admin',
        status: 'active'
      },
      {
        organizationId: suspendedOrganization._id,
        userId: suspendedAdmin._id,
        role: 'admin',
        status: 'active'
      },
      {
        organizationId: suspendedOrganization._id,
        teamId: suspendedTeam._id,
        userId: suspendedAdmin._id,
        role: 'admin',
        status: 'active'
      },
      {
        organizationId: organizationA._id,
        userId: recruiter._id,
        role: 'member',
        status: 'active'
      }
    ]);

    await AuditLog.create([
      {
        actor: organizationAdmin._id,
        organizationId: organizationA._id,
        action: 'Northwind A activity',
        method: 'PATCH',
        route: '/api/admin-console/preferences',
        before: { privateNote: 'tenant-a-secret' },
        after: { changed: true }
      },
      {
        actor: organizationAdmin._id,
        organizationId: organizationB._id,
        action: 'Northwind B activity',
        method: 'PATCH',
        route: '/api/admin-console/preferences',
        before: { privateNote: 'tenant-b-secret' },
        after: { changed: true }
      }
    ]);

    const invitations = Array.from({ length: 25 }, (_, index) => {
      let status = 'accepted';
      let expiresAt = new Date(Date.now() + 60_000);
      if (index === 22) status = 'revoked';
      if (index === 23) status = 'pending';
      if (index === 24) {
        status = 'pending';
        expiresAt = new Date(Date.now() - 60_000);
      }
      return {
        organizationId: organizationA._id,
        email: `invite-${index}@example.test`,
        role: 'recruiter',
        token: `isolated-admin-token-${String(index).padStart(3, '0')}`,
        status,
        invitedBy: organizationAdmin._id,
        acceptedBy: status === 'accepted' ? organizationAdmin._id : null,
        expiresAt,
        createdAt: new Date(Date.now() - index * 1_000)
      };
    });
    await Invitation.create(invitations);
    await Job.create([
      {
        organizationId: organizationA._id,
        recruiterId: recruiter._id,
        title: 'Open role',
        status: 'open'
      },
      {
        organizationId: organizationA._id,
        recruiterId: recruiter._id,
        title: 'Draft role',
        status: 'draft'
      },
      {
        organizationId: organizationA._id,
        recruiterId: recruiter._id,
        title: 'Closed role',
        status: 'closed'
      }
    ]);

    AuditLog.create = function (...args) {
      const write = originalAuditCreate.apply(this, args);
      pendingAuditWrites.add(write);
      write.then(
        () => pendingAuditWrites.delete(write),
        (error) => {
          pendingAuditWrites.delete(write);
          failedAuditWrites.push(error.message);
        }
      );
      return write;
    };

    const app = express();
    app.use(express.json());
    app.use(auditLogMiddleware);
    app.use('/api/admin', adminRoutes);
    app.use('/api/admin-console', adminConsoleRoutes);
    app.use('/api/tenant', tenantRoutes);
    app.use('/api/audit-logs', auditRoutes);
    app.post('/api/auth/accept-invite', acceptInvite);
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const request = (path, user = organizationAdmin) =>
      fetch(`${baseUrl}${path}`, {
        headers: { Authorization: `Bearer ${sign(user)}` }
      });
    const send = (path, method, body, user) =>
      fetch(`${baseUrl}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(user && { Authorization: `Bearer ${sign(user)}` })
        },
        ...(body !== undefined && { body: JSON.stringify(body) })
      });

    const interceptCapacityFence = (organizationId) => {
      const originalUpdateOne = Organization.collection.updateOne;
      let attempts = 0;
      let releaseBarrier;
      const reachedBarrier = new Promise((resolve) => {
        releaseBarrier = resolve;
      });
      const timeout = setTimeout(releaseBarrier, 5000);
      Organization.collection.updateOne = async function (filter, update, options) {
        if (String(filter?._id) === String(organizationId) && update?.$set?.updatedAt) {
          attempts += 1;
          if (attempts === 2) releaseBarrier();
          await reachedBarrier;
        }
        return originalUpdateOne.call(this, filter, update, options);
      };

      return {
        get attempts() {
          return attempts;
        },
        restore() {
          clearTimeout(timeout);
          releaseBarrier();
          Organization.collection.updateOne = originalUpdateOne;
        }
      };
    };

    await t.test('suspended organizations reject organization and team access', async () => {
      const organizationResponse = await request(
        `/api/tenant/organizations/${suspendedOrganization._id}/teams`,
        suspendedAdmin
      );
      const teamResponse = await request(`/api/tenant/teams/${suspendedTeam._id}/members`, suspendedAdmin);
      const adminConsoleResponse = await request('/api/admin-console/overview', suspendedAdmin);

      assert.equal(organizationResponse.status, 403);
      assert.equal(teamResponse.status, 403);
      assert.equal(adminConsoleResponse.status, 403);
      const storedAdmin = await User.findById(suspendedAdmin._id).select('organizationId').lean();
      assert.equal(String(storedAdmin.organizationId), String(suspendedOrganization._id));
    });

    await t.test('Super Admin cannot use organization Admin route families', async () => {
      const consoleResponse = await request('/api/admin-console/overview', superAdmin);
      const legacyAdminResponse = await request('/api/admin/overview', superAdmin);
      const organizationAdminResponse = await request('/api/admin-console/overview');

      assert.equal(consoleResponse.status, 403);
      assert.equal(legacyAdminResponse.status, 403);
      assert.equal(organizationAdminResponse.status, 200);
    });

    await t.test('missing Recruiter activation target does not commit the capacity fence', async () => {
      const before = await Organization.findById(organizationA._id).select('updatedAt').lean();
      const response = await fetch(`${baseUrl}/api/admin/recruiters/${new mongoose.Types.ObjectId()}/active`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${sign(organizationAdmin)}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ isActive: true })
      });
      const after = await Organization.findById(organizationA._id).select('updatedAt').lean();

      assert.equal(response.status, 404);
      assert.equal(after.updatedAt.getTime(), before.updatedAt.getTime());
    });

    await t.test('Admin Console team creation enforces the configured 9/10 capacity boundary', async () => {
      await platformSettings.updateSettings({ organization: { maxTeamsPerOrganization: 10 } });
      await Team.create(
        Array.from({ length: 9 }, (_, index) => ({
          organizationId: organizationA._id,
          name: `Capacity Team ${index + 1}`,
          slug: `capacity-team-${index + 1}`,
          createdBy: organizationAdmin._id
        }))
      );

      const allowedResponse = await fetch(`${baseUrl}/api/admin-console/teams`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${sign(organizationAdmin)}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name: 'Capacity Team Ten', slug: 'capacity-team-ten' })
      });
      const rejectedResponse = await fetch(`${baseUrl}/api/admin-console/teams`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${sign(organizationAdmin)}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name: 'Capacity Team Eleven', slug: 'capacity-team-eleven' })
      });

      assert.equal(allowedResponse.status, 201);
      assert.equal(rejectedResponse.status, 400);
      assert.equal(await Team.countDocuments({ organizationId: organizationA._id }), 10);
    });

    await t.test('direct Recruiter creation races enforce the configured 4/5 seat boundary', async () => {
      await platformSettings.updateSettings({ organization: { recruiterLimitPerOrg: 5 } });
      await User.create(
        Array.from({ length: 3 }, (_, index) => ({
          name: `Existing Recruiter ${index + 1}`,
          email: `existing-recruiter-${index + 1}@example.test`,
          role: 'recruiter',
          organizationId: organizationA._id,
          isActive: true,
          providers: ['github'],
          authProvider: 'github'
        }))
      );
      assert.equal(
        await User.countDocuments({ role: 'recruiter', organizationId: organizationA._id, isActive: { $ne: false } }),
        4
      );

      const createRecruiter = (index) =>
        fetch(`${baseUrl}/api/admin/recruiters/direct`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${sign(organizationAdmin)}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            name: `Concurrent Recruiter ${index}`,
            email: `concurrent-recruiter-${index}@example.test`,
            password: 'ValidPass123!'
          })
        });
      const barrier = interceptCapacityFence(organizationA._id);
      let responses;
      try {
        responses = await Promise.all([createRecruiter(1), createRecruiter(2)]);
      } finally {
        barrier.restore();
      }

      assert.ok(barrier.attempts >= 2);
      assert.deepEqual(responses.map((response) => response.status).sort(), [201, 400]);
      assert.equal(
        await User.countDocuments({ role: 'recruiter', organizationId: organizationA._id, isActive: { $ne: false } }),
        5
      );
      const successfulResponse = responses.find((response) => response.status === 201);
      const successfulPayload = await successfulResponse.json();
      assert.equal(
        await Membership.countDocuments({
          organizationId: organizationA._id,
          userId: successfulPayload.recruiter._id,
          teamId: null,
          status: 'active'
        }),
        1
      );
    });

    await t.test('Recruiter reactivation and direct creation serialize the final seat', async () => {
      await User.create([
        ...Array.from({ length: 4 }, (_, index) => ({
          name: `Northwind B Recruiter ${index + 1}`,
          email: `northwind-b-recruiter-${index + 1}@example.test`,
          role: 'recruiter',
          organizationId: organizationB._id,
          isActive: true,
          providers: ['github'],
          authProvider: 'github'
        })),
        {
          name: 'Inactive Northwind B Recruiter',
          email: 'inactive-northwind-b-recruiter@example.test',
          role: 'recruiter',
          organizationId: organizationB._id,
          isActive: false,
          providers: ['github'],
          authProvider: 'github'
        }
      ]);

      const reactivate = fetch(
        `${baseUrl}/api/admin/recruiters/${(await User.findOne({ email: 'inactive-northwind-b-recruiter@example.test' }))._id}/active`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${sign(organizationBAdmin)}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ isActive: true })
        }
      );
      const createRecruiter = fetch(`${baseUrl}/api/admin/recruiters/direct`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${sign(organizationBAdmin)}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: 'Final Seat Northwind B Recruiter',
          email: 'final-seat-northwind-b-recruiter@example.test',
          password: 'ValidPass123!'
        })
      });
      const barrier = interceptCapacityFence(organizationB._id);
      let responses;
      try {
        responses = await Promise.all([reactivate, createRecruiter]);
      } finally {
        barrier.restore();
      }

      assert.ok(barrier.attempts >= 2);
      const statusCodes = responses.map((response) => response.status);
      assert.equal(statusCodes.filter((status) => status === 400).length, 1);
      assert.ok(statusCodes.includes(200) || statusCodes.includes(201));
      assert.equal(
        await User.countDocuments({ role: 'recruiter', organizationId: organizationB._id, isActive: { $ne: false } }),
        5
      );
    });

    await t.test('recruiter invitation acceptance and direct creation share the final seat fence', async () => {
      const invitationAdmin = await User.create({
        name: 'Northwind C Admin',
        email: 'northwind-c-admin@example.test',
        role: 'admin',
        providers: ['github'],
        authProvider: 'github'
      });
      const organizationC = await Organization.create({
        name: 'Northwind C',
        slug: 'northwind-c',
        ownerId: invitationAdmin._id,
        createdBy: invitationAdmin._id
      });
      invitationAdmin.organizationId = organizationC._id;
      await invitationAdmin.save();
      await Membership.create({
        organizationId: organizationC._id,
        userId: invitationAdmin._id,
        role: 'admin',
        status: 'active'
      });
      await User.create(
        Array.from({ length: 4 }, (_, index) => ({
          name: `Northwind C Recruiter ${index + 1}`,
          email: `northwind-c-recruiter-${index + 1}@example.test`,
          role: 'recruiter',
          organizationId: organizationC._id,
          isActive: true,
          providers: ['github'],
          authProvider: 'github'
        }))
      );
      const invitationToken = 'p1-6a-recruiter-seat-acceptance-token';
      const invitation = await Invitation.create({
        organizationId: organizationC._id,
        email: 'seat-acceptance@example.test',
        name: 'Seat Acceptance Recruiter',
        role: 'recruiter',
        token: invitationToken,
        status: 'pending',
        invitedBy: invitationAdmin._id,
        expiresAt: new Date(Date.now() + 60_000)
      });

      const acceptInvitation = fetch(`${baseUrl}/api/auth/accept-invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: invitationToken, password: 'ValidPass123!' })
      });
      const createRecruiter = fetch(`${baseUrl}/api/admin/recruiters/direct`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${sign(invitationAdmin)}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: 'Direct Final Seat Recruiter',
          email: 'direct-final-seat@example.test',
          password: 'ValidPass123!'
        })
      });
      const barrier = interceptCapacityFence(organizationC._id);
      let responses;
      try {
        responses = await Promise.all([acceptInvitation, createRecruiter]);
      } finally {
        barrier.restore();
      }

      assert.ok(barrier.attempts >= 2);
      assert.equal(responses[0].status === 200, responses[1].status === 400);
      assert.equal(responses[1].status === 201, responses[0].status === 400);
      assert.ok([200, 400].includes(responses[0].status));
      assert.ok([201, 400].includes(responses[1].status));
      assert.equal(
        await User.countDocuments({ role: 'recruiter', organizationId: organizationC._id, isActive: { $ne: false } }),
        5
      );
      const storedInvitation = await Invitation.findById(invitation._id).lean();
      const acceptedUser = await User.findOne({ email: 'seat-acceptance@example.test' }).lean();
      assert.equal(storedInvitation.status === 'accepted', responses[0].status === 200);
      assert.equal(Boolean(acceptedUser), responses[0].status === 200);
    });

    await t.test('same-slug team creation races return one success and one scoped conflict', async () => {
      const createDuplicateTeam = () =>
        fetch(`${baseUrl}/api/tenant/organizations/${organizationB._id}/teams`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${sign(organizationBAdmin)}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ name: 'Shared Race Team', slug: 'shared-race-team' })
        });
      const responses = await Promise.all([createDuplicateTeam(), createDuplicateTeam()]);

      assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
      assert.equal(await Team.countDocuments({ organizationId: organizationB._id, slug: 'shared-race-team' }), 1);
      assert.equal(
        await Membership.countDocuments({
          organizationId: organizationB._id,
          userId: organizationBAdmin._id,
          teamId: { $ne: null }
        }),
        1
      );
    });

    await t.test('synchronized Admin Console and tenant team creation share the final organization slot', async () => {
      await Team.create(
        Array.from({ length: 8 }, (_, index) => ({
          organizationId: organizationB._id,
          name: `Race Capacity Team ${index + 1}`,
          slug: `race-capacity-team-${index + 1}`,
          createdBy: organizationAdmin._id
        }))
      );

      const barrier = interceptCapacityFence(organizationB._id);
      let responses;
      try {
        responses = await Promise.all([
          fetch(`${baseUrl}/api/admin-console/teams`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${sign(organizationBAdmin)}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ name: 'Console Race Capacity Team', slug: 'console-race-capacity-team' })
          }),
          fetch(`${baseUrl}/api/tenant/organizations/${organizationB._id}/teams`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${sign(organizationBAdmin)}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ name: 'Tenant Race Capacity Team', slug: 'tenant-race-capacity-team' })
          })
        ]);
      } finally {
        barrier.restore();
      }

      assert.ok(barrier.attempts >= 2);
      assert.deepEqual(responses.map((response) => response.status).sort(), [201, 400]);
      assert.equal(await Team.countDocuments({ organizationId: organizationB._id }), 10);
      assert.equal(
        await Membership.countDocuments({
          organizationId: organizationB._id,
          userId: organizationBAdmin._id,
          teamId: { $ne: null }
        }),
        1 + (responses[1].status === 201 ? 1 : 0)
      );
    });

    await t.test('organization activity excludes another tenant and private audit payloads', async () => {
      const response = await request('/api/admin-console/activity?page=1&limit=50');
      assert.equal(response.status, 200);
      const payload = await response.json();
      assert.equal(payload.total, payload.logs.length);
      assert.equal(payload.logs.filter((log) => log.action === 'Northwind A activity').length, 1);
      assert.equal(
        payload.logs.some((log) => log.action === 'Northwind B activity'),
        false
      );
      assert.ok(payload.logs.every((log) => String(log.organizationId) === String(organizationA._id)));
      assert.ok(payload.logs.every((log) => !Object.hasOwn(log, 'before') && !Object.hasOwn(log, 'after')));
    });

    await t.test('job totals are exact and invitation totals exceed the recent sample', async () => {
      const response = await request('/api/admin-console/analytics');
      assert.equal(response.status, 200);
      const payload = await response.json();
      assert.deepEqual(payload.hiringActivity, { total: 3, open: 1, draft: 1, closed: 1 });
      assert.deepEqual(payload.invitationFunnel, {
        pending: 1,
        accepted: 22,
        expired: 1,
        revoked: 1
      });
      assert.equal(payload.recentInvitations.length, 10);
    });

    await t.test('concurrent duplicate organization slugs return a conflict and retain the winner audit', async () => {
      await platformSettings.updateSettings({ organization: { allowOrgCreation: true } });
      const creator = await User.create({
        name: 'Organization Creator',
        email: 'organization-creator@example.test',
        role: 'developer',
        providers: ['github'],
        authProvider: 'github'
      });
      const originalFindOne = Organization.findOne;
      let lookups = 0;
      let releaseLookups;
      const lookupBarrier = new Promise((resolve) => {
        releaseLookups = resolve;
      });
      Organization.findOne = function (filter, ...args) {
        if (filter?.slug !== 'racing-organization') return originalFindOne.call(this, filter, ...args);
        return {
          lean: async () => {
            lookups += 1;
            if (lookups === 2) releaseLookups();
            await lookupBarrier;
            return null;
          }
        };
      };

      let responses;
      try {
        responses = await Promise.all([
          fetch(`${baseUrl}/api/tenant/organizations`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${sign(creator)}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ name: 'Racing Organization', slug: 'racing-organization' })
          }),
          fetch(`${baseUrl}/api/tenant/organizations`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${sign(creator)}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ name: 'Racing Organization', slug: 'racing-organization' })
          })
        ]);
      } finally {
        Organization.findOne = originalFindOne;
      }

      assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
      assert.equal(await Organization.countDocuments({ slug: 'racing-organization' }), 1);

      let raceAudits = [];
      for (let attempt = 0; attempt < 40 && raceAudits.length < 2; attempt += 1) {
        raceAudits = await AuditLog.find({
          actor: creator._id,
          route: '/api/tenant/organizations',
          statusCode: { $in: [201, 409] }
        }).lean();
        if (raceAudits.length < 2) await new Promise((resolve) => setTimeout(resolve, 25));
      }
      assert.deepEqual(raceAudits.map((audit) => audit.statusCode).sort(), [201, 409]);
      assert.ok(raceAudits.find((audit) => audit.statusCode === 201)?.organizationId);
    });
    await t.test('team authority remains confined to its team', async () => {
      const manager = await User.create({
        role: 'developer',
        name: 'Fixture Manager',
        email: 'scoped-team-manager@example.test',
        providers: ['github']
      });
      const team = await Team.create({
        name: 'Scoped Team',
        slug: 'scoped-team',
        organizationId: organizationA._id,
        createdBy: organizationAdmin._id
      });
      await Membership.create({
        organizationId: organizationA._id,
        teamId: team._id,
        userId: manager._id,
        role: 'manager',
        status: 'active'
      });
      assert.equal((await request(`/api/tenant/teams/${team._id}/members`, manager)).status, 200);
      assert.equal((await request(`/api/tenant/organizations/${organizationA._id}/members`, manager)).status, 403);
      assert.equal((await request('/api/admin-console/overview', manager)).status, 403);
    });

    await t.test('actorless audit archival is confined to stored organization and single-use', async () => {
      const records = await AuditLog.create(
        [organizationA._id, organizationB._id, null].map((organizationId) => ({
          organizationId,
          actor: null,
          action: 'fixture.audit',
          method: 'POST',
          route: '/api/fixture',
          statusCode: 200
        }))
      );
      for (const record of records.slice(1)) {
        assert.equal((await send(`/api/audit-logs/${record._id}`, 'DELETE', undefined, organizationAdmin)).status, 404);
      }
      assert.equal(
        (await send(`/api/audit-logs/${records[0]._id}`, 'DELETE', undefined, organizationAdmin)).status,
        200
      );
      assert.equal(
        (await send(`/api/audit-logs/${records[0]._id}`, 'DELETE', undefined, organizationAdmin)).status,
        404
      );
      assert.equal(
        await AuditLog.countDocuments({ _id: { $in: records.map((record) => record._id) }, deleted: true }),
        1
      );
    });

    await t.test('public onboarding preserves an existing recipient and leaves the invitation pending', async () => {
      const token = 'fixture-existing-recipient-invitation';
      const invitation = await Invitation.create({
        organizationId: organizationA._id,
        email: organizationBAdmin.email.toUpperCase(),
        role: 'member',
        token,
        invitedBy: organizationAdmin._id,
        expiresAt: new Date(Date.now() + 60000)
      });
      const before = await User.findById(organizationBAdmin._id).select('+password').lean();
      const response = await send(`/api/tenant/invitations/accept/${token}/onboard`, 'POST', {
        name: 'Fixture Name',
        password: 'FixturePassword123!'
      });
      assert.equal(response.status, 409);
      const after = await User.findById(organizationBAdmin._id).select('+password').lean();
      assert.deepEqual(after, before);
      assert.equal((await Invitation.findById(invitation._id)).status, 'pending');
      await Promise.allSettled([...pendingAuditWrites]);
      const audit = await AuditLog.findOne({ route: '/api/tenant/invitations/accept/:token/onboard' }).lean();
      assert.ok(audit);
      assert.equal(JSON.stringify(audit).includes(token), false);
      assert.equal(JSON.stringify(audit).includes('FixturePassword123!'), false);
      await Invitation.updateOne({ _id: invitation._id }, { $set: { status: 'revoked' } });
    });

    await t.test('eight authenticated acceptance requests consume an invitation once', async () => {
      const recipient = await User.create({
        role: 'developer',
        name: 'Fixture Recipient',
        email: 'concurrent-recipient@example.test',
        isVerified: true,
        providers: ['github']
      });
      const token = 'fixture-concurrent-recipient-invitation';
      const invitation = await Invitation.create({
        organizationId: organizationA._id,
        email: recipient.email,
        role: 'member',
        token,
        invitedBy: organizationAdmin._id,
        expiresAt: new Date(Date.now() + 60000)
      });
      const responses = await Promise.all(
        Array.from({ length: 8 }, () => send(`/api/tenant/invitations/accept/${token}`, 'POST', {}, recipient))
      );
      assert.deepEqual(responses.map((response) => response.status).sort(), [200, 400, 400, 400, 400, 400, 400, 400]);
      assert.equal(await Membership.countDocuments({ organizationId: organizationA._id, userId: recipient._id }), 1);
      assert.equal(String((await Invitation.findById(invitation._id)).acceptedBy), String(recipient._id));
    });

    await t.test('Admin Console assignment allows only one competing team assignment', async () => {
      const teams = await Team.find({ organizationId: organizationA._id, isActive: true }).limit(2);
      assert.equal(teams.length, 2);
      const responses = await Promise.all(
        teams.map((team) =>
          send(
            `/api/admin-console/teams/${team._id}/recruiters`,
            'POST',
            { recruiterId: String(recruiter._id) },
            organizationAdmin
          )
        )
      );
      assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
      assert.equal(
        await Membership.countDocuments({ userId: recruiter._id, teamId: { $ne: null }, status: 'active' }),
        1
      );
    });

    await t.test('malformed Admin parameters return controlled status codes', async () => {
      const checks = [
        request('/api/admin-console/performance?days=NaN'),
        send('/api/admin/recruiters/not-an-id', 'PUT', {}, organizationAdmin),
        send('/api/admin/recruiters/not-an-id/active', 'PATCH', { isActive: true }, organizationAdmin),
        send('/api/admin-console/teams/not-an-id', 'PATCH', { name: 'Valid name' }, organizationAdmin),
        send('/api/admin/ai-rank', 'POST', { jobId: 'not-an-id' }, organizationAdmin),
        send(
          '/api/admin-console/preferences',
          'PATCH',
          { dashboardConfig: { defaultTeamId: 'not-an-id' } },
          organizationAdmin
        ),
        request('/api/audit-logs?from=not-a-date')
      ];
      for (const response of await Promise.all(checks)) assert.equal(response.status, 400);
      assert.equal((await request('/api/audit-logs?actor=%5B')).status, 200);
    });

    await t.test('performance includes Admin-owned jobs and Admin-sent invitations', async () => {
      const now = new Date();
      await Job.create({
        organizationId: organizationA._id,
        recruiterId: organizationAdmin._id,
        title: 'Admin-owned fixture',
        status: 'open'
      });
      const expired = await Invitation.create({
        organizationId: organizationA._id,
        invitedBy: organizationAdmin._id,
        role: 'member',
        email: 'expired-performance@example.test',
        token: 'fixture-expired-performance-invitation',
        expiresAt: new Date(now.getTime() - 60000)
      });
      const expectedJobs = await Job.countDocuments({ organizationId: organizationA._id });
      const expectedAccepted = await Invitation.countDocuments({
        organizationId: organizationA._id,
        status: 'accepted'
      });
      const expectedExpired = await Invitation.countDocuments({
        organizationId: organizationA._id,
        $or: [{ status: 'expired' }, { status: 'pending', expiresAt: { $lte: now } }]
      });
      const details = await send(`/api/tenant/invitations/${expired.token}/details`, 'GET');
      assert.equal(details.status, 400);
      assert.equal((await Invitation.findById(expired._id)).status, 'pending');
      const result = await request('/api/admin-console/performance?days=30');
      assert.equal(result.status, 200);
      const data = await result.json();
      assert.equal(data.hiringAnalytics.total, expectedJobs);
      assert.equal(data.hiringAnalytics.invitationFunnel.accepted, expectedAccepted);
      assert.equal(data.hiringAnalytics.invitationFunnel.expired, expectedExpired);
    });

    await t.test(
      'invitation acceptance rolls back account affiliation when membership persistence fails',
      async (t) => {
        const recipient = await User.create({
          role: 'developer',
          name: 'Rollback Fixture',
          email: 'rollback-recipient@example.test',
          isVerified: true,
          providers: ['github']
        });
        const token = 'fixture-rollback-recipient-invitation';
        const invitation = await Invitation.create({
          organizationId: organizationA._id,
          email: recipient.email,
          role: 'member',
          token,
          invitedBy: organizationAdmin._id,
          expiresAt: new Date(Date.now() + 60000)
        });
        const failure = t.mock.method(Membership, 'findOneAndUpdate', () => {
          throw new Error('Disposable membership persistence failure');
        });
        try {
          assert.equal((await send(`/api/tenant/invitations/accept/${token}`, 'POST', {}, recipient)).status, 500);
        } finally {
          failure.mock.restore();
        }
        assert.equal((await User.findById(recipient._id)).organizationId, null);
        assert.equal((await Invitation.findById(invitation._id)).status, 'pending');
        assert.equal(await Membership.countDocuments({ userId: recipient._id }), 0);
      }
    );

    await t.test('revocation and acceptance cannot both consume a pending invitation', async () => {
      const recipient = await User.create({
        role: 'developer',
        name: 'Revocation Fixture',
        email: 'revocation-recipient@example.test',
        isVerified: true,
        providers: ['github']
      });
      const token = 'fixture-revocation-recipient-invitation';
      const invitation = await Invitation.create({
        organizationId: organizationA._id,
        email: recipient.email,
        role: 'member',
        token,
        invitedBy: organizationAdmin._id,
        expiresAt: new Date(Date.now() + 60000)
      });
      const [accepted, revoked] = await Promise.all([
        send(`/api/tenant/invitations/accept/${token}`, 'POST', {}, recipient),
        send(
          `/api/tenant/organizations/${organizationA._id}/invitations/${invitation._id}/revoke`,
          'PATCH',
          {},
          organizationAdmin
        )
      ]);
      assert.notEqual(accepted.ok, revoked.ok);
      assert.equal(await Membership.countDocuments({ userId: recipient._id }), Number(accepted.ok));
      assert.equal((await Invitation.findById(invitation._id))?.status, accepted.ok ? 'accepted' : undefined);
    });

    await t.test('public developer discovery excludes inactive accounts and personal email', async () => {
      const marker = 'Public Discovery Fixture';
      await User.create(
        [true, false].map((isActive) => ({
          name: marker,
          email: `discovery-${isActive}@fixture.test`,
          role: 'developer',
          isPublic: true,
          isActive,
          providers: ['github']
        }))
      );
      const response = await request(`/api/admin/developers?search=${encodeURIComponent(marker)}`);
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.equal(result.total, 1);
      assert.equal(result.developers.length, 1);
      assert.equal(Object.hasOwn(result.developers[0], 'email'), false);
    });
  }
);
