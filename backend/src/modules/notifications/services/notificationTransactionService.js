const mongoose = require('mongoose');
const User = require('../../auth/models/user');
const State = require('../models/notificationState');
const metrics = require('./notificationMetrics');

const settledModelInits = new WeakSet();

const trackModelInit = (promise) =>
  Promise.resolve(promise).then(
    () => settledModelInits.add(promise),
    () => settledModelInits.add(promise)
  );

async function ensureModelsReadyForTransaction() {
  // User is written in fence(), and notificationService reads PlatformSettings, User,
  // Membership, Team, Receipt and Notification inside the transaction. Initialize all
  // required collections/indexes plus any already-started background autoIndex work on
  // this connection so cold DDL cannot race or acquire locks during an open transaction.
  const required = [
    User,
    State,
    require('../models/notification'),
    require('../models/notificationReceipt'),
    require('../../admin/models/membership'),
    require('../../admin/models/team'),
    require('../../super-admin/models/platformSettings')
  ];
  await Promise.all(
    required.map(async (model) => {
      if (typeof model?.init !== 'function') return;
      const cached = model.$init;
      if (cached && settledModelInits.has(cached)) return;
      await model.init();
      if (model.$init) settledModelInits.add(model.$init);
    })
  );

  const pendingBackground = [];
  for (const model of Object.values(mongoose.connection?.models || {})) {
    const initPromise = model?.$init;
    if (initPromise && !settledModelInits.has(initPromise)) {
      pendingBackground.push(trackModelInit(initPromise));
    }
  }
  if (pendingBackground.length) await Promise.all(pendingBackground);
}

async function transaction(work) {
  const stop = metrics.duration.startTimer({ operation: 'transaction' });
  try {
    if (mongoose.connection.readyState !== 1) throw Error('Database unavailable');
    await ensureModelsReadyForTransaction();
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

module.exports = { transaction, fence, changed };
