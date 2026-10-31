// Audit by default. --apply creates missing collections/indexes without dropping
// or rewriting existing indexes, notifications, receipts or delivery history.
const mongoose = require('mongoose');
if (require.main === module) {
  mongoose.set('autoCreate', false);
  mongoose.set('autoIndex', false);
}
const models = [
  require('../models/notification'),
  require('../models/notificationState'),
  require('../models/notificationReceipt'),
  require('../models/supportTicket'),
  require('../models/supportTicketQuota'),
  require('../models/supportTicketDedupe'),
  require('../models/weeklyReport')
];

async function migrate({ apply = false } = {}) {
  if (mongoose.connection.readyState !== 1)
    throw Error('Connect to the explicitly selected database first.');
  const results = [];
  for (const Model of models) {
    let existing = [];
    try {
      existing = await Model.collection.listIndexes().toArray();
    } catch (error) {
      if (error.code !== 26) throw error;
    }
    const missing = Model.schema
      .indexes()
      .filter(
        ([keys, options]) =>
          !existing.some(
            (index) =>
              JSON.stringify(index.key) === JSON.stringify(keys) &&
              Boolean(index.unique) === Boolean(options.unique)
          )
      );
    results.push({
      collection: Model.collection.collectionName,
      existing: existing.map(
        ({ name, key, unique, expireAfterSeconds, partialFilterExpression }) => ({
          name,
          key,
          unique: Boolean(unique),
          ...(expireAfterSeconds !== undefined ? { expireAfterSeconds } : {}),
          ...(partialFilterExpression ? { partialFilterExpression } : {})
        })
      ),
      missing: missing.map(([keys, options]) => ({ keys, name: options.name || null }))
    });
    if (apply) {
      await Model.createCollection();
      for (const [keys, options] of missing)
        await Model.collection.createIndex(keys, { ...options, maxTimeMS: 60000 });
    }
  }
  return { apply, results };
}

if (require.main === module) {
  // Operators supply a URI explicitly. Never implicitly load a production .env.
  const uri = process.env.NOTIFICATION_MIGRATION_URI;
  if (!uri) {
    console.error('NOTIFICATION_MIGRATION_URI must select the intended database.');
    process.exitCode = 1;
  } else
    mongoose
      .connect(uri, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 5000 })
      .then(() => migrate({ apply: process.argv.includes('--apply') }))
      .then((result) => console.log(JSON.stringify(result, null, 2)))
      .catch(() => {
        console.error(
          'Notification index audit/migration failed. Existing data and indexes were preserved.'
        );
        process.exitCode = 1;
      })
      .finally(() => mongoose.disconnect());
}
module.exports = { migrate };
