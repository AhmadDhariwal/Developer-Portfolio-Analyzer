const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const express = require('express');
const { startMongo } = require('../fixtures/disposableRequestMongo');
const Job = require('../../modules/recruiter/models/Job');
const Application = require('../../modules/jobs/models/jobApplication');
const User = require('../../modules/auth/models/user');
const Organization = require('../../modules/admin/models/organization');
const Resume = require('../../modules/resume/models/resumeFile');
const Profile = require('../../modules/public-portfolio/models/publicProfile');
const storage = require('../../modules/resume/services/resumeStorageService');
const notifications = require('../../modules/notifications/services/notificationService');
const service = require('../../modules/jobs/services/jobApplicationService');

test(
  'direct applications: disposable Mongo and authenticated HTTP',
  { timeout: 120000 },
  async (t) => {
    const runtime = await startMongo({
      replicaSet: 'direct-applications',
      readinessAttempts: 200,
      temporaryRoot: require('node:path').resolve(__dirname, '../../../verification')
    });
    let server;
    const originalRead = storage.read;
    const originalNotify = notifications.createNotification;
    t.after(async () => {
      await require('../../modules/notifications/services/notificationStreamService').stop();
      if (server) await new Promise((resolve) => server.close(resolve));
      storage.read = originalRead;
      notifications.createNotification = originalNotify;
      await mongoose.disconnect();
      const cleanup = await runtime.stop();
      assert.equal(cleanup.mongoStopped, true);
    });
    await mongoose.connect(runtime.uri);
    await Promise.all([
      Job.init(),
      Application.init(),
      User.init(),
      Organization.init(),
      Resume.init(),
      Profile.init()
    ]);
    const ids = Array.from({ length: 6 }, () => new mongoose.Types.ObjectId());
    const [developer, other, recruiter, peer, foreign, orgId] = ids;
    await User.collection.insertMany(
      [developer, other, recruiter, peer, foreign].map((_id, i) => ({
        _id,
        name: `Person ${i}`,
        email: `${i}@application.test`,
        role: i < 2 ? 'developer' : 'recruiter',
        organizationId: orgId,
        sessionRevision: 0,
        isActive: true
      }))
    );
    await Organization.create({
      _id: orgId,
      name: 'Test organization',
      slug: 'application-test',
      ownerId: recruiter,
      createdBy: recruiter
    });
    const job = await Job.create({
      recruiterId: recruiter,
      organizationId: orgId,
      title: 'Internal engineer',
      requiredSkills: ['Angular'],
      location: 'Remote',
      published: true
    });
    const unpublished = await Job.create({
      recruiterId: recruiter,
      organizationId: orgId,
      title: 'Private job'
    });
    const closed = await Job.create({
      recruiterId: recruiter,
      organizationId: orgId,
      title: 'Closed',
      published: true,
      status: 'closed'
    });
    const resume = await Resume.create({
      userId: developer,
      fileName: 'version-one.pdf',
      fileUrl: '/test-only.pdf',
      fileSize: Buffer.byteLength('%PDF-1.7\nsubmitted version')
    });
    const profile = await Profile.create({
      userId: developer,
      slug: 'application-fixture',
      headline: 'Original headline',
      isPublic: false,
      projects: [{ title: 'Shared project' }],
      sections: { contact: { email: 'private@example.test' } }
    });
    const pdf = Buffer.from('%PDF-1.7\nsubmitted version');
    let reads = 0;
    storage.read = async (_reference, owner) => {
      assert.equal(String(owner), String(developer));
      reads++;
      return pdf;
    };
    process.env.JWT_SECRET = 'disposable-direct-application-fixture';
    const controller = require('../../modules/jobs/jobApplicationController');
    const app = express();
    app.use(express.json());
    // Production route modules with real JWT and tenant middleware; no Redis dependency is required.
    app.use('/api/notifications', require('../../modules/notifications/notification.routes'));
    app.use('/api/jobs', require('../../modules/jobs/jobRoutes'));
    app.use('/api/recruiter-hub', require('../../modules/recruiter/routes/hub/recruiterHubRoutes'));
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api`;
    const sign = require('../../modules/auth/utils/authSessionToken').sign;
    async function request(path, actor = developer, method = 'GET', body) {
      const response = await fetch(base + path, {
        method,
        headers: {
          ...(actor ? { Authorization: `Bearer ${sign({ _id: actor })}` } : {}),
          'Content-Type': 'application/json'
        },
        ...(body ? { body: JSON.stringify(body) } : {})
      });
      return {
        status: response.status,
        body: response.headers.get('content-type')?.includes('application/json')
          ? await response.json()
          : Buffer.from(await response.arrayBuffer())
      };
    }
    const path = `/jobs/internal/${job._id}/applications`;
    let payload;
    await t.test(
      'discovery is opt-in, open and role guarded; preview excludes private data',
      async () => {
        assert.equal((await request('/jobs/internal', null)).status, 401);
        assert.equal((await request('/jobs/internal', recruiter)).status, 403);
        const found = await request('/jobs/internal');
        assert.deepEqual(
          found.body.jobs.map((j) => j._id),
          [String(job._id)]
        );
        const options = (await request('/jobs/internal/options')).body;
        assert.equal(options.portfolio.headline, 'Original headline');
        assert.equal(JSON.stringify(options).includes('private@example.test'), false);
        assert.equal(options.resumes[0].fileUrl, undefined);
        payload = {
          resumeId: String(resume._id),
          consent: true,
          sharePortfolio: true,
          portfolioHash: options.portfolioHash
        };
        assert.equal(
          controller.developerOnly(
            { user: { role: 'super_admin' } },
            { status: () => ({ json: () => 'denied' }) },
            () => 'allowed'
          ),
          'denied'
        );
      }
    );
    await t.test('validation, resume ownership, consent and job eligibility', async () => {
      assert.equal(
        (await request(path, developer, 'POST', { ...payload, consent: false })).status,
        400
      );
      assert.equal(
        (await request(path, developer, 'POST', { ...payload, applicantId: String(other) })).status,
        400
      );
      assert.equal((await request(path, other, 'POST', payload)).status, 400);
      assert.equal(
        (await request(path, developer, 'POST', { ...payload, resumeId: 'bad' })).status,
        400
      );
      assert.equal(
        (await request(path, developer, 'POST', { ...payload, portfolioHash: 'stale' })).status,
        409
      );
      for (const invalid of [unpublished, closed])
        assert.equal(
          (await request(`/jobs/internal/${invalid._id}/applications`, developer, 'POST', payload))
            .status,
          409
        );
      await Organization.updateOne({ _id: orgId }, { $set: { isSuspended: true } });
      assert.equal((await request('/jobs/internal')).body.jobs.length, 0);
      assert.equal((await request(path, developer, 'POST', payload)).status, 409);
      await Organization.updateOne({ _id: orgId }, { $set: { isSuspended: false } });
    });
    await t.test(
      'publication requires an owned job and explicit boolean; status is unchanged',
      async () => {
        const jobPath = `/recruiter-hub/jobs/${job._id}`;
        assert.equal((await request(jobPath, peer, 'PATCH', { published: false })).status, 404);
        assert.equal(
          (await request(jobPath, recruiter, 'PATCH', { published: 'true' })).status,
          400
        );
        const hidden = await request(jobPath, recruiter, 'PATCH', { published: false });
        assert.equal(hidden.status, 200);
        assert.equal(hidden.body.job.status, 'open');
        assert.equal((await request('/jobs/internal')).body.jobs.length, 0);
        assert.equal((await request(jobPath, recruiter, 'PATCH', { published: true })).status, 200);
        assert.equal((await request('/jobs/internal')).body.jobs.length, 1);
      }
    );
    await t.test('close during evidence loading prevents submission', async () => {
      const raceJob = await Job.create({
        recruiterId: recruiter,
        organizationId: orgId,
        title: 'Closing job',
        published: true
      });
      const priorRead = storage.read;
      let release;
      let started;
      const reading = new Promise((resolve) => {
        started = resolve;
      });
      storage.read = async () => {
        started();
        return new Promise((resolve) => {
          release = () => resolve(pdf);
        });
      };
      const submission = service.submit(
        { _id: developer, name: 'Fixture' },
        String(raceJob._id),
        payload
      );
      await reading;
      await Job.updateOne({ _id: raceJob._id }, { $set: { status: 'closed' } });
      release();
      await assert.rejects(submission, (error) => error.statusCode === 409);
      storage.read = priorRead;
      assert.equal(await Application.countDocuments(), 0);
    });
    await t.test(
      'notification failure rolls back application, receipt and inbox revision',
      async () => {
        notifications.createNotification = async (input) => {
          await originalNotify(input);
          throw Error('Injected write failure');
        };
        try {
          assert.equal((await request(path, developer, 'POST', payload)).status, 503);
        } finally {
          notifications.createNotification = originalNotify;
        }
        assert.equal(await Application.countDocuments(), 0);
        assert.equal(
          await require('../../modules/notifications/models/notification').countDocuments(),
          0
        );
        assert.equal(
          await require('../../modules/notifications/models/notificationReceipt').countDocuments(),
          0
        );
        assert.equal(
          await require('../../modules/notifications/models/notificationState').countDocuments(),
          0
        );
      }
    );
    let application;
    await t.test(
      'concurrent submissions create exactly one durable application and notification attempt',
      async () => {
        // Prove the deterministic primary key works without the secondary unique index.
        await Application.collection.dropIndex('jobId_1_applicantId_1');
        const results = await Promise.all(
          Array.from({ length: 8 }, () => request(path, developer, 'POST', payload))
        );
        assert.equal(results.filter((r) => r.status === 201).length, 1);
        assert.equal(results.filter((r) => r.status === 200).length, 7);
        assert.equal(new Set(results.map((r) => r.body.application._id)).size, 1);
        assert.equal(await Application.countDocuments(), 1);
        assert.equal(
          await require('../../modules/notifications/models/notification').countDocuments(),
          1
        );
        application = results[0].body.application;
        assert.equal(application.organizationName, 'Test organization');
        assert.equal(application.resumeBytes, undefined);
        assert.equal(application.history, undefined);
        const readCount = reads;
        await Resume.deleteOne({ _id: resume._id });
        await Profile.updateOne({ _id: profile._id }, { $set: { headline: 'Changed' } });
        assert.equal((await request(path, developer, 'POST', payload)).status, 200);
        assert.equal(reads, readCount);
      }
    );
    const applicantsPath = `/recruiter-hub/jobs/${job._id}/applications`;
    await t.test(
      'ownership and organization isolation; submitted copies survive source deletion',
      async () => {
        assert.equal((await request(applicantsPath, developer)).status, 403);
        assert.equal((await request(applicantsPath, peer)).status, 404);
        await User.updateOne(
          { _id: foreign },
          { $set: { organizationId: new mongoose.Types.ObjectId() } }
        );
        assert.notEqual((await request(applicantsPath, foreign)).status, 200);
        const result = await request(applicantsPath, recruiter);
        assert.equal(result.status, 200);
        assert.equal(result.body.applications[0].portfolio.headline, 'Original headline');
        assert.equal(result.body.applications[0].resumeBytes, undefined);
        assert.deepEqual(
          (await request(`${applicantsPath}/${application._id}/resume`, recruiter)).body,
          pdf
        );
        assert.equal(
          (await request(`${applicantsPath}/${application._id}/resume`, peer)).status,
          404
        );
        assert.equal(
          (await request('/jobs/internal/applications', other)).body.applications.length,
          0
        );
        await Application.updateOne(
          { _id: application._id },
          { $set: { portfolio: { headline: 'Tamper' } } }
        );
        assert.equal(
          (await Application.findById(application._id)).portfolio.headline,
          'Original headline'
        );
      }
    );
    await t.test(
      'state transitions use compare-and-set; audit remains recruiter only',
      async () => {
        const statusPath = `${applicantsPath}/${application._id}`;
        assert.equal(
          (await request(statusPath, peer, 'PATCH', { status: 'reviewing' })).status,
          404
        );
        assert.equal(
          (await request(statusPath, recruiter, 'PATCH', { status: 'offered' })).status,
          400
        );
        const results = await Promise.all([
          request(statusPath, recruiter, 'PATCH', { status: 'reviewing' }),
          request(statusPath, recruiter, 'PATCH', { status: 'reviewing' })
        ]);
        assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
        assert.equal(
          (await request(statusPath, recruiter, 'PATCH', { status: 'rejected' })).status,
          200
        );
        assert.equal(
          (await request(statusPath, recruiter, 'PATCH', { status: 'reviewing' })).status,
          409
        );
        const row = await Application.findById(application._id).lean();
        assert.deepEqual(
          row.history.map((h) => [h.from, h.to]),
          [
            ['', 'submitted'],
            ['submitted', 'reviewing'],
            ['reviewing', 'rejected']
          ]
        );
        const mine = (await request('/jobs/internal/applications')).body.applications[0];
        assert.equal(mine.status, 'rejected');
        assert.equal(mine.history, undefined);
      }
    );
    await t.test(
      'withdrawal is owned, terminal, atomic and idempotent; safe timelines exclude actors',
      async () => {
        const secondJob = await Job.create({
          recruiterId: recruiter,
          organizationId: orgId,
          title: 'Withdrawal fixture',
          published: true
        });
        const file = await Resume.create({
          userId: developer,
          fileName: 'withdraw.pdf',
          fileUrl: '/test-only.pdf',
          fileSize: pdf.length
        });
        const body = { resumeId: String(file._id), consent: true, sharePortfolio: false };
        const submitted = await request(
          `/jobs/internal/${secondJob._id}/applications`,
          developer,
          'POST',
          body
        );
        assert.equal(submitted.status, 201);
        const id = submitted.body.application._id;
        const withdrawalPath = `/jobs/internal/applications/${id}/withdraw`;
        assert.equal(
          (await request(withdrawalPath, other, 'POST', { expectedStatus: 'submitted' })).status,
          404
        );
        assert.equal(
          (await request(withdrawalPath, recruiter, 'POST', { expectedStatus: 'submitted' }))
            .status,
          403
        );
        assert.equal(
          (await request(withdrawalPath, developer, 'POST', { expectedStatus: 'rejected' })).status,
          400
        );
        const statusPath = `/recruiter-hub/jobs/${secondJob._id}/applications/${id}`;
        assert.equal(
          (
            await request(statusPath, recruiter, 'PATCH', {
              status: 'reviewing',
              expectedStatus: 'submitted'
            })
          ).status,
          200
        );
        assert.equal(
          (await request(withdrawalPath, developer, 'POST', { expectedStatus: 'submitted' }))
            .status,
          409
        );
        const results = await Promise.all(
          Array.from({ length: 5 }, () =>
            request(withdrawalPath, developer, 'POST', { expectedStatus: 'reviewing' })
          )
        );
        assert.ok(results.every((r) => r.status === 200));
        const row = results[0].body.application;
        assert.equal(row.status, 'withdrawn');
        assert.deepEqual(
          row.timeline.map((e) => e.status),
          ['submitted', 'reviewing', 'withdrawn']
        );
        assert.ok(row.timeline.every((e) => Object.keys(e).sort().join(',') === 'at,status'));
        assert.equal(row.history, undefined);
        assert.equal(
          (await request(statusPath, recruiter, 'PATCH', { status: 'rejected' })).status,
          409
        );
        assert.equal(
          (await request(`/jobs/internal/${secondJob._id}/applications`, developer, 'POST', body))
            .body.application.status,
          'withdrawn'
        );
        const Notice = require('../../modules/notifications/models/notification');
        const notices = await Notice.find({ dedupeKey: { $regex: id } }).lean();
        assert.equal(notices.length, 3);
        assert.equal(notices.filter((n) => String(n.userId) === String(developer)).length, 1);
        assert.ok(
          notices.every(
            (n) =>
              !JSON.stringify(n).includes('Original headline') &&
              !JSON.stringify(n).includes('sha256')
          )
        );
        assert.equal(
          notices.find((n) => n.title === 'Application withdrawn').meta.target,
          '/app/recruiter/jobs'
        );
        assert.equal(
          notices.find((n) => n.title === 'Application status updated').meta.target,
          '/app/jobs?view=internal'
        );
        assert.equal((await Application.findById(id)).history.length, 3);
      }
    );
    await t.test(
      'status/withdraw races and notification failure preserve atomic history and SSE',
      async () => {
        const job = await Job.create({
          recruiterId: recruiter,
          organizationId: orgId,
          title: 'Race fixture',
          published: true
        });
        const file = await Resume.findOne({ userId: developer });
        const submitted = await request(
          `/jobs/internal/${job._id}/applications`,
          developer,
          'POST',
          { resumeId: String(file._id), consent: true, sharePortfolio: false }
        );
        assert.equal(submitted.status, 201);
        const id = submitted.body.application._id;
        const statusPath = `/recruiter-hub/jobs/${job._id}/applications/${id}`;
        const withdrawPath = `/jobs/internal/applications/${id}/withdraw`;
        const Notice = require('../../modules/notifications/models/notification');
        const before = await Notice.countDocuments();
        notifications.createNotification = async (input) => {
          await originalNotify(input);
          throw Error('Injected status delivery failure');
        };
        try {
          assert.equal(
            (
              await request(statusPath, recruiter, 'PATCH', {
                status: 'reviewing',
                expectedStatus: 'submitted'
              })
            ).status,
            503
          );
        } finally {
          notifications.createNotification = originalNotify;
        }
        assert.equal((await Application.findById(id)).status, 'submitted');
        assert.equal((await Application.findById(id)).history.length, 1);
        assert.equal(await Notice.countDocuments(), before);
        const abort = new AbortController();
        const timeout = setTimeout(() => abort.abort(), 15000);
        try {
          const stream = await fetch(base + '/notifications/stream', {
            headers: { Authorization: `Bearer ${sign({ _id: developer })}` },
            signal: abort.signal
          });
          assert.equal(stream.status, 200);
          const reader = stream.body.getReader();
          await reader.read();
          assert.equal(
            (
              await request(statusPath, recruiter, 'PATCH', {
                status: 'reviewing',
                expectedStatus: 'submitted'
              })
            ).status,
            200
          );
          await require('../../modules/notifications/services/notificationStreamService').reconcile();
          const event = new TextDecoder().decode((await reader.read()).value);
          assert.match(event, /notification/);
          assert.match(event, /reconcile/);
          assert.equal(event.includes('portfolio'), false);
          assert.equal(event.includes('Race fixture'), false);
        } finally {
          clearTimeout(timeout);
          abort.abort();
        }
        // Competing terminal mutations use the same observed status. Exactly one wins.
        const race = await Promise.all([
          request(statusPath, recruiter, 'PATCH', {
            status: 'rejected',
            expectedStatus: 'reviewing'
          }),
          request(withdrawPath, developer, 'POST', { expectedStatus: 'reviewing' })
        ]);
        assert.deepEqual(race.map((r) => r.status).sort(), [200, 409]);
        assert.equal((await Application.findById(id)).history.length, 3);
        assert.equal(await Notice.countDocuments({ dedupeKey: { $regex: id } }), 3);
        assert.equal(
          (
            await request(
              `/jobs/internal/applications/${application._id}/withdraw`,
              developer,
              'POST',
              { expectedStatus: 'reviewing' }
            )
          ).status,
          409
        );
      }
    );
    await t.test('closed job blocks new submissions but preserves prior status', async () => {
      await Job.updateMany({ recruiterId: recruiter }, { $set: { status: 'closed' } });
      assert.equal((await request('/jobs/internal')).body.jobs.length, 0);
      assert.equal((await request('/jobs/internal/applications')).body.applications.length, 3);
      assert.equal(
        await service
          .applicants(
            { recruiterId: recruiter, organizationId: new mongoose.Types.ObjectId() },
            String(job._id)
          )
          .then(
            () => 200,
            (e) => e.statusCode
          ),
        404
      );
    });
  }
);
