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
const Team = require('../../modules/admin/models/team');
const Membership = require('../../modules/admin/models/membership');
const Invitation = require('../../modules/admin/models/invitation');
const Notification = require('../../modules/notifications/models/notification');
const AuditLog = require('../../modules/admin/models/auditLog');
const { auditLogMiddleware } = require('../../core/middleware/auditLogMiddleware');
const { sign } = require('../../modules/auth/utils/authSessionToken');

const waitForAudits = async (pendingAudits, filter) => {
  await Promise.allSettled([...pendingAudits]);
  for (let i = 0; i < 20; i += 1) {
    const rows = await AuditLog.collection.find(filter).toArray();
    if (rows.length > 0) return rows;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return AuditLog.collection.find(filter).toArray();
};

test(
  'invitation authority revocation and acceptance transaction closure',
  { timeout: 180000 },
  async (t) => {
    const mongo = await startMongo({ replicaSet: 'invitation-authority-revocation' });
    const previousSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = randomBytes(32).toString('hex');
    let server;
    const pendingAudits = new Set();
    const auditErrors = [];

    t.after(async () => {
      try {
        if (server) {
          server.closeAllConnections?.();
          await new Promise((resolve) => server.close(resolve));
        }
        await Promise.allSettled([...pendingAudits]);
        assert.deepEqual(auditErrors, []);
      } finally {
        settings.stopSettingsSynchronization();
        await mongoose.disconnect();
        await mongo.stop();
        if (previousSecret === undefined) delete process.env.JWT_SECRET;
        else process.env.JWT_SECRET = previousSecret;
      }
    });

    await mongoose.connect(mongo.uri);
    await settings.startSettingsSynchronization();
    await settings.updateSettings({
      organization: { recruiterLimitPerOrg: 25, maxTeamsPerOrganization: 25 },
      recruiter: { enableRecruiterAccess: true }
    });

    for (const Model of [
      User,
      Organization,
      Team,
      Membership,
      Invitation,
      Notification,
      AuditLog
    ]) {
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
    const invitationEmailService = require('../../core/messaging/invitationEmailService');
    t.mock.method(emailService, 'sendRecruiterInvitationEmail', async () => ({
      sent: false,
      reason: 'disposable test stub'
    }));
    t.mock.method(invitationEmailService, 'sendInvitationEmail', async () => ({
      sent: true,
      provider: 'stub'
    }));

    const app = express();
    app.use(express.json());
    app.use(auditLogMiddleware);
    app.use('/api/admin', require('../../modules/admin/routes/admin.routes'));
    app.use('/api/admin-console', require('../../modules/admin/routes/adminConsole.routes'));
    app.use('/api/tenant', require('../../modules/admin/routes/tenant.routes'));
    app.get(
      '/api/auth/invite-details/:token',
      require('../../modules/auth/authcontroller').getInviteDetails
    );
    app.post('/api/auth/accept-invite', require('../../modules/auth/authcontroller').acceptInvite);

    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}`;

    const send = async (route, method = 'POST', body, actor = null) => {
      const response = await fetch(base + route, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(actor && { Authorization: `Bearer ${sign(actor)}` })
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(20000)
      });
      return { status: response.status, data: await response.json() };
    };

    const user = (slug, props = {}) =>
      User.create({
        name: slug,
        email: `${slug}-${randomBytes(4).toString('hex')}@revocation.test`,
        providers: ['github'],
        isVerified: true,
        isActive: true,
        ...props
      });

    const owner = await user('org-owner', { role: 'admin' });
    const foreignOwner = await user('foreign-owner', { role: 'admin' });
    const superAdminOwner = await user('super-owner', { role: 'super_admin' });
    const superAdminOutsider = await user('super-outsider', { role: 'super_admin' });

    const org = await Organization.create({
      name: 'Revocation Org',
      slug: 'revocation-org',
      ownerId: owner._id,
      createdBy: owner._id
    });
    const foreignOrg = await Organization.create({
      name: 'Foreign Org',
      slug: 'foreign-revocation-org',
      ownerId: foreignOwner._id,
      createdBy: foreignOwner._id
    });
    const superOrg = await Organization.create({
      name: 'Super Owned Org',
      slug: 'super-owned-org',
      ownerId: superAdminOwner._id,
      createdBy: superAdminOwner._id
    });

    owner.organizationId = org._id;
    foreignOwner.organizationId = foreignOrg._id;
    await Promise.all([owner.save(), foreignOwner.save()]);

    const activeTeam = await Team.create({
      organizationId: org._id,
      name: 'Core Engineering',
      slug: 'core-engineering',
      createdBy: owner._id,
      isActive: true
    });

    await Membership.create([
      { organizationId: org._id, userId: owner._id, teamId: null, role: 'admin', status: 'active' },
      {
        organizationId: foreignOrg._id,
        userId: foreignOwner._id,
        teamId: null,
        role: 'admin',
        status: 'active'
      }
    ]);

    await t.test(
      'disabled direct Admin inviter is denied before and after invitationCreation toggle across all acceptance, creation and resend paths',
      async () => {
        const inviter = await user('non-owner-admin', {
          role: 'admin',
          organizationId: org._id
        });
        const inviterDirectMembership = await Membership.create({
          organizationId: org._id,
          userId: inviter._id,
          teamId: null,
          role: 'admin',
          status: 'active'
        });

        const recDirect = await user('rec-direct', { role: 'developer' });
        const recById = await user('rec-by-id', { role: 'developer' });
        const recByToken = await user('rec-by-token', { role: 'developer' });
        const onboardRecruiterEmail = `onboard-rec-${randomBytes(4).toString('hex')}@revocation.test`;
        const onboardMemberEmail = `onboard-mem-${randomBytes(4).toString('hex')}@revocation.test`;

        for (const payload of [
          { name: 'Direct Check', email: recDirect.email },
          { name: 'By ID', email: recById.email },
          { name: 'By Token', email: recByToken.email },
          { name: 'Auth Onboard', email: onboardRecruiterEmail }
        ]) {
          const created = await send('/api/admin/invite-recruiter', 'POST', payload, inviter);
          assert.equal(created.status, 201, JSON.stringify(created.data));
        }

        const memberCreated = await send(
          `/api/tenant/organizations/${org._id}/invitations`,
          'POST',
          { email: onboardMemberEmail, role: 'member' },
          inviter
        );
        assert.equal(memberCreated.status, 201, JSON.stringify(memberCreated.data));

        // Disable direct membership while keeping User.role='admin', isActive=true, organizationId=org._id
        await Membership.updateOne(
          { _id: inviterDirectMembership._id },
          { $set: { status: 'disabled' } }
        );

        const invDirect = await Invitation.findOne({
          organizationId: org._id,
          email: recDirect.email
        });
        const invById = await Invitation.findOne({ organizationId: org._id, email: recById.email });
        const invByToken = await Invitation.findOne({
          organizationId: org._id,
          email: recByToken.email
        });
        const invAuthOnboard = await Invitation.findOne({
          organizationId: org._id,
          email: onboardRecruiterEmail
        });
        const invTenantOnboard = await Invitation.findOne({
          organizationId: org._id,
          email: onboardMemberEmail
        });

        const initialSeatsBefore = await User.countDocuments({
          organizationId: org._id,
          role: 'recruiter',
          isActive: { $ne: false }
        });
        const notificationsBefore = await Notification.countDocuments();

        // Phase A: Before toggling policy, acceptance on both direct & onboarding paths must deny
        assert.equal(
          (await send(`/api/tenant/invitations/${invDirect._id}/accept`, 'POST', {}, recDirect))
            .status,
          403
        );
        assert.equal(
          (await send(`/api/tenant/invitations/accept/${invByToken.token}`, 'POST', {}, recByToken))
            .status,
          403
        );
        assert.equal(
          (
            await send('/api/auth/accept-invite', 'POST', {
              token: invAuthOnboard.token,
              password: 'Strong-Password-99!'
            })
          ).status,
          403
        );
        assert.equal(
          (
            await send(`/api/tenant/invitations/accept/${invTenantOnboard.token}/onboard`, 'POST', {
              name: 'Member Onboard',
              password: 'Strong-Password-99!'
            })
          ).status,
          403
        );

        // Phase B: Disable and re-enable invitationCreation via owner
        for (const enabled of [false, true]) {
          const gov = await send('/api/admin-console/governance', 'GET', undefined, owner);
          assert.equal(gov.status, 200);
          const patched = await send(
            '/api/admin-console/governance',
            'PATCH',
            { expectedVersion: gov.data.version, policies: { invitationCreation: enabled } },
            owner
          );
          assert.equal(patched.status, 200);
        }

        // Read-only invitation detail checks produce zero mutations
        assert.equal(
          (await send(`/api/tenant/invitations/${invByToken.token}/details`, 'GET')).status,
          200
        );
        assert.equal(
          (await send(`/api/auth/invite-details/${invAuthOnboard.token}`, 'GET')).status,
          200
        );

        // Creation and resend remain denied for revoked non-owner admin
        for (const [route, body] of [
          [
            '/api/admin/invite-recruiter',
            { name: 'Denied', email: 'denied-create@revocation.test' }
          ],
          ['/api/admin/recruiter', { name: 'Denied Alias', email: 'denied-alias@revocation.test' }],
          [`/api/admin/invitations/${invById._id}/resend`, {}],
          [
            `/api/tenant/organizations/${org._id}/invitations`,
            { email: 'denied-tenant@revocation.test', role: 'member' }
          ]
        ]) {
          const res = await send(route, 'POST', body, inviter);
          assert.equal(res.status, 403, route);
        }

        // All 4 acceptance routes must return 403 after re-enable
        const resById = await send(
          `/api/tenant/invitations/${invById._id}/accept`,
          'POST',
          {},
          recById
        );
        const resByToken = await send(
          `/api/tenant/invitations/accept/${invByToken.token}`,
          'POST',
          {},
          recByToken
        );
        const resAuthOnboard = await send('/api/auth/accept-invite', 'POST', {
          token: invAuthOnboard.token,
          password: 'Strong-Password-99!'
        });
        const resTenantOnboard = await send(
          `/api/tenant/invitations/accept/${invTenantOnboard.token}/onboard`,
          'POST',
          { name: 'Member Onboard', password: 'Strong-Password-99!' }
        );

        for (const res of [resById, resByToken, resAuthOnboard, resTenantOnboard]) {
          assert.equal(res.status, 403, JSON.stringify(res.data));
          assert.equal(Boolean(res.data?.user?.token), false);
          assert.equal(Boolean(res.data?.token), false);
        }

        for (const inv of [invDirect, invById, invByToken, invAuthOnboard, invTenantOnboard]) {
          const fresh = await Invitation.findById(inv._id).lean();
          assert.equal(fresh.status, 'pending');
          assert.equal(fresh.acceptedBy, null);
        }

        for (const dev of [recDirect, recById, recByToken]) {
          const freshUser = await User.findById(dev._id).lean();
          assert.equal(freshUser.role, 'developer');
          assert.equal(freshUser.organizationId, null);
          assert.equal(await Membership.countDocuments({ userId: dev._id }), 0);
        }

        assert.equal(await User.findOne({ email: onboardRecruiterEmail }), null);
        assert.equal(await User.findOne({ email: onboardMemberEmail }), null);
        assert.equal(
          await User.countDocuments({
            organizationId: org._id,
            role: 'recruiter',
            isActive: { $ne: false }
          }),
          initialSeatsBefore
        );
        assert.equal(await Notification.countDocuments(), notificationsBefore);

        await waitForAudits(pendingAudits, { statusCode: 403 });
        const successfulAcceptAudits = await AuditLog.collection
          .find({
            route: {
              $in: [
                '/api/tenant/invitations/:id/accept',
                '/api/tenant/invitations/accept/:token',
                '/api/tenant/invitations/accept/:token/onboard',
                '/api/auth/accept-invite'
              ]
            },
            statusCode: { $lt: 400 }
          })
          .toArray();
        assert.equal(successfulAcceptAudits.length, 0);
      }
    );

    await t.test(
      'authorized inviter compatibility: active direct Admin, exact owner, Super Admin owner, and legacy affiliation without disabled membership',
      async () => {
        // 1. Active direct Admin membership
        const directAdmin = await user('compat-direct-admin', {
          role: 'admin',
          organizationId: org._id
        });
        await Membership.create({
          organizationId: org._id,
          userId: directAdmin._id,
          teamId: null,
          role: 'admin',
          status: 'active'
        });
        const directTarget = await user('compat-direct-target', { role: 'developer' });
        assert.equal(
          (
            await send(
              '/api/admin/invite-recruiter',
              'POST',
              { name: 'Direct Target', email: directTarget.email },
              directAdmin
            )
          ).status,
          201
        );
        const directInv = await Invitation.findOne({
          organizationId: org._id,
          email: directTarget.email
        });
        assert.equal(
          (await send(`/api/tenant/invitations/${directInv._id}/accept`, 'POST', {}, directTarget))
            .status,
          200
        );
        assert.equal((await User.findById(directTarget._id)).role, 'recruiter');

        // 2. Legitimate exact organization owner (admin)
        const ownerTarget = await user('compat-owner-target', { role: 'developer' });
        assert.equal(
          (
            await send(
              '/api/admin/invite-recruiter',
              'POST',
              { name: 'Owner Target', email: ownerTarget.email },
              owner
            )
          ).status,
          201
        );
        const ownerInv = await Invitation.findOne({
          organizationId: org._id,
          email: ownerTarget.email
        });
        assert.equal(
          (await send(`/api/tenant/invitations/accept/${ownerInv.token}`, 'POST', {}, ownerTarget))
            .status,
          200
        );
        assert.equal((await User.findById(ownerTarget._id)).role, 'recruiter');

        // 3. Previously accepted Super Admin organization-owner invitation compatibility
        const saOnboardEmail = `sa-owner-${randomBytes(4).toString('hex')}@revocation.test`;
        const saInv = await Invitation.create({
          organizationId: superOrg._id,
          invitedBy: superAdminOwner._id,
          email: saOnboardEmail,
          name: 'SA Invite Recruiter',
          role: 'recruiter',
          token: randomBytes(24).toString('hex'),
          expiresAt: new Date(Date.now() + 60000)
        });
        const saRes = await send('/api/auth/accept-invite', 'POST', {
          token: saInv.token,
          password: 'Strong-Password-99!'
        });
        assert.equal(saRes.status, 200, JSON.stringify(saRes.data));
        const saRec = await User.findOne({ email: saOnboardEmail }).lean();
        assert.equal(saRec.role, 'recruiter');
        assert.equal(String(saRec.organizationId), String(superOrg._id));

        // 4. Non-owner Super Admin has no bypass
        const saDeniedEmail = `sa-outsider-${randomBytes(4).toString('hex')}@revocation.test`;
        const saDeniedInv = await Invitation.create({
          organizationId: superOrg._id,
          invitedBy: superAdminOutsider._id,
          email: saDeniedEmail,
          role: 'recruiter',
          token: randomBytes(24).toString('hex'),
          expiresAt: new Date(Date.now() + 60000)
        });
        assert.equal(
          (
            await send('/api/auth/accept-invite', 'POST', {
              token: saDeniedInv.token,
              password: 'Strong-Password-99!'
            })
          ).status,
          403
        );
        assert.equal(await User.findOne({ email: saDeniedEmail }), null);

        // 5. Legacy affiliation without direct Membership document
        const legacyAdmin = await user('compat-legacy-admin', {
          role: 'admin',
          organizationId: org._id
        });
        const legacyTarget = await user('compat-legacy-target', { role: 'developer' });
        assert.equal(
          (
            await send(
              '/api/admin/invite-recruiter',
              'POST',
              { name: 'Legacy Target', email: legacyTarget.email },
              legacyAdmin
            )
          ).status,
          201
        );
        const legacyInv = await Invitation.findOne({
          organizationId: org._id,
          email: legacyTarget.email
        });
        assert.equal(
          (await send(`/api/admin/invitations/${legacyInv._id}/resend`, 'POST', {}, legacyAdmin))
            .status,
          200
        );
        assert.equal(
          (
            await send(
              `/api/tenant/invitations/accept/${legacyInv.token}`,
              'POST',
              {},
              legacyTarget
            )
          ).status,
          200
        );
        assert.equal((await User.findById(legacyTarget._id)).role, 'recruiter');
      }
    );

    await t.test(
      'other denied authority: inactive, foreign, demoted, insufficient direct role, disabled direct + active team, suspended org, expired/revoked',
      async () => {
        const makePending = (invitedBy, extra = {}) =>
          Invitation.create({
            organizationId: org._id,
            invitedBy,
            email: `denied-${randomBytes(5).toString('hex')}@revocation.test`,
            role: 'recruiter',
            token: randomBytes(24).toString('hex'),
            expiresAt: new Date(Date.now() + 60000),
            ...extra
          });

        // Inactive inviter account (even with active direct admin membership)
        const inactiveAdmin = await user('inactive-admin', {
          role: 'admin',
          organizationId: org._id,
          isActive: false
        });
        await Membership.create({
          organizationId: org._id,
          userId: inactiveAdmin._id,
          teamId: null,
          role: 'admin',
          status: 'active'
        });
        assert.equal(
          (
            await send('/api/auth/accept-invite', 'POST', {
              token: (await makePending(inactiveAdmin._id)).token,
              password: 'Strong-Password-99!'
            })
          ).status,
          403
        );

        // Foreign-organization inviter
        assert.equal(
          (
            await send('/api/auth/accept-invite', 'POST', {
              token: (await makePending(foreignOwner._id)).token,
              password: 'Strong-Password-99!'
            })
          ).status,
          403
        );

        // Demoted inviter account role (from admin -> developer) despite active direct admin membership
        const demotedAdmin = await user('demoted-admin', {
          role: 'admin',
          organizationId: org._id
        });
        await Membership.create({
          organizationId: org._id,
          userId: demotedAdmin._id,
          teamId: null,
          role: 'admin',
          status: 'active'
        });
        const demotedInv = await makePending(demotedAdmin._id);
        await User.updateOne({ _id: demotedAdmin._id }, { $set: { role: 'developer' } });
        assert.equal(
          (
            await send('/api/auth/accept-invite', 'POST', {
              token: demotedInv.token,
              password: 'Strong-Password-99!'
            })
          ).status,
          403
        );

        // Insufficient direct membership role (Admin account with direct 'member' or 'manager' role)
        const downgradedAdmin = await user('insufficient-direct-role', {
          role: 'admin',
          organizationId: org._id
        });
        const downgradedMem = await Membership.create({
          organizationId: org._id,
          userId: downgradedAdmin._id,
          teamId: null,
          role: 'admin',
          status: 'active'
        });
        const downgradedInv = await makePending(downgradedAdmin._id);
        await Membership.updateOne({ _id: downgradedMem._id }, { $set: { role: 'member' } });
        assert.equal(
          (
            await send(
              '/api/admin/invite-recruiter',
              'POST',
              { name: 'Insufficient', email: 'insuff@revocation.test' },
              downgradedAdmin
            )
          ).status,
          403
        );
        assert.equal(
          (
            await send(
              `/api/admin/invitations/${downgradedInv._id}/resend`,
              'POST',
              {},
              downgradedAdmin
            )
          ).status,
          403
        );
        assert.equal(
          (
            await send('/api/auth/accept-invite', 'POST', {
              token: downgradedInv.token,
              password: 'Strong-Password-99!'
            })
          ).status,
          403
        );

        // Disabled direct membership paired with an active team admin membership
        const teamOnlyAdmin = await user('disabled-direct-active-team', {
          role: 'admin',
          organizationId: org._id
        });
        await Membership.create([
          {
            organizationId: org._id,
            userId: teamOnlyAdmin._id,
            teamId: null,
            role: 'admin',
            status: 'disabled'
          },
          {
            organizationId: org._id,
            userId: teamOnlyAdmin._id,
            teamId: activeTeam._id,
            role: 'admin',
            status: 'active'
          }
        ]);
        const teamOnlyRecInv = await makePending(teamOnlyAdmin._id);
        const teamOnlyMemInv = await makePending(teamOnlyAdmin._id, { role: 'member' });
        assert.equal(
          (
            await send('/api/auth/accept-invite', 'POST', {
              token: teamOnlyRecInv.token,
              password: 'Strong-Password-99!'
            })
          ).status,
          403
        );
        assert.equal(
          (
            await send(`/api/tenant/invitations/accept/${teamOnlyMemInv.token}/onboard`, 'POST', {
              name: 'Team Only Member',
              password: 'Strong-Password-99!'
            })
          ).status,
          403
        );

        // Expired & revoked invitations fail closed without modifying recipient or issuing token
        const expiredInv = await makePending(owner._id, {
          expiresAt: new Date(Date.now() - 5000)
        });
        const revokedInv = await makePending(owner._id, { status: 'revoked' });
        assert.equal(
          (
            await send('/api/auth/accept-invite', 'POST', {
              token: expiredInv.token,
              password: 'Strong-Password-99!'
            })
          ).status,
          400
        );
        assert.equal(
          (
            await send('/api/auth/accept-invite', 'POST', {
              token: revokedInv.token,
              password: 'Strong-Password-99!'
            })
          ).status,
          400
        );

        // Suspended organization denies acceptance and preserves pending state
        const suspendedOrgInv = await makePending(owner._id);
        await Organization.updateOne({ _id: org._id }, { $set: { isSuspended: true } });
        try {
          assert.equal(
            (
              await send('/api/auth/accept-invite', 'POST', {
                token: suspendedOrgInv.token,
                password: 'Strong-Password-99!'
              })
            ).status,
            403
          );
          assert.equal((await Invitation.findById(suspendedOrgInv._id)).status, 'pending');
        } finally {
          await Organization.updateOne({ _id: org._id }, { $set: { isSuspended: false } });
        }
      }
    );

    await t.test(
      'concurrent revocation vs acceptance enforces fence ordering and commits safely',
      async () => {
        // Case 1: Acceptance enters transaction and holds at Team.exists (after Organization fence,
        // before Membership write fence); standalone Membership.updateOne disables direct membership
        // and commits first. Membership fence detects conflict, transaction retries and denies 403.
        const inviter1 = await user('race-inviter-1', {
          role: 'admin',
          organizationId: org._id
        });
        const inv1Membership = await Membership.create({
          organizationId: org._id,
          userId: inviter1._id,
          teamId: null,
          role: 'admin',
          status: 'active'
        });
        const raceRec1 = await user('race-rec-1', { role: 'developer' });
        const inv1 = await Invitation.create({
          organizationId: org._id,
          teamId: activeTeam._id,
          invitedBy: inviter1._id,
          email: raceRec1.email,
          role: 'recruiter',
          token: randomBytes(24).toString('hex'),
          expiresAt: new Date(Date.now() + 60000)
        });

        let enterTeamCheck;
        const enteredTeamCheck = new Promise((resolve) => {
          enterTeamCheck = resolve;
        });
        let releaseTeamCheck;
        const releasedTeamCheck = new Promise((resolve) => {
          releaseTeamCheck = resolve;
        });
        const originalTeamExists = Team.exists;
        let teamChecks = 0;
        Team.exists = function (...args) {
          teamChecks += 1;
          const query = originalTeamExists.apply(this, args);
          if (teamChecks === 1) {
            const origSession = query.session.bind(query);
            query.session = function (sess) {
              const res = origSession(sess);
              const origThen = res.then.bind(res);
              res.then = function (onFulfilled, onRejected) {
                return origThen(async (val) => {
                  enterTeamCheck();
                  await releasedTeamCheck;
                  return val;
                }, onRejected).then(onFulfilled, onRejected);
              };
              return res;
            };
          }
          return query;
        };

        try {
          const acceptPromise = send(
            `/api/tenant/invitations/${inv1._id}/accept`,
            'POST',
            {},
            raceRec1
          );
          await enteredTeamCheck;
          // Standalone update to Membership ONLY (does not write Organization)
          await Membership.updateOne({ _id: inv1Membership._id }, { $set: { status: 'disabled' } });
          releaseTeamCheck();
          const acceptRes = await acceptPromise;
          assert.equal(acceptRes.status, 403, JSON.stringify(acceptRes.data));
          assert.ok(teamChecks >= 2, 'Expected transaction retry after Membership write conflict');
          assert.equal((await Invitation.findById(inv1._id)).status, 'pending');
          assert.equal((await User.findById(raceRec1._id)).role, 'developer');
          assert.equal(await Membership.countDocuments({ userId: raceRec1._id }), 0);
        } finally {
          releaseTeamCheck();
          Team.exists = originalTeamExists;
        }

        // Case 2: Valid acceptance acquires Membership fence and pauses in acceptMembership;
        // concurrent transactional role downgrade commits afterward and blocks subsequent invites.
        const inviter2 = await user('race-inviter-2', {
          role: 'admin',
          organizationId: org._id
        });
        const inv2Membership = await Membership.create({
          organizationId: org._id,
          userId: inviter2._id,
          teamId: null,
          role: 'admin',
          status: 'active'
        });
        const raceRec2 = await user('race-rec-2', { role: 'developer' });
        const raceRec2Later = await user('race-rec-2-later', { role: 'developer' });
        const inv2First = await Invitation.create({
          organizationId: org._id,
          invitedBy: inviter2._id,
          email: raceRec2.email,
          role: 'recruiter',
          token: randomBytes(24).toString('hex'),
          expiresAt: new Date(Date.now() + 60000)
        });
        const inv2Second = await Invitation.create({
          organizationId: org._id,
          invitedBy: inviter2._id,
          email: raceRec2Later.email,
          role: 'recruiter',
          token: randomBytes(24).toString('hex'),
          expiresAt: new Date(Date.now() + 60000)
        });

        let enterAcceptMem;
        const enteredAcceptMem = new Promise((resolve) => {
          enterAcceptMem = resolve;
        });
        let releaseAcceptMem;
        const releasedAcceptMem = new Promise((resolve) => {
          releaseAcceptMem = resolve;
        });
        const origMemFindOneAndUpdate = Membership.findOneAndUpdate;
        let memUpdateHeld = false;
        Membership.findOneAndUpdate = function (...args) {
          const query = origMemFindOneAndUpdate.apply(this, args);
          if (
            !memUpdateHeld &&
            args[1]?.$set?.status === 'active' &&
            query &&
            typeof query.then === 'function'
          ) {
            memUpdateHeld = true;
            const origThen = query.then.bind(query);
            query.then = function (onFulfilled, onRejected) {
              return origThen(async (val) => {
                enterAcceptMem();
                await releasedAcceptMem;
                return val;
              }, onRejected).then(onFulfilled, onRejected);
            };
          }
          return query;
        };

        try {
          const validAccept = send(
            `/api/tenant/invitations/accept/${inv2First.token}`,
            'POST',
            {},
            raceRec2
          );
          await enteredAcceptMem;
          const downgrade = send(
            `/api/tenant/memberships/${inv2Membership._id}/role`,
            'PATCH',
            { role: 'member' },
            owner
          );
          releaseAcceptMem();
          const [validRes, downgradeRes] = await Promise.all([validAccept, downgrade]);
          assert.equal(validRes.status, 200, JSON.stringify(validRes.data));
          assert.equal(downgradeRes.status, 200, JSON.stringify(downgradeRes.data));
          assert.equal((await Invitation.findById(inv2First._id)).status, 'accepted');
          assert.equal((await User.findById(raceRec2._id)).role, 'recruiter');
          assert.equal((await Membership.findById(inv2Membership._id)).role, 'member');

          // Subsequent acceptance by downgraded inviter must fail 403
          const laterRes = await send(
            `/api/tenant/invitations/accept/${inv2Second.token}`,
            'POST',
            {},
            raceRec2Later
          );
          assert.equal(laterRes.status, 403);
          assert.equal((await Invitation.findById(inv2Second._id)).status, 'pending');
          assert.equal((await User.findById(raceRec2Later._id)).role, 'developer');
        } finally {
          releaseAcceptMem();
          Membership.findOneAndUpdate = origMemFindOneAndUpdate;
        }
      }
    );
  }
);
