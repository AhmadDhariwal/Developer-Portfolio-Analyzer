const test = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs/promises');
const { once } = require('node:events');
const express = require('express');
const mongoose = require('mongoose');
const { startMongo } = require('../fixtures/disposableRequestMongo');
const User = require('../../modules/auth/models/user');
const Organization = require('../../modules/admin/models/organization');
const Membership = require('../../modules/admin/models/membership');
const Team = require('../../modules/admin/models/team');
const Settings = require('../../modules/super-admin/models/platformSettings');
const Job = require('../../modules/recruiter/models/Job');
const Application = require('../../modules/jobs/models/jobApplication');
const Shortlist = require('../../modules/recruiter/models/RecruiterShortlist');
const Candidate = require('../../modules/recruiter/models/Candidate');
const Match = require('../../modules/recruiter/models/RecruiterMatch');
const Profile = require('../../modules/public-portfolio/models/publicProfile');
const Resume = require('../../modules/resume/models/resumeFile');
const Notification = require('../../modules/notifications/models/notification');
const Audit = require('../../modules/admin/models/auditLog');
const storage = require('../../modules/resume/services/resumeStorageService');
const applications = require('../../modules/jobs/services/jobApplicationService');
const settings = require('../../modules/super-admin/services/platformSettingsService');
const { sign } = require('../../modules/auth/utils/authSessionToken');
const { auditLogMiddleware } = require('../../core/middleware/auditLogMiddleware');
const hub = require('../../modules/recruiter/routes/hub/recruiterHubRoutes');

test(
  'application-origin shortlists: canonical ownership, consent, transactions and isolation',
  { timeout: 240000 },
  async (t) => {
    const evidence = { phase: 'P1.4A', status: 'running', checks: [] };
    const mongo = await startMongo({
      replicaSet: 'application-shortlists',
      temporaryRoot: path.resolve(__dirname, '../../../verification'),
      readinessAttempts: 200
    });
    const savedSecret = process.env.JWT_SECRET;
    const savedRead = storage.read;
    const savedTtl = process.env.RECRUITER_SUMMARY_CACHE_TTL_SECONDS;
    process.env.JWT_SECRET = randomBytes(32).toString('hex');
    process.env.RECRUITER_SUMMARY_CACHE_TTL_SECONDS = '0';
    let server;
    const pendingAuditWrites = new Set();
    const createAudit = Audit.create.bind(Audit);
    t.mock.method(Audit, 'create', (...args) => {
      const write = createAudit(...args);
      pendingAuditWrites.add(write);
      write.then(
        () => pendingAuditWrites.delete(write),
        () => pendingAuditWrites.delete(write)
      );
      return write;
    });
    t.after(async () => {
      if (evidence.status === 'running') evidence.status = 'failed';
      if (server) await new Promise((resolve) => server.close(resolve));
      await Promise.allSettled([...pendingAuditWrites]);
      settings.stopSettingsSynchronization();
      await require('../../modules/notifications/services/notificationStreamService').stop();
      storage.read = savedRead;
      await mongoose.disconnect();
      evidence.cleanup = await mongo.stop();
      if (savedSecret === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = savedSecret;
      if (savedTtl === undefined) delete process.env.RECRUITER_SUMMARY_CACHE_TTL_SECONDS;
      else process.env.RECRUITER_SUMMARY_CACHE_TTL_SECONDS = savedTtl;
      if (process.env.RECRUITER_APPLICATION_LINK_EVIDENCE === '1')
        await fs.writeFile(
          path.resolve(__dirname, '../../../verification/jobs-hub/p1.4a-linkage-tests.json'),
          JSON.stringify(evidence, null, 2) + '\n'
        );
    });
    await mongoose.connect(mongo.uri);
    await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
    await settings.startSettingsSynchronization();
    const oid = () => new mongoose.Types.ObjectId();
    const org = oid(),
      otherOrg = oid(),
      owner = oid(),
      manager = oid(),
      member = oid(),
      outsider = oid();
    const devs = Array.from({ length: 8 }, oid);
    await User.collection.insertMany([
      ...[owner, manager, member, outsider].map((_id, i) => ({
        _id,
        name: `Recruiter ${i}`,
        email: `recruiter-${i}@link.test`,
        role: 'recruiter',
        organizationId: i === 3 ? otherOrg : org,
        isActive: true,
        sessionRevision: 0
      })),
      ...devs.map((_id, i) => ({
        _id,
        name: i === 0 ? 'PrivateApplicantSecret' : `Applicant ${i}`,
        email: `applicant-${i}@link.test`,
        role: 'developer',
        isActive: true,
        isPublic: i === 1 || i === 2,
        organizationId: org,
        createdAt: new Date()
      }))
    ]);
    await Organization.create([
      { _id: org, name: 'Link org', slug: 'link-org', ownerId: owner, createdBy: owner },
      {
        _id: otherOrg,
        name: 'Other org',
        slug: 'other-link-org',
        ownerId: outsider,
        createdBy: outsider
      }
    ]);
    const team = await Team.create({
      organizationId: org,
      name: 'Hiring team',
      slug: 'link-hiring-team',
      createdBy: owner
    });
    for (const [i, userId] of [owner, manager, member].entries()) {
      await Membership.create({
        userId,
        organizationId: org,
        teamId: null,
        role: 'member',
        status: 'active'
      });
      await Membership.create({
        userId,
        organizationId: org,
        teamId: team._id,
        role: i < 2 ? 'manager' : 'member',
        status: 'active'
      });
    }
    const job = await Job.create({
      organizationId: org,
      recruiterId: owner,
      teamId: team._id,
      title: 'Linked role',
      published: true,
      teamShared: true,
      evaluationShared: true
    });
    const otherJob = await Job.create({
      organizationId: org,
      recruiterId: owner,
      title: 'Separate role',
      published: true
    });
    const pdf = Buffer.from('%PDF-1.7\noriginal submitted evidence');
    storage.read = async () => pdf;
    const records = [];
    for (const [i, applicantId] of devs.entries()) {
      const resume = await Resume.create({
        userId: applicantId,
        fileName: `submitted-${i}.pdf`,
        fileUrl: '/test-only.pdf',
        fileSize: pdf.length
      });
      const profile = await Profile.create({
        userId: applicantId,
        slug: `link-fixture-${i}`,
        isPublic: i === 1 || i === 2,
        headline: 'Frozen snapshot',
        summary: 'Submitted private snapshot',
        skills: [{ name: 'Node.js', score: 50 }],
        projects: [{ title: 'Consented project' }]
      });
      const opts = await applications.options(applicantId);
      const result = await applications.submit(
        { _id: applicantId, name: i === 0 ? 'PrivateApplicantSecret' : `Applicant ${i}` },
        String(job._id),
        {
          resumeId: String(resume._id),
          consent: true,
          sharePortfolio: i !== 4,
          portfolioHash: opts.portfolioHash
        }
      );
      records.push(result.application);
      assert.ok(profile);
    }
    const app = express();
    app.use(express.json());
    app.use(auditLogMiddleware);
    app.use('/api/recruiter-hub', hub);
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const request = async (route, actor = owner, method = 'GET', body) => {
      const res = await fetch(
        `http://127.0.0.1:${server.address().port}/api/recruiter-hub${route}`,
        {
          method,
          headers: {
            ...(actor ? { Authorization: `Bearer ${sign({ _id: actor })}` } : {}),
            'Content-Type': 'application/json'
          },
          ...(body !== undefined ? { body: JSON.stringify(body) } : {})
        }
      );
      return {
        status: res.status,
        body: res.headers.get('content-type')?.includes('application/json')
          ? await res.json()
          : Buffer.from(await res.arrayBuffer()),
        cache: res.headers.get('cache-control')
      };
    };
    const route = (application = records[0], targetJob = job) =>
      `/jobs/${targetJob._id}/applications/${application._id}`;
    const link = (
      application = records[0],
      actor = owner,
      payload = { expectedStatus: 'submitted' },
      targetJob = job
    ) => request(route(application, targetJob) + '/shortlist', actor, 'POST', payload);
    const noteCount = () => Notification.countDocuments({ userId: { $in: devs } });
    let main, publicLinked;
    await t.test(
      'eight concurrent retries create one canonical reference without notifications or lifecycle changes',
      async () => {
        const before = await Application.findById(records[0]._id).select('+resumeBytes').lean();
        const notices = await noteCount();
        const results = await Promise.all(Array.from({ length: 8 }, () => link()));
        assert.equal(
          results.filter((r) => r.status === 201).length,
          1,
          JSON.stringify(results.map((r) => ({ status: r.status, message: r.body.message })))
        );
        assert.equal(results.filter((r) => r.status === 200).length, 7);
        main = results[0].body.shortlist;
        assert.equal(new Set(results.map((r) => r.body.shortlist._id)).size, 1);
        assert.equal(main.candidateId, String(devs[0]));
        assert.equal(main.applicationId, records[0]._id);
        assert.equal(main.teamId, null);
        assert.equal(await Shortlist.countDocuments({ applicationId: records[0]._id }), 1);
        const after = await Application.findById(records[0]._id).select('+resumeBytes').lean();
        for (const key of [
          'status',
          'history',
          'resume',
          'resumeBytes',
          'portfolio',
          'consent',
          'updatedAt'
        ])
          assert.deepEqual(after[key], before[key], key);
        assert.equal(await noteCount(), notices);
        assert.equal((await User.findById(devs[0]).lean()).isPublic, false);
        evidence.checks.push(
          'canonical idempotency, concurrent create, unchanged lifecycle/evidence/notifications'
        );
      }
    );
    await t.test(
      'owner-only list, details and mutation keep internal stages separate and versioned',
      async () => {
        const before = await noteCount();
        let list = await request('/shortlists/applications');
        assert.equal(list.status, 200);
        assert.equal(list.cache, 'private, no-store');
        main = list.body.shortlists.find((r) => r._id === main._id);
        assert.equal(main.candidate.name, 'PrivateApplicantSecret');
        assert.equal(main.application.status, 'submitted');
        assert.equal(main.portfolio, undefined);
        assert.equal(main.resume, undefined);
        const patch = await request(`/shortlists/applications/${main._id}`, owner, 'PATCH', {
          status: 'reviewing',
          notes: 'Owner-only assessment',
          expectedVersion: main.version
        });
        assert.equal(patch.status, 200);
        main = patch.body.shortlist;
        const stale = await request(`/shortlists/applications/${main._id}`, owner, 'PATCH', {
          status: 'contacted',
          expectedVersion: 0
        });
        assert.equal(stale.status, 409);
        assert.equal((await Application.findById(records[0]._id)).status, 'submitted');
        assert.equal(await noteCount(), before);
        const detail = await request(route());
        assert.equal(detail.status, 200);
        assert.equal(detail.body.application.shortlist.id, main._id);
        assert.equal(detail.body.application.portfolio.headline, 'Frozen snapshot');
        assert.equal(detail.body.application.resumeBytes, undefined);
        const resumed = await request(route() + '/resume');
        assert.equal(resumed.status, 200);
        assert.deepEqual(resumed.body, pdf);
        const rows = await request(`/jobs/${job._id}/applications`);
        assert.equal(
          rows.body.applications.find((a) => a._id === records[0]._id).shortlist.id,
          main._id
        );
        evidence.checks.push(
          'owner-only context, retained submitted evidence, separate stages, version CAS'
        );
      }
    );
    await t.test(
      'members, managers and foreign actors cannot infer or mutate application links through shared endpoints',
      async () => {
        for (const actor of [manager, member, outsider]) {
          assert.equal(
            (await request('/shortlists/applications', actor)).body.shortlists?.length || 0,
            0
          );
          for (const suffix of ['', '/resume'])
            assert.equal((await request(route() + suffix, actor)).status, 404);
          assert.equal((await link(records[0], actor)).status, 404);
          assert.equal(
            (
              await request(`/shortlists/applications/${main._id}`, actor, 'PATCH', {
                notes: 'forbidden',
                expectedVersion: main.version
              })
            ).status,
            404
          );
          assert.equal(
            (await request(`/shortlists/${main._id}`, actor, 'PATCH', { notes: 'forbidden' }))
              .status,
            404
          );
          assert.equal((await request(`/shortlists/${main._id}`, actor, 'DELETE')).status, 404);
          const shared = await request(`/shortlists?jobId=${job._id}`, actor);
          assert.ok(!JSON.stringify(shared.body).includes(records[0]._id));
        }
        assert.equal((await request('/shortlists/applications', null)).status, 401);
        assert.equal((await request('/shortlists/applications', devs[0])).status, 403);
        assert.equal(
          (await link(records[0], owner, { expectedStatus: 'submitted' }, otherJob)).status,
          404
        );
        evidence.checks.push('team/member/manager/foreign/role isolation and cross-job rejection');
      }
    );
    await t.test(
      'existing canonical and legacy public evaluations conflict without changing notes or stage',
      async () => {
        const publicRow = await request('/shortlists', owner, 'POST', {
          candidateId: String(devs[2]),
          jobId: String(job._id),
          notes: 'Keep historical notes',
          status: 'contacted'
        });
        assert.equal(publicRow.status, 201);
        const before = await Shortlist.findById(publicRow.body.shortlist._id).lean();
        assert.equal((await link(records[2])).status, 409);
        const after = await Shortlist.findById(before._id).lean();
        assert.deepEqual(after, before);
        const alias = await Candidate.create({
          userId: devs[3],
          fullName: 'Legacy alias',
          email: 'legacy@link.test'
        });
        const legacy = await Shortlist.create({
          recruiterId: owner,
          organizationId: org,
          candidateId: alias._id,
          jobId: job._id,
          notes: 'Legacy history',
          status: 'interview'
        });
        assert.equal((await link(records[3])).status, 409);
        assert.equal((await Shortlist.findById(legacy._id)).notes, 'Legacy history');
        assert.equal((await link(records[4], owner, { expectedStatus: 'reviewing' })).status, 409);
        assert.equal(
          (
            await link(records[4], owner, {
              expectedStatus: 'submitted',
              candidateId: String(devs[0])
            })
          ).status,
          400
        );
        evidence.checks.push(
          'canonical and explicit legacy alias conflicts preserve records; stale/forged payloads rejected'
        );
      }
    );
    await t.test(
      'application-origin data cannot influence public discovery, matching, shared shortlists or analytics',
      async () => {
        const created = await link(records[1]);
        assert.equal(created.status, 201);
        publicLinked = created.body.shortlist;
        const generated = await request('/matches/generate', owner, 'POST', {
          jobId: String(job._id),
          candidateIds: [String(devs[1])]
        });
        assert.equal(generated.status, 200);
        assert.equal(generated.body.matches[0].status, 'generated');
        assert.equal(generated.body.matches[0].shortlisted, false);
        assert.equal(
          (
            await request('/shortlists', manager, 'POST', {
              candidateId: String(devs[1]),
              jobId: String(job._id)
            })
          ).status,
          404
        );
        const discovery = await request('/candidates?limit=240');
        assert.equal(discovery.status, 200);
        assert.ok(!JSON.stringify(discovery.body).includes('PrivateApplicantSecret'));
        const analytics = await request('/analytics');
        assert.equal(analytics.status, 200);
        assert.equal(analytics.body.metrics.shortlistedCandidates, 2); // One public canonical plus legacy row; neither application link.
        for (const result of [
          analytics,
          await request('/shortlists'),
          await request('/matches'),
          await request('/matches', manager)
        ]) {
          const text = JSON.stringify(result.body);
          assert.ok(!text.includes('PrivateApplicantSecret'));
          assert.ok(!text.includes(records[0]._id));
          assert.ok(!text.includes('Owner-only assessment'));
        }
        assert.equal(
          (await Match.findOne({ jobId: job._id, candidateId: devs[1] })).status,
          'generated'
        );
        evidence.checks.push(
          'public/analytics/shared/matching exclusion, including public applicants with private application links'
        );
      }
    );
    await t.test(
      'withdrawn/rejected applications retain links and evidence without reopening or stage advancement',
      async () => {
        await applications.withdraw(devs[0], records[0]._id, 'submitted');
        await applications.changeStatus(
          { recruiterId: String(owner), organizationId: String(org) },
          String(job._id),
          records[1]._id,
          'rejected',
          'submitted'
        );
        const response = await request('/shortlists/applications');
        main = response.body.shortlists.find((r) => r._id === main._id);
        const rejected = response.body.shortlists.find((r) => r._id === publicLinked._id);
        assert.equal(main.application.status, 'withdrawn');
        assert.equal(main.status, 'reviewing');
        assert.equal(main.access.manageStages, false);
        assert.equal(rejected.application.status, 'rejected');
        assert.equal((await link()).status, 409);
        assert.equal((await link(records[1])).status, 409);
        assert.equal(
          (
            await request(`/shortlists/applications/${main._id}`, owner, 'PATCH', {
              status: 'interview',
              expectedVersion: main.version
            })
          ).status,
          409
        );
        const notices = await noteCount();
        const updated = await request(`/shortlists/applications/${main._id}`, owner, 'PATCH', {
          notes: 'Applicant withdrew; retain history',
          expectedVersion: main.version
        });
        assert.equal(updated.status, 200);
        assert.equal(updated.body.shortlist.status, 'reviewing');
        assert.equal(await noteCount(), notices);
        assert.deepEqual((await request(route() + '/resume')).body, pdf);
        assert.equal((await Application.findById(records[0]._id)).status, 'withdrawn');
        evidence.checks.push(
          'terminal history/evidence retained, notes permitted, stage/relink blocked, no status sync'
        );
      }
    );
    await t.test(
      'projection-free policy stays live under ownership, membership, organization and consent changes',
      async () => {
        await User.updateOne({ _id: owner }, { $set: { isActive: false } });
        assert.ok([401, 403].includes((await request('/shortlists/applications')).status));
        await User.updateOne({ _id: owner }, { $set: { isActive: true } });
        await settings.updateSettings({ recruiter: { enableRecruiterAccess: false } }, owner);
        assert.equal((await request('/shortlists/applications')).status, 403);
        await settings.updateSettings({ recruiter: { enableRecruiterAccess: true } }, owner);
        evidence.checks.push('live actor and platform access are enforced');
        await Application.collection.updateOne(
          { _id: records[4]._id },
          { $set: { 'consent.version': 'unknown' } }
        );
        assert.equal((await link(records[4])).status, 404);
        await Application.collection.updateOne(
          { _id: records[4]._id },
          { $set: { 'consent.version': 'direct-apply-v1' } }
        );
        await Membership.updateOne(
          { userId: owner, teamId: null },
          { $set: { status: 'disabled' } }
        );
        assert.equal((await request('/shortlists/applications')).status, 403);
        await Membership.updateOne({ userId: owner, teamId: null }, { $set: { status: 'active' } });
        await Organization.updateOne({ _id: org }, { $set: { isSuspended: true } });
        assert.equal((await request('/shortlists/applications')).status, 403);
        await Organization.updateOne({ _id: org }, { $set: { isSuspended: false } });
        await Settings.updateOne(
          { scope: 'global' },
          { $set: { 'recruiter.candidateVisibility': 'private' } }
        );
        assert.equal((await link(records[4])).status, 201);
        assert.equal((await request(route(records[4]))).body.application.portfolio, null);
        await Settings.updateOne(
          { scope: 'global' },
          { $set: { 'recruiter.candidateVisibility': 'public' } }
        );
        await Job.updateOne({ _id: job._id }, { $set: { recruiterId: manager } });
        assert.equal((await request('/shortlists/applications')).body.shortlists.length, 0);
        assert.equal(
          (await request('/shortlists/applications', manager)).body.shortlists.length,
          0
        );
        assert.equal((await request(route(), manager)).status, 404);
        await Job.updateOne({ _id: job._id }, { $set: { recruiterId: owner } });
        evidence.checks.push(
          'live canonical owner, membership/org policy, immutable consent version, independent public opt-in'
        );
      }
    );
    await t.test(
      'failed link rolls back and link-versus-withdraw race never reopens an application',
      async (st) => {
        const before = await Application.findById(records[5]._id).lean();
        const mock = st.mock.method(Shortlist, 'create', async () => {
          throw Error('Injected transaction failure');
        });
        assert.equal((await link(records[5])).status, 503);
        mock.mock.restore();
        assert.equal(await Shortlist.countDocuments({ applicationId: records[5]._id }), 0);
        assert.deepEqual(await Application.findById(records[5]._id).lean(), before);
        const [linked] = await Promise.all([
          link(records[6]),
          applications.withdraw(devs[6], records[6]._id, 'submitted')
        ]);
        assert.ok([201, 409].includes(linked.status));
        assert.equal((await Application.findById(records[6]._id)).status, 'withdrawn');
        assert.ok((await Shortlist.countDocuments({ applicationId: records[6]._id })) <= 1);
        const audits = await Audit.find({
          route: '/api/recruiter-hub/private-application-evaluation'
        }).lean();
        assert.ok(audits.length > 0);
        for (const audit of audits) {
          assert.equal(audit.before, null);
          assert.equal(audit.after, null);
          const text = JSON.stringify(audit);
          assert.ok(!text.includes(records[0]._id));
          assert.ok(!text.includes('PrivateApplicantSecret'));
        }
        evidence.checks.push(
          'transaction rollback, withdrawal race, redacted audit/log/export surface'
        );
      }
    );
    await t.test(
      'public and application creation race preserves a single evaluation without conversion',
      async () => {
        await User.updateOne({ _id: devs[7] }, { $set: { isPublic: true } });
        await Profile.updateOne({ userId: devs[7] }, { $set: { isPublic: true } });
        const [privateResult, publicResult] = await Promise.all([
          link(records[7]),
          request('/shortlists', owner, 'POST', {
            candidateId: String(devs[7]),
            jobId: String(job._id),
            notes: 'Preserve public notes',
            status: 'contacted'
          })
        ]);
        const evaluations = await Shortlist.find({
          recruiterId: owner,
          candidateId: devs[7],
          jobId: job._id
        }).lean();
        assert.equal(evaluations.length, 1);
        if (evaluations[0].applicationId) {
          assert.equal(privateResult.status, 201);
          assert.equal(publicResult.status, 404);
          assert.equal(evaluations[0].notes, '');
          assert.equal(evaluations[0].status, 'shortlisted');
        } else {
          assert.equal(publicResult.status, 201);
          assert.equal(privateResult.status, 409);
          assert.equal(evaluations[0].notes, 'Preserve public notes');
          assert.equal(evaluations[0].status, 'contacted');
        }
        evidence.checks.push(
          'concurrent public/private creates keep exactly one evaluation and preserve the winning origin, notes and stage'
        );
      }
    );
    evidence.status = 'passed';
  }
);
