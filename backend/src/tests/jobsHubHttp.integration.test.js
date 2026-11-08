const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const mongoose = require('mongoose');
const express = require('express');
const jwt = require('jsonwebtoken');
const { fixture } = require('./fixtures/jobsHubRedisFixture');

test(
  'real Jobs HTTP contracts use disposable Mongo, real Redis and JWT owner isolation',
  {
    skip: !process.env.JOBS_TEST_MONGODB_URI || !process.env.JOBS_TEST_REDIS_URL,
    timeout: 120000
  },
  async (t) => {
    const uri = new URL(process.env.JOBS_TEST_MONGODB_URI);
    assert.equal(uri.protocol, 'mongodb:');
    assert.ok(['127.0.0.1', 'localhost'].includes(uri.hostname));
    const database = `jobs_hub_test_${randomUUID().replaceAll('-', '')}`;
    const servers = [];
    await mongoose.connect(uri.href, { dbName: database, autoIndex: false });
    t.after(async () => {
      await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
      assert.equal(mongoose.connection.name, database);
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    });
    const setup = await fixture(t);
    const worker = await setup.worker();
    const redis = require('../services/redisCacheService');
    const original = redis.getRedisCacheClient;
    redis.getRedisCacheClient = worker.cache.getRedisCacheClient;
    t.after(() => {
      redis.getRedisCacheClient = original;
    });
    // Provider ingestion and Learning Hub recommendation boundaries are explicit
    // fixtures; authentication, routes, persistence, quotas and cache are real.
    let providerCalls = 0;
    const transport = require('../services/jobProviderTransport');
    const denyProvider = async () => {
      providerCalls++;
      throw Error('Provider call forbidden in fixture');
    };
    transport.get = denyProvider;
    transport.post = denyProvider;
    require('../services/courseService').buildCoursePool = async () => [];
    process.env.JWT_SECRET = 'disposable-jobs-http-signing-secret';
    process.env.JWT_ISSUER = 'devinsight-api';
    process.env.JWT_AUDIENCE = 'devinsight-web';
    const User = require('../models/user');
    const Cache = require('../models/jobCache');
    const Actions = require('../models/userJobAction');
    const bcrypt = require('bcryptjs');
    const password = 'Account!Password123';
    const passwordHash = await bcrypt.hash(password, 10);
    await Promise.all([User.createIndexes(), Cache.createIndexes(), Actions.createIndexes()]);
    const owner = new mongoose.Types.ObjectId(),
      other = new mongoose.Types.ObjectId();
    await User.collection.insertMany(
      [owner, other].map((_id, index) => ({
        _id,
        email: `http-${index}@example.test`,
        name: 'Fixture',
        role: 'developer',
        isActive: true,
        careerStack: 'Backend',
        experienceLevel: '0-1 years',
        sessionRevision: 0
        , password: passwordHash
      }))
    );
    await require('../services/jobService').syncJobsToCache([
      {
        id: 'http-job',
        title: 'Backend Engineer',
        company: 'Fixture',
        source: 'Arbeitnow',
        platform: 'Arbeitnow',
        skills: ['Node.js'],
        applyUrl: 'https://example.com/jobs/http-job'
      }
    ]);
    for (let index = 0; index < 2; index++) {
      const app = express();
      app.use(express.json());
      app.use('/api/jobs', require('../routes/jobRoutes'));
      const server = await new Promise((resolve) => {
        const server = app.listen(0, '127.0.0.1', () => resolve(server));
      });
      servers.push(server);
    }
    const tokens = new Map();
    const grants = new Map();
    const grantKeys = [];
    const nativeSet = worker.redis.set;
    worker.redis.set = (key, value, options) => {
      if (key.startsWith('jobs:v3:hidden:grant:')) grantKeys.push(key);
      return nativeSet(key, value, options);
    };
    const token = (id) => {
      const key = String(id);
      if (!tokens.has(key)) tokens.set(key, jwt.sign({ id: key, sessionRevision: 0 }, process.env.JWT_SECRET, {
        issuer: process.env.JWT_ISSUER,
        audience: process.env.JWT_AUDIENCE,
        expiresIn: '1h'
      }));
      return tokens.get(key);
    };
    const request = (path, id = owner, options = {}, server = 0) =>
      fetch(`http://127.0.0.1:${servers[server].address().port}/api/jobs${path}`, {
        ...options,
        headers: {
          ...(id ? { Authorization: `Bearer ${token(id)}` } : {}),
          'Content-Type': 'application/json',
          ...(grants.has(String(id)) ? { 'X-Jobs-Hidden-Token': grants.get(String(id)) } : {}),
          ...options.headers
        }
      });
    const mutate = (id, body, server = 0) =>
      request('/http-job/actions', id, { method: 'PUT', body: JSON.stringify(body) }, server);
    assert.equal((await request('/', null)).status, 401);
    const response = await request('/');
    assert.equal(response.status, 200);
    assert.match(response.headers.get('cache-control'), /no-store/);
    const feed = await response.json();
    assert.equal(feed.total, 1);
    assert.equal(feed.personalization.status, 'career-context-only');
    assert.deepEqual(feed.recommendedBasedOn.knownSkills, []);
    const writes = await Promise.all(
      Array.from({ length: 15 }, (_, index) => mutate(owner, { saved: true }, index % 2))
    );
    assert.ok(writes.every((response) => response.status === 200));
    assert.equal(await Actions.countDocuments({ userId: owner }), 1);
    assert.equal((await (await request('/actions?state=saved', other)).json()).actions.length, 0);
    assert.equal((await mutate(owner, { userId: String(other), saved: false })).status, 400);
    assert.equal((await mutate(owner, { applied: true, hidden: true }, 1)).status, 200);
    assert.equal((await (await request('/', owner)).json()).total, 0);
    assert.equal((await request('/http-job', owner)).status, 404);
    assert.equal((await (await request('/', other, {}, 1)).json()).total, 1);
    assert.equal((await request('/actions?state=hidden', owner)).status, 403);
    for (const state of ['', '?state=saved', '?state=applied'])
      assert.equal((await (await request(`/actions${state}`, owner)).json()).actions.length, 0);
    assert.equal((await mutate(owner, { hidden: false })).status, 403);
    assert.equal((await mutate(owner, { saved: false })).status, 403);
    assert.equal((await request('/http-job/hide', owner, { method: 'DELETE' })).status, 403);
    const unlock = async (id, value) => {
      const result = await request('/hidden-access/unlock', id,
        { method: 'POST', body: JSON.stringify({ password: value }) });
      if (result.status === 200) grants.set(String(id), (await result.json()).token);
      return result;
    };
    assert.equal((await unlock(owner, 'WrongPassword')).status, 403);
    assert.equal((await unlock(owner, password)).status, 200);
    assert.ok(await worker.redis.pTTL(grantKeys.at(-1)) > 0);
    assert.ok(await worker.redis.pTTL(grantKeys.at(-1)) <= 300000);
    assert.equal((await (await request('/actions?state=hidden', owner)).json()).actions.length, 1);
    assert.equal((await mutate(owner, { hidden: false })).status, 200);
    assert.equal((await (await request('/actions?state=applied', owner)).json()).actions.length, 1);
    assert.equal((await request('/http-job', owner)).status, 200);
    await Cache.updateOne({ jobId: 'http-job' }, { $set: { expiresAt: new Date(0) } });
    assert.equal((await request('/http-job', owner)).status, 404);
    assert.equal((await mutate(owner, { saved: false })).status, 200);
    assert.equal((await mutate(other, { saved: true })).status, 404);
    redis.getRedisCacheClient = () => null;
    assert.equal((await mutate(owner, { applied: false })).status, 503);
    assert.equal((await request('/', other)).status, 200);
    redis.getRedisCacheClient = worker.cache.getRedisCacheClient;
    assert.equal((await mutate(owner, { applied: false }, 1)).status, 200);
    assert.equal((await mutate(owner, { hidden: true })).status, 200);
    const nextPassword = 'Changed!Password123';
    await User.updateOne({ _id: owner }, { $set: { password: await bcrypt.hash(nextPassword, 10) } });
    assert.equal((await request('/actions?state=hidden', owner)).status, 403);
    assert.equal((await unlock(owner, nextPassword)).status, 200);
    assert.equal((await request('/hidden-access/lock', owner, { method: 'POST' })).status, 200);
    assert.equal((await request('/actions?state=hidden', owner)).status, 403);
    assert.equal((await unlock(owner, nextPassword)).status, 200);
    const expiresKey = grantKeys.at(-1);
    await worker.redis.set(expiresKey, String(Date.now() - 1), { PX: 25 });
    assert.equal((await request('/actions?state=hidden', owner)).status, 403);
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(await worker.redis.get(expiresKey), null);
    assert.equal((await unlock(owner, nextPassword)).status, 200);
    assert.equal((await request('/actions?state=hidden', other, { headers: {
      'X-Jobs-Hidden-Token': grants.get(String(owner)) } })).status, 403);
    const anotherSession = jwt.sign({ id: String(owner), sessionRevision: 0, jti: 'other-session' },
      process.env.JWT_SECRET, { issuer: process.env.JWT_ISSUER, audience: process.env.JWT_AUDIENCE, expiresIn: '1h' });
    assert.equal((await request('/actions?state=hidden', owner, { headers: { Authorization: `Bearer ${anotherSession}` } })).status, 403);
    for (let index = 0; index < 5; index++) assert.equal((await unlock(other, 'WrongPassword')).status, 403);
    const blocked = await unlock(other, password);
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get('retry-after')) > 0);
    await User.updateOne({ _id: owner }, { $inc: { sessionRevision: 1 } });
    assert.equal((await request('/actions?state=hidden', owner)).status, 401);
    assert.equal(providerCalls, 0);
    t.diagnostic(
      JSON.stringify({
        realJwt: true,
        httpServers: 2,
        concurrentWrites: 15,
        providerCalls,
        learningBoundary: 'fixture',
        ownerIsolation: true,
        redisOutageAndRecovery: true
      })
    );
  }
);
