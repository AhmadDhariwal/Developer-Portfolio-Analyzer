'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { fork } = require('node:child_process');
const readline = require('node:readline');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { startMongo } = require('./verifyIntegrationsRealProviders');
const User = require('../models/user');
const Connection = require('../models/integrationConnection');
const Insight = require('../models/integrationInsight');
const root = path.resolve(__dirname, '../../verification/integrations');
const outputName =
  process.argv.find((arg) => arg.startsWith('--output='))?.slice(9) ||
  'combined-browser-runtime-accepted-2026-10-27.json';
assert.match(outputName, /^[a-z0-9-]+\.json$/);
const output = path.join(root, outputName);
const evidence = {
  startedAt: new Date().toISOString(),
  applicationDatabaseUsed: false,
  api: [],
  externalRequests: [],
  snapshots: []
};
let runtime, child, owner;
let stopping = false;
async function audit() {
  const connections = await Connection.find({ userId: owner }).lean();
  const insight = await Insight.findOne({ userId: owner }).lean();
  const snapshot = {
    at: new Date().toISOString(),
    connections: connections.map((row) => ({
      provider: row.provider,
      status: row.status,
      ownershipVerified: row.ownershipVerified,
      lastSynced: Boolean(row.lastSyncedAt),
      lastError: row.lastSyncError || '',
      resources: row.metadata?.resourceObservation
        ? {
            notebooks: row.metadata.resourceObservation.activity.notebooks.resources.length,
            datasets: row.metadata.resourceObservation.activity.datasets.resources.length
          }
        : undefined
    })),
    integrationScore: insight?.integrationScore ?? null,
    scoredProviders: insight?.providers.map((row) => row.provider) || [],
    verifiedSkills:
      insight?.providers
        .filter((row) => row.ownershipVerified)
        .flatMap((row) => row.inferredSkills) || []
  };
  evidence.snapshots.push(snapshot);
  console.log(JSON.stringify(snapshot));
}
async function seedKaggle() {
  const source = JSON.parse(
    fs.readFileSync(path.join(root, 'kaggle-attribution-diagnostic-2026-10-27.json'), 'utf8')
  );
  const before = JSON.stringify(await Insight.findOne({ userId: owner }).lean());
  await Connection.collection.insertOne({
    userId: owner,
    provider: 'kaggle',
    status: 'connected',
    externalUsername: 'dansbecker',
    ownershipVerified: false,
    accessToken: '',
    refreshToken: '',
    lastSyncedAt: new Date(source.checkedAt),
    nextSyncAt: new Date(Date.now() + 86400000),
    metadata: {
      resourceObservation: {
        version: 'kaggle-resources-v1',
        profile: { username: 'dansbecker', ownershipVerified: false, visibility: 'public' },
        activity: { notebooks: source.notebooks, datasets: source.datasets },
        ownershipVerified: false,
        evidenceKind: 'public-resources',
        observedAt: source.checkedAt
      }
    }
  });
  assert.equal(JSON.stringify(await Insight.findOne({ userId: owner }).lean()), before);
  evidence.kaggleSeed = 'Retained real-data fixture only; no fetch; scored document byte-identical';
  await audit();
}
async function stop() {
  if (stopping) return;
  stopping = true;
  if (child?.exitCode === null) {
    const done = new Promise((resolve) => child.once('exit', resolve));
    child.kill();
    await done;
  }
  await mongoose.disconnect();
  if (runtime) evidence.cleanup = await runtime.stop();
  evidence.finishedAt = new Date().toISOString();
  fs.writeFileSync(output, JSON.stringify(evidence, null, 2) + '\n');
  console.log('Isolated backend stopped and temporary Mongo files cleaned.');
  process.exit();
}
async function main() {
  assert.ok(!fs.existsSync(output), 'Existing browser acceptance evidence must not be overwritten');
  runtime = await startMongo();
  await mongoose.connect(runtime.uri, { autoIndex: false });
  await User.createCollection();
  await Connection.createCollection();
  await Insight.createCollection();
  await Connection.collection.createIndex({ userId: 1, provider: 1 }, { unique: true });
  await Insight.collection.createIndex({ userId: 1 }, { unique: true });
  owner = new mongoose.Types.ObjectId();
  await User.collection.insertOne({
    _id: owner,
    name: 'Combined Acceptance',
    email: 'combined-acceptance@invalid.test',
    password: await bcrypt.hash('Disposable-Acceptance-2026!', 10),
    providers: ['local'],
    role: 'developer',
    isActive: true,
    emailVerified: true,
    isVerified: true,
    careerStack: 'Frontend',
    experienceLevel: 'Student',
    notifications: { weeklyScoreReport: false }
  });
  child = fork(path.resolve(__dirname, '../../index.js'), [], {
    cwd: path.resolve(__dirname, '../..'),
    windowsHide: true,
    execArgv: ['--require', path.join(__dirname, 'combinedIntegrationsPreload.js')],
    env: {
      ...process.env,
      NODE_ENV: 'development',
      PORT: '5017',
      MONGODB_URI: runtime.uri,
      NEWS_INGESTION_ENABLED: 'false',
      WEEKLY_REPORT_SCHEDULER_ENABLED: 'false'
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc']
  });
  child.on('message', (message) => {
    if (message.kind === 'fixture') console.log(JSON.stringify(message));
    if (message.kind === 'api') evidence.api.push(message);
    if (message.kind === 'externalRequest') evidence.externalRequests.push(message);
  });
  child.stdout.on('data', (chunk) => {
    if (String(chunk).includes('server started'))
      console.log(
        'Actual backend ready on http://127.0.0.1:5017 using disposable Mongo and configured Redis.'
      );
  });
  child.stderr.on('data', () => {});
  child.on('exit', (code) => {
    if (!stopping) console.log('Backend exited with code ' + code);
  });
  const input = readline.createInterface({ input: process.stdin });
  for await (const line of input) {
    if (line.trim() === 'validate-portfolio') {
      const token = require('jsonwebtoken').sign({ id: String(owner) }, process.env.JWT_SECRET, {
        issuer: process.env.JWT_ISSUER || 'devinsight-api',
        audience: process.env.JWT_AUDIENCE || 'devinsight-web',
        expiresIn: '5m'
      });
      const response = await fetch('http://127.0.0.1:5017/api/integrations/manual/connect', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'portfolio', externalUsername: 'ftp://example.com' })
      });
      assert.equal(response.status, 400);
      assert.equal(await Connection.countDocuments({ userId: owner }), 0);
      evidence.unsupportedPortfolioUrl = {
        status: response.status,
        connectionRows: 0,
        message: (await response.json()).message
      };
      console.log(JSON.stringify(evidence.unsupportedPortfolioUrl));
    }
    if (line.trim() === 'audit') await audit();
    if (line.trim() === 'seed-kaggle') await seedKaggle();
    if (line.trim() === 'stop') await stop();
  }
}
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
main().catch(async () => {
  console.error('Combined acceptance runtime failed; sensitive diagnostics withheld.');
  await stop();
});
