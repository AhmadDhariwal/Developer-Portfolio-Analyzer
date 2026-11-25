const { createHash } = require('node:crypto');
const governance = require('../../integrations/services/integrationMongoGovernanceService');
const State = require('../../integrations/models/integrationGovernanceState');

const hash = (value) => createHash('sha256').update(String(value)).digest('hex');
const unavailable = () =>
  Object.assign(Error('Authentication controls temporarily unavailable.'), { status: 503 });
const loginKey = (req) =>
  `auth:v1:login:${hash(
    `${req.ip || req.socket?.remoteAddress || 'unknown'}:${String(req.body?.email || '')
      .trim()
      .toLowerCase()}`
  )}`;

const currentState = (state, now) => {
  if (!state) return null;
  if (!(state.expiresAt instanceof Date) || !Number.isFinite(state.expiresAt.getTime()))
    throw unavailable();
  if (state.expiresAt.getTime() <= now) return null;
  if (!Number.isSafeInteger(state.count) || state.count < 0 || !Array.isArray(state.leases))
    throw unavailable();
  if (
    state.leases.length &&
    (!(state.leases[0].until instanceof Date) || !Number.isFinite(state.leases[0].until.getTime()))
  )
    throw unavailable();
  return state;
};

async function blockedUntil(req) {
  return governance.transaction(async (session, now) => {
    const state = currentState(
      await State.collection.findOne({ _id: loginKey(req) }, { session }),
      now
    );
    return state?.expiresAt > new Date(now) ? new Date(state.leases?.[0]?.until || 0).getTime() : 0;
  });
}

async function failure(req, security) {
  const maximum = Number(security.loginMaxFailures || process.env.BRUTE_FORCE_MAX_ATTEMPTS || 6);
  const lockoutMs = Number(security.loginLockoutMinutes || 10) * 60000;
  if (!Number.isFinite(maximum) || maximum < 1 || !Number.isFinite(lockoutMs) || lockoutMs < 1)
    throw unavailable();
  return governance.transaction(async (session, now) => {
    const key = loginKey(req);
    const previous = currentState(await State.collection.findOne({ _id: key }, { session }), now);
    const count = previous?.expiresAt > new Date(now) ? Number(previous.count || 0) + 1 : 1;
    if (!Number.isSafeInteger(count)) throw unavailable();
    const until = count >= maximum ? now + lockoutMs : 0;
    await State.collection.replaceOne(
      { _id: key },
      {
        _id: key,
        count,
        leases: until ? [{ token: 'blocked', until: new Date(until) }] : [],
        expiresAt: new Date(Math.max(now + 30 * 60000, until))
      },
      { upsert: true, session }
    );
  });
}

async function clear(req) {
  return governance.transaction((session) =>
    State.collection.deleteOne({ _id: loginKey(req) }, { session })
  );
}

async function consumeOAuth(provider, decoded) {
  if (!Number.isFinite(decoded.exp) || typeof decoded.nonce !== 'string') throw unavailable();
  try {
    await governance.initialize();
    await State.collection.insertOne(
      {
        _id: `auth:v1:oauth:${hash(`${provider}:${decoded.nonce}`)}`,
        count: 1,
        leases: [],
        // Retain consumed markers beyond token expiry to tolerate normal clock skew.
        expiresAt: new Date(Math.max(decoded.exp * 1000, Date.now()) + 10 * 60000)
      },
      { timeoutMS: 2000, writeConcern: { w: 'majority' } }
    );
  } catch (error) {
    if (error.code === 11000)
      throw Object.assign(Error('Invalid or reused OAuth state.'), { statusCode: 400 });
    throw unavailable();
  }
}

module.exports = { hash, blockedUntil, failure, clear, consumeOAuth };
