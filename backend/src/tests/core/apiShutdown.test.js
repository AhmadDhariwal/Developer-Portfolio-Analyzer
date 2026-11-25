const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const net = require('node:net');
const { fork } = require('node:child_process');
const { startMongo } = require('../fixtures/disposableRequestMongo');
const { MongoClient, ObjectId } = require('mongodb');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test(
  'API-only SIGTERM and SIGINT handlers drain and release owned resources idempotently',
  { timeout: 180000 },
  async () => {
    const mongo = await startMongo();
    try {
      for (const signal of ['SIGTERM', 'SIGINT']) {
        const listener = net.createServer();
        await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve));
        const port = listener.address().port;
        await new Promise((resolve) => listener.close(resolve));
        const child = fork(
          path.join(__dirname, '../fixtures/apiLifecycleProbe.js'),
          ['--api-only'],
          {
            env: {
              ...process.env,
              NODE_ENV: 'development',
              MONGODB_URI: mongo.uri,
              PORT: String(port),
              REDIS_URL: 'redis://127.0.0.1:27392',
              UPSTASH_REDIS_TOKEN: '',
              JWT_SECRET: 'disposable-p02-api-shutdown-secret'
            },
            silent: true
          }
        );
        let output = '';
        child.stdout.on('data', (chunk) => {
          output += chunk;
        });
        child.stderr.on('data', (chunk) => {
          output += chunk;
        });
        const exited = new Promise((resolve) => child.once('exit', (code) => resolve(code)));
        try {
          let ready = false;
          const startupStarted = Date.now();
          // Startup already permits a 30-second Mongo connection attempt plus
          // Redis/settings warmup. Keep that readiness budget separate from drain.
          while (Date.now() - startupStarted < 60000 && child.exitCode === null) {
            try {
              ready = (await fetch(`http://localhost:${port}/`)).status === 200;
              if (ready) break;
            } catch {
              /* The listener is still starting. */
            }
            await delay(100);
          }
          assert.ok(ready, output);
          if (signal === 'SIGINT') {
            const expired = new Promise((resolve) => {
              child.once('message', resolve);
            });
            child.send({ op: 'expire-settings' });
            assert.deepEqual(await expired, { phase: 'settings-expired' });
          }
          const start = Date.now();
          if (process.platform === 'win32') child.send({ signal });
          else child.kill(signal);
          let timer;
          const code = await Promise.race([
            exited,
            new Promise((_, reject) => {
              timer = setTimeout(() => reject(Error('Shutdown deadline')), 18000);
            })
          ]).finally(() => clearTimeout(timer));
          assert.equal(code, 0, output);
          assert.equal((output.match(/server shutdown completed/g) || []).length, 1);
          console.log(
            JSON.stringify({
              signal,
              transport: process.platform === 'win32' ? 'Node signal event via IPC' : 'OS signal',
              startupMs: start - startupStarted,
              shutdownMs: Date.now() - start
            })
          );
        } finally {
          if (child.exitCode === null) {
            child.kill();
            await exited;
          }
        }
      }
    } finally {
      await mongo.stop();
    }
  }
);

test(
  'started workers drain delivery and leave an unfinished job recoverable after the shutdown deadline',
  { timeout: 300000 },
  async () => {
    const mongo = await startMongo();
    const client = new MongoClient(mongo.uri, { timeoutMS: 5000 });
    const children = [];
    await client.connect();
    const jobs = client.db().collection('emaildeliveryjobs');
    async function launch() {
      const listener = net.createServer();
      await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve));
      const port = listener.address().port;
      await new Promise((resolve) => listener.close(resolve));
      const child = fork(path.join(__dirname, '../fixtures/apiLifecycleProbe.js'), [], {
        env: {
          ...process.env,
          P02_EMAIL_LIFECYCLE: 'true',
          NODE_ENV: 'development',
          MONGODB_URI: mongo.uri,
          PORT: String(port),
          REDIS_URL: 'redis://127.0.0.1:27392',
          UPSTASH_REDIS_TOKEN: '',
          JWT_SECRET: 'disposable-p02-worker-shutdown-key',
          EMAIL_RETRY_INTERVAL_MS: '5000',
          NEWS_INGESTION_ENABLED: 'false',
          COURSES_MAINTENANCE_ENABLED: 'false',
          WEEKLY_REPORT_SCHEDULER_ENABLED: 'false',
          NOTIFICATION_RETENTION_WORKER_ENABLED: 'false',
          INTERVIEW_QUESTION_INGEST_CRON: '0 0 1 1 *',
          INTERVIEW_QUESTION_MAINTENANCE_CRON: '0 0 1 1 *',
          OTEL_SDK_DISABLED: 'true',
          OTEL_TRACES_EXPORTER: 'none',
          OTEL_METRICS_EXPORTER: 'none',
          OTEL_LOGS_EXPORTER: 'none'
        },
        silent: true
      });
      const messages = [];
      let output = '';
      child.stdout.on('data', (chunk) => {
        output += chunk;
      });
      child.stderr.on('data', (chunk) => {
        output += chunk;
      });
      child.on('message', (message) => messages.push(message));
      const exited = new Promise((resolve) => child.once('exit', (code) => resolve(code)));
      children.push({ child, exited });
      const until = Date.now() + 60000;
      let ready = false;
      while (Date.now() < until && child.exitCode === null) {
        try {
          ready = (await fetch(`http://localhost:${port}/`)).status === 200;
          if (ready) break;
        } catch {
          /* Await readiness. */
        }
        await delay(100);
      }
      assert.ok(ready, output);
      const phase = async (name) => {
        const deadline = Date.now() + 30000;
        while (Date.now() < deadline) {
          const message = messages.find((item) => item.phase === name);
          if (message) return message;
          await delay(20);
        }
        throw Error(`Missing worker phase ${name}: ${output}`);
      };
      const stop = async (signal, release) => {
        const start = Date.now();
        if (process.platform === 'win32') child.send({ signal });
        else child.kill(signal);
        if (release) {
          await delay(250);
          child.send({ op: 'release' });
        }
        let timer;
        const code = await Promise.race([
          exited,
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(Error(`Worker shutdown exceeded deadline: ${output}`)),
              18000
            );
          })
        ]).finally(() => clearTimeout(timer));
        console.log(
          JSON.stringify({
            signal,
            inFlightDelivery: true,
            release,
            shutdownMs: Date.now() - start,
            exitCode: code
          })
        );
        return code;
      };
      return { child, phase, stop, messages };
    }
    try {
      const draining = await launch();
      draining.child.send({ op: 'enqueue' });
      const first = await draining.phase('queued');
      await draining.phase('delivery-started');
      assert.equal((await jobs.findOne({ _id: new ObjectId(first.jobId) })).status, 'processing');
      assert.equal(await draining.stop('SIGTERM', true), 0);
      assert.equal((await jobs.findOne({ _id: new ObjectId(first.jobId) })).status, 'sent');
      const interrupted = await launch();
      interrupted.child.send({ op: 'enqueue' });
      const second = await interrupted.phase('queued');
      await interrupted.phase('delivery-started');
      assert.equal(await interrupted.stop('SIGINT', false), 1);
      const retained = await jobs.findOne({ _id: new ObjectId(second.jobId) });
      assert.equal(retained.status, 'processing');
      assert.ok(retained.nextAttemptAt > new Date());
      // Advance this disposable job's recovery window, preserving the production
      // uncertain-delivery rule and avoiding a two-minute wall-clock wait.
      await jobs.updateOne(
        { _id: retained._id },
        { $set: { nextAttemptAt: new Date(0), updatedAt: new Date(0) } }
      );
      const recovered = await launch();
      const deadline = Date.now() + 20000;
      let after;
      do {
        after = await jobs.findOne({ _id: retained._id });
        if (after.status === 'failed') break;
        await delay(100);
      } while (Date.now() < deadline);
      assert.equal(after.status, 'failed');
      assert.match(after.lastError, /outcome unknown/);
      assert.equal(
        recovered.messages.filter((item) => item.phase === 'delivery-started').length,
        0
      );
      assert.equal(await recovered.stop('SIGTERM', true), 0);
    } finally {
      for (const { child, exited } of children)
        if (child.exitCode === null) {
          child.kill();
          await exited;
        }
      await client.close();
      await mongo.stop();
    }
  }
);
