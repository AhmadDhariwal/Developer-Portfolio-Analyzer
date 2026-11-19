const { randomUUID } = require('node:crypto');
const State = require('../models/weeklyReportCoordination');

async function withLease(key, operation, { model = State } = {}) {
  const token = randomUUID();
  const duration = 5 * 60 * 1000;
  let claim;
  try {
    await model.updateOne(
      { _id: key },
      { $setOnInsert: { expiresAt: new Date(0) } },
      { upsert: true },
    );
  } catch (error) {
    if (error.code !== 11000) throw error;
  }
  try {
    claim = await model
      .findOneAndUpdate(
        { _id: key, $expr: { $lte: ['$expiresAt', '$$NOW'] } },
        [{ $set: { token, expiresAt: { $add: ['$$NOW', duration] } } }],
        { returnDocument: 'after', updatePipeline: true },
      )
      .lean();
  } catch (error) {
    if (error.code !== 11000) throw error;
  }
  if (!claim)
    throw Object.assign(new Error('Weekly report work is already in progress.'), { status: 503 });
  // Fence inside the report transaction: an expired/crashed worker cannot
  // overwrite a newer owner. Updating this document also creates a write conflict.
  const fence = async (session) => {
    const result = await model.updateOne(
      { _id: key, token, $expr: { $gt: ['$expiresAt', '$$NOW'] } },
      [{ $set: { expiresAt: { $add: ['$$NOW', duration] } } }],
      { session, updatePipeline: true },
    );
    if (result.matchedCount !== 1) throw new Error('Weekly report lease expired.');
  };
  try {
    return await operation(fence);
  } finally {
    await model.deleteOne({ _id: key, token });
  }
}

module.exports = { withLease };
