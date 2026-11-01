const { randomUUID } = require('node:crypto');
const Notification = require('../models/notification');
const User = require('../models/user');
const Lease = require('../models/integrationGovernanceState');
const persistence = require('./notificationPersistenceService');
const metrics = require('./notificationMetrics');

const LEASE_ID = 'notifications:retention:v1';
let timer;
let running = false;

function configuration(env = process.env) {
  const enabled = env.NOTIFICATION_RETENTION_ENABLED === 'true';
  const approved = env.NOTIFICATION_RETENTION_POLICY_APPROVED === 'true';
  const integer = (name, fallback, maximum) => {
    const value = env[name] === undefined ? fallback : Number(env[name]);
    if (!Number.isInteger(value) || value < 1 || value > maximum) throw Error(`Invalid ${name}`);
    return value;
  };
  if (enabled && !approved)
    throw Error('Notification retention requires explicit product approval');
  return {
    enabled: enabled && approved,
    workerEnabled: enabled && approved && env.NOTIFICATION_RETENTION_WORKER_ENABLED === 'true',
    readDays: integer('NOTIFICATION_RETENTION_READ_DAYS', 90, 36500),
    unreadDays: integer('NOTIFICATION_RETENTION_UNREAD_DAYS', 180, 36500),
    batchSize: integer('NOTIFICATION_RETENTION_BATCH_SIZE', 100, 100),
    intervalMs: integer('NOTIFICATION_RETENTION_INTERVAL_MINUTES', 60, 1440) * 60000
  };
}

function expiredFilter(policy = configuration(), now = new Date()) {
  if (!policy.enabled) return null;
  return {
    security: false,
    $or: [
      { isRead: true, createdAt: { $lte: new Date(now.getTime() - policy.readDays * 86400000) } },
      { isRead: false, createdAt: { $lte: new Date(now.getTime() - policy.unreadDays * 86400000) } }
    ]
  };
}

function visibleFilter(policy = configuration(), now = new Date()) {
  const expired = expiredFilter(policy, now);
  return expired ? { $nor: [expired] } : {};
}

async function runOnce() {
  const policy = configuration();
  if (!policy.workerEnabled) return { disabled: true, deletedCount: 0 };
  if (Notification.db.readyState !== 1) throw Error('Notification retention database unavailable');
  if (running) return { busy: true, deletedCount: 0 };
  running = true;
  const token = randomUUID();
  let acquired = false;
  try {
    const now = new Date();
    try {
      acquired = Boolean(
        await Lease.findOneAndUpdate(
          { _id: LEASE_ID, expiresAt: { $lte: now } },
          {
            $set: {
              expiresAt: new Date(now.getTime() + 60000),
              leases: [{ token, until: new Date(now.getTime() + 60000) }]
            }
          },
          {
            upsert: true,
            returnDocument: 'after',
            timeoutMS: 2000,
            writeConcern: { w: 'majority' }
          }
        ).lean()
      );
    } catch (error) {
      if (error.code === 11000) return { busy: true, deletedCount: 0 };
      throw error;
    }
    // Separate exact read-state ranges avoid an unbounded cross-state blocking sort.
    const ranges = await Promise.all(
      [true, false].map((isRead) =>
        Notification.find({
          security: false,
          isRead,
          createdAt: {
            $lte: new Date(
              now.getTime() - (isRead ? policy.readDays : policy.unreadDays) * 86400000
            )
          }
        })
          .select('_id userId createdAt')
          .sort({ createdAt: 1, _id: 1 })
          .hint({ security: 1, isRead: 1, createdAt: 1, _id: 1, userId: 1 })
          .limit(policy.batchSize)
          .maxTimeMS(2000)
          .lean()
      )
    );
    const candidates = ranges
      .flat()
      .sort(
        (left, right) =>
          left.createdAt - right.createdAt || String(left._id).localeCompare(String(right._id))
      )
      .slice(0, policy.batchSize);
    const owners = [...new Set(candidates.map((item) => String(item.userId)))].slice(0, 5);
    let deletedCount = 0;
    for (const owner of owners) {
      deletedCount += await persistence.transaction(async (session) => {
        const lease = await Lease.updateOne(
          { _id: LEASE_ID, 'leases.token': token, expiresAt: { $gt: new Date() } },
          { $set: { expiresAt: new Date(Date.now() + 60000) } },
          { session }
        );
        if (!lease.matchedCount) throw Error('Notification retention lease lost');
        const account = await User.collection.updateOne(
          {
            _id: candidates.find((item) => String(item.userId) === owner).userId
          },
          { $inc: { integrationMutationVersion: 1 } },
          { session }
        );
        if (!account.matchedCount) return 0;
        const ids = candidates
          .filter((item) => String(item.userId) === owner)
          .map((item) => item._id);
        const result = await Notification.deleteMany(
          { userId: owner, _id: { $in: ids }, ...expiredFilter(policy, new Date()) },
          { session }
        );
        if (result.deletedCount) await persistence.changed(owner, session);
        return result.deletedCount;
      });
    }
    return { deletedCount, examined: candidates.length, owners: owners.length };
  } finally {
    if (acquired)
      await Lease.deleteOne(
        { _id: LEASE_ID, 'leases.token': token },
        { timeoutMS: 2000, writeConcern: { w: 'majority' } }
      ).catch(() => {});
    running = false;
  }
}

function start() {
  const policy = configuration();
  if (!policy.workerEnabled || timer) return;
  timer = setInterval(() => {
    runOnce()
      .then((result) => {
        metrics.outcomes.inc({
          operation: 'retention',
          outcome: result.busy ? 'busy' : result.deletedCount ? 'committed' : 'empty'
        });
      })
      .catch(() => {
        metrics.outcomes.inc({ operation: 'retention', outcome: 'failed' });
      });
  }, policy.intervalMs);
  timer.unref?.();
}
function stop() {
  clearInterval(timer);
  timer = null;
}
module.exports = { configuration, expiredFilter, visibleFilter, runOnce, start, stop };
