'use strict';
const { createHash, randomUUID } = require('node:crypto');
const governance = require('./integrationMongoGovernanceService');
const State = require('../models/integrationGovernanceState');
const hash = (value) => createHash('sha256').update(String(value)).digest('hex');
const POLICY_VERSION = 'skill-gap-admission-v1';
const WINDOW_MS = 3600000;
const LEASE_MS = 45000;
const budgets = Object.freeze({
  profile: 30,
  preview: 15,
  guest: 5,
  refresh: 5,
  source: 10,
  ai: 10,
  ip: 60
});
const failure = (status = 503, retryAfter = 2) =>
  Object.assign(
    Error(
      status === 429
        ? 'Skill Gap request limit reached. Please retry later.'
        : 'Skill Gap controls temporarily unavailable.'
    ),
    { status, retryAfter }
  );
async function consume(owner, ip, actions) {
  return governance.transaction(async (session, now) => {
    const until = (Math.floor(now / WINDOW_MS) + 1) * WINDOW_MS;
    const identities = [
      ...actions.map((action) => [action, owner, budgets[action]]),
      ['ip', ip, budgets.ip]
    ];
    for (const [action, identity, maximum] of identities) {
      const key = `skillgap:v1:rate:${action}:${hash(identity)}:${Math.floor(now / WINDOW_MS)}`;
      const row = await State.collection.findOne({ _id: key }, { session });
      const count = row && row.expiresAt > new Date(now) ? row.count : 0;
      if (!Number.isSafeInteger(count) || count < 0) throw failure();
      if (count >= maximum) throw failure(429, Math.max(1, Math.ceil((until - now) / 1000)));
      await State.collection.updateOne(
        { _id: key },
        { $set: { count: count + 1, expiresAt: new Date(until) } },
        { upsert: true, session }
      );
    }
  }, 5000);
}
async function acquire(owner, identity, signal) {
  const token = randomUUID();
  const keys = [
    'skillgap:v1:work:global',
    `skillgap:v1:work:owner:${hash(owner)}`,
    `skillgap:v1:work:key:${hash(identity)}`
  ];
  const started = Date.now();
  let joined = false;
  while (true) {
    if (signal?.aborted) throw failure();
    try {
      await governance.transaction(async (session, now) => {
        for (let i = 0; i < keys.length; i++) {
          const row = await State.collection.findOne({ _id: keys[i] }, { session });
          const leases = (row?.leases || []).filter((lease) => lease.until > new Date(now));
          if (leases.length >= [8, 2, 1][i]) throw failure(429, 2);
          leases.push({ token, until: new Date(now + LEASE_MS) });
          await State.collection.updateOne(
            { _id: keys[i] },
            { $set: { leases, expiresAt: new Date(now + LEASE_MS) } },
            { upsert: true, session }
          );
        }
      }, 5000);
      return { token, keys, joined };
    } catch (error) {
      if (error.status !== 429 || Date.now() - started > 10000) throw error;
      joined = true;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}
async function fence(reservation, session, signal) {
  if (signal?.aborted) throw failure();
  const result = await State.collection.updateOne(
    {
      _id: reservation.keys[2],
      leases: { $elemMatch: { token: reservation.token, until: { $gt: new Date() } } }
    },
    { $inc: { count: 1 } },
    { session }
  );
  if (!result.matchedCount) throw failure();
}
module.exports = {
  POLICY_VERSION,
  WINDOW_MS,
  LEASE_MS,
  budgets,
  consume,
  acquire,
  fence,
  release: governance.release,
  failure
};
