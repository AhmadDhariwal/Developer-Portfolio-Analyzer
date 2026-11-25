const test = require('node:test');
const assert = require('node:assert/strict');
const { fork } = require('node:child_process');
const path = require('node:path');
const { startMongo } = require('../fixtures/disposableRequestMongo');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test(
  'independent infrastructure workers coordinate revisions, authentication and bounded caches',
  { timeout: 180000 },
  async () => {
    const baseline = process.env.P02_BASELINE === 'true';
    const mongo = await startMongo();
    const workers = [];
    const calls = [];
    let sequence = 0;
    function worker() {
      const child = fork(path.join(__dirname, '../fixtures/infrastructureWorker.js'), [], {
        execArgv: ['--expose-gc'],
        env: {
          ...process.env,
          REDIS_URL: 'redis://127.0.0.1:27392',
          UPSTASH_REDIS_TOKEN: '',
          RATE_LIMIT_AUTH_MAX: '4',
          JWT_SECRET: 'disposable-p02-security-test-key',
          GOOGLE_CLIENT_ID: 'fixture',
          GOOGLE_CLIENT_SECRET: 'fixture',
          GOOGLE_CALLBACK_URL: 'http://localhost/callback'
        },
        stdio: ['ignore', 'ignore', 'inherit', 'ipc']
      });
      workers.push(child);
      const call = (op, extra = {}) =>
        new Promise((resolve, reject) => {
          if (!child.connected)
            return op === 'close' ? resolve() : reject(Error('Worker disconnected'));
          const id = ++sequence;
          const timer = setTimeout(() => {
            child.off('message', receive);
            reject(Error(`Worker deadline ${op}`));
          }, 60000);
          function receive(message) {
            if (message.id !== id) return;
            clearTimeout(timer);
            child.off('message', receive);
            if (message.error)
              reject(Object.assign(Error(message.error), { status: message.status }));
            else resolve(message.result);
          }
          child.on('message', receive);
          child.send({ id, op, ...extra }, (error) => {
            if (!error) return;
            clearTimeout(timer);
            child.off('message', receive);
            reject(error);
          });
        });
      calls.push(call);
      return call;
    }
    const a = worker();
    const b = worker();
    const post = async (base, route, headers = {}) =>
      (
        await fetch(`${base}/${route}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...headers },
          body: JSON.stringify({ email: 'fixture@example.test' })
        })
      ).status;
    try {
      const urlA = await a('connect', { uri: mongo.uri });
      const firstRevision = await a('revision');
      const urlB = await b('connect', { uri: mongo.uri });
      const workerResetRevision = firstRevision !== (await b('revision'));
      assert.equal(workerResetRevision, baseline);
      const state = await a('state');
      await a('consume', { payload: state });
      if (baseline) await b('consume', { payload: state });
      else await assert.rejects(b('consume', { payload: state }), { status: 400 });
      if (!baseline) {
        const concurrentState = await a('state');
        const claims = await Promise.allSettled([
          a('consume', { payload: concurrentState }),
          b('consume', { payload: concurrentState })
        ]);
        assert.equal(claims.filter((claim) => claim.status === 'fulfilled').length, 1);
        assert.equal(claims.find((claim) => claim.status === 'rejected').reason.status, 400);
        for (const base of [urlA, urlB, urlA, urlB, urlA, urlB])
          assert.equal(await post(base, 'failure'), 401);
        assert.equal(await post(urlA, 'guard'), 429);
        assert.equal(await post(urlB, 'guard'), 429);
      }
      for (const base of [urlA, urlB, urlA, urlB]) assert.equal(await post(base, 'rate'), 200);
      assert.equal(
        await post(urlA, 'rate', { 'X-Forwarded-For': '198.51.100.20' }),
        baseline ? 200 : 429
      );
      if (baseline) {
        console.log(
          JSON.stringify({
            baseline,
            workerResetRevision,
            crossWorkerOAuthReplayAccepted: true,
            authWorkerSwitchBypass: true
          })
        );
        return;
      }
      let revision = await b('revision');
      const interview = await a('seedInterview');
      assert.equal((await b('readInterview')).marker, 'bank-v1');
      await a('reconnect');
      assert.equal(await a('revision'), revision);
      assert.equal((await b('readInterview')).marker, 'bank-v1');
      assert.ok((await a('cacheTtl', { payload: interview.key })) <= interview.ttlMs);
      await a('invalidate');
      assert.equal(await b('readInterview'), null);
      const olderRevision = await b('revision');
      await a('invalidate');
      revision = await b('revision');
      await b('replayRevision', { payload: olderRevision });
      assert.equal(
        await b('revision'),
        revision,
        'Older persisted revisions cannot replace a newer invalidation'
      );
      await a('redisOff');
      await a('invalidate');
      assert.equal(
        await post(urlA, 'api/global'),
        200,
        'Mongo security authority works without Redis'
      );
      await a('reconnect');
      await delay(500);
      assert.notEqual(
        await b('revision'),
        revision,
        'Deferred invalidation is replayed on reconnect'
      );
      await a('mongoOff');
      assert.equal(
        await post(urlA, 'api/global'),
        503,
        'Security coordination fails closed without Mongo'
      );
      const unavailableState = await b('state');
      await assert.rejects(a('consume', { payload: unavailableState }), { status: 503 });
      await b('consume', { payload: unavailableState });
      await a('mongoOn');
      assert.equal(await post(urlA, 'api/global'), 200);
      const firstHit = Date.now();
      const window = await a('relativeWindow');
      assert.ok(window.until >= firstHit + 60000 && window.until <= Date.now() + 60000);
      const sameWindow = await b('relativeWindow');
      assert.equal(sameWindow.until, window.until);
      assert.equal(sameWindow.count, 2);
      await a('configure', { payload: { security: { globalRateLimitMax: 10 } } });
      await delay(2200);
      for (let index = 0; index < 20; index++) await post(index % 2 ? urlA : urlB, 'api/global');
      await a('configure', { payload: { security: { globalRateLimitMax: 15 } } });
      await delay(2200);
      assert.equal(
        await post(urlA, 'api/global'),
        429,
        'Changing settings preserves denied-attempt counts'
      );
      assert.equal(await post(urlB, 'api/global'), 429);
      const memory = [];
      for (const call of [a, b]) {
        const measurement = await call('stress');
        assert.equal(measurement.entries, 256);
        assert.equal((await call('githubStress')).entries, 128);
        const ttl = await call('ttl');
        assert.equal(ttl.first, 'fresh');
        assert.notEqual(ttl.after, 'fresh');
        memory.push(measurement);
      }
      console.log(JSON.stringify({ baseline, workerResetRevision, memory }));
      const beforeRestart = await b('revision');
      await a('redisOff');
      await a('invalidate');
      await a('close');
      const replacement = worker();
      const replacementUrl = await replacement('connect', { uri: mongo.uri });
      assert.notEqual(
        await b('revision'),
        beforeRestart,
        'A new process recovers the departed writer invalidation from Mongo'
      );
      assert.equal(await post(replacementUrl, 'rate'), 429);
      assert.equal(await post(replacementUrl, 'guard'), 429);
      await assert.rejects(replacement('consume', { payload: state }), { status: 400 });
      await replacement('clearFailures');
      assert.equal(await post(urlB, 'guard'), 200);
      await replacement('close');
    } finally {
      await Promise.allSettled(calls.map((call) => call('close')));
      for (const child of workers) if (child.connected) child.kill();
      await mongo.stop();
    }
  }
);
