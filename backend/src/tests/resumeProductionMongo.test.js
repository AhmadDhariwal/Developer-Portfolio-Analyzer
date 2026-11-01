const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fork } = require('node:child_process');
const mongoose = require('mongoose');
const { startMongo } = require('./fixtures/disposableRequestMongo');
const root = path.resolve(__dirname, '../../verification/resume');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function worker(uri) {
  const child = fork(path.join(__dirname, 'fixtures/resumeWorker.js'), [], {
    env: {
      ...process.env,
      RESUME_TEST_URI: uri,
      NODE_ENV: 'test',
      AI_ENABLED: 'false',
      REDIS_ENABLED: 'false'
    },
    windowsHide: true,
    execArgv: [],
    stdio: ['ignore', 'pipe', 'pipe', 'ipc']
  });
  let logs = '';
  for (const stream of [child.stdout, child.stderr])
    stream.on('data', (chunk) => {
      logs = (logs + chunk).slice(-4000);
    });
  const ready = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(Error('Worker startup deadline: ' + logs));
    }, 30000);
    child.once('message', (message) => {
      clearTimeout(timer);
      message.error ? reject(Error(message.error)) : resolve(message);
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(Error(`Worker exited ${code}: ${logs}`));
    });
  });
  return { child, base: `http://127.0.0.1:${ready.port}` };
}
test(
  'two workers: one logical analysis, owner isolation, Redis outage, quotas, lease recovery and exact index',
  { timeout: 120000 },
  async (t) => {
    fs.mkdirSync(root, { recursive: true });
    const mongo = await startMongo({ replicaSet: 'resume-acceptance', temporaryRoot: root });
    const workers = [];
    t.after(async () => {
      for (const { child } of workers) {
        const done = new Promise((resolve) => child.once('exit', resolve));
        child.send('stop');
        await Promise.race([done, delay(5000)]);
        if (child.exitCode === null) child.kill();
      }
      await mongoose.disconnect();
      await mongo.stop();
    });
    await mongoose.connect(mongo.uri, { autoIndex: false, serverSelectionTimeoutMS: 2000 });
    const User = require('../models/user'),
      File = require('../models/resumeFile'),
      Analysis = require('../models/resumeAnalysis'),
      Cache = require('../models/resumeAnalysisCache');
    const Notification = require('../models/notification');
    for (const model of [
      User,
      File,
      Analysis,
      Cache,
      Notification,
      require('../models/notificationState')
    ])
      await model.createCollection();
    await Cache.createIndexes();
    await Notification.createIndexes();
    const owner = new mongoose.Types.ObjectId(),
      other = new mongoose.Types.ObjectId();
    await User.collection.insertMany([
      {
        _id: owner,
        name: 'Synthetic Owner',
        email: 'owner@example.invalid',
        isActive: true,
        sessionRevision: 0
      },
      {
        _id: other,
        name: 'Synthetic Other',
        email: 'other@example.invalid',
        isActive: true,
        sessionRevision: 0
      }
    ]);
    const file = await File.create({
      userId: owner,
      fileName: 'synthetic.pdf',
      fileUrl: path.resolve(__dirname, 'fixtures/resume/standard.pdf'),
      fileSize: fs.statSync(path.join(__dirname, 'fixtures/resume/standard.pdf')).size
    });
    await User.collection.updateOne({ _id: owner }, { $set: { activeResumeFileId: file._id } });
    workers.push(await worker(mongo.uri), await worker(mongo.uri));
    const request = async (workerIndex, userId, route, body = {}) => {
      const response = await fetch(workers[workerIndex].base + route, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-fixture-user': String(userId) },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(45000)
      });
      return {
        status: response.status,
        body: await response.json(),
        retry: response.headers.get('retry-after')
      };
    };
    const started = performance.now();
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        request(i % 2, owner, '/analyze', { fileId: String(file._id), forceRefresh: i > 0 })
      )
    );
    assert.ok(
      results.every((x) => x.status === 200),
      JSON.stringify(results.map(({ status, body }) => ({ status, message: body.message })))
    );
    assert.equal(await Analysis.countDocuments({ userId: owner, fileId: file._id }), 1);
    assert.equal(await Cache.countDocuments({ userId: owner, resumeFileId: file._id }), 1);
    assert.equal(
      (await mongoose.connection.db.collection('fixture_metrics').findOne({ _id: 'ai' })).count,
      1
    );
    const parses = (
      await mongoose.connection.db.collection('fixture_metrics').findOne({ _id: 'parse' })
    ).count;
    assert.equal(parses, 1);
    const denied = await request(1, other, '/analyze', { fileId: String(file._id) });
    assert.equal(denied.status, 403);
    assert.equal(await Analysis.countDocuments({ userId: other }), 0);
    const state = await User.findById(owner).lean();
    assert.equal(String(state.activeResumeFileId), String(file._id));
    const analysisNotifications = await Notification.countDocuments({
      userId: owner,
      type: 'resume_upload'
    });
    assert.equal(analysisNotifications, 1);
    const guide = [];
    for (let i = 0; i < 6; i++) guide.push(await request(i % 2, other, '/budget/guide'));
    assert.deepEqual(
      guide.map((x) => x.status),
      [200, 200, 200, 200, 200, 429]
    );
    assert.ok(Number(guide.at(-1).retry) > 0);
    const governance = require('../services/integrationMongoGovernanceService');
    for (const id of [owner, other, owner])
      await governance.resumeWindow(id, 'synthetic-shared-ip', 'guide', [10, 3]);
    await assert.rejects(governance.resumeWindow(other, 'synthetic-shared-ip', 'guide', [10, 3]), {
      status: 429
    });
    const reservation = await governance.resumeLease(owner, 'recovery');
    await assert.rejects(governance.resumeLease(owner, 'recovery'), { status: 429 });
    await require('../models/integrationGovernanceState').collection.updateMany(
      { _id: { $in: reservation.keys } },
      { $set: { 'leases.$[].until': new Date(0), expiresAt: new Date(0) } }
    );
    const recovered = await governance.resumeLease(owner, 'recovery');
    await assert.rejects(governance.resumeLease(owner, 'recovery', reservation), { status: 503 });
    await governance.release(recovered);
    const cached = await Cache.findOne({ userId: owner, resumeFileId: file._id }).lean();
    const explain = await Cache.collection
      .find({
        userId: owner,
        resumeFileId: file._id,
        resumeHash: cached.resumeHash,
        analysisVersion: cached.analysisVersion
      })
      .explain('executionStats');
    assert.ok(JSON.stringify(explain.queryPlanner.winningPlan).includes('IXSCAN'));
    const evidence = {
      workers: 2,
      concurrentRequests: 5,
      durableAnalyses: 1,
      cacheRecords: 1,
      aiCalls: 1,
      pdfParses: parses,
      notifications: analysisNotifications,
      redis: 'unavailable',
      crossOwnerStatus: denied.status,
      guideStatuses: guide.map((x) => x.status),
      milliseconds: Math.round(performance.now() - started),
      totalKeysExamined: explain.executionStats.totalKeysExamined,
      totalDocsExamined: explain.executionStats.totalDocsExamined
    };
    fs.writeFileSync(path.join(root, 'mongo-acceptance.json'), JSON.stringify(evidence, null, 2));
  }
);
