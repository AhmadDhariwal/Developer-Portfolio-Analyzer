'use strict';
const mongoose = require('mongoose');
const { randomUUID } = require('node:crypto');
const Connection = require('../models/integrationConnection');
const Insight = require('../models/integrationInsight');
const Log = require('../models/integrationSyncLog');
const LinkedProfile = require('../models/integrationLinkedProfile');
const User = require('../models/user');
const tokens = require('./integrationTokenService');
const { integer } = require('./integrationGovernanceService');
const insights = require('./integrationInsightService');
const stale = () =>
  Object.assign(Error('Connection changed or sync lease expired.'), { status: 409 });
async function transaction(work) {
  // Mongo transactions retry transient write conflicts. Never perform provider calls here.
  return mongoose.connection.transaction(work, {
    maxCommitTimeMS: 5000,
    readConcern: { level: 'snapshot' },
    writeConcern: { w: 'majority' }
  });
}
async function ownerFence(owner, session) {
  const result = await User.collection.updateOne(
    { _id: new mongoose.Types.ObjectId(String(owner)) },
    { $inc: { integrationMutationVersion: 1 } },
    { session }
  );
  if (!result.matchedCount) throw Object.assign(Error('Account is unavailable.'), { status: 404 });
}
async function claim(owner, provider) {
  const now = new Date();
  return Connection.findOneAndUpdate(
    {
      userId: owner,
      provider,
      status: { $in: ['connected', 'error'] },
      $or: [{ leaseUntil: { $lte: now } }, { leaseUntil: null }]
    },
    {
      $set: {
        leaseId: randomUUID(),
        leaseUntil: new Date(
          now.getTime() + integer('INTEGRATION_OPERATION_TIMEOUT_MS', 60000, 5000, 120000) + 10000
        )
      }
    },
    { returnDocument: 'after' }
  ).lean();
}
const leaseFilter = (connection) => ({
  _id: connection._id,
  userId: connection.userId,
  provider: connection.provider,
  leaseId: connection.leaseId,
  leaseUntil: { $gt: new Date() },
  status: { $in: ['connected', 'error'] }
});
function invalidate(owner) {
  // Revision-aware downstream reads provide cross-worker correctness; these free local entries.
  for (const [path, method] of [
    ['../controllers/dashboardcontroller', 'invalidateDashboardSummaryCache'],
    ['./careerSprintService', 'invalidateCareerSprintCache']
  ]) {
    try {
      require(path)[method](owner);
    } catch {
      /* Cache cleanup cannot undo a committed mutation. */
    }
  }
}
const isResourceSnapshot = (provider, metadata) =>
  provider === 'kaggle' && metadata?.resourceObservation?.version === 'kaggle-resources-v1';
async function commit(connection, providerInsight, metadata, refreshed = null) {
  const resourceOnly = isResourceSnapshot(connection.provider, metadata);
  const result = await transaction(async (session) => {
    await ownerFence(connection.userId, session);
    const changed = await Connection.updateOne(
      leaseFilter(connection),
      {
        $set: {
          status: 'connected',
          ...(resourceOnly
            ? {
                'metadata.resourceObservation': metadata.resourceObservation,
                'metadata.resourceReason': metadata.reason
              }
            : { metadata }),
          lastSyncedAt: new Date(),
          nextSyncAt: new Date(
            Date.now() + integer('INTEGRATION_DEFAULT_SYNC_INTERVAL_MIN', 30, 1, 1440) * 60000
          ),
          lastSyncError: '',
          leaseId: '',
          leaseUntil: null,
          ...(refreshed || {})
        }
      },
      { session }
    );
    if (!changed.matchedCount) throw stale();
    // Resource snapshots do not enter scored insights or scored sync-trend events.
    if (resourceOnly) return null;
    const insight = await insights.upsertProviderInsight({
      userId: connection.userId,
      providerInsight,
      session
    });
    await Log.create(
      [
        {
          userId: connection.userId,
          provider: connection.provider,
          status: 'success',
          reason: metadata.reason,
          profileScore: providerInsight.profileScore,
          activityScore: providerInsight.activityScore,
          confidence: providerInsight.confidence
        }
      ],
      { session }
    );
    return insight;
  });
  invalidate(connection.userId);
  return resourceOnly ? insights.getIntegrationInsight(connection.userId) : result;
}
async function fail(connection, message, reason) {
  return transaction(async (session) => {
    const result = await Connection.updateOne(
      leaseFilter(connection),
      {
        $set: {
          lastSyncError: message,
          nextSyncAt: new Date(Date.now() + 30 * 60000),
          leaseId: '',
          leaseUntil: null
        }
      },
      { session }
    );
    if (!result.matchedCount) return;
    // Resource failures remain on the connection; never manufacture zero-score trend rows.
    if (isResourceSnapshot(connection.provider, connection.metadata)) return;
    await Log.create(
      [
        {
          userId: connection.userId,
          provider: connection.provider,
          status: 'failed',
          reason,
          error: message
        }
      ],
      { session }
    );
  });
}
async function start(owner, provider, state, redirect) {
  return transaction(async (session) => {
    await ownerFence(owner, session);
    return Connection.findOneAndUpdate(
      { userId: owner, provider },
      {
        $set: {
          oauthState: state,
          oauthStateExpiresAt: new Date(Date.now() + 600000),
          oauthRedirectUri: redirect,
          oauthAttempt: '',
          leaseId: '',
          leaseUntil: null
        },
        $setOnInsert: { status: 'pending' }
      },
      { upsert: true, returnDocument: 'after', session }
    ).lean();
  });
}
async function beginManual(owner, provider) {
  try {
    return await transaction(async (session) => {
      await ownerFence(owner, session);
      return Connection.findOneAndUpdate(
        {
          userId: owner,
          provider,
          $or: [{ leaseUntil: null }, { leaseUntil: { $lte: new Date() } }]
        },
        {
          $set: {
            oauthState: '',
            oauthStateExpiresAt: null,
            oauthAttempt: randomUUID(),
            leaseId: '',
            leaseUntil: null
          },
          $setOnInsert: { status: 'pending' }
        },
        { session, upsert: true, returnDocument: 'after' }
      ).lean();
    });
  } catch (error) {
    if (error.code === 11000) throw stale();
    throw error;
  }
}

async function reuseFreshManual(owner, provider, candidate) {
  const snapshots = require('./integrationPublicSnapshotService');
  const canonical = snapshots.identity(provider, candidate);
  if (!canonical) return null;
  return transaction(async (session) => {
    const now = new Date();
    const userId = new mongoose.Types.ObjectId(String(owner));
    const user = await User.collection.findOne(
      { _id: userId, isActive: { $ne: false } },
      { session, projection: { _id: 1 } }
    );
    if (!user) throw Object.assign(Error('Account is unavailable.'), { status: 404 });
    const connection = await Connection.collection.findOne(
      {
        userId,
        provider,
        status: 'connected',
        externalUsername: candidate.externalUsername,
        accessToken: { $in: ['', null] },
        refreshToken: { $in: ['', null] },
        ownershipVerified: false,
        oauthAttempt: { $in: ['', null] },
        lastSyncError: '',
        lastSyncedAt: { $gt: new Date(now.getTime() - snapshots.FRESH_MS) }
      },
      { session, projection: { provider: 1, status: 1, externalUsername: 1, leaseUntil: 1 } }
    );
    if (!connection) return null;
    if (connection.leaseUntil > now) throw stale();
    const snapshot = await require('../models/integrationPublicSnapshot').collection.findOne(
      { _id: snapshots.keyFor(provider, canonical), freshUntil: { $gt: now } },
      { session }
    );
    if (!snapshot?.observation) return null;
    const insight = await Insight.collection.findOne(
      { userId },
      { session, projection: { providers: { $elemMatch: { provider } } } }
    );
    const prior = insight?.providers?.[0];
    if (!prior || prior.ownershipVerified !== false) return null;
    const observed = snapshot.observation;
    if (
      JSON.stringify([
        prior.normalized?.profile,
        prior.normalized?.activity,
        prior.inferredSkills
      ]) !== JSON.stringify([observed.profile, observed.activity, observed.inferredSkills])
    )
      return null;
    return connection;
  });
}
async function consumeState(provider, state, owner) {
  if (typeof state !== 'string' || !/^[a-f0-9]{64}$/.test(state)) return null;
  return Connection.findOneAndUpdate(
    {
      provider,
      oauthState: state,
      oauthStateExpiresAt: { $gt: new Date() },
      ...(owner ? { userId: owner } : {})
    },
    { $set: { oauthState: '', oauthStateExpiresAt: null, oauthAttempt: randomUUID() } },
    { returnDocument: 'after' }
  ).lean();
}
async function connect(owner, provider, values, providerInsight = null, attempt = null) {
  const resourceOnly = isResourceSnapshot(provider, values.metadata);
  const { metadata, ...remaining } = values;
  const result = await transaction(async (session) => {
    await ownerFence(owner, session);
    const filter = {
      userId: owner,
      provider,
      ...(attempt
        ? {
            oauthAttempt: attempt,
            $or: [{ leaseUntil: null }, { leaseUntil: { $lte: new Date() } }]
          }
        : {})
    };
    const connection = await Connection.findOneAndUpdate(
      filter,
      {
        $set: {
          ...(resourceOnly
            ? { ...remaining, 'metadata.resourceObservation': metadata.resourceObservation }
            : values),
          ...tokens.seal({ ...values, userId: owner, provider }),
          oauthState: '',
          oauthStateExpiresAt: null,
          oauthAttempt: '',
          leaseId: '',
          leaseUntil: null,
          lastSyncError: '',
          nextSyncAt: new Date()
        }
      },
      { upsert: !attempt, returnDocument: 'after', session }
    ).lean();
    if (!connection) throw stale();
    // Reconnect must not display the previous account's insight while new ingestion is pending.
    if (providerInsight)
      await insights.upsertProviderInsight({ userId: owner, providerInsight, session });
    else if (!resourceOnly)
      await insights.removeProviderInsight({ userId: owner, provider, session });
    return connection;
  });
  invalidate(owner);
  return result;
}
async function disconnect(owner, provider) {
  let previous;
  await transaction(async (session) => {
    await ownerFence(owner, session);
    previous = await Connection.findOneAndUpdate(
      { userId: owner, provider },
      {
        $set: {
          status: 'disconnected',
          externalUsername: '',
          externalAccountId: '',
          ownershipVerified: false,
          accessToken: '',
          refreshToken: '',
          tokenType: 'Bearer',
          tokenExpiresAt: null,
          scopes: [],
          metadata: {},
          lastSyncedAt: null,
          nextSyncAt: null,
          lastSyncError: '',
          oauthState: '',
          oauthStateExpiresAt: null,
          oauthRedirectUri: '',
          oauthAttempt: '',
          leaseId: '',
          leaseUntil: null
        }
      },
      { session, returnDocument: 'before' }
    ).lean();
    if (!isResourceSnapshot(provider, previous?.metadata))
      await insights.removeProviderInsight({ userId: owner, provider, session });
  });
  invalidate(owner);
  return previous;
}
async function deleteAccount(owner, remove) {
  await transaction(async (session) => {
    await ownerFence(owner, session);
    await Connection.deleteMany({ userId: owner }, { session });
    await Insight.deleteMany({ userId: owner }, { session });
    await Log.deleteMany({ userId: owner }, { session });
    await LinkedProfile.deleteMany({ userId: owner }, { session });
    await remove(session);
  });
  invalidate(owner);
}
module.exports = {
  transaction,
  ownerFence,
  claim,
  leaseFilter,
  commit,
  fail,
  start,
  consumeState,
  beginManual,
  reuseFreshManual,
  connect,
  disconnect,
  deleteAccount,
  invalidate
};
