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

const windowKey = (bucket, scope, windowSlot) =>
  `courses:v1:rate:${bucket}:${digest(scope)}:${windowSlot}`;

const leaseKey = (signalHash) => `courses:v1:lease:${digest(signalHash)}`;
const POOL_LEASE_MS = 30_000;
const POOL_STORE_TIMEOUT_MS = 2000;
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
  const now = Date.now();
  const slot = Math.floor(now / durationMs);
  const untilMs = (slot + 1) * durationMs;
  const until = new Date(untilMs);
  const key = windowKey(bucket, scope, slot);
  const retryAfterSeconds = Math.max(1, Math.ceil((untilMs - now) / 1000));

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const updated = await State.collection.findOneAndUpdate(
        { _id: key },
        {
          $inc: { count: 1 },
          $setOnInsert: {
            leases: [],
            expiresAt: until,
          },
        },
        { upsert: true, returnDocument: 'after' },
      );
      const doc = updated?.value ?? updated;
      const count = Number(doc?.count || 1);
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
  return {
    allowed: true,
    limit,
    remaining: Math.max(0, limit - 1),
    retryAfterSeconds: 0,
  };
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
    const nowDate = new Date(now);
    const until = new Date(now + durationMs);
    await State.collection.updateOne(
      {
        _id: key,
        $or: [{ 'leases.0': { $exists: false } }, { 'leases.until': { $lte: nowDate } }],
      },
      {
        $set: {
          count: 1,
          leases: [{ token, until }],
          expiresAt: new Date(until.getTime() + 60000),
        },
      },
      { upsert: true, timeoutMS: POOL_STORE_TIMEOUT_MS },
    );
    return { acquired: true, token };
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

async function runPoolBuild(signalHash, { forceRefresh, startedAt, build, persist }) {
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
    return row?.completed?.pool;
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
      const now = new Date();
      const published = await State.collection.updateOne(
        {
          _id: key,
          'leases.token': token,
          $expr: { $gt: [{ $arrayElemAt: ['$leases.until', 0] }, '$$NOW'] },
        },
        { $set: { completed: { at: now, pool: { ...pool, updatedAt: now } } } },
        { timeoutMS: POOL_STORE_TIMEOUT_MS },
      );
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
