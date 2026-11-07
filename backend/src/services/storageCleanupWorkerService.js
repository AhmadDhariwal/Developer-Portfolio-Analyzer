const Cleanup = require('../models/accountDeletionCleanup');
const objects = require('./storedAssetService');
const accounts = require('./accountDeletionService');

async function runBatch() {
  const started = Date.now();
  const summary = {
    objectBatchLimit: 50,
    objectReceiptsProcessed: null,
    accountReceiptsProcessed: 0,
    failures: 0,
    oldestSelectedAccountAgeMs: 0
  };
  try {
    summary.objectReceiptsProcessed = await objects.retryCleanup();
  } catch {
    summary.failures++;
  }
  const now = new Date();
  const jobs = Cleanup.find({
    $or: [{ retryAfter: { $lte: now } }, { retryAfter: { $exists: false } }]
  })
    .sort({ retryAfter: 1, createdAt: 1, _id: 1 })
    .select('_id createdAt')
    .limit(50)
    .lean()
    .cursor();
  for await (const job of jobs) {
    summary.accountReceiptsProcessed++;
    summary.oldestSelectedAccountAgeMs = Math.max(
      summary.oldestSelectedAccountAgeMs,
      Math.max(0, now - new Date(job.createdAt || now))
    );
    try {
      await accounts.processCleanup(job._id, { deferObjects: true });
    } catch {
      summary.failures++;
      await Cleanup.updateOne(
        { _id: job._id },
        { $set: { retryAfter: new Date(Date.now() + 60000) }, $inc: { cleanupAttempts: 1 } }
      );
    }
  }
  summary.elapsedMs = Date.now() - started;
  return summary;
}
const mongoose = require('mongoose');
async function runCli() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw Error('Explicit MongoDB connection configuration is required.');
  require('../services/b2ObjectStorageService').configuration();
  try {
    await mongoose.connect(uri, {
      autoCreate: false,
      autoIndex: false,
      maxPoolSize: 4,
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 5000,
      socketTimeoutMS: 20000
    });
    for (const Model of [require('../models/storedAsset'), Cleanup]) {
      const name = Model.collection.collectionName;
      const present = await mongoose.connection.db
        .listCollections({ name }, { nameOnly: true })
        .toArray();
      if (!present.length) throw Error('Storage collections must be explicitly provisioned.');
      const indexes = await Model.collection.indexes();
      if (indexes.some((index) => index.expireAfterSeconds !== undefined))
        throw Error('Cleanup TTL is unsafe.');
      for (const [key, options] of Model.schema.indexes())
        if (
          !indexes.some(
            (index) =>
              JSON.stringify(index.key) === JSON.stringify(key) &&
              !!index.unique === !!options.unique
          )
        )
          throw Error('Storage indexes must be explicitly provisioned.');
    }
    const summary = await runBatch();
    console.log(JSON.stringify({ event: 'storage_cleanup_batch', ...summary }));
    if (summary.failures) process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

module.exports = { runBatch, runCli };
