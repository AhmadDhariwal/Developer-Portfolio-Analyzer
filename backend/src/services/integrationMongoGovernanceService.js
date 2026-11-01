'use strict';
const mongoose = require('mongoose');
const State = require('../models/integrationGovernanceState');
const { createHash, randomUUID } = require('node:crypto');
const hash = (value) => createHash('sha256').update(String(value)).digest('hex');
const unavailable = () =>
  Object.assign(Error('Integration controls temporarily unavailable.'), { status: 503 });
const limited = () =>
  Object.assign(Error('Integration request limit reached.'), { status: 429, retryAfter: 60 });
const STORE_TIMEOUT_MS = 2000;
let initializedDb;
let initialization;

async function initialize() {
  if (mongoose.connection.readyState !== 1) throw unavailable();
  const db = mongoose.connection.db;
  if (db !== initializedDb || !initialization) {
    initializedDb = db;
    initialization = (async () => {
      try {
        await db.createCollection(State.collection.collectionName, { timeoutMS: STORE_TIMEOUT_MS });
      } catch (error) {
        if (error.code !== 48) throw error; // An existing collection is preserved.
      }
      const indexes = await State.collection.listIndexes({ timeoutMS: STORE_TIMEOUT_MS }).toArray();
      const expiry = indexes.find((index) => index.key.expiresAt === 1);
      if (expiry) {
        if (Object.keys(expiry.key).length !== 1 || expiry.expireAfterSeconds !== 0)
          throw unavailable(); // Never replace an existing index automatically.
      } else {
        await State.collection.createIndex(
          { expiresAt: 1 },
          { expireAfterSeconds: 0, name: 'governance_expiry', timeoutMS: STORE_TIMEOUT_MS }
        );
      }
    })().catch((error) => {
      initialization = null;
      throw error;
    });
  }
  await initialization;
}

async function transaction(work) {
  try {
    await initialize();
    const until = Date.now() + STORE_TIMEOUT_MS;
    // Concurrent first admissions may race to insert the same _id. Restart the
    // whole transaction; no partial counters or leases survive an aborted attempt.
    for (let attempt = 0; attempt < 3; attempt++) {
      const session = await mongoose.connection.startSession();
      try {
        return await session.withTransaction(() => work(session, Date.now()), {
          readConcern: { level: 'snapshot' },
          writeConcern: { w: 'majority' },
          maxCommitTimeMS: 1000,
          timeoutMS: Math.max(1, until - Date.now())
        });
      } catch (error) {
        if (error.code !== 11000 || attempt === 2 || Date.now() >= until) throw error;
      } finally {
        await session.endSession();
      }
    }
  } catch (error) {
    if (error.status === 429) throw error;
    throw unavailable();
  }
}

async function read(key, session, now) {
  const state = await State.collection.findOne({ _id: key }, { session });
  return state && state.expiresAt.getTime() > now ? state : { _id: key, count: 0, leases: [] };
}
const write = (state, session) =>
  State.collection.replaceOne({ _id: state._id }, state, { upsert: true, session });

async function readMany(keys, session, now) {
  const rows = await State.collection.find({ _id: { $in: keys } }, { session }).toArray();
  const byKey = new Map(rows.map((row) => [row._id, row]));
  return keys.map((key) => {
    const state = byKey.get(key);
    return state && state.expiresAt.getTime() > now ? state : { _id: key, count: 0, leases: [] };
  });
}

const writeMany = (states, session) =>
  State.collection.bulkWrite(
    states.map((state) => ({
      replaceOne: { filter: { _id: state._id }, replacement: state, upsert: true }
    })),
    { session, ordered: true }
  );

function increment(state, now, windowMs = 60000) {
  state.count = (state.count || 0) + 1;
  if (!state.expiresAt) state.expiresAt = new Date(now + windowMs);
  return state.count;
}

async function admit(provider, owner, duration, policy, jobs = false) {
  const token = randomUUID();
  const kind = jobs ? 'jobs' : 'requests';
  const keys = [`${kind}:global`, `${kind}:provider:${provider}`];
  await transaction(async (session, now) => {
    const all = await readMany(
      jobs
        ? keys
        : [
            ...keys,
            `cooldown:${provider}`,
            `budget:${provider}`,
            `budget:${provider}:user:${hash(owner)}`
          ],
      session,
      now
    );
    const states = all.slice(0, 2);
    for (const state of states) {
      state.leases = (state.leases || []).filter((lease) => lease.until.getTime() > now);
    }
    if (states[0].leases.length >= policy.global || states[1].leases.length >= policy.provider)
      throw limited();
    if (!jobs) {
      const cooldown = all[2];
      if (cooldown.expiresAt) throw limited();
      const counters = all.slice(3);
      if (counters[0].count >= policy.requests || counters[1].count >= policy.user) throw limited();
      for (const counter of counters) increment(counter, now);
    }
    for (const state of states) {
      state.leases.push({ token, until: new Date(now + duration) });
      state.expiresAt = new Date(Math.max(...state.leases.map((lease) => lease.until.getTime())));
    }
    await writeMany(jobs ? states : [...states, ...all.slice(3)], session);
  });
  return { store: 'mongo', provider, keys, token };
}

async function release(reservation) {
  await transaction(async (session, now) => {
    const states = await readMany(reservation.keys, session, now);
    for (const state of states) {
      state.leases = (state.leases || []).filter(
        (lease) => lease.token !== reservation.token && lease.until.getTime() > now
      );
      state.expiresAt = new Date(
        state.leases.length ? Math.max(...state.leases.map((lease) => lease.until.getTime())) : now
      );
    }
    await writeMany(states, session);
  });
}

async function cooldown(provider, duration) {
  await transaction(async (session, now) => {
    const state = await read(`cooldown:${provider}`, session, now);
    state.expiresAt = new Date(Math.max(state.expiresAt?.getTime() || 0, now + duration));
    await write(state, session);
  });
}

async function failure(provider, status, duration) {
  await transaction(async (session, now) => {
    const state = await read(`failures:${provider}`, session, now);
    increment(state, now);
    await write(state, session);
    if ([401, 403, 429].includes(status) || state.count >= 3) {
      const block = await read(`cooldown:${provider}`, session, now);
      block.expiresAt = new Date(Math.max(block.expiresAt?.getTime() || 0, now + duration));
      await write(block, session);
    }
  });
}

async function action(name, identity) {
  return transaction(async (session, now) => {
    const state = await read(`action:${name}:${hash(identity)}`, session, now);
    const count = increment(state, now);
    await write(state, session);
    return count;
  });
}

// Reused observations consume the account's existing request budget, but do not
// spend a provider HTTP budget or acquire an outbound concurrency reservation.
async function consumeSnapshot(provider, owner, cost, maximum) {
  return transaction(async (session, now) => {
    const state = await read(`budget:${provider}:user:${hash(owner)}`, session, now);
    if (!Number.isInteger(cost) || cost < 1 || state.count + cost > maximum) throw limited();
    for (let index = 0; index < cost; index++) increment(state, now);
    await write(state, session);
  });
}

// Profile/Portfolio fixed windows share the tested transaction/index machinery,
// but use a disjoint namespace. Redis never participates in this authority.
async function requestWindow(prefix, maximum, windowMs) {
  if (
    typeof prefix !== 'string' ||
    !/^(public-portfolio:v3:rate|notifications:v1:rate):[a-z-]+:[a-f0-9]{64}$/.test(prefix) ||
    !Number.isSafeInteger(maximum) ||
    maximum < 1 ||
    !Number.isSafeInteger(windowMs) ||
    windowMs < 1
  )
    throw unavailable();
  return transaction(async (session, now) => {
    const bucket = Math.floor(now / windowMs);
    const until = (bucket + 1) * windowMs;
    const state = await read(`${prefix}:${bucket}`, session, now);
    if (!Number.isSafeInteger(state.count) || state.count < 0) throw unavailable();
    // Saturation bounds hostile repeated writes and preserves legacy denial semantics.
    const count = Math.min(state.count + 1, maximum + 1);
    if (count !== state.count) {
      state.count = count;
      state.expiresAt = new Date(until);
      await write(state, session);
    }
    return { count, until };
  });
}

async function notificationStream(owner, reservation = null) {
  const keys = ['notifications:streams:global', `notifications:streams:user:${hash(owner)}`];
  const token = reservation?.token || randomUUID();
  await transaction(async (session, now) => {
    const states = await readMany(keys, session, now);
    for (let index = 0; index < states.length; index++) {
      const state = states[index];
      state.leases = (state.leases || []).filter((lease) => lease.until.getTime() > now);
      const existing = state.leases.find((lease) => lease.token === token);
      if (reservation && !existing) throw unavailable();
      if (!existing && state.leases.length >= (index === 0 ? 1000 : 6)) throw limited();
      if (existing) existing.until = new Date(now + 60000);
      else state.leases.push({ token, until: new Date(now + 60000) });
      state.expiresAt = new Date(Math.max(...state.leases.map((lease) => lease.until.getTime())));
    }
    await writeMany(states, session);
  });
  return { keys, token };
}

module.exports = {
  admit,
  release,
  cooldown,
  failure,
  action,
  consumeSnapshot,
  initialize,
  requestWindow,
  notificationStream
};
