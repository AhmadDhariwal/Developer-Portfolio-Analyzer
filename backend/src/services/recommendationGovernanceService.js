'use strict';
const { createHash, randomUUID } = require('node:crypto');
const mongo = require('./integrationMongoGovernanceService');
const State = require('../models/integrationGovernanceState');
const hash = (value) => createHash('sha256').update(String(value)).digest('hex');
const WINDOW_MS = 3600000;
const LEASE_MS = 60000;
const budgets = Object.freeze({
  profile: 30,
  preview: 15,
  guest: 5,
  refresh: 5,
  read: 120,
  ai: 5,
  ip: 120,
});
const failure = (status = 503, retryAfter = 2) =>
  Object.assign(
    Error(
      status === 429
        ? 'Recommendations request limit reached. Please retry later.'
        : 'Recommendations controls temporarily unavailable.'
    ),
    { status, retryAfter }
  );

async function consume(owner, ip, actions) {
  return mongo.transaction(async (session, now) => {
    const until = (Math.floor(now / WINDOW_MS) + 1) * WINDOW_MS;
    for (const [action, identity] of [...new Set(actions)]
      .map((action) => [action, owner])
      .concat([['ip', ip]])) {
      if (!budgets[action]) throw failure();
      const key = `recommendations:v1:rate:${action}:${hash(identity)}:${Math.floor(now / WINDOW_MS)}`;
      const row = await State.collection.findOne({ _id: key }, { session });
      const count = row && row.expiresAt > new Date(now) ? row.count : 0;
      if (!Number.isSafeInteger(count) || count < 0) throw failure();
      if (count >= budgets[action])
        throw failure(429, Math.max(1, Math.ceil((until - now) / 1000)));
      await State.collection.updateOne(
        { _id: key },
        { $set: { count: count + 1, expiresAt: new Date(until) } },
        { upsert: true, session }
      );
    }
  }, 5000);
}

async function acquire(owner, signal) {
  const token = randomUUID();
  // Serialize an owner's generation across modes and workers, including refresh.
  const keys = ['recommendations:v1:work:global', `recommendations:v1:work:owner:${hash(owner)}`];
  const started = Date.now();
  let joined = false;
  while (true) {
    if (signal?.aborted) throw failure();
    try {
      await mongo.transaction(async (session, now) => {
        for (let index = 0; index < keys.length; index++) {
          const row = await State.collection.findOne({ _id: keys[index] }, { session });
          const leases = (row?.leases || []).filter((lease) => lease.until > new Date(now));
          if (leases.length >= [8, 1][index]) throw failure(429, 2);
          leases.push({ token, until: new Date(now + LEASE_MS) });
          await State.collection.updateOne(
            { _id: keys[index] },
            { $set: { leases, expiresAt: new Date(now + LEASE_MS) } },
            { upsert: true, session }
          );
        }
      }, 5000);
      return { token, keys, joined };
    } catch (error) {
      if (error.status !== 429 || Date.now() - started >= 10000) throw error;
      joined = true;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

async function fence(reservation, session, signal) {
  if (signal?.aborted) throw failure();
  const result = await State.collection.updateOne(
    {
      _id: reservation.keys[1],
      leases: { $elemMatch: { token: reservation.token, until: { $gt: new Date() } } },
    },
    { $inc: { count: 1 } },
    { session }
  );
  if (!result.matchedCount) throw failure();
}

module.exports = {
  consume,
  acquire,
  fence,
  failure,
  budgets,
  LEASE_MS,
  WINDOW_MS,
  transaction: mongo.transaction,
  release: mongo.release,
};
