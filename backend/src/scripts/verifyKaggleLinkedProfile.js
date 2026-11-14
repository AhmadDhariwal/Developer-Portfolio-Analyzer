'use strict';

// Local disposable Mongo acceptance only; no Kaggle traffic or application database use.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { startMongo } = require('./verifyIntegrationsRealProviders');
const links = require('../services/integrationLinkedProfileService');
const controller = require('../controllers/integrationLinkedProfilescontroller').kaggle;
const LinkedProfile = require('../models/integrationLinkedProfile');
const User = require('../models/user');
const Connection = require('../models/integrationConnection');
const Insight = require('../models/integrationInsight');
const Log = require('../models/integrationSyncLog');

async function main() {
  const output = path.resolve(
    __dirname,
    '../../verification/integrations/kaggle-linked-profile-acceptance-2026-10-27.json'
  );
  if (fs.existsSync(output)) throw Error('Evidence exists.');
  const result = {
    checkedAt: new Date().toISOString(),
    scope: 'isolated linked-profile persistence; not resource ingestion',
    status: 'BLOCKED',
    kaggleApiRequests: 0,
    applicationDatabaseUsed: false
  };
  let runtime;
  try {
    runtime = await startMongo();
    await mongoose.connect(runtime.uri, { autoIndex: false });
    await Promise.all(
      [User, LinkedProfile, Connection, Insight, Log].map((model) => model.createCollection())
    );
    await LinkedProfile.collection.createIndex({ userId: 1, provider: 1 }, { unique: true });
    const owner = new mongoose.Types.ObjectId();
    const foreign = new mongoose.Types.ObjectId();
    await User.collection.insertOne({ _id: owner, name: 'Disposable link acceptance' });
    // Marker-only historical fixture verifies preservation; it is not provider data.
    await Insight.collection.insertOne({
      userId: owner,
      providers: [],
      historicalMarker: 'retain',
      integrationScore: 0
    });
    const before = JSON.stringify(await Insight.collection.findOne({ userId: owner }));
    const saved = await links.save(owner, 'kaggle', 'kaggle');
    assert.equal(saved.ownershipVerified, false);
    assert.equal(saved.profileUrl, 'https://www.kaggle.com/kaggle');
    assert.equal(await links.get(foreign, 'kaggle'), null);
    await links.save(owner, 'https://www.kaggle.com/kaggle', 'kaggle');
    assert.equal(await LinkedProfile.countDocuments({ userId: owner, provider: 'kaggle' }), 1);
    const res = {
      json(body) {
        this.body = body;
        return this;
      },
      status() {
        throw Error('Controller rejected read');
      }
    };
    await controller.get({ user: { _id: owner } }, res);
    assert.equal(res.body.linkedProfile.username, 'kaggle');
    assert.equal(res.body.linkedProfile.evidenceKind, 'user-entered-link');
    await links.remove(owner, 'kaggle');
    assert.equal(await links.get(owner, 'kaggle'), null);
    assert.equal(await Connection.countDocuments({ userId: owner }), 0);
    assert.equal(await Log.countDocuments({ userId: owner }), 0);
    assert.equal(JSON.stringify(await Insight.collection.findOne({ userId: owner })), before);
    Object.assign(result, {
      status: 'PASS',
      transactionAndPersistence: 'PASS',
      ownerIsolation: 'PASS',
      duplicatePrevention: 'PASS',
      controllerReadAdoption: 'PASS',
      removeLink: 'PASS',
      historicalSnapshotUnchanged: true,
      noConnectionOrScoredSyncCreated: true
    });
  } catch {
    result.reason = 'ISOLATED_LINK_ACCEPTANCE_FAILED';
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
    if (runtime) result.cleanup = await runtime.stop();
    fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify(result, null, 2));
  }
}
main().catch(() => {
  console.error('Local link acceptance could not complete; sensitive details withheld.');
  process.exitCode = 1;
});
