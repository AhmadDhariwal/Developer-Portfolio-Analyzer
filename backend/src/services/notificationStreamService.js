const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const State = require('../models/notificationState');
const User = require('../models/user');
const sessions = require('../utils/authSessionToken');
const governance = require('./integrationMongoGovernanceService');
const metrics = require('./notificationMetrics');

const connections = new Set();
let timer;
let watch;
let stopping = false;
let watchRetryAt = 0;

function write(connection, revision, event = 'notification', changedAt = null) {
  if (connection.closed || connection.res.destroyed) return connection.close();
  if (Date.now() >= connection.claims.exp * 1000) return connection.close();
  if (event !== 'connected' && revision <= connection.revision) return;
  // A slow consumer is disconnected rather than accumulating an unbounded queue.
  if (connection.res.writableLength > 16384) return connection.close();
  if (
    !connection.res.write(
      `id: ${revision}\nevent: ${event}\ndata: ${JSON.stringify({ eventType: 'reconcile', revision })}\n\n`
    )
  )
    return connection.close();
  connection.revision = revision;
  if (event === 'notification' && changedAt)
    metrics.deliveryLag.observe(Math.max(0, (Date.now() - new Date(changedAt).getTime()) / 1000));
}

async function reconcile() {
  if (!connections.size) return;
  const stop = metrics.duration.startTimer({ operation: 'reconcile' });
  const deadline = Date.now() + 8000;
  try {
    if (mongoose.connection.readyState !== 1) throw Error('Notification database unavailable');
    const owners = [...new Set([...connections].map((connection) => connection.userId))];
    const [states, users] = await Promise.all([
      State.find({ _id: { $in: owners } })
        .maxTimeMS(2000)
        .lean(),
      User.find({ _id: { $in: owners } })
        .select('isActive sessionRevision')
        .maxTimeMS(2000)
        .lean()
    ]);
    const revisions = new Map(states.map((state) => [String(state._id), state.revision]));
    const timestamps = new Map(states.map((state) => [String(state._id), state.changedAt]));
    const accounts = new Map(users.map((user) => [String(user._id), user]));
    const now = Date.now();
    // Bounded batches avoid a burst of hundreds of admission transactions.
    const active = [...connections];
    for (let offset = 0; offset < active.length; offset += 10) {
      if (Date.now() >= deadline) {
        for (const connection of active.slice(offset)) connection.close();
        metrics.outcomes.inc({ operation: 'reconcile', outcome: 'capacity' });
        break;
      }
      await Promise.all(
        active.slice(offset, offset + 10).map(async (connection) => {
          const user = accounts.get(connection.userId);
          if (
            !user ||
            user.isActive === false ||
            !sessions.matches(user, connection.claims) ||
            connection.claims.exp * 1000 <= now
          )
            return connection.close();
          try {
            await governance.notificationStream(connection.userId, connection.reservation);
            if ((revisions.get(connection.userId) || 0) !== connection.revision)
              write(
                connection,
                revisions.get(connection.userId) || 0,
                'notification',
                timestamps.get(connection.userId)
              );
            else if (!connection.res.write(': keep-alive\n\n')) connection.close();
          } catch {
            connection.close();
          }
        })
      );
    }
    metrics.outcomes.inc({ operation: 'reconcile', outcome: 'success' });
  } catch {
    metrics.outcomes.inc({ operation: 'reconcile', outcome: 'failed' });
    // Fail closed when persisted session state cannot be validated.
    for (const connection of connections) connection.close();
  } finally {
    stop();
  }
}

function startWatcher() {
  if (watch || stopping || Date.now() < watchRetryAt || !connections.size) return;
  const current = State.watch([], { fullDocument: 'updateLookup', maxAwaitTimeMS: 1000 });
  watch = current;
  current.on('change', (change) => {
    const state = change.fullDocument;
    if (!state) return;
    // Signals contain no inbox content. Periodic account checks and the inbox's
    // protected HTTP reads remain authoritative for disclosure.
    for (const connection of connections) {
      if (connection.userId === String(state._id) && connection.revision !== state.revision)
        write(connection, state.revision, 'notification', state.changedAt);
    }
  });
  current.on('close', () => {
    if (watch === current) {
      watch = null;
      watchRetryAt = Date.now() + 60000;
    }
  });
  current.on('error', () => {
    if (watch === current) {
      watch = null;
      watchRetryAt = Date.now() + 60000;
    }
    current.close().catch(() => {});
    metrics.outcomes.inc({ operation: 'watch', outcome: 'unavailable' });
  });
}

function schedule() {
  if (timer || stopping || !connections.size) return;
  timer = setTimeout(async () => {
    timer = null;
    await reconcile();
    if (connections.size) {
      startWatcher();
      schedule();
    } else {
      const idle = watch;
      watch = null;
      await idle?.close().catch(() => {});
    }
  }, 15000);
  timer.unref?.();
}

async function streamNotifications(req, res) {
  let reservation;
  let connection;
  try {
    if (req.query.token)
      return res.status(400).json({ message: 'Use Authorization header for streaming.' });
    if (connections.size >= 500) {
      res.set('Retry-After', '30');
      return res.status(429).json({ message: 'Stream capacity reached.' });
    }
    const claims = jwt.verify(req.headers.authorization.slice(7), process.env.JWT_SECRET, {
      algorithms: ['HS256'],
      issuer: process.env.JWT_ISSUER || 'devinsight-api',
      audience: process.env.JWT_AUDIENCE || 'devinsight-web'
    });
    if (
      !Number.isFinite(claims.exp) ||
      String(claims.id) !== String(req.user._id) ||
      !sessions.matches(req.user, claims) ||
      req.user.isActive === false
    )
      return res.status(401).json({ message: 'Expiring credentials required.' });
    reservation = await governance.notificationStream(req.user._id);
    if (req.destroyed || res.destroyed) {
      await governance.release(reservation);
      return;
    }
    const state = await State.findById(req.user._id).maxTimeMS(2000).lean();
    if (connections.size >= 500)
      throw Object.assign(Error('Stream capacity reached.'), { status: 429 });
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      Vary: 'Authorization'
    });
    res.flushHeaders?.();
    connection = {
      res,
      userId: String(req.user._id),
      claims,
      reservation,
      revision: -1,
      closed: false,
      close() {
        if (this.closed) return;
        this.closed = true;
        clearTimeout(this.expiryTimer);
        connections.delete(this);
        metrics.connections.dec();
        governance.release(this.reservation).catch(() => {});
        res.end();
      }
    };
    connections.add(connection);
    metrics.connections.inc();
    connection.expiryTimer = setTimeout(
      () => connection.close(),
      Math.min(2147483647, Math.max(1, claims.exp * 1000 - Date.now()))
    );
    connection.expiryTimer.unref?.();
    req.on('close', () => connection.close());
    res.on('error', () => connection.close());
    // Always reconcile on connect, even with an old, absent or invalid cursor.
    // Coalesced invalidation is sufficient: the inbox contains durable payloads.
    write(connection, state?.revision || 0, 'connected');
    stopping = false;
    startWatcher();
    schedule();
  } catch (error) {
    if (connection) connection.close();
    else if (reservation) await governance.release(reservation).catch(() => {});
    if (res.headersSent) return res.end();
    const status = error.status === 429 ? 429 : 503;
    if (status === 429) res.set('Retry-After', '60');
    res.status(status).json({
      message:
        status === 429 ? 'Stream connection limit reached.' : 'Notification stream unavailable.'
    });
  }
}

async function stop() {
  stopping = true;
  clearTimeout(timer);
  timer = null;
  for (const connection of connections) connection.close();
  const closing = watch;
  watch = null;
  await closing?.close().catch(() => {});
}
module.exports = { streamNotifications, reconcile, stop };
