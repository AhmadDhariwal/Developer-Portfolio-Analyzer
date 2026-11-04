'use strict';
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
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
    const result = fetchCourses(
      {
        user: { _id: input.owner, activeCareerStack: 'Backend', activeExperienceLevel: 'Intern' },
        query: { skillGaps: ['SQL'].join(','), refresh: 'true', limit: '50' },
      },
      {
        status(code) {
          status = code;
          return this;
        },
        json(body) {
          process.send({ status, total: body.total, signalHash: body.cacheMetadata?.signalHash });
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
        request(owner, hold = false) {
          return new Promise((resolve) => {
            const onMessage = (message) => {
              if (!message.status) return;
              child.off('message', onMessage);
              resolve(message);
            };
            child.on('message', onMessage);
            child.send({ owner, hold });
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
    const waitForProvider = (event, result) =>
      Promise.race([
        event,
        result.then((response) =>
          assert.fail(`Worker completed before provider hold: ${response.status}`),
        ),
      ]);
    const firstProvider = a.waitFor(atProvider);
    const first = a.request(owner, true);
    await waitForProvider(firstProvider, first);
    const started = b.waitFor((message) => message.started);
    const second = b.request(owner);
    await started;
    a.child.send('release');
    const results = await Promise.all([first, second]);
    assert.deepEqual(
      results.map((row) => row.status),
      [200, 200],
    );
    assert.deepEqual(
      results.map((row) => row.total),
      [33, 33],
    );
    assert.equal(results[0].signalHash, results[1].signalHash);
    assert.deepEqual(a.stages, ['search', 'search', 'videos']);
    assert.deepEqual(b.stages, []);
    t.diagnostic('Two successful requests shared two search calls and one details call.');

    const expireActiveLease = async () => {
      // Move the disposable lease deadline into the past to exercise recovery without a 30 s sleep.
      const expired = await State.collection.updateOne(
        { _id: /^courses:v1:lease:/, 'leases.0': { $exists: true } },
        { $set: { 'leases.0.until': new Date(0) } },
      );
      assert.equal(expired.modifiedCount, 1);
    };
    const fenceOwner = String(new mongoose.Types.ObjectId());
    const fencedProvider = a.waitFor(atProvider);
    const fenced = a.request(fenceOwner, true);
    await waitForProvider(fencedProvider, fenced);
    await expireActiveLease();
    const replacement = await b.request(fenceOwner);
    assert.equal(replacement.status, 200);
    a.child.send('release');
    assert.equal((await fenced).status, 503);
    t.diagnostic('Replacement completed and the expired worker was fenced.');

    const crashOwner = String(new mongoose.Types.ObjectId());
    const crashedProvider = a.waitFor(atProvider);
    await waitForProvider(crashedProvider, a.request(crashOwner, true));
    const exited = once(a.child, 'exit');
    a.child.kill();
    await exited;
    await expireActiveLease();
    assert.equal((await b.request(crashOwner)).status, 200);
    assert.deepEqual(b.stages, ['search', 'search', 'videos', 'search', 'search', 'videos']);
    t.diagnostic('Surviving worker recovered after the crashed worker lease deadline.');
  },
);
