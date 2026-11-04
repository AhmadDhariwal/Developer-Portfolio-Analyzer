'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { fork } = require('node:child_process');
const path = require('node:path');
const mongoose = require('mongoose');
const controls = require('../services/recommendationGovernanceService');
const { admit } = require('../middleware/recommendationAdmission');
function response() {
  const res = new EventEmitter();
  res.statusCode = 200;
  res.headers = {};
  res.set = (key, value) => {
    res.headers[key] = value;
    return res;
  };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body) => {
    res.body = body;
    return res;
  };
  return res;
}

test('admission rejects oversized inputs before charging, and sanitizes 429/503 with Retry-After', async (t) => {
  const original = controls.consume;
  t.after(() => {
    controls.consume = original;
  });
  let calls = 0;
  controls.consume = async () => {
    calls++;
    throw controls.failure(429, 17);
  };
  const oversized = response();
  await admit(true)(
    { body: { isTemporary: true, resumeText: 'x'.repeat(12001) }, ip: 'fixture' },
    oversized,
    () => assert.fail('must reject')
  );
  assert.equal(oversized.statusCode, 413);
  assert.equal(calls, 0);
  const limited = response();
  await admit(true)({ body: { isTemporary: true }, ip: 'fixture' }, limited, () =>
    assert.fail('must reject')
  );
  assert.equal(limited.statusCode, 429);
  assert.equal(limited.headers['Retry-After'], '17');
  controls.consume = async () => {
    throw Error('private database detail');
  };
  const outage = response();
  await admit(true)({ body: { isTemporary: true }, ip: 'fixture' }, outage, () =>
    assert.fail('must reject')
  );
  assert.equal(outage.statusCode, 503);
  assert.doesNotMatch(outage.body.message, /private|database/);
});

test('disconnected work is cancelled and a joined refresh becomes a passive compatible read', async (t) => {
  const original = {
    consume: controls.consume,
    acquire: controls.acquire,
    release: controls.release,
  };
  t.after(() => Object.assign(controls, original));
  controls.consume = async () => {};
  controls.acquire = async () => ({ joined: true });
  controls.release = async () => {};
  const req = { user: { _id: 'fixture' }, ip: 'fixture', body: { forceRefresh: true } };
  const res = response();
  await admit(true)(req, res, () => {});
  assert.equal(req.body.forceRefresh, false);
  res.emit('close');
  assert.equal(req.recommendationGovernance.signal.aborted, true);
  req.releaseRecommendationReservation();
});

test('real disposable Mongo: multi-process budgets, leases, expired fencing and history indexes', async (t) => {
  const { startMongo } = require('./fixtures/disposableRequestMongo');
  const mongo = await startMongo();
  t.after(async () => {
    await mongoose.disconnect();
    await mongo.stop();
  });
  await mongoose.connect(mongo.uri);
  const State = require('../models/integrationGovernanceState');
  await controls.consume('bootstrap', 'bootstrap', ['read']);
  const statuses = await Promise.all(
    Array.from(
      { length: 3 },
      () =>
        new Promise((resolve, reject) => {
          const worker = fork(
            path.join(__dirname, 'fixtures/recommendationGovernanceWorker.js'),
            [],
            { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] }
          );
          let result;
          worker.once('error', reject);
          worker.once('message', (value) => {
            result = value;
          });
          worker.once('exit', (code) =>
            code === 0 && result?.statuses
              ? resolve(result.statuses)
              : reject(Error('Quota worker failed'))
          );
          worker.send({ uri: mongo.uri, owner: 'guest:shared', ip: 'shared' });
        })
    )
  );
  assert.equal(statuses.flat().filter((status) => status === 200).length, 5);
  assert.equal(statuses.flat().filter((status) => status === 429).length, 1);
  const old = await controls.acquire('lease-owner');
  const waiting = controls.acquire('lease-owner');
  await new Promise((resolve) => setTimeout(resolve, 150));
  await controls.release(old);
  const current = await waiting;
  assert.equal(current.joined, true);
  await assert.rejects(
    controls.transaction((session) => controls.fence(old, session)),
    { status: 503 }
  );
  await controls.transaction((session) => controls.fence(current, session));
  await State.collection.updateOne(
    { _id: current.keys[1] },
    { $set: { 'leases.0.until': new Date(0) } }
  );
  await assert.rejects(
    controls.transaction((session) => controls.fence(current, session)),
    { status: 503 }
  );
  await controls.release(current);
  const recovered = await controls.acquire('lease-owner');
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(
    controls.transaction((session) => controls.fence(recovered, session, abort.signal)),
    { status: 503 }
  );
  await controls.release(recovered);
  const Recommendation = require('../models/recommendation');
  await Recommendation.createIndexes();
  const owner = new mongoose.Types.ObjectId();
  await Recommendation.collection.insertMany(
    Array.from({ length: 1000 }, (_, i) => ({
      userId: owner,
      title: `Synthetic ${i}`,
      createdAt: new Date(i),
      careerStack: 'Backend',
      experienceLevel: 'Intern',
    }))
  );
  const plan = await Recommendation.find({
    userId: owner,
    careerStack: 'Backend',
    experienceLevel: 'Intern',
  })
    .sort({ createdAt: -1 })
    .limit(20)
    .explain('executionStats');
  assert.equal(plan.executionStats.nReturned, 20);
  assert.ok(plan.executionStats.totalDocsExamined <= 20);
  assert.ok(plan.executionStats.totalKeysExamined <= 20);
  t.diagnostic(
    JSON.stringify({
      multiProcessRequests: 6,
      admitted: 5,
      limited: 1,
      historyRows: 1000,
      returned: 20,
      keysExamined: plan.executionStats.totalKeysExamined,
      docsExamined: plan.executionStats.totalDocsExamined,
    })
  );
});
