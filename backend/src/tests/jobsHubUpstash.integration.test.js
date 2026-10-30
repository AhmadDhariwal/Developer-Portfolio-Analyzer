const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { fork } = require('node:child_process');
const { once } = require('node:events');
const { fixture, load } = require('./fixtures/jobsHubRedisFixture');

test(
  'isolated Upstash Redis TLS validates Jobs Hub integration',
  {
    skip: !process.env.JOBS_TEST_REDIS_URL && 'Dedicated disposable Upstash test database required',
    timeout: 120000
  },
  async (t) => {
    const setup = await fixture(t);
    const one = await setup.worker();
    const two = await setup.worker();
    const governor = (worker) =>
      load('../services/jobGovernanceService.js', { './redisCacheService': worker.cache });
    const a = governor(one);
    const b = governor(two);

    await t.test(
      'Lua admission is atomic across clients; counters and slots have correct TTLs',
      async () => {
        const result = await Promise.all(
          Array.from({ length: 30 }, (_, index) => (index % 2 ? a : b).reserve('arbeitnow'))
        );
        assert.equal(result.filter((entry) => entry.allowed).length, 1);
        const reservation = result.find((entry) => entry.allowed);
        const base = reservation.base;
        const date = new Date().toISOString();
        for (const [name, maximum] of [
          [`${base}:active`, 31000],
          [`${base}:interval`, 3600000],
          [`${base}:day:${date.slice(0, 10)}`, 86400000],
          [`${base}:month:${date.slice(0, 7)}`, 32 * 86400000]
        ]) {
          const ttl = await one.redis.pTTL(name);
          assert.ok(ttl > 0 && ttl <= maximum, 'Quota keys must expire within the intended window');
        }
        await a.finish(reservation);
        assert.equal((await b.health()).arbeitnow.dailyUsed, 1);
        await one.redis.del(`${base}:interval`);
        const active = await b.reserve('arbeitnow');
        assert.equal(active.allowed, true);
        await one.redis.del(`${base}:interval`);
        assert.equal((await a.reserve('arbeitnow')).reason, 'concurrency');
        await b.finish(active);
        await one.redis.set(`${base}:day:${date.slice(0, 10)}`, '24');
        assert.equal((await a.reserve('arbeitnow')).reason, 'daily_budget');
        await one.redis.set(`${base}:day:${date.slice(0, 10)}`, '0');
        await one.redis.set(`${base}:month:${date.slice(0, 7)}`, '1000');
        assert.equal((await b.reserve('arbeitnow')).reason, 'monthly_budget');
      }
    );

    await t.test(
      '429 Retry-After cooldown persists across clients and cannot be shortened',
      async () => {
        const reservation = await a.reserve('remoteok');
        assert.equal(reservation.allowed, true);
        await a.finish(reservation, {
          status: 429,
          headers: { 'retry-after': '120' },
          failed: true
        });
        const cooldown = `${reservation.base}:cooldown`;
        const firstTtl = await two.redis.pTTL(cooldown);
        assert.ok(firstTtl > 110000 && firstTtl <= 120000);
        await b.finish(reservation, {
          status: 429,
          headers: { 'retry-after': '30' },
          failed: true
        });
        assert.ok((await one.redis.pTTL(cooldown)) > 100000);
        await one.redis.del(`${reservation.base}:interval`);
        assert.equal((await governor(two).reserve('remoteok')).reason, 'cooldown');
        assert.equal((await b.health()).remoteok.coolingDown, true);
        await b.finish(reservation, {
          status: 429,
          headers: { 'retry-after': new Date(Date.now() + 180000).toUTCString() },
          failed: true
        });
        const dateTtl = await one.redis.pTTL(cooldown);
        assert.ok(dateTtl > 170000 && dateTtl <= 180000);
        await a.finish(reservation, {
          status: 200,
          headers: { 'x-ratelimit-remaining': '0', 'retry-after': '60' }
        });
        assert.ok((await two.redis.pTTL(cooldown)) > 160000);
      }
    );

    await t.test('three real failed-attempt records open a distributed circuit', async () => {
      for (let index = 0; index < 3; index++) {
        const actor = index % 2 ? a : b;
        const reservation = await actor.reserve('remotive');
        assert.equal(reservation.allowed, true);
        await actor.finish(reservation, { status: 500, failed: true });
        await one.redis.del(`${reservation.base}:interval`);
      }
      assert.equal((await governor(two).reserve('remotive')).reason, 'cooldown');
      const ttl = await one.redis.pTTL('jobs:v2:{remotive}:cooldown');
      assert.ok(ttl > 290000 && ttl <= 300000);
    });

    await t.test(
      'worker leases compare ownership and prevent duplicate work across processes',
      async () => {
        await a.withLease('owner-check', 5, async () =>
          one.redis.set('jobs:v2:lease:owner-check', 'replacement', { EX: 5 })
        );
        assert.equal(await two.redis.get('jobs:v2:lease:owner-check'), 'replacement');
        await one.redis.get('jobs:v2:lease:cross-process');
        const children = [0, 1].map(() =>
          fork(path.join(__dirname, 'fixtures/jobsHubRedisWorker.js'), [], {
            silent: true,
            env: { ...process.env, JOBS_TEST_REDIS_NAMESPACE: setup.namespace }
          })
        );
        t.after(() => {
          for (const child of children) if (child.exitCode === null) child.kill();
        });
        const ready = await Promise.all(children.map((child) => once(child, 'message')));
        assert.ok(ready.every(([message]) => message.ready));
        const results = children.map((child) => once(child, 'message'));
        const exits = children.map((child) => once(child, 'exit'));
        children.forEach((child) => child.send({ start: true }));
        const messages = await Promise.all(results);
        assert.equal(messages.filter(([message]) => message.result?.upstreamCalls === 1).length, 1);
        assert.equal(messages.filter(([message]) => message.result?.skipped).length, 1);
        assert.ok((await Promise.all(exits)).every(([code]) => code === 0));
      }
    );

    await t.test(
      'route limits are distributed and preserve read, refresh, and mutation ceilings',
      async () => {
        const middleware = (worker) =>
          load('../middleware/jobsRateLimit.js', { '../services/redisCacheService': worker.cache });
        const left = middleware(one);
        const right = middleware(two);
        const request = {
          user: { _id: 'synthetic-upstash-owner' },
          query: { forceRefresh: 'true' }
        };
        const invoke = async (handler) => {
          const response = {
            statusCode: 200,
            headers: {},
            set(key, value) {
              this.headers[key] = value;
              return this;
            },
            status(code) {
              this.statusCode = code;
              return this;
            },
            json() {
              return this;
            }
          };
          let passed = false;
          await handler(request, response, () => {
            passed = true;
          });
          return { passed, response };
        };
        for (const [field, maximum] of [
          ['jobsRateLimit', 120],
          ['jobsRefreshLimit', 2],
          ['actionRateLimit', 30]
        ]) {
          const results = await Promise.all(
            Array.from({ length: maximum + 1 }, (_, index) =>
              invoke((index % 2 ? left : right)[field])
            )
          );
          assert.equal(results.filter((value) => value.passed).length, maximum);
          const blocked = results.find((value) => !value.passed);
          assert.equal(blocked.response.statusCode, 429);
          assert.ok(Number(blocked.response.headers['Retry-After']) > 0);
        }
      }
    );

    await t.test(
      'cache publication is shared, stale fills cannot overwrite it, and promotion does not extend expiry',
      async () => {
        const pool = (worker) =>
          load('../services/jobPoolCacheService.js', { './redisCacheService': worker.cache });
        const producer = pool(one);
        const observedAt = Date.now();
        await producer.publish([{ id: 'fresh-public-job' }], observedAt);
        const staleProducer = pool(two);
        await staleProducer.publish([{ id: 'old-public-job' }], observedAt - 1000);
        const reader = pool(two);
        assert.equal(
          (await reader.load(() => assert.fail('Redis should supply public pool')))[0].id,
          'fresh-public-job'
        );
        const key = producer.KEY;
        const ttl = await one.redis.pTTL(key);
        assert.ok(ttl > 290000 && ttl <= 300000);
        await producer.publish([{ id: 'replacement-public-job' }]);
        await new Promise((resolve) => setTimeout(resolve, 15100));
        assert.equal(
          (await reader.load(() => assert.fail('Warm worker must see the refreshed Redis pool')))[0]
            .id,
          'replacement-public-job'
        );
        await one.redis.set(
          key,
          JSON.stringify({
            version: 2,
            observedAt: Date.now(),
            until: Date.now() + 1200,
            jobs: [{ id: 'short-lived' }]
          }),
          { PX: 1200 }
        );
        const promotion = pool(two);
        assert.equal((await promotion.load(() => assert.fail()))[0].id, 'short-lived');
        const before = await two.redis.pTTL(key);
        await new Promise((resolve) => setTimeout(resolve, 1300));
        let loads = 0;
        assert.equal(
          (
            await promotion.load(async () => {
              loads++;
              return [{ id: 'mongo-fallback' }];
            })
          )[0].id,
          'mongo-fallback'
        );
        assert.equal(loads, 1);
        assert.ok(before > 0 && before <= 1200);
        // Disconnect a real Redis connection; the pool must recover through its loader.
        await two.client.quit();
        const offline = pool(two);
        assert.equal(
          (await offline.load(async () => [{ id: 'offline-mongo-fallback' }]))[0].id,
          'offline-mongo-fallback'
        );
        assert.equal((await b.reserve('arbeitnow')).reason, 'quota_store_unavailable');
      }
    );
  }
);
