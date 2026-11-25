const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { existsSync } = require('node:fs');
const { once } = require('node:events');
const test = require('node:test');
const express = require('express');
const mongoose = require('mongoose');
const { startMongo } = require('../fixtures/disposableRequestMongo');
const User = require('../../modules/auth/models/user');
const Organization = require('../../modules/admin/models/organization');
const Team = require('../../modules/admin/models/team');
const Membership = require('../../modules/admin/models/membership');
const Invitation = require('../../modules/admin/models/invitation');
const PlatformSettings = require('../../modules/super-admin/models/platformSettings');
const Job = require('../../modules/recruiter/models/Job');
const RecruiterMatch = require('../../modules/recruiter/models/RecruiterMatch');
const RecruiterShortlist = require('../../modules/recruiter/models/RecruiterShortlist');
const AuditLog = require('../../modules/admin/models/auditLog');
const { auditLogMiddleware } = require('../../core/middleware/auditLogMiddleware');
const { getConsolePerformanceData } = require('../../modules/admin/services/adminConsoleService');
const {
  getRecruiterReportingSnapshot
} = require('../../modules/recruiter/services/hub/recruiterReportingService');
const { sign } = require('../../modules/auth/utils/authSessionToken');
const { acceptInvite } = require('../../modules/auth/authcontroller');
const hub = require('../../modules/recruiter/routes/hub/recruiterHubRoutes');
const legacy = require('../../modules/recruiter/routes/recruiter.routes');

const binary =
  process.env.INTEGRATION_TEST_MONGOD || 'C:\\Program Files\\MongoDB\\Server\\8.2\\bin\\mongod.exe';

test(
  'recruiter HTTP contracts and tenant boundaries on disposable MongoDB',
  {
    skip: !existsSync(binary) && 'A local mongod binary is required',
    timeout: 90000
  },
  async (t) => {
    const mongo = await startMongo({ replicaSet: 'recruiter-http' });
    const currentSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = randomBytes(32).toString('hex');
    t.after(async () => {
      await mongoose.disconnect();
      await mongo.stop();
      if (currentSecret === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = currentSecret;
    });
    await mongoose.connect(mongo.uri);

    const app = express();
    app.use(express.json());
    app.use(auditLogMiddleware);
    app.use('/api/recruiter-hub', hub);
    app.use('/api/recruiter', legacy);
    app.post('/accept', acceptInvite);
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const base = `http://127.0.0.1:${server.address().port}`;

    const user = (slug, props = {}) =>
      User.create({
        name: slug,
        email: `${slug}@example.test`,
        isVerified: true,
        providers: ['github'],
        ...props
      });
    const owner = await user('platform-admin', { role: 'super_admin' });
    const [org, foreignOrg] = await Organization.create(
      ['alpha', 'bravo'].map((slug) => ({
        name: slug,
        slug,
        ownerId: owner._id,
        createdBy: owner._id
      }))
    );
    const [recruiter, peer, foreignRecruiter, first, second, foreign, privateCandidate] =
      await Promise.all([
        user('recruiter', { role: 'recruiter', organizationId: org._id }),
        user('peer', { role: 'recruiter', organizationId: org._id }),
        user('foreign-recruiter', { role: 'recruiter', organizationId: foreignOrg._id }),
        user('developer-one', {
          name: 'Developer [Platform]',
          role: 'developer',
          organizationId: org._id,
          isPublic: true
        }),
        user('developer-two', { role: 'developer', organizationId: org._id, isPublic: true }),
        user('developer-foreign', {
          role: 'developer',
          organizationId: foreignOrg._id,
          isPublic: true
        }),
        user('developer-private', { role: 'developer', organizationId: org._id, isPublic: false })
      ]);
    await PlatformSettings.create({
      scope: 'global',
      recruiter: { candidateVisibility: 'organization' }
    });
    const otherJob = await Job.create({
      title: 'Peer job',
      recruiterId: peer._id,
      organizationId: org._id
    });

    const request = async (method, path, status, { actor = recruiter, body } = {}) => {
      const route = path
        .replace(/^\/hub\//, '/api/recruiter-hub/')
        .replace(/^\/legacy\//, '/api/recruiter/');
      const response = await fetch(base + route, {
        method,
        headers: {
          ...(actor && { Authorization: `Bearer ${sign(actor)}` }),
          ...(body && { 'Content-Type': 'application/json' })
        },
        ...(body && { body: JSON.stringify(body) })
      });
      const data = await response.json();
      assert.equal(response.status, status, `${method} ${path}: ${JSON.stringify(data)}`);
      return data;
    };

    await t.test('candidate consent, organization boundaries and role checks', async () => {
      const { candidates } = await request('GET', '/hub/candidates', 200);
      assert.deepEqual(new Set(candidates.map(({ id }) => id)), new Set([first.id, second.id]));
      assert.equal(
        candidates.some((candidate) => 'email' in candidate),
        false
      );
      const literal = await request('GET', '/legacy/candidates?search=%5BPlatform%5D', 200);
      assert.deepEqual(
        literal.candidates.map(({ userId }) => userId),
        [first.id]
      );
      await request('GET', `/hub/candidates/${foreign.id}`, 404);
      await request('GET', `/hub/candidates/${privateCandidate.id}`, 404);
      await request('GET', `/legacy/candidate/${first.id}`, 200);
      await request('GET', `/hub/candidates/${first.id}`, 200);
      await request('POST', `/hub/candidates/${first.id}/analyze`, 200, { body: {} });
      await request('GET', '/hub/candidates/invalid-id', 400);
      await request('GET', '/hub/candidates', 401, { actor: null });
      await request('GET', '/hub/candidates', 403, { actor: owner });
      await request('GET', '/legacy/jobs', 403, { actor: owner });
      await request('GET', '/hub/jobs', 403, { actor: first });
    });

    await t.test('Hub endpoint workflow and isolation across recruiters', async () => {
      const created = await request('POST', '/hub/jobs', 201, {
        body: {
          title: 'Engineer',
          location: 'Remote',
          requiredSkills: ['Angular'],
          description: ''
        }
      });
      const jobId = created.job._id;
      assert.equal(created.job.description, '');
      const plan = await Job.find({ recruiterId: recruiter._id, organizationId: org._id })
        .sort({ updatedAt: -1 })
        .explain('executionStats');
      assert.equal(plan.executionStats.nReturned, 1);
      assert.ok(plan.executionStats.totalDocsExamined >= plan.executionStats.nReturned);
      assert.deepEqual(
        (await request('GET', '/hub/jobs', 200)).jobs.map(({ _id }) => _id),
        [jobId]
      );
      await request('GET', `/hub/jobs/${jobId}`, 200);
      await request('GET', '/hub/jobs/invalid-id', 400);
      await request('GET', `/hub/jobs/${jobId}`, 404, { actor: foreignRecruiter });
      await request('PATCH', `/hub/jobs/${jobId}`, 200, { body: { description: 'Updated' } });
      await request('PATCH', `/hub/jobs/${otherJob.id}`, 404, { body: { description: 'Updated' } });
      await request('POST', '/hub/matches/generate', 400, {
        body: { jobId, candidateIds: ['invalid-id'] }
      });
      await RecruiterMatch.init();
      const generate = () =>
        request('POST', '/hub/matches/generate', 200, {
          body: { jobId, candidateIds: [first.id] }
        });
      const generated = await Promise.all([generate(), generate()]);
      for (const result of generated) {
        assert.deepEqual(
          result.matches.map(({ candidateId }) => candidateId),
          [first.id]
        );
      }
      assert.equal(await RecruiterMatch.countDocuments({ jobId }), 1);
      const list = await request('GET', `/hub/matches?jobId=${jobId}`, 200);
      const matchId = list.matches[0]._id;
      await request('GET', `/hub/matches/${matchId}`, 200);
      await request('GET', `/hub/matches/${matchId}`, 404, { actor: peer });
      await request('PATCH', `/hub/matches/${matchId}/status`, 200, {
        body: { status: 'rejected' }
      });
      await request('POST', '/hub/shortlists', 404, {
        body: { jobId, candidateId: privateCandidate.id }
      });
      const createdShortlist = await request('POST', '/hub/shortlists', 201, {
        body: { jobId, candidateId: first.id }
      });
      const shortlistId = createdShortlist.shortlist._id;
      await request('GET', '/hub/shortlists', 200);
      await request('PATCH', `/hub/shortlists/${shortlistId}`, 404, {
        actor: peer,
        body: { status: 'reviewing' }
      });
      await request('PATCH', `/hub/shortlists/${shortlistId}`, 200, {
        body: { status: 'reviewing' }
      });
      await request('POST', '/hub/comparison', 200, {
        body: { jobId, candidateIds: [first.id, second.id] }
      });
      await request('GET', '/hub/analytics/dashboard', 200);
      await request('GET', '/hub/analytics', 200);
      await request('GET', '/hub/activity', 200);
      await request('GET', '/hub/profile', 200);
      await request('PATCH', '/hub/profile', 200, { body: { jobTitle: 'Hiring specialist' } });
      await request('DELETE', `/hub/shortlists/${shortlistId}`, 200);
      const metrics = await getRecruiterReportingSnapshot(recruiter);
      assert.equal(metrics.totalCandidatesAnalyzed, 1);
      assert.equal(metrics.matchesGenerated, 1);
      const adminReport = await getConsolePerformanceData(org.id, { recruiterId: recruiter.id });
      assert.equal(adminReport.summary.matchesGenerated, 2);
      assert.equal(
        await AuditLog.countDocuments({
          actor: recruiter._id,
          action: 'POST /api/recruiter-hub/matches/generate',
          statusCode: { $lt: 400 }
        }),
        0
      );

      await User.updateOne({ _id: first._id }, { isPublic: false });
      await request('GET', `/hub/matches/${matchId}`, 404);
      assert.deepEqual((await request('GET', '/hub/matches', 200)).matches, []);
      await User.updateOne({ _id: first._id }, { isPublic: true });
      await request('POST', '/hub/shortlists', 201, { body: { jobId, candidateId: first.id } });
      await request('POST', `/hub/jobs/${jobId}/archive`, 200, { body: {} });
      await request('DELETE', `/hub/jobs/${jobId}`, 200);
      assert.equal(await RecruiterMatch.countDocuments({ jobId }), 0);
      assert.equal(await RecruiterShortlist.countDocuments({ jobId }), 0);
    });

    await t.test('legacy job and ranking contracts retain recruiter ownership', async () => {
      await request('GET', '/legacy/dashboard', 200);
      const { job } = await request('POST', '/legacy/job', 201, {
        body: { title: 'Legacy', description: 'Engineer' }
      });
      assert.deepEqual(
        (await request('GET', '/legacy/jobs', 200)).jobs.map(({ _id }) => _id),
        [job._id]
      );
      await request('PUT', `/legacy/job/${otherJob.id}`, 404, { body: { title: 'Updated' } });
      await request('DELETE', `/legacy/job/${otherJob.id}`, 404);
      await request('PUT', `/legacy/job/${job._id}`, 200, { body: { title: 'Updated' } });
      await request('POST', '/legacy/match', 200, { body: { jobId: job._id } });
      const ranked = await request('POST', '/legacy/ai-rank', 200, {
        body: { jobId: job._id, candidateIds: [first.id, foreign.id] }
      });
      assert.deepEqual(
        ranked.rankedCandidates.map(({ candidateId }) => candidateId),
        [first.id]
      );
      await request('DELETE', `/legacy/job/${job._id}`, 200);
    });

    await t.test(
      'concurrent acceptance writes tenant and team memberships exactly once',
      async () => {
        const team = await Team.create({
          name: 'Hiring team',
          slug: 'hiring',
          organizationId: org._id,
          createdBy: owner._id
        });
        await Membership.init();
        const invitation = await Invitation.create({
          organizationId: org._id,
          teamId: team._id,
          token: randomBytes(24).toString('hex'),
          email: 'new-recruiter@example.test',
          role: 'recruiter',
          invitedBy: owner._id,
          expiresAt: new Date(Date.now() + 60000)
        });
        const accept = () =>
          fetch(base + '/accept', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: invitation.token, password: 'Fixture-Hiring-92!' })
          });
        const responses = await Promise.all([accept(), accept()]);
        assert.deepEqual(responses.map((response) => response.status).sort(), [200, 400]);
        const accepted = await responses.find((response) => response.ok).json();
        assert.equal(accepted.redirectTo, '/app/recruiter/profile?onboarding=recruiter');
        const memberships = await Membership.find({
          organizationId: org._id,
          userId: accepted.user._id
        }).lean();
        assert.deepEqual(
          new Set(memberships.map((item) => (item.teamId ? String(item.teamId) : null))),
          new Set([team.id, null])
        );
      }
    );
  }
);
