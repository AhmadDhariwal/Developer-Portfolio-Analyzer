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
const RecruiterMatch = require('../../modules/recruiter/models/RecruiterMatch');
const RecruiterShortlist = require('../../modules/recruiter/models/RecruiterShortlist');
const PublicProfile = require('../../modules/public-portfolio/models/publicProfile');
const AuditLog = require('../../modules/admin/models/auditLog');
const Application = require('../../modules/jobs/models/jobApplication');
const {
  getRecruiterJobDetails
} = require('../../modules/recruiter/services/hub/recruiterJobService');
const { sign } = require('../../modules/auth/utils/authSessionToken');

test(
  'explicit shared evaluations: canonical ownership, consent and concurrency',
  { timeout: 120000 },
  async (t) => {
    const mongo = await startMongo({
      replicaSet: 'team-evaluations',
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
      [
        User,
        Organization,
        Team,
        Membership,
        Job,
        Application,
        RecruiterMatch,
        RecruiterShortlist,
        PublicProfile
      ].map((model) => model.init())
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
    const base = `http://127.0.0.1:${server.address().port}/api/recruiter-hub`;
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
    await User.updateOne({ _id: applicant }, { $set: { isPublic: true } });
    let job, match, shortlist;
    const getJob = async () => (await request(owner, `/jobs/${job._id}`)).body.job;
    const share = async (value) => {
      const current = await getJob();
      return request(owner, `/jobs/${job._id}`, 'PATCH', {
        evaluationShared: value,
        expectedVersion: current.version
      });
    };
    await t.test(
      'metadata sharing alone does not disclose evaluations; owner workflow survives',
      async () => {
        const created = await request(owner, '/jobs', 'POST', {
          title: 'Engineer',
          role: 'Engineer',
          location: 'Remote',
          requiredSkills: ['Node.js'],
          teamId: String(team._id),
          teamShared: true
        });
        assert.equal(created.status, 201);
        job = created.body.job;
        assert.equal((await request(member, `/matches?jobId=${job._id}`)).status, 404);
        const generated = await request(owner, '/matches/generate', 'POST', {
          jobId: job._id,
          candidateIds: [String(applicant)]
        });
        assert.equal(generated.status, 200, JSON.stringify(generated.body));
        assert.equal(generated.body.matches.length, 1);
        match = generated.body.matches[0];
        const saved = await request(owner, '/shortlists', 'POST', {
          jobId: job._id,
          candidateId: String(applicant),
          notes: 'Public evaluation note'
        });
        assert.equal(saved.status, 201, JSON.stringify(saved.body));
        shortlist = saved.body.shortlist;
        assert.equal((await request(member, '/shortlists')).body.shortlists.length, 0);
        assert.equal((await share(true)).status, 200);
      }
    );
    await t.test(
      'member read, manager/admin manage, exact-team and platform role boundaries',
      async () => {
        for (const actor of [member, manager, teamAdmin]) {
          const rows = await request(actor, `/matches?jobId=${job._id}`);
          assert.equal(rows.status, 200);
          assert.equal(rows.body.matches.length, 1);
          assert.equal(String(rows.body.matches[0].recruiterId), String(owner));
          assert.equal(rows.body.matches[0].access.manage, actor !== member);
          const items = await request(actor, '/shortlists');
          assert.equal(items.body.shortlists[0].notes, 'Public evaluation note');
        }
        assert.equal(
          (await request(member, `/matches/${match._id}/status`, 'PATCH', { status: 'rejected' }))
            .status,
          403
        );
        assert.equal((await request(member, `/shortlists/${shortlist._id}`, 'DELETE')).status, 403);
        assert.equal(
          (await request(member, '/matches/generate', 'POST', { jobId: job._id })).status,
          403
        );
        for (const actor of [outsider, foreign]) {
          assert.equal((await request(actor, `/matches/${match._id}`)).status, 404);
          assert.equal(
            (await request(actor, `/shortlists/${shortlist._id}`, 'PATCH', { notes: 'Forbidden' }))
              .status,
            404
          );
        }
        for (const actor of [admin, superAdmin])
          assert.equal((await request(actor, '/matches')).status, 403);
        assert.equal((await request(null, '/matches')).status, 401);
        const applicationId = 'b'.repeat(64);
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
          resumeBytes: Buffer.from('%PDF-1.4 private'),
          portfolio: { summary: 'PRIVATE APPLICATION EVIDENCE' },
          consent: { version: 'fixture', submittedAt: new Date(), sharePortfolio: true },
          history: [{ from: '', to: 'submitted', actorId: applicant, at: new Date() }]
        });
        for (const actor of [member, manager, teamAdmin]) {
          const root = `/jobs/${job._id}/applications`;
          assert.equal((await request(actor, root)).status, 404);
          assert.equal((await request(actor, `${root}/${applicationId}/resume`)).status, 404);
          assert.equal(
            (await request(actor, `${root}/${applicationId}`, 'PATCH', { status: 'reviewing' }))
              .status,
            404
          );
          assert.equal(
            JSON.stringify((await request(actor, '/matches')).body).includes(
              'PRIVATE APPLICATION EVIDENCE'
            ),
            false
          );
        }
        assert.equal(
          await getRecruiterJobDetails({
            recruiterId: String(manager),
            organizationId: String(org),
            jobId: job._id
          }),
          null
        );
      }
    );
    await t.test(
      'concurrent generation/upserts retain canonical unique records and existing shortlist notes/status',
      async () => {
        const results = await Promise.all(
          [owner, manager, teamAdmin].map((actor) =>
            request(actor, '/matches/generate', 'POST', {
              jobId: job._id,
              candidateIds: [String(applicant)]
            })
          )
        );
        assert.deepEqual(
          results.map((result) => result.status),
          [200, 200, 200]
        );
        assert.equal(await RecruiterMatch.countDocuments({ jobId: job._id }), 1);
        const added = await Promise.all(
          [owner, manager, teamAdmin].map((actor) =>
            request(actor, '/shortlists', 'POST', {
              jobId: job._id,
              candidateId: String(applicant),
              notes: 'Do not overwrite'
            })
          )
        );
        assert.deepEqual(
          added.map((result) => result.status),
          [201, 201, 201]
        );
        assert.equal(new Set(added.map((result) => result.body.shortlist._id)).size, 1);
        assert.equal(await RecruiterShortlist.countDocuments({ jobId: job._id }), 1);
        assert.equal(added[0].body.shortlist.notes, 'Public evaluation note');
        assert.equal(String((await RecruiterMatch.findById(match._id)).recruiterId), String(owner));
        const current = (await request(owner, '/shortlists')).body.shortlists[0];
        const changed = await Promise.all(
          [owner, manager].map((actor, index) =>
            request(actor, `/shortlists/${shortlist._id}`, 'PATCH', {
              status: index ? 'contacted' : 'reviewing',
              expectedVersion: current.version
            })
          )
        );
        assert.deepEqual(changed.map((result) => result.status).sort(), [200, 409]);
        const currentMatch = (await request(owner, `/matches/${match._id}`)).body.match;
        const transitions = await Promise.all(
          [owner, manager].map((actor, index) =>
            request(actor, `/matches/${match._id}/status`, 'PATCH', {
              status: index ? 'rejected' : 'generated',
              expectedVersion: currentMatch.version
            })
          )
        );
        assert.deepEqual(transitions.map((result) => result.status).sort(), [200, 409]);
        assert.equal(
          (
            await request(manager, `/shortlists/${shortlist._id}`, 'PATCH', {
              notes: 'Collaborative public note'
            })
          ).status,
          200
        );
        assert.equal(
          (
            await request(teamAdmin, `/shortlists/${shortlist._id}`, 'PATCH', {
              status: 'reviewing'
            })
          ).status,
          200
        );
        assert.equal(
          (await request(manager, `/shortlists/${shortlist._id}`, 'PATCH', { expectedVersion: -1 }))
            .status,
          400
        );
        assert.equal(
          String((await RecruiterShortlist.findById(shortlist._id)).recruiterId),
          String(owner)
        );
      }
    );
    await t.test('jobless personal shortlists never inherit evaluation team grants', async () => {
      const personal = await request(owner, '/shortlists', 'POST', {
        candidateId: String(applicant),
        notes: 'PERSONAL_NOTE'
      });
      assert.equal(personal.status, 201);
      assert.equal(
        JSON.stringify((await request(member, '/shortlists')).body).includes('PERSONAL_NOTE'),
        false
      );
      assert.equal(
        (await request(member, `/shortlists/${personal.body.shortlist._id}`, 'DELETE')).status,
        404
      );
      assert.equal(
        (await request(owner, `/shortlists/${personal.body.shortlist._id}`, 'DELETE')).status,
        200
      );
      const privateJob = (
        await request(owner, '/jobs', 'POST', {
          title: 'Private team assignment',
          role: 'Engineer',
          location: 'Remote',
          requiredSkills: ['Node.js'],
          teamId: String(team._id)
        })
      ).body.job;
      const assigned = (
        await request(owner, '/shortlists', 'POST', {
          candidateId: String(applicant),
          jobId: privateJob._id
        })
      ).body.shortlist;
      assert.equal(
        (
          await request(owner, `/jobs/${privateJob._id}`, 'PATCH', {
            teamId: null,
            expectedVersion: privateJob.version
          })
        ).status,
        200
      );
      const route = `/shortlists/${assigned._id}`;
      assert.equal((await request(owner, route, 'DELETE')).status, 200);
      const audit = await AuditLog.findOne({
        action: 'RECRUITER_SHORTLIST_REMOVED',
        route: `/api/recruiter-hub${route}`
      }).lean();
      assert.ok(audit);
      assert.equal(audit.teamId, null);
      assert.equal((await request(owner, `/jobs/${privateJob._id}`, 'DELETE')).status, 200);
    });
    await t.test(
      'live candidate consent/activity/org/settings and public-portfolio revocation hide retained rows and block mutation',
      async () => {
        const cases = [{ isPublic: false }, { isActive: false }];
        for (const change of cases) {
          await User.updateOne({ _id: applicant }, { $set: change });
          assert.equal((await request(manager, '/matches')).body.matches.length, 0);
          assert.equal((await request(owner, '/shortlists')).body.shortlists.length, 0);
          assert.equal(
            (
              await request(manager, `/shortlists/${shortlist._id}`, 'PATCH', {
                status: 'interview'
              })
            ).status,
            404
          );
          await User.updateOne({ _id: applicant }, { $set: { isPublic: true, isActive: true } });
        }
        const Settings = require('../../modules/super-admin/models/platformSettings');
        await Settings.updateOne(
          { scope: 'global' },
          { $set: { 'recruiter.candidateVisibility': 'organization' } }
        );
        await User.updateOne({ _id: applicant }, { $set: { organizationId: foreignOrg } });
        assert.equal((await request(manager, '/matches')).body.matches.length, 0);
        await User.updateOne({ _id: applicant }, { $set: { organizationId: org } });
        await Settings.updateOne(
          { scope: 'global' },
          { $set: { 'recruiter.candidateVisibility': 'private' } }
        );
        assert.equal((await request(owner, '/shortlists')).body.shortlists.length, 0);
        await Settings.updateOne(
          { scope: 'global' },
          { $set: { 'recruiter.candidateVisibility': 'public' } }
        );
        await PublicProfile.collection.insertOne({
          userId: applicant,
          slug: 'fixture-private',
          isPublic: false
        });
        assert.equal((await request(manager, '/matches')).body.matches.length, 0);
        await PublicProfile.updateOne({ userId: applicant }, { $set: { isPublic: true } });
        assert.equal((await request(manager, '/matches')).body.matches.length, 1);
        await PublicProfile.updateOne(
          { userId: applicant },
          { $set: { 'sections.visibility.projects': false } }
        );
        assert.equal((await request(manager, '/matches')).body.matches.length, 0);
        await PublicProfile.updateOne(
          { userId: applicant },
          { $set: { 'sections.visibility.projects': true } }
        );
        assert.equal(await RecruiterMatch.countDocuments({ jobId: job._id }), 1);
      }
    );
    await t.test(
      'in-flight candidate revocation retries authorization before committing',
      async () => {
        let release, reached;
        const paused = new Promise((resolve) => {
          reached = resolve;
        });
        const barrier = new Promise((resolve) => {
          release = resolve;
        });
        const original = User.collection.updateMany.bind(User.collection);
        let intercepted = false;
        const mock = t.mock.method(
          User.collection,
          'updateMany',
          async (filter, update, options) => {
            if (
              !intercepted &&
              filter._id?.$in?.some((value) => String(value) === String(applicant)) &&
              update.$inc?.recruiterJobAccessRevision
            ) {
              intercepted = true;
              reached();
              await barrier;
            }
            return original(filter, update, options);
          }
        );
        const pending = request(manager, `/shortlists/${shortlist._id}`, 'PATCH', {
          notes: 'Must not commit'
        });
        await paused;
        await User.updateOne({ _id: applicant }, { $set: { isPublic: false } });
        release();
        assert.equal((await pending).status, 404);
        mock.mock.restore();
        assert.notEqual(
          (await RecruiterShortlist.findById(shortlist._id)).notes,
          'Must not commit'
        );
        await User.updateOne({ _id: applicant }, { $set: { isPublic: true } });
      }
    );
    await t.test(
      'sharing withdrawal, membership revocation, retargeting and owner change revoke access',
      async () => {
        await Membership.updateOne(
          { userId: manager, teamId: team._id },
          { $set: { status: 'disabled' } }
        );
        assert.equal((await request(manager, '/matches')).body.matches.length, 0);
        await Membership.updateOne(
          { userId: manager, teamId: team._id },
          { $set: { status: 'active' } }
        );
        await Membership.updateOne(
          { userId: owner, teamId: team._id },
          { $set: { status: 'disabled' } }
        );
        assert.equal((await share(false)).status, 200);
        await Membership.updateOne(
          { userId: owner, teamId: team._id },
          { $set: { status: 'active' } }
        );
        assert.equal((await request(member, '/matches')).body.matches.length, 0);
        assert.equal((await share(true)).status, 200);
        const current = await getJob();
        assert.equal(
          (
            await request(owner, `/jobs/${job._id}`, 'PATCH', {
              teamId: String(otherTeam._id),
              expectedVersion: current.version
            })
          ).status,
          200
        );
        assert.equal((await getJob()).evaluationShared, false);
        assert.equal((await share(true)).status, 200);
        assert.equal(
          (
            await request(owner, `/shortlists/${shortlist._id}`, 'PATCH', {
              notes: 'Explicitly shared with the new team'
            })
          ).status,
          200
        );
        assert.equal(
          String((await RecruiterShortlist.findById(shortlist._id)).teamId),
          String(otherTeam._id)
        );

        await Job.updateOne({ _id: job._id }, { $set: { recruiterId: manager } });
        assert.equal((await request(manager, '/matches')).body.matches.length, 0);
        assert.equal((await request(owner, '/shortlists')).body.shortlists.length, 0);
      }
    );
  }
);
