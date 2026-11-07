'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const mongoose = require('mongoose');
const express = require('express');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const { startMongo } = require('./verifyIntegrationsRealProviders');
const cache = require('../services/redisCacheService');
const { getAdapter } = require('../services/integrations');
const candidate = require('../services/integrations/kaggleResourceExtractor');
const User = require('../models/user');
const Connection = require('../models/integrationConnection');
const Insight = require('../models/integrationInsight');
const Log = require('../models/integrationSyncLog');

async function main() {
  const output = path.resolve(
    __dirname,
    '../../verification/integrations/kaggle-resource-lifecycle-2026-10-27.json'
  );
  if (fs.existsSync(output)) throw Error('Lifecycle evidence exists; no repeated live acceptance.');
  const result = {
    checkedAt: new Date().toISOString(),
    account: 'dansbecker',
    status: 'BLOCKED',
    requests: [],
    applicationDatabaseUsed: false,
    stages: {}
  };
  const adapter = getAdapter('kaggle');
  const original = adapter.ingestData;
  let runtime, server;
  const interceptor = axios.interceptors.response.use((response) => {
    if (String(response.config.url).startsWith('https://api.kaggle.com/v1/')) {
      const rows = response.data?.kernels || response.data?.datasets || [];
      result.requests.push({
        endpoint: response.config.url,
        status: response.status,
        resources: rows.map((row) =>
          Object.fromEntries(
            [
              'ref',
              'title',
              'author',
              'ownerRef',
              'ownerName',
              'creatorName',
              'creatorUrl',
              'language',
              'lastRunTime',
              'lastUpdated',
              'totalVotes',
              'voteCount',
              'downloadCount',
              'viewCount'
            ]
              .filter((key) => row[key] !== undefined)
              .map((key) => [key, row[key]])
          )
        )
      });
    }
    return response;
  });
  try {
    assert.ok(await cache.initRedisCache({ silent: true, probeOnly: true }));
    runtime = await startMongo();
    await mongoose.connect(runtime.uri, { autoIndex: false });
    await Promise.all([User, Connection, Insight, Log].map((model) => model.createCollection()));
    await Connection.collection.createIndex({ userId: 1, provider: 1 }, { unique: true });
    await Insight.collection.createIndex({ userId: 1 }, { unique: true });
    const owner = new mongoose.Types.ObjectId();
    await User.collection.insertOne({
      _id: owner,
      name: 'Disposable resource acceptance',
      isActive: true,
      providers: ['local']
    });
    // Explicit historical control fixture, not a provider observation or metric claim.
    await Insight.collection.insertOne({
      userId: owner,
      providers: [
        {
          provider: 'kaggle',
          normalized: { historicalControl: true },
          profileScore: 0,
          activityScore: 0,
          confidence: 0,
          inferredSkills: [],
          ownershipVerified: false
        }
      ],
      integrationScore: 0,
      mergedSkills: []
    });
    const historical = JSON.stringify(await Insight.collection.findOne({ userId: owner }));
    process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
    const token = jwt.sign({ id: String(owner) }, process.env.JWT_SECRET, {
      issuer: process.env.JWT_ISSUER || 'devinsight-api',
      audience: process.env.JWT_AUDIENCE || 'devinsight-web',
      expiresIn: '5m'
    });
    const app = express();
    app.use(express.json());
    app.use('/api/integrations', require('../routes/integrations.routes'));
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const origin = `http://127.0.0.1:${server.address().port}/api/integrations`;
    async function call(method, route, body) {
      const response = await fetch(origin + route, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {})
      });
      const data = await response.json();
      assert.equal(response.status, 200, 'Isolated API operation failed.');
      return data;
    }
    // This process serves only the disposable replica. The live adapter stays disabled
    // in source until this candidate's safeguards and full lifecycle have passed.
    adapter.ingestData = candidate.ingestData;
    await call('POST', '/manual/connect', { provider: 'kaggle', externalUsername: result.account });
    result.stages.fetchNormalizePersist = 'PASS';
    const connected = await Connection.findOne({ userId: owner, provider: 'kaggle' }).lean();
    const snapshot = connected.metadata.resourceObservation;
    assert.equal(snapshot.ownershipVerified, false);
    assert.ok(snapshot.activity.notebooks.resources.length > 0);
    assert.ok(snapshot.activity.datasets.resources.length > 0);
    for (const row of snapshot.activity.notebooks.resources) {
      assert.ok(row.ref.startsWith('dansbecker/'));
      assert.equal(row.language, undefined);
    }
    for (const row of snapshot.activity.datasets.resources)
      assert.equal(row.ownerRef, result.account);
    for (const record of result.requests) {
      const stored = record.endpoint.includes('Kernels')
        ? snapshot.activity.notebooks.resources
        : snapshot.activity.datasets.resources;
      for (const source of record.resources) {
        const extracted = stored.find((row) => row.ref === source.ref);
        for (const [key, value] of Object.entries(source))
          if (extracted[key] !== undefined) assert.deepEqual(extracted[key], value);
      }
    }
    const first = await call('GET', '/insights');
    assert.equal(first.publicResources.length, 1);
    const market = await call('GET', '/marketplace');
    assert.equal(
      market.integrations.find((row) => row.provider === 'kaggle').resourceSummary.datasets,
      snapshot.activity.datasets.resources.length
    );
    const signals = await require('../services/developerSignalService').summarizeIntegrationSignal(
      owner
    );
    assert.equal(signals.publicResources.length, 1);
    assert.deepEqual(signals.verifiedSkills, []);
    assert.equal(signals.integrationScore, 0);
    result.stages.downstream = 'PASS';
    await call('POST', '/sync-now', { provider: 'kaggle' });
    assert.equal(await Connection.countDocuments({ userId: owner, provider: 'kaggle' }), 1);
    assert.ok((await Connection.findOne({ userId: owner }).lean()).lastSyncedAt);
    assert.equal(await Log.countDocuments({ userId: owner }), 0);
    assert.equal(JSON.stringify(await Insight.collection.findOne({ userId: owner })), historical);
    result.stages.syncAndHistory = 'PASS';
    await call('DELETE', '/connections/kaggle');
    const disconnected = await call('GET', '/insights');
    assert.deepEqual(disconnected.publicResources, []);
    assert.equal(JSON.stringify(await Insight.collection.findOne({ userId: owner })), historical);
    result.stages.disconnect = 'PASS';
    assert.equal(result.requests.length, 4);
    result.sample = {
      notebooks: snapshot.activity.notebooks.resources.length,
      datasets: snapshot.activity.datasets.resources.length,
      ownershipVerified: false,
      scoringAffected: false
    };
    result.status = 'PASS';
  } catch (error) {
    result.reason = 'ISOLATED_RESOURCE_LIFECYCLE_FAILED';
    result.failureType = error.code === 'ERR_ASSERTION' ? 'assertion' : 'runtime';
    process.exitCode = 1;
  } finally {
    adapter.ingestData = original;
    axios.interceptors.response.eject(interceptor);
    if (server) await new Promise((resolve) => server.close(resolve));
    await cache.closeRedisCache();
    await mongoose.disconnect();
    if (runtime) result.cleanup = await runtime.stop();
    fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
    console.log(
      JSON.stringify(
        {
          status: result.status,
          stages: result.stages,
          sample: result.sample,
          requestCount: result.requests.length,
          reason: result.reason,
          cleanup: result.cleanup
        },
        null,
        2
      )
    );
  }
}
main().catch(() => {
  console.error('Isolated resource verification could not finish; sensitive diagnostics withheld.');
  process.exitCode = 1;
});
