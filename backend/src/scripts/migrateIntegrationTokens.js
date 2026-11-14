'use strict';
// Offline, restartable, compare-and-set migration. Never prints URIs or token values.
const mongoose = require('mongoose');
const tokens = require('../services/integrationTokenService');
async function migrate(collection, { apply = false, rotate = false } = {}) {
  tokens.keyring();
  const result = { scanned: 0, eligible: 0, changed: 0, conflicts: 0 };
  const cursor = collection.find(
    {
      $or: [
        { accessToken: { $type: 'string', $ne: '' } },
        { refreshToken: { $type: 'string', $ne: '' } }
      ]
    },
    {
      projection: { _id: 1, userId: 1, provider: 1, accessToken: 1, refreshToken: 1 },
      batchSize: 100
    }
  );
  for await (const row of cursor) {
    result.scanned++;
    const set = {};
    for (const field of ['accessToken', 'refreshToken']) {
      const old = row[field];
      if (!old) continue;
      if (old.startsWith(tokens.PREFIX)) {
        // Validate every envelope, even during dry runs. Re-encrypt only on rotation.
        const plain = tokens.decrypt(old, row.userId, row.provider, field);
        if (rotate && !old.startsWith(tokens.PREFIX + tokens.keyring().active + ':'))
          set[field] = tokens.encrypt(plain, row.userId, row.provider, field);
      } else set[field] = tokens.encrypt(old, row.userId, row.provider, field);
    }
    if (!Object.keys(set).length) continue;
    result.eligible++;
    if (apply) {
      const changed = await collection.updateOne(
        {
          _id: row._id,
          ...Object.fromEntries(Object.keys(set).map((field) => [field, row[field]]))
        },
        { $set: set }
      );
      result.changed += changed.modifiedCount;
      result.conflicts += changed.matchedCount ? 0 : 1;
    }
  }
  return result;
}
if (require.main === module) {
  (async () => {
    try {
      if (!process.env.MONGODB_URI) throw Error('Missing migration URI.');
      await mongoose.connect(process.env.MONGODB_URI, {
        autoIndex: false,
        serverSelectionTimeoutMS: 5000
      });
      console.log(
        JSON.stringify(
          await migrate(mongoose.connection.collection('integrationconnections'), {
            apply: process.argv.includes('--apply'),
            rotate: process.argv.includes('--rotate')
          })
        )
      );
    } catch {
      console.error(
        'Integration token migration failed; inspect configuration without logging credentials.'
      );
      process.exitCode = 1;
    } finally {
      await mongoose.disconnect();
    }
  })();
}
module.exports = { migrate };
