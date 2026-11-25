const test = require('node:test');
const assert = require('node:assert/strict');
const { fork } = require('node:child_process');
const path = require('node:path');
const net = require('node:net');
const { startMongo } = require('../fixtures/disposableRequestMongo');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test(
  'independent settings workers converge through Redis and bounded Mongo fallback',
  { timeout: 180000 },
  async () => {
    const mongo = await startMongo({ readinessAttempts: 100 });
    const workers = [];
    let sequence = 0;
    function worker(redisUrl) {
      const child = fork(
        path.join(__dirname, '../fixtures/platformSettingsWorker.js'),
        [],
        {
          env: { ...process.env, REDIS_URL: redisUrl, UPSTASH_REDIS_TOKEN: '' },
          stdio: ['ignore', 'inherit', 'inherit', 'ipc']
        }
      );
      workers.push(child);
      child.setMaxListeners(30);
      return (op, extra = {}) =>
        new Promise((resolve, reject) => {
          const id = ++sequence;
          const timer = setTimeout(() => {
            child.off('message', receive);
            reject(Error('Worker deadline'));
          }, 15000);
          function receive(message) {
            if (message.id !== id) return;
            clearTimeout(timer);
            child.off('message', receive);
            if (message.error) reject(Error(message.error));
            else resolve(message.result);
          }
          child.on('message', receive);
          child.send({ id, op, ...extra });
        });
    }
    const a = worker(process.env.SETTINGS_TEST_REDIS_URL || '');
    const b = worker(process.env.SETTINGS_TEST_REDIS_URL || '');
    try {
      await a('connect', { uri: mongo.uri });
      await b('connect', { uri: mongo.uri });
      const start = Date.now();
      await a('update', {
        payload: { recruiter: { enableRecruiterAccess: false } }
      });
      const bound = process.env.SETTINGS_TEST_REDIS_URL ? 5000 : 60000;
      let observed = false;
      while (Date.now() - start < bound) {
        await delay(100);
        if ((await b('read')).recruiter.enableRecruiterAccess === false) {
          observed = true;
          break;
        }
      }
      console.log(
        JSON.stringify({
          redis: Boolean(process.env.SETTINGS_TEST_REDIS_URL),
          latencyMs: Date.now() - start
        })
      );
      assert.ok(
        observed,
        'Worker B must observe Worker A update within deadline'
      );
      assert.equal(await b('gate'), 403);
      await a('update', {
        payload: {
          security: {
            passwordMinLength: 12,
            jwtExpiresIn: '5m',
            otpExpiryMinutes: 2
          }
        }
      });
      for (let index = 0; index < 5; index++) {
        await a('update', {
          payload: { security: { otpMaxAttempts: index + 4 } }
        });
      }
      await delay(process.env.SETTINGS_TEST_REDIS_URL ? 2200 : 28000);
      const snapshots = await Promise.all(
        Array.from({ length: 20 }, () => b('read'))
      );
      assert.ok(
        snapshots.every((value) => value.security.otpMaxAttempts === 8)
      );
      const policies = await b('policies');
      assert.equal(policies.passwordValid, false);
      assert.equal(policies.jwtSeconds, 300);
      assert.ok(
        policies.otpRemainingMs > 110000 && policies.otpRemainingMs <= 120000
      );
      const restarted = worker(process.env.SETTINGS_TEST_REDIS_URL || '');
      await restarted('connect', { uri: mongo.uri });
      assert.equal(await restarted('gate'), 403);
      await restarted('close');
      await Promise.all([
        a('update', {
          payload: {
            general: { platformName: 'Concurrent settings verification' }
          }
        }),
        b('update', { payload: { analytics: { refreshIntervalMinutes: 17 } } })
      ]);
      await delay(process.env.SETTINGS_TEST_REDIS_URL ? 2200 : 28000);
      const concurrent = await b('read');
      assert.equal(
        concurrent.general.platformName,
        'Concurrent settings verification'
      );
      assert.equal(concurrent.analytics.refreshIntervalMinutes, 17);
      if (process.env.SETTINGS_TEST_REDIS_URL) {
        await b('redisOff');
        const fallbackStart = Date.now();
        await a('update', {
          payload: { recruiter: { enableRecruiterAccess: true } }
        });
        while (
          (await b('read')).recruiter.enableRecruiterAccess === false &&
          Date.now() - fallbackStart < 60000
        )
          await delay(100);
        assert.equal(await b('gate'), 200);
        console.log(
          JSON.stringify({
            missedNotificationLatencyMs: Date.now() - fallbackStart
          })
        );
        await b('redisOn');
        await a('update', {
          payload: { recruiter: { enableRecruiterAccess: false } }
        });
        await delay(2200);
        assert.equal(await b('gate'), 403);
      }
      await a('update', { payload: { general: { maintenanceMode: true } } });
      const listener = net.createServer();
      await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve));
      const port = listener.address().port;
      await new Promise((resolve) => listener.close(resolve));
      const api = fork(
        path.join(__dirname, '../../../index.js'),
        ['--api-only'],
        {
          env: {
            ...process.env,
            NODE_ENV: 'development',
            MONGODB_URI: mongo.uri,
            PORT: String(port),
            JWT_SECRET: 'disposable-settings-worker-test-secret',
            REDIS_URL: process.env.SETTINGS_TEST_REDIS_URL || '',
            UPSTASH_REDIS_TOKEN: ''
          },
          stdio: ['ignore', 'ignore', 'inherit', 'ipc']
        }
      );
      workers.push(api);
      const base = `http://localhost:${port}`;
      let response;
      for (let attempt = 0; attempt < 100; attempt++) {
        try {
          response = await fetch(`${base}/api/recruiter-hub/jobs`);
          break;
        } catch {
          await delay(100);
        }
      }
      assert.equal(
        response?.status,
        503,
        'API-only cold start enforces stored maintenance mode'
      );
      assert.equal(
        (await fetch(`${base}/api/super-admin/settings`)).status,
        401
      );
      await a('update', { payload: { general: { maintenanceMode: false } } });
      const authStart = Date.now();
      do {
        await delay(100);
        response = await fetch(`${base}/api/recruiter-hub/jobs`);
      } while (response.status === 503 && Date.now() - authStart < 60000);
      assert.equal(
        response.status,
        401,
        'Unauthenticated requests remain rejected after maintenance'
      );
      await b('mongoOff');
      await delay(31000);
      await assert.rejects(b('read'), /temporarily unavailable/);
    } finally {
      await Promise.allSettled([a('close'), b('close')]);
      for (const child of workers) if (child.connected) child.kill();
      await mongo.stop();
    }
  }
);
