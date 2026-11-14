'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const filename = require.resolve('../services/aiservice');
const shared = new Map();
require.cache[filename] = {
  id: filename,
  filename,
  loaded: true,
  exports: {
    getSharedCache: async (key) => shared.get(key) || null,
    setSharedCache: async (key, value, ttl, namespace) => {
      assert.equal(ttl, 120);
      assert.equal(namespace, 'career_sprint:overview-v4');
      shared.set(key, value);
    }
  }
};
const cache = require('../services/sprintOverviewCacheService');
const snapshot = (id, revision = 0) => ({
  _id: id,
  userId: 'owner',
  __v: revision,
  calendarPolicy: 'sprint-calendar-48h-v1',
  timeZone: 'UTC',
  tasks: []
});
const counters = () => ({ memoryHits: 0, redisHits: 0, redisWrites: 0, pipelineExecutions: 0 });

test.beforeEach(() => {
  cache.clear();
  shared.clear();
});

test('500-entry LRU retains a recently read snapshot and evicts the least recently read snapshot', async () => {
  const counts = counters();
  const load = (id) => cache.load(snapshot(id), null, async () => snapshot(id), counts);
  for (let index = 0; index < 500; index++) await load(String(index));
  await load('0');
  await load('500');
  shared.clear();
  const builds = counts.pipelineExecutions;
  await load('0');
  assert.equal(counts.pipelineExecutions, builds, 'Reading an entry must refresh its LRU position.');
  await load('1');
  assert.equal(counts.pipelineExecutions, builds + 1, 'The least recently used entry must be evicted.');
});

test('memory hits preserve the original 60-second expiry rather than extending the TTL', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-07T12:00Z') });
  const counts = counters();
  const sprint = snapshot('ttl');
  const load = () => cache.load(sprint, null, async () => sprint, counts);
  await load();
  shared.clear();
  t.mock.timers.tick(59000);
  await load();
  assert.equal(counts.pipelineExecutions, 1);
  t.mock.timers.tick(1000);
  await load();
  assert.equal(counts.pipelineExecutions, 2);
});

test('concurrent identical snapshots share a build and return independent values', async () => {
  const counts = counters();
  const sprint = snapshot('dedupe');
  let finish;
  const build = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const first = cache.load(sprint, null, build, counts);
  const second = cache.load(sprint, null, build, counts);
  await new Promise(setImmediate);
  finish(sprint);
  const values = await Promise.all([first, second]);
  assert.equal(counts.pipelineExecutions, 1);
  values[0].tasks.push({ title: 'Client edit' });
  assert.deepEqual(values[1].tasks, []);
});

test('a late old revision cannot replace the current revision after invalidation', async () => {
  const counts = counters();
  const old = snapshot('revision');
  const current = snapshot('revision', 1);
  let finish;
  const pending = cache.load(
    old,
    null,
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
    counts
  );
  await new Promise(setImmediate);
  cache.invalidate('owner');
  await cache.load(current, null, async () => current, counts);
  finish(old);
  await pending;
  cache.clear();
  const result = await cache.load(
    current,
    null,
    async () => assert.fail('Current Redis revision must survive.'),
    counts
  );
  assert.equal(result.__v, 1);
});

test('Redis rejection falls back to a fresh build', async (t) => {
  t.mock.method(require.cache[filename].exports, 'getSharedCache', async () => {
    throw new Error('Redis unavailable');
  });
  const sprint = snapshot('offline');
  const result = await cache.load(sprint, null, async () => sprint, counters());
  assert.equal(result._id, 'offline');
});

test('a stalled Redis read cannot hold overview generation beyond its 120ms budget', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(require.cache[filename].exports, 'getSharedCache', () => new Promise(() => {}));
  const sprint = snapshot('slow');
  const pending = cache.load(sprint, null, async () => sprint, counters());
  t.mock.timers.tick(120);
  assert.equal((await pending)._id, 'slow');
});
