'use strict';
const crypto = require('node:crypto');
const mongoose = require('mongoose');
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

async function acquirePoolLease(signalHash, leaseMs = 15000) {
  if (mongoose.connection.readyState !== 1) {
    return { acquired: true, token: null };
  }
  try {
    await mongo.initialize();
    const key = leaseKey(signalHash);
    const token = crypto.randomUUID();
    const durationMs = Math.max(1000, Math.trunc(Number(leaseMs) || 15000));
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
      { upsert: true },
    );
    return { acquired: true, token };
  } catch (error) {
    if (error?.code === 11000) {
      return { acquired: false, token: null };
    }
    return { acquired: true, token: null };
  }
}

async function releasePoolLease(signalHash, token) {
  if (!token || mongoose.connection.readyState !== 1) return;
  try {
    const key = leaseKey(signalHash);
    await State.collection.deleteOne({ _id: key, 'leases.token': token });
  } catch {
    // Non-fatal lease release failure; TTL/until recovers automatically.
  }
}

module.exports = {
  window,
  acquirePoolLease,
  releasePoolLease,
};
