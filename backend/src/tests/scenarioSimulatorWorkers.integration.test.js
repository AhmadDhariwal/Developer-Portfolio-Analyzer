'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { fork } = require('node:child_process');
const path = require('node:path');
const fixture = require('./fixtures/scenarioMongo');
const Scenario = require('../models/scenarioSimulation');
const Sprint = require('../models/careerSprint');
const { sprintWindow } = require('../utils/sprintCalendar');
const engine = require('../services/scoring/scenarioPlanningScore');
const worker = (uri) =>
  new Promise((resolve, reject) => {
    const process = fork(path.join(__dirname, 'fixtures/scenarioWorker.js'), [], {
      env: { ...global.process.env, NODE_ENV: 'test', SCENARIO_TEST_URI: uri },
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    });
    process.stderr.on('data', () => {});
    process.once('error', reject);
    let next = 0;
    const pending = new Map();
    const request = (action, body = {}) =>
      new Promise((done, fail) => {
        const id = ++next;
        const timer = setTimeout(() => {
          pending.delete(id);
          fail(Error('Worker request timed out.'));
        }, 15000);
        pending.set(id, (result) => {
          clearTimeout(timer);
          result.error ? fail(Object.assign(Error(result.error.message), result.error)) : done(result.value);
        });
        process.send({ id, action, ...body });
      });
    process.on('message', (message) => {
      if ('ready' in message) {
        if (message.ready) resolve({ request, process });
        else reject(Error(message.error));
      } else {
        pending.get(message.id)?.(message);
        pending.delete(message.id);
      }
    });
  });
test('P3 two real workers: atomic saves, export receipts, fresh history and restart', async (t) => {
  const mongo = await fixture.start();
  const workers = [];
  t.after(async () => {
    for (const item of workers) {
      if (item.process.connected) await item.request('stop');
    }
    await mongoose.disconnect();
    await mongo.stop();
  });
  await mongoose.connect(mongo.uri);
  await Promise.all([Scenario.init(), Sprint.init()]);
  workers.push(...(await Promise.all([worker(mongo.uri), worker(mongo.uri)])));
  const owner = new mongoose.Types.ObjectId();
  const input = {
    ruleVersion: engine.RULE_VERSION,
    baselineHiringScore: 40,
    baselineJobMatch: 35,
    baselineAuthority: 'user-assumption',
    baselineConfirmed: true,
    role: 'frontend',
    experienceLevel: 'mid',
    durationWeeks: 6,
    skills: ['React'],
    projects: [],
  };
  const payload = { ...input, evaluation: engine.calculate(input).evaluation };
  const saved = await Promise.all(
    Array.from({ length: 100 }, (_, index) =>
      workers[index % 2].request('save', { owner: String(owner), payload }),
    ),
  );
  assert.equal(new Set(saved.map((item) => item.id)).size, 1);
  assert.equal(await Scenario.countDocuments({ userId: owner }), 1);
  const window = sprintWindow('Asia/Karachi', '2026-10-26', '2026-11-01');
  const sprint = await Sprint.create({
    userId: owner,
    ...window,
    weekStartDate: window.sprintStartDate,
    weekEndDate: window.sprintEndDate,
  });
  const scenario = await Scenario.findById(saved[0].id).lean();
  const exports = await Promise.all(
    Array.from({ length: 50 }, (_, index) =>
      workers[index % 2].request('export', { owner: String(owner), sprintId: String(sprint._id), scenario }),
    ),
  );
  assert.equal(exports.filter((item) => !item.replayed).length, 1);
  const persisted = await Sprint.findById(sprint._id);
  assert.equal(persisted.tasks.length, 1);
  assert.equal(persisted.scenarioReceipts.length, 1);
  await workers[0].request('stop');
  workers[0] = await worker(mongo.uri);
  assert(
    (await workers[0].request('export', { owner: String(owner), sprintId: String(sprint._id), scenario }))
      .replayed,
  );
  assert.equal((await workers[0].request('history', { owner: String(owner) })).history.length, 1);
});
