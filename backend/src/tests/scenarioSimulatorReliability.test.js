'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const cache = require('../services/redisCacheService');
const { limits } = require('../middleware/scenarioSimulatorMiddleware');
const response = () => ({
  code: 200,
  headers: {},
  set(key, value) {
    this.headers[key] = value;
    return this;
  },
  status(code) {
    this.code = code;
    return this;
  },
  json(value) {
    this.body = value;
    return this;
  },
});
test('production persistence fails closed until required indexes are verified', async (t) => {
  const prior = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  t.after(() => {
    if (prior === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prior;
  });
  const Scenario = require('../models/scenarioSimulation');
  const { requireIndexes } = require('../services/scenarioSimulatorService').__test;
  let calls = 0;
  t.mock.method(Scenario.collection, 'indexes', async () => {
    calls++;
    return calls === 1
      ? []
      : [
          { unique: true, key: { userId: 1, scenarioHash: 1 } },
          { key: { userId: 1, createdAt: -1, _id: -1 } },
        ];
  });
  await assert.rejects(requireIndexes(), (error) => error.statusCode === 503);
  await requireIndexes();
  await requireIndexes();
  assert.equal(calls, 2);
});
test('shared quota uses atomic counters, safe owner keys and bounded rejection', async (t) => {
  let count = 0;
  const keys = [];
  t.mock.method(cache, 'getRedisCacheClient', () => ({
    eval: async (_script, options) => {
      keys.push(options.keys[0]);
      return ++count;
    },
  }));
  let admitted = 0;
  let denied = 0;
  for (let index = 0; index < 65; index++) {
    const res = response();
    await limits.evaluate({ user: { _id: 'private-fixture-owner' } }, res, () => admitted++);
    if (res.code === 429) {
      denied++;
      assert.equal(res.headers['Retry-After'], '60');
    }
  }
  assert.equal(admitted, 60);
  assert.equal(denied, 5);
  assert(keys.every((key) => !key.includes('private-fixture-owner')));
});
test('production shared quota outage fails closed rather than multiplying local quotas', async (t) => {
  const nodeEnv = process.env.NODE_ENV;
  const mode = process.env.SCENARIO_LIMIT_MODE;
  t.after(() => {
    if (nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = nodeEnv;
    if (mode === undefined) delete process.env.SCENARIO_LIMIT_MODE;
    else process.env.SCENARIO_LIMIT_MODE = mode;
  });
  process.env.NODE_ENV = 'production';
  delete process.env.SCENARIO_LIMIT_MODE;
  t.mock.method(cache, 'getRedisCacheClient', () => null);
  const res = response();
  let admitted = false;
  await limits.evaluate({ user: { _id: 'fixture' } }, res, () => {
    admitted = true;
  });
  assert.equal(admitted, false);
  assert.equal(res.code, 503);
  assert.equal(res.headers['Retry-After'], '2');
});
