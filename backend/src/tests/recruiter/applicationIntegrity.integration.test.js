const test = require('node:test');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const mongoose = require('mongoose');
const { startApplicationFixture } = require('../fixtures/applicationPerformanceFixture');
const Shortlist = require('../../modules/recruiter/models/RecruiterShortlist');
const Application = require('../../modules/jobs/models/jobApplication');
const Job = require('../../modules/recruiter/models/Job');
const { withAccess } = require('../../modules/recruiter/utils/hub/recruiterJobAccess');
const {
  verifyApplicationIdentities,
  remainingBudget,
  MAX_IDENTITY_ROWS
} = require('../../modules/recruiter/utils/hub/applicationIdentityValidation');

test(
  'bounded identity validation retains exact, live application authorization',
  { timeout: 120000 },
  async (t) => {
    const fixture = await startApplicationFixture({ count: 261 });
    t.after(() => fixture.stop());
    const list = () =>
      fixture.request('/api/recruiter-hub/shortlists/applications?page=1&limit=20');
    assert.equal((await list()).body.meta.total, 261);
    const first = fixture.records[0];
    const row = await Shortlist.findOne({ applicationId: first._id }).lean();
    await t.test(
      'plausible forged hashes and malformed consent never enter the total; validation is not cached',
      async () => {
        const forged = 'c'.repeat(64);
        await Application.collection.insertOne({
          ...first,
          _id: forged,
          applicantId: new mongoose.Types.ObjectId()
        });
        const forgedApplication = await Application.findById(forged).lean();
        await Shortlist.collection.updateOne(
          { _id: row._id },
          { $set: { applicationId: forged, candidateId: forgedApplication.applicantId } }
        );
        assert.equal((await list()).body.meta.total, 260);
        await Shortlist.collection.updateOne(
          { _id: row._id },
          { $set: { applicationId: first._id, candidateId: first.applicantId } }
        );
        assert.equal((await list()).body.meta.total, 261);
        await Application.collection.updateOne(
          { _id: first._id },
          { $set: { 'consent.version': 'forged' } }
        );
        assert.equal((await list()).body.meta.total, 260);
        await Application.collection.updateOne(
          { _id: first._id },
          { $set: { 'consent.version': 'direct-apply-v1' } }
        );
        for (const [field, malformed, original] of [
          ['applicantId', [first.applicantId], first.applicantId],
          ['status', ['submitted'], 'submitted'],
          ['consent.submittedAt', new Date().toISOString(), first.consent.submittedAt]
        ]) {
          await Application.collection.updateOne(
            { _id: first._id },
            { $set: { [field]: malformed } }
          );
          assert.equal((await list()).body.meta.total, 260, field);
          await Application.collection.updateOne(
            { _id: first._id },
            { $set: { [field]: original } }
          );
        }
        await Job.updateOne({ _id: fixture.job._id }, { $set: { recruiterId: fixture.peer } });
        assert.equal((await list()).body.meta.total, 0);
        assert.equal(
          (
            await fixture.request('/api/recruiter-hub/shortlists/applications', {
              actor: fixture.peer
            })
          ).body.meta.total,
          0
        );
        await Job.updateOne({ _id: fixture.job._id }, { $set: { recruiterId: fixture.owner } });
        assert.equal((await list()).body.meta.total, 261);
      }
    );
    await t.test(
      'capacity and elapsed budgets fail explicitly, never return truncated IDs or totals',
      async () => {
        assert.equal(MAX_IDENTITY_ROWS, 10000);
        await assert.rejects(
          withAccess(fixture.scope, (ctx) => verifyApplicationIdentities(ctx, { maxRows: 2 })),
          (error) => error.statusCode === 503 && /capacity/.test(error.message)
        );
        assert.throws(
          () => remainingBudget(performance.now() - 1),
          (error) => error.statusCode === 503
        );
        assert.equal((await list()).body.meta.total, 261);
      }
    );
  }
);
