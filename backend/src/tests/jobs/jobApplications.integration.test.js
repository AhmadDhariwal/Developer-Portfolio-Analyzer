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
    let notificationAttempts = 0;
    notifications.createNotification = async () => {
      notificationAttempts++;
      assert.equal(await Application.countDocuments(), 1);
      throw Error('Simulated notification outage');
    };
    process.env.JWT_SECRET = 'disposable-direct-application-fixture';
    const controller = require('../../modules/jobs/jobApplicationController');
    const app = express();
    app.use(express.json());
    // Production route modules with real JWT and tenant middleware; no Redis dependency is required.
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
        assert.equal(notificationAttempts, 1);
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
    await t.test('closed job blocks new submissions but preserves prior status', async () => {
      await Job.updateOne({ _id: job._id }, { $set: { status: 'closed' } });
      assert.equal((await request('/jobs/internal')).body.jobs.length, 0);
      assert.equal((await request('/jobs/internal/applications')).body.applications.length, 1);
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
