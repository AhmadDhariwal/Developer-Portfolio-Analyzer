const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { randomBytes } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const mongoose = require('mongoose');
const { startMongo } = require('../fixtures/disposableRequestMongo');
const User = require('../../modules/auth/models/user');
const Organization = require('../../modules/admin/models/organization');
const Team = require('../../modules/admin/models/team');
const Membership = require('../../modules/admin/models/membership');
const Invitation = require('../../modules/admin/models/invitation');
const Notification = require('../../modules/notifications/models/notification');
const AuditLog = require('../../modules/admin/models/auditLog');
const { sign } = require('../../modules/auth/utils/authSessionToken');
const { auditLogMiddleware } = require('../../core/middleware/auditLogMiddleware');

test('Admin regression closure uses only a disposable replica set', { timeout: 120000 }, async (t) => {
  const mongo = await startMongo({ replicaSet: 'admin-regression-closure' });
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = randomBytes(32).toString('hex');
  let server;
  const pendingAudits = new Set();
  const auditErrors = [];
  t.after(async () => {
    try {
      if (server) await new Promise((resolve) => server.close(resolve));
      await Promise.allSettled([...pendingAudits]);
      assert.deepEqual(auditErrors, []);
    } finally {
      await mongoose.disconnect();
      await mongo.stop();
      if (previousSecret === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = previousSecret;
    }
  });
  await mongoose.connect(mongo.uri);
  for (const Model of [User, Organization, Team, Membership, Invitation, Notification, AuditLog]) {
    await Model.init();
  }
  const originalAuditCreate = AuditLog.create;
  t.mock.method(AuditLog, 'create', function (...args) {
    const write = originalAuditCreate.apply(this, args);
    pendingAudits.add(write);
    write.then(
      () => pendingAudits.delete(write),
      (error) => {
        pendingAudits.delete(write);
        auditErrors.push(error.message);
      }
    );
    return write;
  });
  const emailService = require('../../core/messaging/emailService');
  const sendEmail = t.mock.method(emailService, 'sendRecruiterInvitationEmail', async () => ({ sent: true }));
  const app = express();
  app.use(express.json());
  app.use(auditLogMiddleware);
  app.use('/api/admin', require('../../modules/admin/routes/admin.routes'));
  app.use('/api/tenant', require('../../modules/admin/routes/tenant.routes'));
  app.post('/api/auth/accept-invite', require('../../modules/auth/authcontroller').acceptInvite);
  // Synthetic mutation handlers exercise the actual persistence middleware.
  for (const route of ['/api/profile', '/api/integrations/callback', '/api/recruiter-hub/shortlists']) {
    app.post(route, (_req, res) => res.json({ ok: true }));
  }
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const user = (name, props = {}) =>
    User.create({
      name,
      email: `${name}@closure.test`,
      providers: ['github'],
      isVerified: true,
      ...props
    });
  const admin = await user('admin', { role: 'admin' });
  const owner = await user('owner', { role: 'super_admin' });
  const outsider = await user('outsider', { role: 'super_admin' });
  const ordinary = await user('ordinary', { role: 'developer' });
  const inactive = await user('inactive', { role: 'super_admin', isActive: false });
  const org = await Organization.create({
    name: 'Closure',
    slug: 'closure',
    ownerId: owner._id,
    createdBy: owner._id
  });
  const foreignOrg = await Organization.create({
    name: 'Foreign',
    slug: 'closure-foreign',
    ownerId: outsider._id,
    createdBy: outsider._id
  });
  admin.organizationId = org._id;
  await admin.save();
  const foreignAdmin = await user('foreign-admin', { role: 'admin', organizationId: foreignOrg._id });
  const teams = await Team.create([
    { name: 'Active', slug: 'active', organizationId: org._id, createdBy: admin._id },
    { name: 'Inactive', slug: 'inactive', organizationId: org._id, createdBy: admin._id, isActive: false },
    { name: 'Foreign', slug: 'foreign', organizationId: foreignOrg._id, createdBy: outsider._id }
  ]);
  const send = async (route, body, actor = admin) => {
    const response = await fetch(base + route, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(actor && { Authorization: `Bearer ${sign(actor)}` })
      },
      body: JSON.stringify(body)
    });
    const data = await response.json();
    return { status: response.status, data };
  };
  const counts = async () =>
    Promise.all([
      User.countDocuments(),
      Invitation.countDocuments(),
      Membership.countDocuments(),
      Notification.countDocuments()
    ]);

  for (const route of [
    '/api/admin/invite-recruiter',
    '/api/admin/recruiter',
    '/api/admin/recruiters/direct'
  ]) {
    await t.test(`${route}: invalid and unavailable teams never partially write`, async () => {
      for (const [teamId, expected] of [
        ['bad-id', 400],
        ['a'.repeat(23), 400],
        [{ token: 'bad-id' }, 400],
        [new mongoose.Types.ObjectId().toString(), 404],
        [teams[1].id, 404],
        [teams[2].id, 404]
      ]) {
        const before = await counts();
        const organizationBefore = await Organization.findById(org._id).lean();
        const emailCalls = sendEmail.mock.callCount();
        const result = await send(route, {
          name: 'Validation fixture',
          email: 'invalid-team@closure.test',
          password: 'Fixture-Hiring-92!',
          teamId
        });
        assert.equal(result.status, expected, JSON.stringify(result.data));
        assert.deepEqual(
          await counts(),
          before,
          'No account, invitation, membership or notification is created'
        );
        assert.equal(sendEmail.mock.callCount(), emailCalls, 'Validation must precede invitation delivery');
        assert.equal(
          +new Date((await Organization.findById(org._id)).updatedAt),
          +new Date(organizationBefore.updatedAt)
        );
      }
    });
    await t.test(`${route}: same-organization and optional teams remain supported`, async () => {
      for (const teamId of [teams[0].id, undefined, null, '']) {
        const email = `${randomBytes(6).toString('hex')}@closure.test`;
        const result = await send(route, {
          name: 'Valid fixture',
          email,
          password: 'Fixture-Hiring-92!',
          ...(teamId !== undefined && { teamId })
        });
        assert.equal(result.status, 201, JSON.stringify(result.data));
        if (route.endsWith('/direct')) {
          const account = await User.findOne({ email });
          assert.equal(account.role, 'recruiter');
          const memberships = await Membership.find({ userId: account._id }).lean();
          assert.equal(memberships.length, teamId ? 2 : 1);
          assert.ok(memberships.some((membership) => membership.teamId === null));
          if (teamId) assert.ok(memberships.some((membership) => String(membership.teamId) === teamId));
        } else {
          const invitation = await Invitation.findOne({ email });
          assert.equal(String(invitation.teamId || ''), teamId || '');
        }
      }
    });
  }

  const invite = (invitedBy, email, extra = {}) =>
    Invitation.create({
      organizationId: org._id,
      invitedBy,
      email,
      role: 'recruiter',
      token: randomBytes(24).toString('hex'),
      expiresAt: new Date(Date.now() + 60000),
      ...extra
    });
  await t.test(
    'unrelated ownership, account role, affiliation and team role grant no inviter bypass',
    async () => {
      // Even a direct org-admin membership on a non-Admin account is insufficient
      // for recruiter invitations unless that account owns this exact organization.
      await Membership.create({ organizationId: org._id, userId: ordinary._id, teamId: null, role: 'admin' });
      for (const inviter of [outsider, ordinary, foreignAdmin]) {
        const email = `denied-${inviter.id}@closure.test`;
        const invitation = await invite(inviter._id, email);
        const before = await counts();
        const result = await send(
          '/api/auth/accept-invite',
          { token: invitation.token, password: 'Fixture-Hiring-92!' },
          null
        );
        assert.equal(result.status, 403, JSON.stringify(result.data));
        assert.deepEqual(await counts(), before);
        assert.equal((await Invitation.findById(invitation._id)).status, 'pending');
      }
      const inactiveOrg = await Organization.create({
        name: 'Inactive owner',
        slug: 'inactive-owner',
        ownerId: inactive._id,
        createdBy: inactive._id
      });
      const invitation = await invite(inactive._id, 'inactive-recipient@closure.test', {
        organizationId: inactiveOrg._id
      });
      assert.equal(
        (
          await send(
            '/api/auth/accept-invite',
            { token: invitation.token, password: 'Fixture-Hiring-92!' },
            null
          )
        ).status,
        403
      );
      assert.equal((await Invitation.findById(invitation._id)).status, 'pending');
      const limitedOwnerOrg = await Organization.create({
        name: 'Limited owner',
        slug: 'limited-owner',
        ownerId: owner._id,
        createdBy: owner._id
      });
      await Membership.create({
        organizationId: limitedOwnerOrg._id,
        userId: owner._id,
        teamId: null,
        role: 'member'
      });
      const limitedInvitation = await invite(owner._id, 'limited-recipient@closure.test', {
        organizationId: limitedOwnerOrg._id
      });
      const limitedResult = await send(
        '/api/auth/accept-invite',
        {
          token: limitedInvitation.token,
          password: 'Fixture-Hiring-92!'
        },
        null
      );
      assert.equal(limitedResult.status, 403, JSON.stringify(limitedResult.data));
      assert.equal((await Invitation.findById(limitedInvitation._id)).status, 'pending');
    }
  );

  await t.test(
    'legitimate Super Admin ownership cannot overwrite or transfer an existing account',
    async () => {
      const recipient = await user('existing-recipient', {
        role: 'developer',
        organizationId: foreignOrg._id
      });
      const invitation = await invite(owner._id, recipient.email);
      const before = await User.findById(recipient._id).lean();
      assert.equal(
        (
          await send(
            '/api/auth/accept-invite',
            { token: invitation.token, password: 'Fixture-Hiring-92!' },
            null
          )
        ).status,
        409
      );
      assert.deepEqual(await User.findById(recipient._id).lean(), before);
      const authenticated = await send(`/api/tenant/invitations/accept/${invitation.token}`, {}, recipient);
      assert.equal(authenticated.status, 403, JSON.stringify(authenticated.data));
      assert.deepEqual(await User.findById(recipient._id).lean(), before);
      assert.equal((await Invitation.findById(invitation._id)).status, 'pending');
      assert.equal(await Membership.countDocuments({ userId: recipient._id }), 0);
      // Recipient identity and privileged account restrictions still apply.
      assert.equal(
        (await send(`/api/tenant/invitations/accept/${invitation.token}`, {}, ordinary)).status,
        403
      );
      const privilegedInvite = await invite(owner._id, admin.email);
      assert.equal(
        (await send(`/api/tenant/invitations/accept/${privilegedInvite.token}`, {}, admin)).status,
        403
      );
    }
  );

  await t.test(
    'raw persisted audits retain safe diagnostics and exclude credentials and private queries',
    async () => {
      const secret = 'synthetic-closure-secret';
      const publicJob = '0123456789abcdef01234567';
      for (const route of [
        `/api/profile?tab=settings&%74oken=${secret}&otp=${secret}&api_key=${secret}&applicationEvidence=${secret}`,
        `/api/profile?tab=settings&tab=${secret}&password=%ZZ${secret}`,
        `/api/integrations/callback?code=${secret}&state=${secret}`,
        `/api/recruiter-hub/shortlists?jobId=${publicJob}&applicationId=${secret}`
      ]) {
        assert.equal((await send(route, { password: secret, nested: { apiKey: secret } })).status, 200);
      }
      await Promise.allSettled([...pendingAudits]);
      // Read the collection directly, without DTO/projection/serialization redaction.
      const raw = await AuditLog.collection
        .find({
          route: {
            $in: [
              '/api/profile?tab=settings',
              '/api/profile',
              '/api/integrations/callback',
              `/api/recruiter-hub/shortlists?jobId=${publicJob}`
            ]
          }
        })
        .toArray();
      assert.equal(raw.length, 4);
      assert.equal(JSON.stringify(raw).includes(secret), false);
      assert.deepEqual(raw.find((record) => record.route === '/api/profile?tab=settings').before.query, {
        tab: 'settings'
      });
      // Mongoose minimizes empty Mixed objects in the stored BSON document.
      assert.deepEqual(raw.find((record) => record.route === '/api/profile').before.query ?? {}, {});
      assert.equal(raw.find((record) => record.route === '/api/integrations/callback').before, null);
      const output = path.resolve(__dirname, '../../../verification/admin/p1.6a.2/raw-audit-inspection.json');
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(
        output,
        JSON.stringify(
          {
            productionDataUsed: false,
            rawDocumentsInspected: raw.length,
            syntheticSecretAbsent: true,
            records: raw
          },
          null,
          2
        ) + '\n'
      );
    }
  );
});
