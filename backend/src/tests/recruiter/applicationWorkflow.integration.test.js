const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash, randomBytes } = require('node:crypto');
const { once } = require('node:events');
const fs = require('node:fs/promises');
const path = require('node:path');
const express = require('express');
const mongoose = require('mongoose');
const { startMongo } = require('../fixtures/disposableRequestMongo');
const User = require('../../modules/auth/models/user');
const Organization = require('../../modules/admin/models/organization');
const Job = require('../../modules/recruiter/models/Job');
const Application = require('../../modules/jobs/models/jobApplication');
const Shortlist = require('../../modules/recruiter/models/RecruiterShortlist');
const Notification = require('../../modules/notifications/models/notification');
const Receipt = require('../../modules/notifications/models/notificationReceipt');
const State = require('../../modules/notifications/models/notificationState');
const lifecycle = require('../../modules/jobs/services/jobApplicationService');
const notifications = require('../../modules/notifications/services/notificationService');
const settings = require('../../modules/super-admin/services/platformSettingsService');
const { buildPipeline } = require('../../modules/recruiter/utils/hub/applicationShortlistQuery');
const {
  applicationKeyExpression
} = require('../../modules/recruiter/utils/hub/applicationKeyExpression');
const { sign } = require('../../modules/auth/utils/authSessionToken');
const hub = require('../../modules/recruiter/routes/hub/recruiterHubRoutes');

test(
  'P1.4B linked application workflow and authorized pagination',
  { timeout: 240000 },
  async (t) => {
    const evidence = { phase: 'P1.4B', status: 'running', checks: [] };
    const runtime = await startMongo({
      replicaSet: 'application-workflow',
      readinessAttempts: 200
    });
    const secret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = randomBytes(32).toString('hex');
    let server;
    t.after(async () => {
      if (server) await new Promise((resolve) => server.close(resolve));
      settings.stopSettingsSynchronization();
      await require('../../modules/notifications/services/notificationStreamService').stop();
      await mongoose.disconnect();
      evidence.cleanup = await runtime.stop();
      if (secret === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = secret;
      if (evidence.status === 'running') evidence.status = 'failed';
      await fs.writeFile(
        process.env.APPLICATION_WORKFLOW_EVIDENCE_FILE ||
          path.resolve(__dirname, '../../../verification/jobs-hub/p1.4b-workflow-tests.json'),
        JSON.stringify(evidence, null, 2) + '\n'
      );
    });
    await mongoose.connect(runtime.uri);
    await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
    await settings.startSettingsSynchronization();
    const oid = () => new mongoose.Types.ObjectId();
    const owner = oid(),
      peer = oid(),
      foreign = oid(),
      org = oid(),
      otherOrg = oid();
    const applicants = Array.from({ length: 135 }, oid);
    await User.collection.insertMany([
      ...[owner, peer, foreign].map((_id, i) => ({
        _id,
        name: `Recruiter ${i}`,
        email: `recruiter-${i}@workflow.test`,
        role: 'recruiter',
        isActive: true,
        organizationId: i === 2 ? otherOrg : org,
        sessionRevision: 0
      })),
      ...applicants.map((_id, i) => ({
        _id,
        name: `Private ${i}`,
        email: `${i}@workflow.test`,
        role: 'developer',
        isPublic: false,
        isActive: true
      }))
    ]);
    await Organization.create([
      { _id: org, name: 'Workflow', slug: 'workflow', ownerId: owner, createdBy: owner },
      {
        _id: otherOrg,
        name: 'Foreign',
        slug: 'foreign-workflow',
        ownerId: foreign,
        createdBy: foreign
      }
    ]);
    const job = await Job.create({
      recruiterId: owner,
      organizationId: org,
      title: 'Engineer',
      published: true
    });
    const key = (applicant) => createHash('sha256').update(`${job._id}:${applicant}`).digest('hex');
    const at = new Date('2026-11-24T00:00:00Z');
    const records = await Application.create(
      applicants.map((applicantId, i) => ({
        _id: key(applicantId),
        recruiterId: owner,
        organizationId: org,
        jobId: job._id,
        organizationName: 'Workflow',
        applicantId,
        applicantName: `Private ${i}`,
        jobTitle: 'Engineer',
        resume: { fileName: 'submitted.pdf', sha256: 'b'.repeat(64) },
        resumeBytes: Buffer.from('%PDF-frozen'),
        portfolio: { headline: 'Frozen evidence' },
        consent: { version: 'direct-apply-v1', submittedAt: at, sharePortfolio: true },
        status: 'submitted',
        history: [{ from: '', to: 'submitted', actorId: applicantId, at }]
      }))
    );
    await Shortlist.create(
      records.slice(0, 125).map((application) => ({
        recruiterId: owner,
        organizationId: org,
        jobId: job._id,
        candidateId: application.applicantId,
        applicationId: application._id,
        status: 'contacted',
        notes: 'Private assessment',
        updatedAt: at
      }))
    );
    // A common timestamp exercises the unique deterministic ordering tie-breaker.
    await Shortlist.collection.updateMany({}, { $set: { updatedAt: at } });
    const app = express();
    app.use(express.json());
    app.use('/api/recruiter-hub', hub);
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const request = async (route, actor = owner, method = 'GET', body) => {
      const response = await fetch(
        `http://127.0.0.1:${server.address().port}/api/recruiter-hub${route}`,
        {
          method,
          headers: {
            Authorization: `Bearer ${sign({ _id: actor })}`,
            'Content-Type': 'application/json'
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) })
        }
      );
      return { status: response.status, body: await response.json() };
    };
    const route = (record) => `/jobs/${job._id}/applications/${record._id}`;
    const status = (record, next, expected, actor = owner) =>
      request(route(record), actor, 'PATCH', { status: next, expectedStatus: expected });
    const page = (number = 1, limit = 20, actor = owner) =>
      request(`/shortlists/applications?page=${number}&limit=${limit}`, actor);

    await t.test(
      'native aggregation key matches Node SHA-256 for canonical fixed-length tuples',
      async () => {
        const vectors = [
          oid(),
          new mongoose.Types.ObjectId('000000000000000000000000'),
          new mongoose.Types.ObjectId('ffffffffffffffffffffffff')
        ];
        for (const applicant of vectors) {
          const [result] = await Job.aggregate([
            { $limit: 1 },
            {
              $project: {
                digest: applicationKeyExpression({ $literal: job._id }, { $literal: applicant })
              }
            }
          ]);
          assert.equal(result.digest, key(applicant));
        }
        evidence.checks.push(
          'native Mongo SHA-256 agrees with Node crypto; no server-side JavaScript'
        );
      }
    );
    await t.test(
      'authorized pagination beyond 100 excludes invalid source tuples before totals',
      async () => {
        const invalid = records.slice(125);
        await Shortlist.create(
          invalid.map((record) => ({
            recruiterId: owner,
            organizationId: org,
            jobId: job._id,
            candidateId: record.applicantId,
            applicationId: record._id
          }))
        );
        await Application.collection.updateOne(
          { _id: invalid[0]._id },
          { $set: { 'consent.version': 'unknown' } }
        );
        await Application.collection.updateOne(
          { _id: invalid[1]._id },
          { $set: { 'consent.sharePortfolio': 'true' } }
        );
        await Application.collection.updateOne(
          { _id: invalid[2]._id },
          { $set: { organizationId: otherOrg } }
        );
        await Application.collection.updateOne(
          { _id: invalid[3]._id },
          { $set: { recruiterId: peer } }
        );
        await Application.collection.updateOne({ _id: invalid[4]._id }, { $set: { jobId: oid() } });
        await Application.collection.updateOne(
          { _id: invalid[5]._id },
          { $set: { applicantId: oid() } }
        );
        await Application.collection.updateOne(
          { _id: invalid[6]._id },
          { $set: { 'consent.submittedAt': 'invalid' } }
        );
        await Application.collection.updateOne(
          { _id: invalid[7]._id },
          { $set: { status: 'hired' } }
        );
        await Shortlist.collection.updateOne(
          { applicationId: invalid[8]._id },
          { $set: { applicationId: 'a'.repeat(64) } }
        );
        // Raw malformed source with a plausible digest and matching tuple must also be excluded.
        const forged = invalid[9].toObject();
        forged._id = 'c'.repeat(64);
        forged.applicantId = oid();
        await Application.collection.insertOne(forged);
        await Shortlist.collection.updateOne(
          { applicationId: invalid[9]._id },
          { $set: { applicationId: forged._id, candidateId: forged.applicantId } }
        );
        const found = [];
        for (let number = 1; number <= 7; number++) {
          const response = await page(number);
          assert.equal(response.status, 200, JSON.stringify(response.body));
          assert.equal(response.body.meta.total, 125);
          assert.equal(response.body.meta.pages, 7);
          assert.equal(response.body.meta.page, number);
          assert.equal(response.body.shortlists.length, number === 7 ? 5 : 20);
          found.push(...response.body.shortlists.map((row) => row._id));
        }
        assert.equal(new Set(found).size, 125);
        assert.deepEqual(
          (await page(1)).body.shortlists.map((row) => row._id),
          found.slice(0, 20)
        );
        const last = (await page(7)).body.shortlists[4];
        assert.equal(
          (await request(`/jobs/${last.jobId}/applications/${last.applicationId}`)).status,
          200
        );
        assert.equal((await page(8)).body.shortlists.length, 0);
        assert.equal((await request('/shortlists/applications')).body.shortlists.length, 100);
        for (const actor of [peer, foreign]) {
          const response = await page(1, 20, actor);
          assert.equal(response.body.meta.total, 0);
          assert.deepEqual(response.body.shortlists, []);
        }
        for (const query of [
          'page=0',
          'page=-1',
          'page=1.5',
          'page=1000001',
          'limit=101',
          'limit=0',
          'page[x]=1',
          'page=1&page=2'
        ])
          assert.equal((await request('/shortlists/applications?' + query)).status, 400, query);
        const explain = await Shortlist.aggregate(
          buildPipeline({ recruiterId: owner, organizationId: org }, { page: 7, limit: 20 })
        ).explain('executionStats');
        evidence.queryPlan = explain;
        evidence.checks.push(
          '125 authorized rows across seven stable pages; ten invalid links excluded before counts; exact detail navigation; foreign totals zero'
        );
      }
    );
    await t.test(
      'explicit status changes notify once; internal changes remain independent and silent',
      async () => {
        const row = (await page()).body.shortlists[0];
        const record = records.find((record) => record._id === row.applicationId);
        for (const actor of [peer, foreign])
          assert.equal((await status(record, 'reviewing', 'submitted', actor)).status, 404);
        await Job.updateOne({ _id: job._id }, { $set: { recruiterId: peer } });
        for (const actor of [owner, peer])
          assert.equal((await status(record, 'reviewing', 'submitted', actor)).status, 404);
        await Job.updateOne({ _id: job._id }, { $set: { recruiterId: owner } });
        const before = await Application.findById(record._id).select('+resumeBytes').lean();
        assert.deepEqual(row.application.permittedStatuses, ['reviewing', 'rejected']);
        const changed = await request(`/shortlists/applications/${row._id}`, owner, 'PATCH', {
          status: 'interview',
          notes: 'Private internal notes',
          expectedVersion: row.version
        });
        assert.equal(changed.status, 200);
        assert.equal(await Notification.countDocuments({ userId: record.applicantId }), 0);
        assert.equal((await Application.findById(record._id)).status, 'submitted');
        const results = await Promise.all(
          Array.from({ length: 5 }, () => status(record, 'reviewing', 'submitted'))
        );
        assert.equal(
          results.filter((r) => r.status === 200).length,
          1,
          JSON.stringify(results.map((r) => ({ status: r.status, message: r.body.message })))
        );
        assert.equal(results.filter((r) => r.status === 409).length, 4);
        assert.equal(await Notification.countDocuments({ userId: record.applicantId }), 1);
        assert.equal(await Receipt.countDocuments({ userId: record.applicantId }), 1);
        assert.equal((await State.findById(record.applicantId)).revision, 1);
        assert.equal((await status(record, 'rejected', 'submitted')).status, 409);
        assert.equal(await Receipt.countDocuments({ userId: record.applicantId }), 1);
        const refreshed = (await page()).body.shortlists.find((entry) => entry._id === row._id);
        assert.equal(refreshed.status, 'interview');
        assert.equal(refreshed.application.status, 'reviewing');
        assert.deepEqual(refreshed.application.permittedStatuses, ['rejected']);
        assert.equal((await status(record, 'rejected', 'reviewing')).status, 200);
        assert.equal((await status(record, 'reviewing', 'reviewing')).status, 409);
        const after = await Application.findById(record._id).select('+resumeBytes').lean();
        for (const field of ['resume', 'resumeBytes', 'portfolio', 'consent'])
          assert.deepEqual(after[field], before[field]);
        assert.deepEqual(
          after.history.map((event) => event.to),
          ['submitted', 'reviewing', 'rejected']
        );
        const notices = await Notification.find({ userId: record.applicantId }).lean();
        assert.equal(notices.length, 2);
        for (const notice of notices) {
          const payload = JSON.stringify({
            title: notice.title,
            message: notice.message,
            meta: notice.meta
          });
          for (const secret of [
            'Private internal notes',
            'Private assessment',
            'Frozen evidence',
            'submitted.pdf',
            record._id
          ])
            assert.ok(!payload.includes(secret));
        }
        const terminal = (await page()).body.shortlists.find((entry) => entry._id === row._id);
        assert.deepEqual(terminal.application.permittedStatuses, []);
        assert.equal(terminal.access.manageStages, false);
        assert.equal(
          (
            await request(`/shortlists/applications/${row._id}`, owner, 'PATCH', {
              status: 'contacted',
              expectedVersion: terminal.version
            })
          ).status,
          409
        );
        assert.equal(
          (
            await request(`/shortlists/applications/${row._id}`, owner, 'PATCH', {
              notes: 'Retained after rejection',
              expectedVersion: terminal.version
            })
          ).status,
          200
        );
        evidence.checks.push(
          'five concurrent status intents: one commit, one receipt/inbox revision; stale/terminal failures silent; immutable evidence retained; internal edits silent'
        );
      }
    );
    await t.test(
      'notification failure rolls back status/history/receipt/revision and withdrawal races remain terminal',
      async (st) => {
        const record = records[120];
        const before = await Application.findById(record._id).lean();
        const original = notifications.createNotification;
        const injected = st.mock.method(notifications, 'createNotification', async (input) => {
          await original(input);
          throw Error('Injected post-notification failure');
        });
        assert.equal((await status(record, 'reviewing', 'submitted')).status, 503);
        injected.mock.restore();
        assert.deepEqual(await Application.findById(record._id).lean(), before);
        assert.equal(await Notification.countDocuments({ userId: record.applicantId }), 0);
        assert.equal(await Receipt.countDocuments({ userId: record.applicantId }), 0);
        assert.equal(await State.countDocuments({ _id: record.applicantId }), 0);
        const race = await Promise.allSettled([
          status(record, 'rejected', 'submitted'),
          lifecycle.withdraw(record.applicantId, record._id, 'submitted')
        ]);
        const outcome = race.map((r, i) =>
          r.status === 'rejected' ? r.reason.statusCode : i === 0 ? r.value.status : 200
        );
        assert.deepEqual(outcome.sort(), [200, 409]);
        assert.ok(
          ['rejected', 'withdrawn'].includes((await Application.findById(record._id)).status)
        );
        assert.equal((await status(record, 'reviewing', 'submitted')).status, 409);
        evidence.checks.push(
          'post-notification failure atomically rolls back all durable writes; concurrent reject/withdraw yields one winner and one 409'
        );
      }
    );
    assert.equal(
      evidence.checks.length,
      4,
      'All workflow checks must pass before recording success.'
    );
    evidence.status = 'passed';
  }
);
