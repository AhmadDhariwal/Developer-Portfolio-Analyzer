'use strict';
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const test = require('node:test');
const mongoose = require('mongoose');
const { startMongo } = require('./fixtures/disposableRequestMongo');
const State = require('../models/integrationGovernanceState');

async function worker() {
  const mongoose = require('mongoose');
  const axios = require('axios');
  await mongoose.connect(process.env.COURSES_TEST_MONGO);
  await require('./src/services/integrationMongoGovernanceService').initialize();
  const cachePath = require.resolve('./src/services/aiservice');
  require.cache[cachePath] = {
    id: cachePath,
    filename: cachePath,
    loaded: true,
    exports: {
      getSharedCache: async () => {
        throw new Error('Redis unavailable');
      },
      setSharedCache: async () => {
        throw new Error('Redis unavailable');
      },
    },
  };
  let release;
  let hold;
  axios.get = async (url) => {
    const stage = url.endsWith('/search') ? 'search' : 'videos';
    process.send({ stage });
    if (hold && stage === 'videos') await hold;
    if (stage === 'search') return { data: { items: [{ id: { videoId: 'abcdefghijk' } }] } };
    return {
      data: {
        items: [
          {
            id: 'abcdefghijk',
            snippet: { title: 'SQL course', channelTitle: 'Synthetic course fixture' },
            contentDetails: { duration: 'PT1H' },
          },
        ],
      },
    };
  };
  const { fetchCourses } = require('./src/services/courseRecommendationService');
  process.on('message', async (input) => {
    if (input === 'release') return release?.();
    hold = input.hold
      ? new Promise((resolve) => {
          release = resolve;
        })
      : null;
    let status = 200;
    const result = input.work
      ? require('./src/services/sharedCourseCatalogService')
          .getYouTube({
            topic: input.topic || 'SQL',
            fingerprint: require('./src/services/courseService').providerConfigurationFingerprint(),
            fetchProvider: require('./src/services/courseService').fetchYouTubeCourses,
          })
          .then((pool) => process.send({ status: 200, total: pool.courses.length }))
          .catch((error) => process.send({ status: error.status || 500 }))
      : fetchCourses(
          {
            user: {
              _id: input.owner,
              activeCareerStack: 'Backend',
              activeExperienceLevel: 'Intern',
            },
            query: {
              topic: input.topic || 'SQL',
              skillGaps: ['SQL'].join(','),
              refresh: 'true',
              limit: '50',
            },
          },
          {
            status(code) {
              status = code;
              return this;
            },
            json(body) {
              process.send({
                status,
                total: body.total,
                signalHash: body.cacheMetadata?.signalHash,
                providerCounts: body.providerCounts,
                providers: body.courses?.map((course) => course.platform),
              });
            },
          },
        );
    process.send({ started: true });
    await result;
  });
  process.send({ ready: true });
}

test(
  'real Mongo course workers share provider requests and fence expired or crashed owners',
  { timeout: 90_000 },
  async (t) => {
    const runtime = await startMongo({
      replicaSet: 'courses-pool-workers',
      readinessAttempts: 100,
    });
    const children = [];
    t.after(async () => {
      await Promise.all(
        children.map(async (child) => {
          if (child.exitCode !== null || child.signalCode !== null) return;
          const exited = once(child, 'exit');
          child.kill();
          await exited;
        }),
      );
      await mongoose.disconnect();
      await runtime.stop();
    });
    await mongoose.connect(runtime.uri);
    await require('../services/integrationMongoGovernanceService').initialize();
    const startWorker = async () => {
      const child = spawn(
        process.execPath,
        [
          '-e',
          `(${worker})().catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })`,
        ],
        {
          cwd: require('node:path').resolve(__dirname, '../..'),
          env: {
            ...process.env,
            COURSES_TEST_MONGO: runtime.uri,
            YOUTUBE_API_KEY: 'synthetic-fixture-key',
            COURSES_POOL_STORE_TIMEOUT_MS: '5000',
          },
          stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
          windowsHide: true,
        },
      );
      children.push(child);
      const stages = [];
      child.on('message', (message) => {
        if (message.stage) stages.push(message.stage);
      });
      const [ready] = await once(child, 'message');
      assert.equal(ready.ready, true);
      return {
        child,
        stages,
        request(owner, hold = false, topic = 'SQL', work = false) {
          return new Promise((resolve) => {
            const onMessage = (message) => {
              if (!message.status) return;
              child.off('message', onMessage);
              resolve(message);
            };
            child.on('message', onMessage);
            child.send({ owner, hold, topic, work });
          });
        },
        waitFor(predicate) {
          return new Promise((resolve) => {
            const onMessage = (message) => {
              if (!predicate(message)) return;
              child.off('message', onMessage);
              resolve();
            };
            child.on('message', onMessage);
          });
        },
      };
    };
    const [a, b] = await Promise.all([startWorker(), startWorker()]);
    const owner = String(new mongoose.Types.ObjectId());
    const atProvider = (message) => message.stage === 'videos';
    // The service fails closed with 503 when a lease-store call exceeds its bounded 2 s budget, and a
    // loaded disposable mongod occasionally stalls that long. A client-side timeout does not cancel
    // the server write, so the timed-out upsert can still land and leave an orphaned lease that
    // self-heals only at its 30 s deadline (observed in a driver trace). That admission outcome
    // happens before any provider call, so the harness retries only it (bounded), fast-forwards
    // orphaned deadlines like the crash scenario below when no legitimate holder can exist, and
    // records how many retries were needed.
    const MAX_ATTEMPTS = 4;
    const transientAdmission = [];
    const backoff = async (attempt, orphans) => {
      transientAdmission.push(attempt);
      if (orphans) {
        await State.collection.updateMany(
          { _id: /^courses:v1:lease:/, 'leases.0': { $exists: true } },
          { $set: { 'leases.0.until': new Date(0) } },
        );
      }
      await delay(500);
    };
    const settle = async (send, { orphans = false } = {}) => {
      for (let attempt = 1; ; attempt++) {
        const response = await send();
        if (response.status !== 503 || attempt === MAX_ATTEMPTS) return response;
        await backoff(attempt, orphans);
      }
    };
    const hold = async (worker, ownerId, topic = 'SQL') => {
      for (let attempt = 1; ; attempt++) {
        const provider = worker.waitFor(atProvider);
        const result = worker.request(ownerId, true, topic, true);
        const outcome = await Promise.race([provider.then(() => 'provider'), result]);
        if (outcome === 'provider') return { result };
        if (outcome.status !== 503 || attempt === MAX_ATTEMPTS) {
          assert.fail(`Worker completed before provider hold: ${outcome.status}`);
        }
        await backoff(attempt, true);
      }
    };
    const first = (await hold(a, owner)).result;
    const started = b.waitFor((message) => message.started);
    const second = settle(() =>
      b.request(String(new mongoose.Types.ObjectId()), false, 'SQL', true),
    );
    await started;
    a.child.send('release');
    const results = await Promise.all([first, second]);
    assert.deepEqual(
      results.map((row) => row.status),
      [200, 200],
    );
    assert.ok(results[0].total > 0);
    assert.equal(results[0].total, results[1].total);
    const served = await Promise.all([
      a.request(owner),
      b.request(String(new mongoose.Types.ObjectId())),
    ]);
    assert.ok(
      served.every((row) => row.providers.includes('YouTube')),
      'All includes YouTube for both owners',
    );
    assert.equal(
      Object.values(served[0].providerCounts).reduce((sum, count) => sum + count, 0),
      served[0].total,
    );
    assert.notEqual(
      served[0].signalHash,
      served[1].signalHash,
      'personalized evidence remains owner-scoped',
    );
    assert.deepEqual(a.stages, ['search', 'search', 'videos']);
    assert.deepEqual(b.stages, []);
    t.diagnostic('Two successful requests shared two search calls and one details call.');

    const expireActiveLease = async () => {
      // Move the disposable lease deadline into the past to exercise recovery without a 30 s sleep.
      const expired = await State.collection.updateMany(
        { _id: /^courses:v1:lease:/, 'leases.0': { $exists: true } },
        { $set: { 'leases.0.until': new Date(0) } },
      );
      assert.equal(expired.modifiedCount, 1, 'expire the active shared provider slot');
      const raw = await mongoose.connection.db
        .collection('shared_course_catalog')
        .updateOne({ leaseToken: { $exists: true } }, { $set: { leaseUntil: new Date(0) } });
      assert.equal(raw.modifiedCount, 1);
    };
    const fenceOwner = String(new mongoose.Types.ObjectId());
    const fenced = (await hold(a, fenceOwner, 'Python')).result;
    await expireActiveLease();
    const replacement = await settle(() => b.request(fenceOwner, false, 'Python', true), {
      orphans: true,
    });
    assert.equal(replacement.status, 200);
    a.child.send('release');
    assert.equal((await fenced).status, 503);
    t.diagnostic('Replacement completed and the expired worker was fenced.');

    const crashOwner = String(new mongoose.Types.ObjectId());
    await hold(a, crashOwner, 'React');
    const exited = once(a.child, 'exit');
    a.child.kill();
    await exited;
    await expireActiveLease();
    assert.equal(
      (await settle(() => b.request(crashOwner, false, 'React', true), { orphans: true })).status,
      200,
    );
    assert.deepEqual(b.stages, ['search', 'search', 'videos', 'search', 'search', 'videos']);
    t.diagnostic('Surviving worker recovered after the crashed worker lease deadline.');
    t.diagnostic(
      `Transient lease-admission 503 retries before any provider call: ${transientAdmission.length}.`,
    );
  },
);
