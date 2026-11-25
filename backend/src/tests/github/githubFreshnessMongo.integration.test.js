'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { randomBytes } = require('node:crypto');
const mongoose = require('mongoose');
const express = require('express');
const { startMongo } = require('../fixtures/disposableRequestMongo');

test(
  'real HTTP/auth/Mongo: saved reads never sync and accepted revisions survive failures',
  {
    skip: !fs.existsSync(
      process.env.INTEGRATION_TEST_MONGOD ||
        'C:\\Program Files\\MongoDB\\Server\\8.2\\bin\\mongod.exe'
    ),
    timeout: 120000
  },
  async (t) => {
    const runtime = await startMongo({ replicaSet: 'github-freshness' });
    let server;
    const previousSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = randomBytes(32).toString('hex');
    t.after(async () => {
      await new Promise((resolve) => (server ? server.close(resolve) : resolve()));
      await mongoose.disconnect();
      await runtime.stop();
      if (previousSecret === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = previousSecret;
    });
    await mongoose.connect(runtime.uri, { monitorCommands: true });
    let transactionActive = false;
    let activeDDL = 0;
    const overlappingDDL = [];
    const mongoClient = mongoose.connection.getClient();
    mongoClient.on('commandStarted', ({ command, commandName }) => {
      if (['create', 'createIndexes'].includes(commandName)) {
        activeDDL += 1;
        if (transactionActive) overlappingDDL.push(`started:${commandName}`);
      }
      if (command.autocommit === false) {
        transactionActive = true;
        if (activeDDL > 0) overlappingDDL.push(`inFlight:${activeDDL}`);
      }
      if (['commitTransaction', 'abortTransaction'].includes(commandName))
        transactionActive = false;
    });
    const finishDDL = ({ commandName }) => {
      if (['create', 'createIndexes'].includes(commandName)) {
        activeDDL = Math.max(0, activeDDL - 1);
      }
    };
    mongoClient.on('commandSucceeded', finishDDL);
    mongoClient.on('commandFailed', finishDDL);
    const User = require('../../modules/auth/models/user');
    const Analysis = require('../../modules/skill-gap/models/analysis');
    const SaveLock = require('../../modules/github/models/githubSaveLock');
    const Repository = require('../../modules/github/models/repository');
    const service = require('../../modules/github/services/githubservice');
    let syncs = 0;
    let fail = false;
    let switchIdentity = false;
    let duringProvider = async () => {};
    let revision = '2026-11-17T00:00:00.000Z';
    service.analyzeGitHubProfile = async (username) => {
      syncs++;
      await duringProvider();
      if (switchIdentity)
        await User.updateOne({ _id: user._id }, { $set: { activeGithubUsername: 'changed' } });
      if (fail) throw Error('Provider unavailable');
      return {
        analysisVersion: 'github-v2',
        fetchedAt: revision,
        repoCount: 1,
        totalStars: 2,
        totalForks: 0,
        activityScore: 40,
        githubHealthScore: 40,
        languageDistribution: [],
        repositoryActivity: [],
        repositories: [{ name: 'owned', language: 'JavaScript', stars: 2, forks: 0 }],
        githubSignals: { username, analyzedAt: revision },
        cache: {
          source: 'fresh',
          expiresAt: new Date(Date.now() + 86400000).toISOString()
        }
      };
    };
    const user = await User.create({
      name: 'Freshness fixture',
      email: 'fixture@example.invalid',
      password: randomBytes(24).toString('hex'),
      githubUsername: 'fixture'
    });
    const other = await User.create({
      name: 'Other fixture',
      email: 'other@example.invalid',
      password: randomBytes(24).toString('hex'),
      githubUsername: 'fixture'
    });
    const sign = require('../../modules/auth/utils/authSessionToken').sign;
    const app = express();
    app.use(express.json());
    app.use('/api/github', require('../../modules/github/github.routes'));
    server = await new Promise((resolve) => {
      const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    });
    const url = `http://127.0.0.1:${server.address().port}/api/github/analyze-save`;
    const request = async (body, owner = user) =>
      fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sign(owner)}`
        },
        body: JSON.stringify({ username: 'fixture', ...body })
      });
    assert.equal((await fetch(url, { method: 'POST' })).status, 401);
    assert.equal((await request({ savedOnly: true })).status, 404);
    assert.equal(syncs, 0);
    assert.equal((await request({ forceRefresh: true })).status, 200);
    assert.deepEqual(overlappingDDL, [], 'Cold model DDL must finish before the save transaction');
    const accepted = await Analysis.findOne({ userId: user._id }).lean();
    for (let index = 0; index < 4; index++) {
      const response = await request({ savedOnly: true });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).githubSignals.analyzedAt, revision);
    }
    assert.equal(syncs, 1);
    assert.equal((await request({ savedOnly: true }, other)).status, 404);
    await request({ forceRefresh: true });
    assert.equal(
      (await Analysis.findOne({ userId: user._id })).githubAnalysisHistory.length,
      accepted.githubAnalysisHistory.length
    );
    fail = true;
    assert.equal((await request({ forceRefresh: true })).status, 500);
    assert.equal((await request({ savedOnly: true })).status, 200);
    assert.equal(await Repository.countDocuments({ ownerId: user._id }), 1);
    fail = false;
    revision = '2026-11-17T01:00:00.000Z';
    assert.equal((await request({ forceRefresh: true })).status, 200);
    assert.equal(
      (await request({ savedOnly: true }).then((response) => response.json())).githubSignals
        .analyzedAt,
      revision
    );
    const providerCallsBeforeAnalyze = syncs;
    const cachedAnalyze = await request({});
    assert.equal(cachedAnalyze.status, 200);
    assert.equal((await cachedAnalyze.json()).githubSignals.analyzedAt, revision);
    assert.equal(syncs, providerCallsBeforeAnalyze);

    const lockKey = `github-save:${user._id}`;
    if (process.env.DPA_TEST_LONG_GITHUB_SYNC === 'true') {
      duringProvider = async () => {
        await new Promise((resolve) => setTimeout(resolve, 31000));
        const lease = await SaveLock.findById(lockKey).lean();
        assert.ok(lease.expiresAt > new Date(), 'the original holder renewed beyond 30 seconds');
        assert.equal(
          await SaveLock.countDocuments({
            _id: lockKey,
            expiresAt: { $lte: new Date() }
          }),
          0
        );
      };
      const longSync = await request({ forceRefresh: true });
      assert.equal(longSync.status, 200);
    }
    duringProvider = async () => {
      await SaveLock.updateOne({ _id: lockKey }, { $set: { ownerToken: 'successor' } });
    };
    revision = '2026-11-17T01:30:00.000Z';
    assert.equal((await request({ forceRefresh: true })).status, 409);
    assert.equal((await SaveLock.findById(lockKey)).ownerToken, 'successor');
    const lastAccepted = await Analysis.findOne({ userId: user._id }).lean();
    assert.equal(lastAccepted.githubSignals.analyzedAt, '2026-11-17T01:00:00.000Z');
    await SaveLock.updateOne(
      { _id: lockKey, ownerToken: 'successor' },
      { $set: { expiresAt: new Date(0) } }
    );
    duringProvider = async () => {};
    revision = lastAccepted.githubSignals.analyzedAt;
    t.diagnostic(
      `Provider stub sync calls=${syncs}; saved reads=7; MongoDB and HTTP real; Redis not exercised.`
    );
    const acceptedRevision = revision;
    revision = '2026-11-17T02:00:00.000Z';
    switchIdentity = true;
    assert.equal((await request({ forceRefresh: true })).status, 409);
    assert.equal((await User.findById(user._id)).activeGithubUsername, 'changed');
    assert.equal(
      (await Analysis.findOne({ userId: user._id })).githubSignals.analyzedAt,
      acceptedRevision
    );
  }
);
