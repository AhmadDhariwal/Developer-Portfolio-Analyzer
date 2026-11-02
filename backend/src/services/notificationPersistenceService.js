const mongoose = require('mongoose');
const User = require('../models/user');
const State = require('../models/notificationState');
const metrics = require('./notificationMetrics');

async function transaction(work) {
  const stop = metrics.duration.startTimer({ operation: 'transaction' });
  try {
    if (mongoose.connection.readyState !== 1) throw Error('Database unavailable');
    return await mongoose.connection.transaction(work, {
      readConcern: { level: 'snapshot' },
      writeConcern: { w: 'majority' },
      maxCommitTimeMS: 2000,
      timeoutMS: 5000
    });
  } finally {
    stop();
  }
}

async function fence(userId, session, sessionRevision) {
  const filter = { _id: new mongoose.Types.ObjectId(String(userId)), isActive: { $ne: false } };
  if (sessionRevision !== undefined) {
    filter.$expr = { $eq: [{ $ifNull: ['$sessionRevision', 0] }, sessionRevision] };
  }
  const result = await User.collection.updateOne(
    filter,
    {
      $inc: { integrationMutationVersion: 1 }
    },
    { session }
  );
  if (!result.matchedCount)
    throw Object.assign(Error('Account or session unavailable.'), { status: 401 });
}

async function changed(userId, session) {
  return State.findOneAndUpdate(
    { _id: userId },
    {
      $inc: { revision: 1 },
      $set: { changedAt: new Date() }
    },
    { session, upsert: true, returnDocument: 'after' }
  ).lean();
}
async function commit(userId, mutation, notification, sessionRevision) {
  return transaction(async (session) => {
    await fence(userId, session, sessionRevision);
    const result = await mutation(session);
    const input = typeof notification === 'function' ? notification(result) : notification;
    if (input)
      await require('./notificationService').createNotification({ ...input, userId, session });
    return result;
  });
}
module.exports = { transaction, fence, changed, commit };
