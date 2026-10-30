// Explicit maintenance target only; never loads .env or infers the application DB.
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const Asset = require('../models/storedAsset');
const Cleanup = require('../models/accountDeletionCleanup');
function target(env, apply) {
  const uri = env.STORAGE_MAINTENANCE_MONGO_URI;
  const database = env.STORAGE_MAINTENANCE_DATABASE;
  assert.ok(uri && /^mongodb(?:\+srv)?:\/\//.test(uri), 'Explicit maintenance URI required.');
  assert.match(database || '', /^[A-Za-z0-9_-]{1,63}$/);
  assert.ok(!['admin', 'config', 'local'].includes(database));
  if (apply) {
    const local =
      /^mongodb:\/\/(?:127\.0\.0\.1|localhost):\d+\//.test(uri) &&
      /^profile_b2_security_[a-f0-9]{24}$/.test(database);
    const staging =
      env.STORAGE_MAINTENANCE_ENV === 'staging' &&
      env.STORAGE_MAINTENANCE_ACK === 'authorized-staging-target';
    assert.ok(
      local || staging,
      'Apply requires a disposable loopback target or explicitly authorized staging target.'
    );
  }
  return { uri, database };
}
async function provision({ env = process.env, apply = false } = {}) {
  const { uri, database } = target(env, apply);
  try {
    await mongoose.connect(uri, {
      dbName: database,
      autoCreate: false,
      autoIndex: false,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 10000
    });
    const hello = await mongoose.connection.db.admin().command({ hello: 1 });
    assert.ok(
      (hello.setName || hello.msg === 'isdbgrid') && hello.logicalSessionTimeoutMinutes,
      'Transactions require a replica set or sharded cluster.'
    );
    const result = {
      mode: apply ? 'apply' : 'inspect',
      transactionTopology: true,
      collections: {}
    };
    for (const Model of [Asset, Cleanup]) {
      const name = Model.collection.collectionName;
      if (apply) {
        await Model.createCollection();
        // Add declared indexes only. Never syncIndexes, drop, rename or modify data.
        await Model.createIndexes();
      }
      const present =
        (await mongoose.connection.db.listCollections({ name }, { nameOnly: true }).toArray())
          .length === 1;
      const indexes = present ? await Model.collection.indexes() : [];
      assert.ok(
        !indexes.some((index) => index.expireAfterSeconds !== undefined),
        'Durable cleanup receipts must not have TTL indexes.'
      );
      for (const [key, options] of Model.schema.indexes())
        if (apply)
          assert.ok(
            indexes.some(
              (index) =>
                JSON.stringify(index.key) === JSON.stringify(key) &&
                !!index.unique === !!options.unique
            )
          );
      result.collections[name] = {
        present,
        indexes: indexes.map(({ key, unique }) => ({ key, unique: !!unique }))
      };
    }
    return result;
  } finally {
    await mongoose.disconnect();
  }
}
if (require.main === module)
  provision({ apply: process.argv.includes('--apply') })
    .then((result) => console.log(JSON.stringify(result)))
    .catch(() => {
      console.error(
        'Storage provisioning failed; inspect explicit target, topology, permissions and index conflicts. No destructive index repair was attempted.'
      );
      process.exitCode = 1;
    });
module.exports = { target, provision };
