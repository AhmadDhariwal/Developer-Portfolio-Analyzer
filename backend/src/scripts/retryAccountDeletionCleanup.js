// Operational retry: no production connection is inferred from a local .env.
const mongoose = require('mongoose');
async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw Error('Explicit MONGODB_URI is required.');
  await mongoose.connect(uri, { autoIndex: false });
  try {
    const Cleanup = require('../models/accountDeletionCleanup');
    for await (const job of Cleanup.find().select('_id').lean().cursor())
      await require('../services/accountDeletionService').processCleanup(job._id);
  } finally {
    await mongoose.disconnect();
  }
}
main().catch(() => {
  console.error('Account cleanup failed; receipts retained.');
  process.exitCode = 1;
});
