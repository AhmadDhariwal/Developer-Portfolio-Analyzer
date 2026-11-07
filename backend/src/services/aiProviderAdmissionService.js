const { randomUUID, createHash } = require('node:crypto');
const State = require('../models/aiProviderAdmission');
const { setting } = require('../config/aiProviders');
const failure = (reason) => Object.assign(new Error('AI admission unavailable.'), { aiReason: reason });
const query = (operation, deadline) => {
  const remaining = Math.min(500, deadline - Date.now());
  if (remaining < 1) throw failure('timeout');
  return operation.setOptions({ maxTimeMS: remaining, timeoutMS: remaining });
};
const fingerprint = (provider, key, model) =>
  createHash('sha256')
    .update(JSON.stringify([provider, key, model]))
    .digest('hex');
const reserve = async (scope, limit, duration, deadline) => {
  const bucket = Math.floor(Date.now() / duration);
  try {
    await query(
      State.findOneAndUpdate(
        { _id: `${scope}:${bucket}`, count: { $lt: limit } },
        {
          $inc: { count: 1 },
          $setOnInsert: { expiresAt: new Date((bucket + 1) * duration) }
        },
        { upsert: true }
      ),
      deadline
    );
  } catch (error) {
    throw failure(error.code === 11000 ? 'local_quota' : error.aiReason || 'coordination_unavailable');
  }
};
const acquire = async (scope, maximum, deadline, leaseMs) => {
  const token = randomUUID();
  for (let index = 0; index < maximum; index++) {
    const id = `slot:${scope}:${index}`;
    try {
      await query(
        State.findOneAndUpdate(
          { _id: id, expiresAt: { $lte: new Date() } },
          {
            $set: { token, expiresAt: new Date(Date.now() + leaseMs) }
          },
          { upsert: true }
        ),
        deadline
      );
      return { id, token };
    } catch (error) {
      if (error.code !== 11000) throw failure(error.aiReason || 'coordination_unavailable');
    }
  }
  throw failure('concurrency_limit');
};
const release = (lease) =>
  lease
    ? State.deleteOne({ _id: lease.id, token: lease.token })
        .setOptions({ maxTimeMS: 500, timeoutMS: 500 })
        .catch(() => {})
    : Promise.resolve();
const enter = async (scope, deadline, leaseMs) => {
  const global = scope === 'global';
  const prefix = global ? 'AI_GLOBAL' : scope.toUpperCase();
  const lease = await acquire(scope, setting(`${prefix}_MAX_CONCURRENCY`, 64), deadline, leaseMs);
  try {
    await reserve(`quota:${scope}`, setting(`${prefix}_REQUESTS_PER_MINUTE`, 100000), 60000, deadline);
    await reserve(`daily:${scope}`, setting(`${prefix}_REQUESTS_PER_DAY`, 1000000), 86400000, deadline);
    return lease;
  } catch (error) {
    await release(lease);
    throw error;
  }
};
const circuit = async (identity, deadline) => {
  try {
    const state = await query(State.findById(`circuit:${identity}`), deadline).lean();
    return !state?.openUntil || state.openUntil.getTime() <= Date.now();
  } catch (error) {
    throw failure(error.aiReason || 'coordination_unavailable');
  }
};
const record = async (
  identity,
  success,
  { configuration = false, cooldownMs = 180000, rateLimited = false } = {},
  deadline
) => {
  try {
    const state = await query(
      State.findOneAndUpdate(
        { _id: `circuit:${identity}` },
        {
          ...(success
            ? { $set: { count: 0, openUntil: new Date(0), expiresAt: new Date(Date.now() + 86400000) } }
            : {
                $inc: { count: 1 },
                $set: { expiresAt: new Date(Date.now() + 86400000) }
              })
        },
        { upsert: true, returnDocument: 'after' }
      ),
      deadline
    ).lean();
    if (!success && (configuration || rateLimited || state.count >= setting('AI_CIRCUIT_FAILURE_THRESHOLD', 20))) {
      await query(
        State.updateOne(
          { _id: state._id, count: state.count },
          {
            $set: {
              openUntil: new Date(Date.now() + (configuration ? setting('AI_AUTH_COOLDOWN_MS', 86400000) : cooldownMs))
            }
          }
        ),
        deadline
      );
    }
  } catch {
    /* Never hide a provider outcome; admission still fails closed on the next call. */
  }
};
module.exports = { enter, release, circuit, record, fingerprint, reserve, acquire };
