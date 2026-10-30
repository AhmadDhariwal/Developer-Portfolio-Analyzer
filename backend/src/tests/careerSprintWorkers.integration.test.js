'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { fork } = require('node:child_process');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
const User = require('../models/user');
const Sprint = require('../models/careerSprint');
const Schedule = require('../models/sprintSchedule');
const Preference = require('../models/sprintPreference');
const { sprintWindow } = require('../utils/sprintCalendar');

const startWorker = (owner) =>
  new Promise((resolve, reject) => {
    const process = fork(path.join(__dirname, 'fixtures/careerSprintWorker.js'), [], {
      env: { ...global.process.env, CAREER_SPRINT_TEST_OWNER: String(owner) },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      windowsHide: true
    });
    const pending = new Map();
    let sequence = 0;
    const timer = setTimeout(() => {
      process.kill();
      reject(new Error('Worker initialization timed out.'));
    }, 12000);
    const request = (action, params = {}) =>
      new Promise((done, fail) => {
        const id = ++sequence;
        const timeout = setTimeout(() => {
          pending.delete(id);
          fail(new Error('Worker request timed out.'));
        }, 12000);
        pending.set(id, (message) => {
          clearTimeout(timeout);
          done(message);
        });
        process.send({ id, action, ...params });
      });
    process.on('message', (message) => {
      if ('ready' in message) {
        clearTimeout(timer);
        if (message.ready) resolve({ process, request, redis: message.redis });
        else
          reject(
            new Error(`Worker initialization failed: ${message.errorType} ${JSON.stringify(message.codes)}`)
          );
      } else {
        pending.get(message.id)?.(message);
        pending.delete(message.id);
      }
    });
    process.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });

test('two real processes: fresh Mongo revisions, stale Redis writes, restart, fallback and concurrent windows', async (t) => {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 5000
  });
  const owner = new mongoose.Types.ObjectId();
  const workers = [];
  t.after(async () => {
    const cleanupErrors = [];
    for (const worker of workers)
      if (worker.process.connected) {
        try {
          const stopped = await worker.request('stop', { cleanup: true });
          assert.equal(stopped.error, undefined, stopped.error?.message);
        } catch (error) {
          worker.process.kill();
          cleanupErrors.push(error.message);
        }
      }
    await Promise.all([
      User.deleteOne({ _id: owner }),
      Sprint.deleteMany({ userId: owner }),
      Schedule.deleteOne({ _id: owner }),
      Preference.deleteOne({ _id: owner })
    ]);
    await mongoose.disconnect();
    assert.deepEqual(cleanupErrors, [], 'Every worker must acknowledge successful fixture cleanup.');
  });
  await User.create({
    _id: owner,
    name: 'Two-process Sprint fixture',
    email: `${owner}@sprint.test`,
    password: 'fixture'
  });
  await Sprint.init();
  const window = sprintWindow('UTC');
  const record = await Sprint.create({
    userId: owner,
    ...window,
    weekStartDate: window.sprintStartDate,
    weekEndDate: window.sprintEndDate,
    tasks: [{ title: 'Build owned API', category: 'project', priority: 'high', points: 5 }]
  });
  const a = await startWorker(owner);
  workers.push(a);
  const b = await startWorker(owner);
  workers.push(b);
  t.diagnostic(
    `Actual Redis available in both processes: ${a.redis && b.redis}. ${a.redis && b.redis ? 'Redis consistency exercised.' : 'Database-authoritative fallback exercised; live Redis consistency remains unverified.'}`
  );
  const initial = await b.request('read');
  assert.equal(initial.value.xpPoints, 0);
  await b.request('hold');
  assert.equal((await b.request('read', { forceRefresh: true })).value.xpPoints, 0);
  const complete = await a.request('complete', {
    sprintId: String(record._id),
    taskId: String(record.tasks[0]._id)
  });
  assert.equal(complete.value.xpPoints, 20);
  await b.request('release');
  assert.equal((await b.request('read')).value.xpPoints, 20);
  await b.request('stop');
  const restarted = await startWorker(owner);
  workers.push(restarted);
  assert.equal((await restarted.request('read')).value.xpPoints, 20);
  await restarted.request('offline');
  assert.equal((await restarted.request('read', { forceRefresh: true })).value.xpPoints, 20);
  assert.equal((await restarted.request('read')).value.tasks[0].isCompleted, true);
  const from = new Date();
  from.setUTCDate(from.getUTCDate() + 30);
  const day = (offset) => {
    const d = new Date(from);
    d.setUTCDate(d.getUTCDate() + offset);
    return d.toISOString().slice(0, 10);
  };
  const created = await Promise.all([
    a.request('create', { payload: { sprintStartDate: day(0), sprintEndDate: day(4) } }),
    restarted.request('create', { payload: { sprintStartDate: day(2), sprintEndDate: day(6) } })
  ]);
  assert.equal(created.filter((result) => result.value?._id).length, 1);
  assert.equal(created.find((result) => result.error)?.error.statusCode, 409);
  assert.equal(await Sprint.countDocuments({ userId: owner }), 2);
  assert.equal((await Sprint.findById(record._id).lean()).xpPoints, 20);
  assert.equal((await a.request('read')).value.xpPoints, 20);
  await a.request('databaseOffline');
  assert.equal(
    (await a.request('read')).error?.statusCode,
    500,
    'Mongo failure must not return a previously cached authoritative snapshot.'
  );
});
