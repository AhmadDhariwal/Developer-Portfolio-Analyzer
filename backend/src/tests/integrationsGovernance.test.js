'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const cache = require('../services/redisCacheService');
const governance = require('../services/integrationGovernanceService');

test('shared integration controls tolerate the measured Upstash RTT and still admit every operation', async (t) => {
  const original = cache.getRedisCacheClient;
  let admissions = 0;
  cache.getRedisCacheClient = ({ commandTimeoutMs = 150 } = {}) => ({
    eval: () =>
      new Promise((resolve, reject) => {
        const deadline = setTimeout(
          () => reject(Error('Redis command timed out.')),
          commandTimeoutMs
        );
        setTimeout(() => {
          clearTimeout(deadline);
          admissions += 1;
          resolve(1);
        }, 180);
      }),
    zRem: async () => 1
  });
  t.after(() => {
    cache.getRedisCacheClient = original;
  });
  let outbound = 0;
  await governance.withJob('fixture', () =>
    governance.run('isolated-owner', () =>
      governance.request('fixture', async () => {
        outbound += 1;
        return { data: {} };
      })
    )
  );
  let next = 0;
  const response = { set() {} };
  await governance.actionLimit('fixture')({ user: { _id: 'isolated-owner' } }, response, () => {
    next += 1;
  });
  assert.equal(admissions, 3);
  assert.equal(outbound, 1);
  assert.equal(next, 1);
});

test('a control-store failure still blocks outbound work with 503', async (t) => {
  const original = cache.getRedisCacheClient;
  cache.getRedisCacheClient = () => ({
    eval: async () => {
      throw Error('unavailable');
    }
  });
  t.after(() => {
    cache.getRedisCacheClient = original;
  });
  let outbound = 0;
  await assert.rejects(
    governance.run('isolated-owner', () =>
      governance.request('fixture', async () => {
        outbound += 1;
      })
    ),
    { status: 503 }
  );
  assert.equal(outbound, 0);
});
