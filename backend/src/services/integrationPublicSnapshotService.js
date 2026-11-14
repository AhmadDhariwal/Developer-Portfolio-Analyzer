'use strict';
const mongoose = require('mongoose');
const { createHash, randomUUID } = require('node:crypto');
const Snapshot = require('../models/integrationPublicSnapshot');
const governance = require('./integrationGovernanceService');
const VERSION = 'public-unverified-v1';
const FRESH_MS = 300000;
const WAIT_MS = 2000;
const MAX_PENDING = 128;
const MAX_FLIGHTS = 32;
const MAX_BYTES = 32768;
const flights = new Map();
let pending = 0;
let db;
let initialization;
const failure = (status, message) =>
  Object.assign(Error(message), { status, retryAfter: status === 429 ? 2 : undefined });
const unavailable = () => failure(503, 'Integration public observations unavailable.');
const busy = () => failure(429, 'Public profile fetch is busy. Please retry.');
const clone = (value) => JSON.parse(JSON.stringify(value));

function identity(provider, connection) {
  if (connection.accessToken || connection.refreshToken) return null;
  const value = String(connection.externalUsername || '').trim();
  // Preserve handle case; never merge identities using an unverified alias rule.
  if (provider === 'leetcode' && /^[a-zA-Z0-9_-]{1,100}$/.test(value)) return value;
  if (provider === 'stackoverflow' && /^\d{1,20}$/.test(value) && BigInt(value) > 0n)
    return BigInt(value).toString();
  if (provider === 'devblogs' && /^devto@[a-zA-Z0-9_.-]{1,100}$/.test(value)) return value;
  return null;
}

const keyFor = (provider, canonical) =>
  createHash('sha256')
    .update(JSON.stringify([provider, canonical, 'public', VERSION]))
    .digest('hex');

function project(provider, value) {
  const fields = {
    leetcode: ['username', 'ranking', 'reputation', 'solvedProblems'],
    stackoverflow: [
      'username',
      'userId',
      'reputation',
      'goldBadges',
      'silverBadges',
      'bronzeBadges',
      'totalBadges',
      'answerCount',
      'questionCount'
    ],
    devblogs: ['username', 'totalArticles', 'totalReactions', 'totalViews', 'brandingScore']
  };
  const activities = {
    leetcode: ['easy', 'medium', 'hard'],
    stackoverflow: ['topTags', 'namedBadges', 'acceptRate'],
    devblogs: ['topTags', 'platforms', 'recentArticles']
  };
  const pick = (object, names) =>
    Object.fromEntries(
      names.filter((name) => Object.hasOwn(object || {}, name)).map((name) => [name, object[name]])
    );
  const profile = pick(value.profile, fields[provider]);
  const activity = pick(value.activity, activities[provider]);
  if (Array.isArray(activity.recentArticles))
    activity.recentArticles = activity.recentArticles
      .slice(0, 5)
      .map((article) => pick(article, ['title', 'reactions', 'publishedAt', 'platform']));
  const observation = clone({
    provider,
    profile,
    activity,
    inferredSkills: (value.inferredSkills || []).slice(0, 20)
  });
  if (Buffer.byteLength(JSON.stringify(observation)) > MAX_BYTES)
    throw failure(502, 'Public observation exceeds its size limit.');
  return observation;
}

async function initialize() {
  if (mongoose.connection.readyState !== 1) throw unavailable();
  if (db !== mongoose.connection.db || !initialization) {
    db = mongoose.connection.db;
    initialization = (async () => {
      try {
        await db.createCollection(Snapshot.collection.collectionName, { timeoutMS: 2000 });
      } catch (error) {
        if (error.code !== 48) throw error;
      }
      const indexes = await Snapshot.collection.listIndexes({ timeoutMS: 2000 }).toArray();
      const expiry = indexes.find((index) => index.key.expiresAt === 1);
      if (expiry && (Object.keys(expiry.key).length !== 1 || expiry.expireAfterSeconds !== 0))
        throw unavailable();
      if (!expiry)
        await Snapshot.collection.createIndex(
          { expiresAt: 1 },
          { name: 'public_snapshot_expiry', expireAfterSeconds: 0, timeoutMS: 2000 }
        );
    })().catch((error) => {
      initialization = null;
      throw error;
    });
  }
  try {
    await initialization;
  } catch {
    throw unavailable();
  }
}

async function load(key, adapter, connection) {
  await initialize();
  const stopAt = Date.now() + WAIT_MS;
  let delay = 25;
  while (true) {
    governance.assertActive();
    const now = Date.now();
    const row = await Snapshot.collection.findOne({ _id: key }, { timeoutMS: 2000 });
    if (row?.observation && row.freshUntil > new Date(now))
      return { observation: row.observation, requestCost: row.requestCost, fetched: false };
    if (!row || row.leaseUntil <= new Date(now)) {
      const token = randomUUID();
      const generation = row?.generation || 0;
      const leaseUntil = new Date(
        now + governance.integer('INTEGRATION_OPERATION_TIMEOUT_MS', 60000, 5000, 120000) + 10000
      );
      let acquired = false;
      try {
        if (!row) {
          await Snapshot.collection.insertOne(
            { _id: key, generation, leaseToken: token, leaseUntil, expiresAt: leaseUntil },
            { timeoutMS: 2000 }
          );
          acquired = true;
        } else {
          const changed = await Snapshot.collection.updateOne(
            {
              _id: key,
              generation,
              leaseToken: row.leaseToken,
              leaseUntil: { $lte: new Date(now) },
              $or: [{ freshUntil: { $lte: new Date(now) } }, { freshUntil: { $exists: false } }]
            },
            { $set: { leaseToken: token, leaseUntil, expiresAt: leaseUntil } },
            { timeoutMS: 2000 }
          );
          acquired = changed.matchedCount === 1;
        }
      } catch (error) {
        if (error.code !== 11000) throw error;
      }
      if (acquired) {
        const fence = { _id: key, generation, leaseToken: token, leaseUntil: { $gt: new Date() } };
        try {
          const result = await governance
            .measurePublicFetch(() => adapter.ingestData(connection))
            .catch((error) => {
              if (error.status || error.code === 'ERR_CANCELED') throw error;
              throw failure(502, 'Provider public observation unavailable.');
            });
          const observation = project(adapter.provider, result.value);
          const freshUntil = new Date(Date.now() + FRESH_MS);
          fence.leaseUntil = { $gt: new Date() };
          const changed = await Snapshot.collection.updateOne(
            fence,
            {
              $set: {
                observation,
                requestCost: result.requestCost,
                freshUntil,
                expiresAt: freshUntil,
                leaseToken: '',
                leaseUntil: new Date(0)
              }
            },
            { timeoutMS: 2000 }
          );
          if (!changed.matchedCount) throw failure(409, 'Public observation changed during fetch.');
          return { observation, requestCost: result.requestCost, fetched: true };
        } catch (error) {
          await Snapshot.collection
            .updateOne(
              { _id: key, generation, leaseToken: token },
              {
                $set: {
                  leaseToken: '',
                  leaseUntil: new Date(0),
                  expiresAt: new Date(Date.now() + 10000)
                }
              },
              { timeoutMS: 2000 }
            )
            .catch(() => {});
          throw error;
        }
      }
    }
    if (Date.now() >= stopAt) throw busy();
    await new Promise((resolve) => setTimeout(resolve, delay));
    delay = Math.min(250, delay * 2);
  }
}

async function ingest(adapter, connection) {
  const canonical = identity(adapter.provider, connection);
  if (!canonical || adapter.getAuthMode() !== 'manual') return adapter.ingestData(connection);
  governance.assertActive();
  if (pending >= MAX_PENDING) throw busy();
  const key = keyFor(adapter.provider, canonical);
  let leader = false;
  let flight = flights.get(key);
  if (!flight) {
    if (flights.size >= MAX_FLIGHTS) throw busy();
    leader = true;
    flight = load(key, adapter, { externalUsername: canonical });
    flights.set(key, flight);
  }
  pending++;
  try {
    const result = await flight;
    if (!leader || !result.fetched)
      await governance.consumePublicSnapshot(adapter.provider, result.requestCost);
    governance.assertActive();
    return clone(result.observation);
  } catch (error) {
    if (error.status || error.code === 'ERR_CANCELED') throw error;
    throw unavailable();
  } finally {
    pending--;
    if (leader && flights.get(key) === flight) flights.delete(key);
  }
}

async function invalidate(provider, canonical) {
  await initialize();
  await Snapshot.collection.updateOne(
    { _id: keyFor(provider, canonical) },
    {
      $inc: { generation: 1 },
      $set: {
        freshUntil: new Date(0),
        leaseUntil: new Date(0),
        leaseToken: '',
        expiresAt: new Date(Date.now() + 10000)
      }
    },
    { timeoutMS: 2000 }
  );
}

module.exports = {
  ingest,
  identity,
  keyFor,
  invalidate,
  initialize,
  FRESH_MS,
  MAX_PENDING,
  MAX_FLIGHTS
};
