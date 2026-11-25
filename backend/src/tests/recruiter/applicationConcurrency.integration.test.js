const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const mongoose = require('mongoose');
const { startApplicationFixture } = require('../fixtures/applicationPerformanceFixture');
const User = require('../../modules/auth/models/user');
const Job = require('../../modules/recruiter/models/Job');
const Application = require('../../modules/jobs/models/jobApplication');
const Notification = require('../../modules/notifications/models/notification');
const Receipt = require('../../modules/notifications/models/notificationReceipt');
const Membership = require('../../modules/admin/models/membership');
const budget = require('../../modules/recruiter/utils/hub/applicationWorkflowBudget');

test(
  'private application concurrency preserves lifecycle, revocation and bounded outcomes',
  { timeout: 240000 },
  async (t) => {
    const evidence = { status: 'running', productionDataUsed: false, checks: [] };
    const fixture = await startApplicationFixture({ count: 261, seed: 'p15b-security' });
    t.after(async () => {
      evidence.cleanup = await fixture.stop();
      if (evidence.status === 'running') evidence.status = 'failed';
      fs.writeFileSync(
        path.resolve(__dirname, '../../../verification/jobs-hub/p1.5b/concurrency-tests.json'),
        JSON.stringify(evidence, null, 2) + '\n'
      );
    });
    const list = () =>
      fixture.request('/api/recruiter-hub/shortlists/applications?page=1&limit=20');
    const status = (record) =>
      fixture.request(`/api/recruiter-hub/jobs/${fixture.job._id}/applications/${record._id}`, {
        method: 'PATCH',
        body: { status: 'reviewing', expectedStatus: 'submitted' }
      });

    await t.test(
      'repeated concurrent observed transitions have one winner and one atomic notification',
      async () => {
        for (const row of fixture.records.slice(0, 3)) {
          const responses = await Promise.all(Array.from({ length: 6 }, () => status(row)));
          assert.equal(
            responses.filter((response) => response.status === 200).length,
            1,
            JSON.stringify(responses)
          );
          assert.equal(
            responses.filter((response) => response.status === 409).length,
            5,
            JSON.stringify(responses)
          );
          const saved = await Application.findById(row._id).lean();
          assert.equal(saved.status, 'reviewing');
          assert.equal(saved.history.length, 2);
          assert.deepEqual(saved.consent, row.consent);
          assert.equal(await Notification.countDocuments({ userId: row.applicantId }), 1);
          assert.equal(await Receipt.countDocuments({ userId: row.applicantId }), 1);
        }
        evidence.checks.push(
          'Three rounds of six competing status intents: one 200, five 409, one history event/notification/receipt per round.'
        );
      }
    );

    await t.test(
      'ownership transfer between validation and page fencing invalidates the snapshot',
      async (subtest) => {
        const original = Job.collection.updateMany.bind(Job.collection);
        let transferred = false;
        subtest.mock.method(Job.collection, 'updateMany', async (filter, update, options) => {
          if (!transferred && options?.session) {
            transferred = true;
            await Job.collection.updateOne(
              { _id: fixture.job._id },
              { $set: { recruiterId: fixture.peer } }
            );
          }
          return original(filter, update, options);
        });
        const response = await list();
        assert.equal(transferred, true);
        assert.equal(response.status, 200, JSON.stringify(response));
        assert.equal(response.body.meta.total, 0);
        assert.deepEqual(response.body.shortlists, []);
        const peer = await fixture.request('/api/recruiter-hub/shortlists/applications', {
          actor: fixture.peer
        });
        assert.equal(peer.status, 200);
        assert.equal(peer.body.meta.total, 0);
        await Job.collection.updateOne(
          { _id: fixture.job._id },
          { $set: { recruiterId: fixture.owner } }
        );
        evidence.checks.push(
          'In-flight owner transfer forces a fresh snapshot and zero disclosure to either mismatched owner.'
        );
      }
    );

    await t.test(
      'live session and membership revocation during active requests never disclose private rows',
      async (subtest) => {
        const original = User.collection.findOneAndUpdate.bind(User.collection);
        let revoked = false;
        subtest.mock.method(
          User.collection,
          'findOneAndUpdate',
          async (filter, update, options) => {
            if (!revoked && options?.session && String(filter._id) === String(fixture.owner)) {
              revoked = true;
              await User.collection.updateOne(
                { _id: fixture.owner },
                { $inc: { sessionRevision: 1 } }
              );
            }
            return original(filter, update, options);
          }
        );
        const denied = await list();
        assert.equal(revoked, true);
        assert.equal(denied.status, 403, JSON.stringify(denied));
        assert.equal(denied.body.shortlists, undefined);
        await User.collection.updateOne({ _id: fixture.owner }, { $set: { sessionRevision: 0 } });
        await Membership.create({
          userId: fixture.owner,
          organizationId: fixture.organizationId,
          role: 'member',
          status: 'disabled'
        });
        const membership = await list();
        assert.equal(membership.status, 403, JSON.stringify(membership));
        await Membership.updateOne(
          { userId: fixture.owner, organizationId: fixture.organizationId },
          { $set: { status: 'active' } }
        );
        assert.equal((await list()).body.meta.total, 261);
        evidence.checks.push(
          'Session revision revoked after HTTP authentication but before the first fence returns 403; inactive membership returns 403; restored live policy restores exact totals.'
        );
      }
    );

    await t.test(
      'persistent transient conflicts stop at one workflow deadline',
      async (subtest) => {
        let attempts = 0;
        subtest.mock.method(User.collection, 'findOneAndUpdate', async () => {
          attempts++;
          throw new mongoose.mongo.MongoServerError({
            message: 'Disposable forced write conflict',
            code: 112,
            errorLabels: ['TransientTransactionError']
          });
        });
        const started = performance.now();
        const response = await list();
        const elapsedMs = performance.now() - started;
        assert.equal(response.status, 503, JSON.stringify(response));
        assert.match(response.body.message, /deadline|retry budget/);
        assert.ok(attempts > 1);
        assert.ok(attempts <= budget.MAX_TRANSACTION_ATTEMPTS);
        assert.ok(
          elapsedMs < budget.WORKFLOW_BUDGET_MS + 1500,
          `Unbounded retries: ${elapsedMs}ms`
        );
        evidence.checks.push({
          persistentContention: { elapsedMs, attempts, http: response.status, commit: 'none' }
        });
      }
    );

    await t.test(
      'an unknown commit retries only the commit, without duplicate lifecycle effects',
      async (subtest) => {
        const row = fixture.records[5];
        const original = mongoose.mongo.ClientSession.prototype.commitTransaction;
        let commits = 0;
        subtest.mock.method(
          mongoose.mongo.ClientSession.prototype,
          'commitTransaction',
          async function (...args) {
            await original.apply(this, args);
            if (++commits === 1)
              throw new mongoose.mongo.MongoServerError({
                message: 'Disposable uncertain commit reply',
                errorLabels: ['UnknownTransactionCommitResult']
              });
          }
        );
        const response = await status(row);
        assert.equal(response.status, 200, JSON.stringify(response));
        assert.equal(commits, 2);
        assert.equal((await Application.findById(row._id).lean()).history.length, 2);
        assert.equal(await Notification.countDocuments({ userId: row.applicantId }), 1);
        assert.equal(await Receipt.countDocuments({ userId: row.applicantId }), 1);
        evidence.checks.push(
          'UnknownTransactionCommitResult retries commit once, with one lifecycle event and one notification/receipt.'
        );
      }
    );

    await t.test(
      'a lost successful commit reply is reported as unconfirmed and never replays the mutation',
      async (subtest) => {
        const row = fixture.records[4];
        const original = mongoose.mongo.ClientSession.prototype.commitTransaction;
        let commits = 0;
        subtest.mock.method(
          mongoose.mongo.ClientSession.prototype,
          'commitTransaction',
          async function (...args) {
            await original.apply(this, args);
            commits++;
            throw new mongoose.mongo.MongoOperationTimeoutError(
              'Disposable lost commit acknowledgement'
            );
          }
        );
        const response = await status(row);
        assert.equal(response.status, 503, JSON.stringify(response));
        assert.match(response.body.message, /outcome is unconfirmed.*Refresh/);
        assert.equal(commits, 1);
        const saved = await Application.findById(row._id).lean();
        assert.equal(saved.status, 'reviewing');
        assert.equal(saved.history.length, 2);
        assert.equal(await Notification.countDocuments({ userId: row.applicantId }), 1);
        assert.equal(await Receipt.countDocuments({ userId: row.applicantId }), 1);
        evidence.checks.push(
          'Real commit followed by injected lost acknowledgement: explicit unconfirmed response, one committed transition/notification/receipt, zero callback replay.'
        );
      }
    );
    evidence.status = 'passed';
  }
);
