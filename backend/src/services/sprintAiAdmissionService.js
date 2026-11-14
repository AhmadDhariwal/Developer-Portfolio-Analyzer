'use strict';

const { createHash, randomUUID } = require('node:crypto');
const mongo = require('./integrationMongoGovernanceService');
const State = require('../models/integrationGovernanceState');
const WINDOW_MS = 60 * 60 * 1000;
const LEASE_MS = 10_000;
const LIMITS = Object.freeze({ hourly: 5, owner: 1, global: 8 });
const PREFIX = 'career-sprint:ai:v1:';

// Admission is optional-AI only. Its failure must never prevent a deterministic plan.
const acquire = async (owner) => {
  if (!owner) return null;
  const identity = createHash('sha256').update(String(owner)).digest('hex');
  const keys = [`${PREFIX}work:global`, `${PREFIX}work:owner:${identity}`];
  const token = randomUUID();
  let rateKey;
  try {
    // Quota and both leases commit together; denied work consumes no quota.
    await mongo.transaction(async (session, now) => {
      rateKey = `${PREFIX}rate:${identity}:${Math.floor(now / WINDOW_MS)}`;
      const row = await State.collection.findOne({ _id: rateKey }, { session });
      const count = row && row.expiresAt > new Date(now) ? row.count : 0;
      if (!Number.isSafeInteger(count) || count < 0 || count >= LIMITS.hourly) throw Error('AI admission denied.');
      for (const [index, key] of keys.entries()) {
        const work = await State.collection.findOne({ _id: key }, { session });
        const leases = (work?.leases || []).filter((lease) => lease.until > new Date(now));
        if (leases.length >= [LIMITS.global, LIMITS.owner][index]) throw Error('AI admission denied.');
        leases.push({ token, until: new Date(now + LEASE_MS) });
        await State.collection.updateOne(
          { _id: key },
          { $set: { leases, expiresAt: new Date(now + LEASE_MS) } },
          { upsert: true, session }
        );
      }
      await State.collection.updateOne(
        { _id: rateKey },
        { $set: { count: count + 1, expiresAt: new Date((Math.floor(now / WINDOW_MS) + 1) * WINDOW_MS) } },
        { upsert: true, session }
      );
    });
    return { keys, token, rateKey };
  } catch {
    return null;
  }
};

const release = async (reservation) => {
  if (!reservation) return;
  // Token-scoped cleanup cannot release another worker's lease or refund quota.
  // Failed cleanup retains only a bounded 10-second lease, never an unbounded job.
  await mongo.release(reservation).catch(() => {});
};

module.exports = { acquire, release, LIMITS, LEASE_MS, WINDOW_MS, PREFIX };
