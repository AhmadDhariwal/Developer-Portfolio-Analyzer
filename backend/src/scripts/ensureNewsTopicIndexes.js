const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

// Default is read-only inventory. Explicit --apply creates declared indexes only;
// never syncIndexes/dropIndex or remove documents in this migration.
async function ensure(connection, apply = false) {
  const model = connection.model('NewsTopicCache', require('../models/newsTopicCache').schema);
  if (apply) await model.createIndexes();
  const indexes = await model.collection.indexes();
  const requirements = {
    uniqueCacheKey: indexes.some((index) => index.unique && index.key.cacheKey === 1),
    absoluteExpiry: indexes.some((index) => index.key.expiresAt === 1 && index.expireAfterSeconds === 0),
    topicExpiry: indexes.some((index) => index.key['filters.topic'] === 1 && index.key.expiresAt === 1)
  };
  return { applied: apply, requirements, complete: Object.values(requirements).every(Boolean) };
}
if (require.main === module) {
  const mongoose = require('mongoose');
  let connection;
  (async () => {
    try {
      connection = await mongoose
        .createConnection(process.env.MONGODB_URI, { autoIndex: false, serverSelectionTimeoutMS: 5000 })
        .asPromise();
      const result = await ensure(connection, process.argv.includes('--apply'));
      console.log(JSON.stringify(result, null, 2));
      if (!result.complete) process.exitCode = 1;
    } catch {
      console.error('News index inspection failed; database unavailable or index creation requires review.');
      process.exitCode = 1;
    } finally {
      if (connection) await connection.close();
    }
  })();
}
module.exports = { ensure };
