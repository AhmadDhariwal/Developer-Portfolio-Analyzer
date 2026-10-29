const mongoose = require('mongoose');
async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw Error('Explicit MongoDB connection configuration is required.');
  require('../services/b2ObjectStorageService').configuration();
  await mongoose.connect(uri, { autoIndex: false });
  try {
    let failed = false;
    await require('../services/storedAssetService')
      .retryCleanup()
      .catch(() => {
        failed = true;
      });
    const Cleanup = require('../models/accountDeletionCleanup');
    for await (const job of Cleanup.find().select('_id').limit(50).lean().cursor())
      await require('../services/accountDeletionService')
        .processCleanup(job._id, { deferObjects: true })
        .catch(() => {
          failed = true;
        });
    if (failed) throw Error('Cleanup pending.');
  } finally {
    await mongoose.disconnect();
  }
}
main().catch(() => {
  console.error('Storage cleanup incomplete; durable receipts retained.');
  process.exitCode = 1;
});
