const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { startMongo } = require('./fixtures/disposableRequestMongo');
const State = require('../models/weeklyReportCoordination');
const Report = require('../models/weeklyReport');
const User = require('../models/user');
const { withLease } = require('../services/weeklyReportCoordinationService');
const { deliver } = require('../services/weeklyReportDeliveryService');
const { fork } = require('node:child_process');
const { once } = require('node:events');
const path = require('node:path');
const fs = require('node:fs');
const { performance } = require('node:perf_hooks');

test(
  'isolated Mongo: independent clients, lease takeover, fencing and uncertain email',
  { skip: process.env.WEEKLY_REPORT_TEST_MONGO !== '1' },
  async (t) => {
    const mongo = await startMongo({ replicaSet: 'weekly-finalization' });
    let peer;
    t.after(async () => {
      await peer?.close();
      await mongoose.disconnect();
      await mongo.stop();
    });
    await mongoose.connect(mongo.uri);
    peer = await mongoose.createConnection(mongo.uri).asPromise();
    const PeerState = peer.model('WeeklyReportCoordination', State.schema);
    await State.init();
    let release;
    const held = new Promise((resolve) => {
      release = resolve;
    });
    let entered;
    const ready = new Promise((resolve) => {
      entered = resolve;
    });
    const first = withLease('generation:test', async (fence) => {
      entered();
      await held;
      await assert.rejects(fence(), /expired/);
    });
    await Promise.race([ready, first]);
    await assert.rejects(
      withLease('generation:test', async () => {}, { model: PeerState }),
      /in progress/,
    );
    await State.updateOne({ _id: 'generation:test' }, { $set: { expiresAt: new Date(0) } });
    await withLease(
      'generation:test',
      async (fence) => {
        await fence();
        release();
        await first;
      },
      { model: PeerState },
    );
    assert.equal(await State.countDocuments(), 0);
    const worker = fork(path.join(__dirname, 'fixtures/weeklyReportLeaseWorker.js'), [], {
      env: { ...process.env, WEEKLY_FIXTURE_URI: mongo.uri },
      silent: true,
    });
    t.after(() => {
      if (worker.exitCode === null) worker.kill();
    });
    const [message] = await once(worker, 'message');
    assert.equal(message.claimed, true);
    await assert.rejects(
      withLease('crash-test', async () => {}),
      /in progress/,
    );
    const exited = once(worker, 'exit');
    worker.kill();
    await exited;
    await State.updateOne({ _id: 'crash-test' }, { $set: { expiresAt: new Date(0) } });
    await withLease('crash-test', async (fence) => {
      await fence();
    });

    const userId = new mongoose.Types.ObjectId();
    await User.collection.insertOne({
      _id: userId,
      email: 'fixture@example.invalid',
      name: 'Fixture',
      isActive: true,
    });
    const id = new mongoose.Types.ObjectId();
    await Report.collection.insertOne({
      _id: id,
      userId,
      meta: { reportHash: 'fixture' },
      emailStatus: 'skipped',
      emailDelivery: { status: 'pending', attempts: 0 },
    });
    let sends = 0;
    let finish;
    const sending = deliver({ _id: id }, null, async () => {
      sends++;
      await new Promise((resolve) => {
        finish = resolve;
      });
      return { sent: true };
    });
    while (!finish) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(
      (
        await deliver({ _id: id }, null, async () => {
          sends++;
          return { sent: true };
        })
      ).sent,
      false,
    );
    finish();
    await sending;
    assert.equal(sends, 1);
    const ai = require('../services/aiservice');
    const originalAI = ai.runAIAnalysis;
    ai.runAIAnalysis = async (_prompt, fallback) => fallback;
    t.after(() => {
      ai.runAIAnalysis = originalAI;
    });
    const weekly = require('../services/weeklyReportService');
    const generationUserId = new mongoose.Types.ObjectId();
    await User.collection.insertOne({
      _id: generationUserId,
      name: 'Generation fixture',
      email: 'generation@fixture.invalid',
      isActive: true,
      notifications: { weeklyScoreReport: false },
    });
    await require('../models/analysis').collection.insertOne({
      userId: generationUserId,
      githubScore: 60,
      updatedAt: new Date(),
    });
    const started = performance.now();
    const generated = await weekly.generateWeeklyReport(generationUserId, { forceRefresh: true });
    const generationMs = performance.now() - started;
    const replayStarted = performance.now();
    const repeated = await weekly.generateWeeklyReport(generationUserId, { forceRefresh: true });
    const replayMs = performance.now() - replayStarted;
    assert.equal(String(generated._id), String(repeated._id));
    assert.equal(generated.score, repeated.score);
    assert.equal(generated.meta.reportHash, repeated.meta.reportHash);
    assert.equal(generated.meta.deterministicScore, true);
    assert.equal(generated.meta.comparisons.scoreDelta, 0);
    assert.match(generated.progressSummary, /establishes a saved baseline/);
    assert.equal(generated.meta.fallbackUsed, true);
    assert.equal(generated.meta.dataSourcesUsed.learning.status, 'Unavailable');
    assert.equal(String(generated.userId), String(generationUserId));
    await User.updateOne({ _id: userId }, { $set: { 'notifications.weeklyScoreReport': false } });
    assert.equal(
      (
        await deliver(generated, null, async () => {
          sends++;
          return { sent: true };
        })
      ).sent,
      false,
    );
    assert.equal(sends, 1);

    await User.collection.insertMany(
      Array.from({ length: 3 }, (_, index) => ({
        name: `Page ${index}`,
        email: `page${index}@fixture.invalid`,
        isActive: true,
      })),
    );
    const oldLimit = process.env.WEEKLY_REPORT_BATCH_LIMIT;
    process.env.WEEKLY_REPORT_BATCH_LIMIT = '2';
    try {
      const batch = await weekly.runWeeklyReportBatch({ dryRun: true });
      assert.equal(batch.usersScanned, 3);
      assert.equal(batch.generated, 0);
      assert.equal(batch.skipped, 3);
      const failed = await weekly.runWeeklyReportBatch({
        dryRun: false,
        generate: async () => {
          throw Error('synthetic retry');
        },
      });
      assert.equal(failed.failed, 2);
      const recovered = await weekly.runWeeklyReportBatch({
        dryRun: false,
        generate: async () => ({ _id: 'stub-report' }),
        sendEmail: async () => ({ sent: true }),
      });
      assert.equal(recovered.generated, 3);
      const completed = await weekly.runWeeklyReportBatch({
        dryRun: false,
        generate: async () => {
          throw Error('completed scheduler must not replay');
        },
      });
      assert.equal(completed.usersScanned, 0);
    } finally {
      if (oldLimit === undefined) delete process.env.WEEKLY_REPORT_BATCH_LIMIT;
      else process.env.WEEKLY_REPORT_BATCH_LIMIT = oldLimit;
    }
    await User.updateOne({ _id: userId }, { $set: { 'notifications.weeklyScoreReport': true } });
    await Report.updateOne({ _id: id }, { $set: { 'emailDelivery.status': 'pending' } });
    await assert.rejects(
      deliver({ _id: id }, null, async () => {
        throw Error('unknown provider outcome');
      }),
    );
    assert.equal((await Report.findById(id).lean()).emailDelivery.status, 'uncertain');
    assert.equal(
      (
        await deliver({ _id: id }, null, async () => {
          sends++;
        })
      ).sent,
      false,
    );
    assert.equal(sends, 1);
    const controller = require('../controllers/weeklyReportController');
    let exposed;
    await controller.getLatestReport(
      { user: { _id: new mongoose.Types.ObjectId() } },
      {
        json: (value) => {
          exposed = value;
        },
      },
    );
    assert.equal(exposed, null);
    const output = path.join(__dirname, '../../verification/weekly-reports/finalization');
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(
      path.join(output, 'mongo-results.json'),
      JSON.stringify(
        {
          passed: true,
          generationMs,
          forcedReplayMs: replayMs,
          environment: 'disposable local Windows MongoDB replica set',
          realProvidersUsed: false,
          assertions: [
            'independent-client lease exclusion',
            'real child-process crash takeover',
            'expired-token fencing',
            'same-week deterministic replay',
            'AI deterministic fallback',
            'ninth-source persistence',
            'owner-scoped latest',
            'scheduler keyset pagination',
            'notification preference suppression',
            'one concurrent email send',
            'uncertain outcome blocks resend',
          ],
        },
        null,
        2,
      ),
    );
  },
);
