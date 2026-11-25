const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { once } = require('node:events');
const express = require('express');
const mongoose = require('mongoose');
const { startMongo } = require('../fixtures/disposableRequestMongo');
const settings = require('../../modules/super-admin/services/platformSettingsService');
const User = require('../../modules/auth/models/user');
const Organization = require('../../modules/admin/models/organization');
const Team = require('../../modules/admin/models/team');
const Membership = require('../../modules/admin/models/membership');
const Job = require('../../modules/recruiter/models/Job');
const Application = require('../../modules/jobs/models/jobApplication');
const {
  getRecruiterJobDetails
} = require('../../modules/recruiter/services/hub/recruiterJobService');
const { sign } = require('../../modules/auth/utils/authSessionToken');

test(
  'explicit recruiter team metadata sharing: policy, disclosure boundary and live revocation',
  { timeout: 120000 },
  async (t) => {
    const mongo = await startMongo({
      replicaSet: 'team-jobs',
      temporaryRoot: path.resolve(__dirname, '../../../verification')
    });
    let server;
    const previous = process.env.JWT_SECRET;
    process.env.JWT_SECRET = 'disposable-team-job-policy-session-key';
    t.after(async () => {
      if (server) await new Promise((resolve) => server.close(resolve));
      settings.stopSettingsSynchronization();
      await mongoose.disconnect();
      await mongo.stop();
      if (previous === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = previous;
    });
    await mongoose.connect(mongo.uri);
    await settings.startSettingsSynchronization();
    await Promise.all(
      [User, Organization, Team, Membership, Job, Application].map((model) => model.init())
    );
    const id = () => new mongoose.Types.ObjectId();
    const org = id(),
      foreignOrg = id();
    const owner = id(),
      member = id(),
      manager = id(),
      teamAdmin = id(),
      outsider = id(),
      foreign = id(),
      admin = id(),
      superAdmin = id(),
      legacy = id(),
      applicant = id();
    await User.collection.insertMany(
      [
        owner,
        member,
        manager,
        teamAdmin,
        outsider,
        foreign,
        admin,
        superAdmin,
        legacy,
        applicant
      ].map((_id, i) => ({
        _id,
        name: `Fixture ${i}`,
        email: `team-${i}@fixture.test`,
        organizationId: i === 5 ? foreignOrg : org,
        role: i === 6 ? 'admin' : i === 7 ? 'super_admin' : i === 9 ? 'developer' : 'recruiter',
        isActive: true,
        sessionRevision: 0
      }))
    );
    await Organization.create([
      { _id: org, name: 'Team organization', slug: 'team-org', ownerId: admin, createdBy: admin },
      {
        _id: foreignOrg,
        name: 'Other organization',
        slug: 'other-org',
        ownerId: foreign,
        createdBy: foreign
      }
    ]);
    const [team, otherTeam, foreignTeam] = await Team.create([
      { organizationId: org, name: 'Hiring team', slug: 'hiring', createdBy: admin },
      { organizationId: org, name: 'Other team', slug: 'other', createdBy: admin },
      { organizationId: foreignOrg, name: 'Foreign team', slug: 'foreign', createdBy: foreign }
    ]);
    await Membership.create([
      ...[owner, member, manager, teamAdmin].map((userId, i) => ({
        userId,
        organizationId: org,
        teamId: team._id,
        role: i === 2 ? 'manager' : i === 3 ? 'admin' : 'member'
      })),
      { userId: owner, organizationId: org, teamId: otherTeam._id, role: 'member' },
      ...[owner, member, manager, teamAdmin, outsider].map((userId) => ({
        userId,
        organizationId: org,
        teamId: null,
        role: userId === outsider ? 'admin' : 'member'
      })),
      { userId: foreign, organizationId: foreignOrg, teamId: foreignTeam._id, role: 'manager' }
    ]);
    const app = express();
    app.use(express.json());
    app.use(async (_req, res, next) => {
      try {
        await settings.getSettings();
        next();
      } catch {
        res.status(503).json({ message: 'Settings unavailable' });
      }
    });
    app.use('/api/recruiter-hub', require('../../modules/recruiter/routes/hub/recruiterHubRoutes'));
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}/api/recruiter-hub/jobs`;
    const request = async (actor, suffix = '', method = 'GET', body) => {
      const response = await fetch(base + suffix, {
        method,
        headers: {
          ...(actor ? { Authorization: `Bearer ${sign({ _id: actor })}` } : {}),
          'Content-Type': 'application/json'
        },
        ...(body ? { body: JSON.stringify(body) } : {})
      });
      return { status: response.status, body: await response.json() };
    };
    const payload = {
      title: 'Shared engineer',
      role: 'Engineer',
      location: 'Remote',
      requiredSkills: ['Node.js'],
      teamId: String(team._id)
    };
    let job;
    await t.test(
      'historical assignments and new jobs default private; no Admin bypass',
      async () => {
        const historical = await Job.create({
          recruiterId: owner,
          organizationId: org,
          teamId: team._id,
          title: 'Historical team label'
        });
        assert.equal((await request(member, `/${historical._id}`)).status, 404);
        const privateLegacy = await Job.create({
          recruiterId: legacy,
          organizationId: org,
          title: 'Legacy private owner'
        });
        assert.equal((await request(legacy, `/${privateLegacy._id}`)).status, 200);
        for (const actor of [admin, superAdmin, applicant])
          assert.equal((await request(actor)).status, 403);
        assert.equal((await request(null)).status, 401);
        const created = await request(owner, '', 'POST', payload);
        assert.equal(created.status, 201);
        job = created.body.job;
        assert.equal(job.teamShared, false);
        assert.equal((await request(member)).body.jobs.length, 0);
        assert.equal((await request(outsider)).body.teams.length, 0);
        assert.equal((await request(owner)).body.teams.length, 2);
      }
    );
    await t.test(
      'only explicit owner intent, active own-team membership and current version can share',
      async () => {
        const url = `/${job._id}`;
        assert.equal((await request(owner, url, 'PATCH', { teamShared: true })).status, 400);
        assert.equal(
          (await request(owner, url, 'PATCH', { teamShared: 'true', expectedVersion: job.version }))
            .status,
          400
        );
        assert.equal(
          (
            await request(owner, url, 'PATCH', {
              teamShared: true,
              teamId: String(foreignTeam._id),
              expectedVersion: job.version
            })
          ).status,
          403
        );
        assert.equal(
          (await request(owner, url, 'PATCH', { recruiterId: String(manager) })).status,
          400
        );
        const shared = await request(owner, url, 'PATCH', {
          teamShared: true,
          expectedVersion: job.version
        });
        assert.equal(shared.status, 200);
        job = shared.body.job;
        assert.equal(job.owner._id, String(owner));
        const viewed = await request(member, url);
        assert.equal(viewed.status, 200);
        assert.equal(viewed.body.job.access.view, true);
        assert.equal(viewed.body.job.access.edit, false);
        assert.equal(viewed.body.job.access.privateEvidence, false);
        assert.equal(viewed.body.job.access.matching, false);
        assert.equal((await request(member)).body.jobs.length, 1);
        for (const actor of [outsider, foreign])
          assert.equal((await request(actor, url)).status, 404);
      }
    );
    await t.test(
      'team member reads; manager/admin membership edits, publishes and archives, never shares/deletes',
      async () => {
        const url = `/${job._id}`;
        assert.equal((await request(member, url, 'PATCH', { title: 'Denied' })).status, 403);
        assert.equal((await request(member, url, 'PATCH', { published: true })).status, 403);
        assert.equal((await request(member, `${url}/archive`, 'POST', {})).status, 403);
        for (const actor of [manager, teamAdmin]) {
          const edited = await request(actor, url, 'PATCH', {
            title: 'Team edited',
            published: true
          });
          assert.equal(edited.status, 200);
          assert.equal(edited.body.job.recruiterId, String(owner));
          assert.equal(
            (
              await request(actor, url, 'PATCH', {
                teamShared: false,
                expectedVersion: edited.body.job.version
              })
            ).status,
            403
          );
          assert.equal((await request(actor, url, 'DELETE')).status, 403);
        }
        assert.equal((await request(manager, `${url}/archive`, 'POST', {})).status, 200);
        assert.equal((await request(owner, url, 'PATCH', { status: 'open' })).status, 200);
      }
    );
    await t.test(
      'P1.2B evidence and private comparison/shortlist lookup remain owner-only',
      async () => {
        const pdf = Buffer.from('%PDF-1.7 fixture');
        const applicationId = 'a'.repeat(64);
        await Application.create({
          _id: applicationId,
          organizationId: org,
          organizationName: 'Team organization',
          recruiterId: owner,
          jobId: job._id,
          applicantId: applicant,
          applicantName: 'Private applicant',
          jobTitle: job.title,
          resume: { fileId: id(), fileName: 'private.pdf', sha256: 'hash', uploadedAt: new Date() },
          resumeBytes: pdf,
          portfolio: { summary: 'PRIVATE APPLICATION EVIDENCE' },
          consent: { version: 'fixture', submittedAt: new Date(), sharePortfolio: true },
          history: [{ from: '', to: 'submitted', actorId: applicant, at: new Date() }]
        });
        const root = `/${job._id}/applications`;
        assert.equal((await request(owner, root)).body.applications.length, 1);
        for (const actor of [member, manager, teamAdmin]) {
          assert.equal((await request(actor, root)).status, 404);
          assert.equal((await request(actor, `${root}/${applicationId}/resume`)).status, 404);
          assert.equal(
            (await request(actor, `${root}/${applicationId}`, 'PATCH', { status: 'reviewing' }))
              .status,
            404
          );
          assert.equal(
            await getRecruiterJobDetails({
              recruiterId: actor,
              organizationId: org,
              jobId: job._id
            }),
            null
          );
          assert.equal(
            JSON.stringify((await request(actor, `/${job._id}`)).body).includes(
              'PRIVATE APPLICATION EVIDENCE'
            ),
            false
          );
        }
      }
    );
    await t.test(
      'sharing changes compare versions; unsharing removes access immediately',
      async () => {
        const url = `/${job._id}`;
        const current = (await request(owner, url)).body.job;
        const results = await Promise.all([
          request(owner, url, 'PATCH', { teamShared: false, expectedVersion: current.version }),
          request(owner, url, 'PATCH', {
            teamShared: true,
            teamId: String(otherTeam._id),
            expectedVersion: current.version
          })
        ]);
        assert.deepEqual(results.map((entry) => entry.status).sort(), [200, 409]);
        const latest = (await request(owner, url)).body.job;
        const reset = await request(owner, url, 'PATCH', {
          teamShared: true,
          teamId: String(team._id),
          expectedVersion: latest.version
        });
        assert.equal(reset.status, 200);
        const unshared = await request(owner, url, 'PATCH', {
          teamShared: false,
          expectedVersion: reset.body.job.version
        });
        assert.equal(unshared.status, 200);
        assert.equal((await request(member, url)).status, 404);
        assert.equal(
          (await request(manager, url, 'PATCH', { title: 'Stale team access' })).status,
          404
        );
        assert.equal(
          (
            await request(owner, url, 'PATCH', {
              teamShared: true,
              expectedVersion: unshared.body.job.version
            })
          ).status,
          200
        );
      }
    );
    await t.test(
      'live membership, team, organization and ownership changes invalidate permissions',
      async () => {
        const url = `/${job._id}`;
        await Membership.updateOne(
          { userId: member, teamId: null },
          { $set: { status: 'disabled' } }
        );
        assert.equal((await request(member, url)).status, 403);
        await Membership.updateOne(
          { userId: member, teamId: null },
          { $set: { status: 'active' } }
        );
        await Membership.updateOne(
          { userId: manager, teamId: team._id },
          { $set: { role: 'member' } }
        );
        assert.equal((await request(manager, url, 'PATCH', { published: false })).status, 403);
        await Membership.updateOne(
          { userId: member, teamId: team._id },
          { $set: { status: 'disabled' } }
        );
        assert.equal((await request(member, url)).status, 404);
        await Membership.updateOne(
          { userId: member, teamId: team._id },
          { $set: { status: 'active' } }
        );
        await Team.updateOne({ _id: team._id }, { $set: { isActive: false } });
        assert.equal((await request(member, url)).status, 404);
        await Team.updateOne({ _id: team._id }, { $set: { isActive: true } });
        await Organization.updateOne({ _id: org }, { $set: { isSuspended: true } });
        assert.equal((await request(owner, url)).status, 403);
        assert.equal((await request(owner, url, 'PATCH', { title: 'Suspended' })).status, 403);
        await Organization.updateOne({ _id: org }, { $set: { isSuspended: false } });
        await Job.updateOne({ _id: job._id }, { $set: { recruiterId: teamAdmin } });
        assert.equal((await request(owner, url)).body.job.access.isOwner, false);
        assert.equal(
          (
            await request(owner, url, 'PATCH', {
              teamShared: false,
              expectedVersion: (await request(owner, url)).body.job.version
            })
          ).status,
          403
        );
        assert.equal((await request(teamAdmin, url)).body.job.access.isOwner, true);
        await Job.updateOne({ _id: job._id }, { $set: { recruiterId: owner } });
        await Membership.updateOne(
          { userId: manager, teamId: team._id },
          { $set: { role: 'manager' } }
        );
      }
    );
    await t.test(
      'revocation between snapshot authorization and the team fence cannot commit a stale edit',
      async () => {
        let release, reached;
        const paused = new Promise((resolve) => {
          reached = resolve;
        });
        const barrier = new Promise((resolve) => {
          release = resolve;
        });
        const original = Team.collection.updateOne.bind(Team.collection);
        let intercepted = false;
        const mock = t.mock.method(
          Team.collection,
          'updateOne',
          async (filter, update, options) => {
            if (!intercepted && update.$inc?.recruiterJobAccessRevision) {
              intercepted = true;
              reached();
              await barrier;
            }
            return original(filter, update, options);
          }
        );
        const pending = request(manager, `/${job._id}`, 'PATCH', { title: 'Must not commit' });
        await paused;
        await Team.updateOne({ _id: team._id }, { $set: { isActive: false } });
        release();
        const result = await pending;
        mock.mock.restore();
        assert.equal(result.status, 404);
        assert.notEqual((await Job.findById(job._id)).title, 'Must not commit');
        await Team.updateOne({ _id: team._id }, { $set: { isActive: true } });
      }
    );
    await t.test('team deletion removes grants without deleting jobs or ownership', async () => {
      await Team.deleteOne({ _id: team._id });
      assert.equal((await request(member, `/${job._id}`)).status, 404);
      const owned = (await request(owner, `/${job._id}`)).body.job;
      assert.equal(owned.access.isOwner, true);
      assert.equal(
        (
          await request(owner, `/${job._id}`, 'PATCH', {
            teamShared: false,
            teamId: null,
            expectedVersion: owned.version
          })
        ).status,
        200
      );
      assert.ok(await Job.exists({ _id: job._id }));
    });
    await t.test(
      'owner deletion keeps the existing cascade boundary and retained applications',
      async () => {
        assert.equal((await request(owner, `/${job._id}`, 'DELETE')).status, 200);
        assert.equal(await Job.exists({ _id: job._id }), null);
        assert.ok(await Application.exists({ jobId: job._id }));
      }
    );
  }
);
