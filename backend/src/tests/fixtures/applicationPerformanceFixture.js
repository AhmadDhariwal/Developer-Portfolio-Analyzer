const { createHash, randomBytes } = require('node:crypto');
const { once } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const mongoose = require('mongoose');
const { startMongo } = require('./disposableRequestMongo');
const User = require('../../modules/auth/models/user');
const Organization = require('../../modules/admin/models/organization');
const Job = require('../../modules/recruiter/models/Job');
const Application = require('../../modules/jobs/models/jobApplication');
const Shortlist = require('../../modules/recruiter/models/RecruiterShortlist');
const settings = require('../../modules/super-admin/services/platformSettingsService');
const { sign } = require('../../modules/auth/utils/authSessionToken');
const hub = require('../../modules/recruiter/routes/hub/recruiterHubRoutes');

async function startApplicationFixture({ count = 261, configure } = {}) {
  const temporaryRoot = path.resolve(__dirname, '../../../verification/jobs-hub/p1.5a-runtime');
  fs.mkdirSync(temporaryRoot, { recursive: true });
  const runtime = await startMongo({
    temporaryRoot,
    replicaSet: 'p15a-applications',
    readinessAttempts: 200
  });
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = randomBytes(32).toString('hex');
  let server;
  const stop = async () => {
    if (server) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
    settings.stopSettingsSynchronization();
    await require('../../modules/notifications/services/notificationStreamService').stop();
    await mongoose.disconnect();
    const cleanup = await runtime.stop();
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
    return cleanup;
  };
  try {
    await mongoose.connect(runtime.uri);
    // Register route dependencies first; finish cold DDL before any transaction.
    await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
    await settings.startSettingsSynchronization();
    const oid = () => new mongoose.Types.ObjectId();
    const owner = oid(),
      peer = oid(),
      organizationId = oid();
    await User.collection.insertMany(
      [owner, peer].map((_id, i) => ({
        _id,
        name: `Fixture recruiter ${i}`,
        email: `r${i}@p15a.test`,
        role: 'recruiter',
        organizationId,
        isActive: true,
        sessionRevision: 0
      }))
    );
    await Organization.create({
      _id: organizationId,
      name: 'P15A fixture',
      slug: 'p15a-fixture',
      ownerId: owner,
      createdBy: owner
    });
    const job = await Job.create({
      recruiterId: owner,
      organizationId,
      title: 'Fixture engineer',
      published: true
    });
    const records = Array.from({ length: count }, (_, i) => {
      const applicantId = oid();
      return {
        _id: createHash('sha256').update(`${job._id}:${applicantId}`).digest('hex'),
        recruiterId: owner,
        organizationId,
        organizationName: 'P15A fixture',
        jobId: job._id,
        applicantId,
        applicantName: `Private fixture ${i}`,
        jobTitle: job.title,
        resume: { fileName: 'submitted.pdf', sha256: 'b'.repeat(64) },
        resumeBytes: Buffer.from('%PDF-frozen'),
        portfolio: null,
        consent: { version: 'direct-apply-v1', submittedAt: new Date(), sharePortfolio: false },
        status: 'submitted',
        history: [{ from: '', to: 'submitted', actorId: applicantId, at: new Date() }],
        createdAt: new Date(),
        updatedAt: new Date(),
        __v: 0
      };
    });
    await User.collection.insertMany(
      records.map((r, i) => ({
        _id: r.applicantId,
        name: r.applicantName,
        email: `d${i}@p15a.test`,
        role: 'developer',
        isActive: true,
        isPublic: false
      }))
    );
    await Application.collection.insertMany(records);
    const at = new Date('2026-11-24T00:00:00Z');
    await Shortlist.collection.insertMany(
      records.map((r) => ({
        _id: oid(),
        recruiterId: owner,
        organizationId,
        jobId: job._id,
        candidateId: r.applicantId,
        applicationId: r._id,
        notes: 'Private fixture assessment',
        status: 'shortlisted',
        createdAt: at,
        updatedAt: at,
        __v: 0
      }))
    );
    const scope = { recruiterId: String(owner), organizationId: String(organizationId) };
    const app = express();
    app.use(express.json());
    if (configure) await configure(app, scope);
    app.use('/api/recruiter-hub', hub);
    app.use('/api/tenant', require('../../modules/admin/routes/tenant.routes'));
    app.use('/api/notifications', require('../../modules/notifications/notification.routes'));
    app.use('/api/profile', require('../../modules/profile/profile.routes'));
    // New route imports may register additional models needed during browser boot.
    await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const origin = `http://127.0.0.1:${server.address().port}`;
    const request = async (route, { actor = owner, method = 'GET', body } = {}) => {
      const response = await fetch(origin + route, {
        method,
        signal: AbortSignal.timeout(30000),
        headers: {
          Authorization: `Bearer ${sign({ _id: actor })}`,
          'Content-Type': 'application/json'
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
      return { status: response.status, body: await response.json() };
    };
    return { app, server, origin, scope, owner, peer, organizationId, job, records, request, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}

module.exports = { startApplicationFixture };
