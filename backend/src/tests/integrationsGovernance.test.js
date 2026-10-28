'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const cache = require('../services/redisCacheService');
const mongo = require('../services/integrationMongoGovernanceService');
const governance = require('../services/integrationGovernanceService');

test('provider HTTP 429 retains quota status and Retry-After', async (t) => {
  t.mock.method(mongo, 'admit', async () => ({ store: 'mongo', provider: 'fixture' }));
  t.mock.method(mongo, 'release', async () => {});
  t.mock.method(mongo, 'failure', async () => {});
  await assert.rejects(
    governance.run('fixture-owner', () =>
      governance.request('fixture', async () => {
        throw Object.assign(Error('provider quota'), {
          response: { status: 429, headers: { 'retry-after': '120' } }
        });
      })
    ),
    { status: 429, retryAfter: 120 }
  );
});

test('integration boundaries always use Mongo, even with legacy Redis selection', async (t) => {
  const previous = process.env.INTEGRATION_GOVERNANCE_STORE;
  process.env.INTEGRATION_GOVERNANCE_STORE = 'redis';
  t.after(() => {
    if (previous === undefined) delete process.env.INTEGRATION_GOVERNANCE_STORE;
    else process.env.INTEGRATION_GOVERNANCE_STORE = previous;
  });
  t.mock.method(cache, 'getRedisCacheClient', () => assert.fail('Cache cannot admit integrations'));
  let admissions = 0,
    releases = 0,
    actions = 0;
  t.mock.method(mongo, 'admit', async (_provider, _owner, _duration, policy) => {
    assert.equal(policy.global, 8);
    assert.equal(policy.provider, 2);
    admissions++;
    return { store: 'mongo', provider: 'fixture' };
  });
  t.mock.method(mongo, 'release', async () => releases++);
  t.mock.method(mongo, 'action', async () => ++actions);
  let outbound = 0;
  await governance.withJob('fixture', () =>
    governance.run('fixture-owner', () =>
      governance.request('fixture', async () => {
        outbound++;
        return { data: {} };
      })
    )
  );
  let next = 0;
  await governance.actionLimit('fixture')(
    { user: { _id: 'fixture-owner' } },
    { set() {} },
    () => next++
  );
  assert.equal(admissions, 2);
  assert.equal(releases, 2);
  assert.equal(actions, 1);
  assert.equal(outbound, 1);
  assert.equal(next, 1);
});

test('Mongo admission failure blocks outbound work and route admission with 503', async (t) => {
  const unavailable = () => {
    throw Object.assign(Error('Unavailable'), { status: 503 });
  };
  t.mock.method(mongo, 'admit', unavailable);
  t.mock.method(mongo, 'action', unavailable);
  let outbound = 0;
  await assert.rejects(
    governance.run('fixture-owner', () => governance.request('fixture', async () => outbound++)),
    { status: 503 }
  );
  assert.equal(outbound, 0);
  const response = {
    code: 200,
    status(code) {
      this.code = code;
      return this;
    },
    json() {}
  };
  await governance.actionLimit('fixture')({ user: { _id: 'fixture-owner' } }, response, () =>
    assert.fail('Must fail closed')
  );
  assert.equal(response.code, 503);
});
