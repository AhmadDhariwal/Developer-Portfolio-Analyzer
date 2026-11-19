const { randomUUID } = require('node:crypto');
const Lease = require('../models/interviewJobLease');

// Mongo is authoritative even when the optional Redis provider is unavailable.
// Jobs share one lease because ingestion and maintenance modify the same bank.
const runInterviewJob = async (operation) => {
  const ownerToken = randomUUID();
  const startedAt = Date.now();
  try {
    const lease = await Lease.findOneAndUpdate(
      {
        _id: 'interview-bank',
        expiresAt: { $lte: new Date(startedAt) }
      },
      { $set: { ownerToken, expiresAt: new Date(startedAt + 15 * 60 * 1000) } },
      { upsert: true, returnDocument: 'after', maxTimeMS: 5000 }
    ).lean();
    if (lease?.ownerToken !== ownerToken) return { skipped: true };
  } catch (error) {
    if (error.code === 11000) return { skipped: true };
    throw error;
  }
  try {
    return await operation({
      // Check between bounded provider/database operations, well before expiry.
      shouldContinue: () => Date.now() - startedAt < 5 * 60 * 1000
    });
  } finally {
    await Lease.deleteOne({ _id: 'interview-bank', ownerToken }).setOptions({ maxTimeMS: 5000 });
  }
};

module.exports = { runInterviewJob };
