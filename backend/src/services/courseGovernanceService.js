'use strict';
const crypto = require('node:crypto');
const mongoose = require('mongoose');
const { setTimeout: delay } = require('node:timers/promises');
const State = require('../models/integrationGovernanceState');
const mongo = require('./integrationMongoGovernanceService');

const digest = (value) =>
  crypto
    .createHash('sha256')
    .update(String(value || ''))
    .digest('hex');

const windowKey = (bucket, scope) => `courses:v1:rate:${bucket}:${digest(scope)}`;

const leaseKey = (signalHash) => `courses:v1:lease:${digest(signalHash)}`;
const POOL_LEASE_MS = 30_000;
const POOL_STORE_TIMEOUT_MS = Number(process.env.COURSES_POOL_STORE_TIMEOUT_MS || 2000);
const poolBusy = () =>
  Object.assign(new Error('Course pool temporarily unavailable.'), {
    status: 503,
  });

async function window(
  bucket,
  scope,
  max,
  windowMs = Number(process.env.COURSES_RATE_LIMIT_WINDOW_MS || 60000),
) {
  await mongo.initialize();
  const limit = Math.max(1, Math.trunc(Number(max) || 60));
  const durationMs = Math.max(1000, Math.trunc(Number(windowMs) || 60000));
  const key = windowKey(bucket, scope);
  const serverSlot = { $floor: { $divide: [{ $toLong: '$$NOW' }, durationMs] } };

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const updated = await State.collection.findOneAndUpdate(
        { _id: key },
        [
          {
            $set: {
              count: { $cond: [{ $eq: ['$windowSlot', serverSlot] }, { $add: ['$count', 1] }, 1] },
              windowSlot: serverSlot,
              serverNow: '$$NOW',
              expiresAt: { $toDate: { $multiply: [{ $add: [serverSlot, 1] }, durationMs] } },
            },
          },
        ],
        { upsert: true, returnDocument: 'after', timeoutMS: POOL_STORE_TIMEOUT_MS },
      );
      const doc = updated?.value ?? updated;
      const count = Number(doc?.count || 1);
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((doc.expiresAt.getTime() - doc.serverNow.getTime()) / 1000),
      );
      if (count > limit) {
        return {
          allowed: false,
          limit,
          remaining: 0,
          retryAfterSeconds,
        };
      }
      return {
        allowed: true,
        limit,
        remaining: Math.max(0, limit - count),
        retryAfterSeconds: 0,
      };
    } catch (error) {
      if (error?.code === 11000 && attempt < 2) continue;
      throw error;
    }
  }
  throw poolBusy();
}

async function acquirePoolLease(signalHash, leaseMs = POOL_LEASE_MS) {
  if (mongoose.connection.readyState !== 1) {
    return { acquired: true, token: null };
  }
  try {
    await mongo.initialize();
    const key = leaseKey(signalHash);
    const token = crypto.randomUUID();
    const durationMs = Math.max(1000, Math.trunc(Number(leaseMs) || POOL_LEASE_MS));
    const now = Date.now();
    await State.collection
      .updateOne(
        { _id: key },
        { $setOnInsert: { leases: [], expiresAt: new Date(now + durationMs + 60000) } },
        { upsert: true, timeoutMS: POOL_STORE_TIMEOUT_MS },
      )
      .catch((error) => {
        if (error.code !== 11000) throw error;
      });
    const acquired = await State.collection.updateOne(
      {
        _id: key,
        $expr: {
          $lte: [{ $ifNull: [{ $arrayElemAt: ['$leases.until', 0] }, new Date(0)] }, '$$NOW'],
        },
      },
      [
        {
          $set: {
            count: 1,
            leases: [{ token, until: { $add: ['$$NOW', durationMs] } }],
            expiresAt: { $add: ['$$NOW', durationMs + 60000] },
          },
        },
      ],
      { timeoutMS: POOL_STORE_TIMEOUT_MS },
    );
    return { acquired: acquired.matchedCount === 1, token: acquired.matchedCount ? token : null };
  } catch (error) {
    if (error?.code === 11000) {
      return { acquired: false, token: null };
    }
    throw poolBusy();
  }
}

async function releasePoolLease(signalHash, token) {
  if (!token || mongoose.connection.readyState !== 1) return;
  try {
    const key = leaseKey(signalHash);
    await State.collection.updateOne(
      { _id: key, 'leases.token': token },
      { $set: { leases: [] } },
      { timeoutMS: POOL_STORE_TIMEOUT_MS },
    );
  } catch {
    // Non-fatal lease release failure; TTL/until recovers automatically.
  }
}

async function runPoolBuild(
  signalHash,
  { forceRefresh, startedAt, build, persist, isReusable = () => true, cacheable = () => true },
) {
  if (mongoose.connection.readyState !== 1) {
    const pool = await build();
    await persist(pool);
    return pool;
  }
  await mongo.initialize().catch(() => {
    throw poolBusy();
  });
  const key = leaseKey(signalHash);
  const readCompleted = async () => {
    const row = await State.collection
      .findOne(
        {
          _id: key,
          ...(forceRefresh
            ? { 'completed.at': { $gte: startedAt } }
            : {
                $or: [
                  { 'completed.at': { $gte: startedAt } },
                  {
                    'completed.at': { $gte: new Date(Date.now() - 60_000) },
                    'completed.pool.total': { $gt: 0 },
                  },
                ],
              }),
        },
        { projection: { 'completed.pool': 1 }, timeoutMS: POOL_STORE_TIMEOUT_MS },
      )
      .catch(() => {
        throw poolBusy();
      });
    const pool = row?.completed?.pool;
    return pool && isReusable(pool) ? pool : null;
  };
  const deadline = Date.now() + POOL_LEASE_MS + POOL_STORE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const completed = await readCompleted();
    if (completed) return completed;
    const { acquired, token } = await acquirePoolLease(signalHash);
    if (!acquired) {
      await delay(150);
      continue;
    }
    if (!token) throw poolBusy();
    try {
      const winner = await readCompleted();
      if (winner) return winner;
      const pool = await build();
      if (!cacheable(pool)) {
        await persist(pool);
        return { ...pool, updatedAt: new Date() };
      }
      const now = new Date();
      const published = await State.collection
        .updateOne(
          {
            _id: key,
            'leases.token': token,
            $expr: { $gt: [{ $arrayElemAt: ['$leases.until', 0] }, '$$NOW'] },
          },
          { $set: { completed: { at: now, pool: { ...pool, updatedAt: now } } } },
          { timeoutMS: POOL_STORE_TIMEOUT_MS },
        )
        .catch(() => {
          throw poolBusy();
        });
      if (!published.matchedCount) throw poolBusy();
      await persist(pool, { governed: true, publishedAt: now });
      return { ...pool, updatedAt: now };
    } finally {
      await releasePoolLease(signalHash, token);
    }
  }
  throw poolBusy();
}

module.exports = {
  window,
  acquirePoolLease,
  releasePoolLease,
  runPoolBuild,
};
