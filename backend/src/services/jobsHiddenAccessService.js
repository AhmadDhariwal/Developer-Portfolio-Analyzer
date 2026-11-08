const bcrypt = require('bcryptjs');
const { createHash, randomBytes } = require('node:crypto');
const User = require('../models/user');
const cache = require('./redisCacheService');
const { COUNTER } = require('./jobGovernanceService');
const TTL_SECONDS = 300;
const fail = (status, code, message) => Object.assign(new Error(message), { status, code });
const locked = () =>
  fail(403, 'JOBS_HIDDEN_LOCKED', 'Confirm your account password to access hidden jobs.');
const unavailable = () =>
  fail(503, 'JOBS_HIDDEN_UNAVAILABLE', 'Hidden jobs protection is temporarily unavailable.');
const digest = (value) => createHash('sha256').update(String(value)).digest('hex');
let comparisons = 0;

async function account(req) {
  let user;
  try {
    user = await User.findById(req.user._id)
      .select('+password sessionRevision isActive')
      .maxTimeMS(1500)
      .lean();
  } catch {
    throw unavailable();
  }
  if (
    !user ||
    user.isActive === false ||
    Number(user.sessionRevision || 0) !== Number(req.user.sessionRevision || 0)
  )
    throw fail(401, 'JOBS_HIDDEN_SESSION_EXPIRED', 'Your session changed. Sign in again.');
  return user;
}
function client() {
  const redis = cache.getRedisCacheClient();
  if (!redis) throw unavailable();
  return redis;
}
function token(req) {
  const value = req.headers?.['x-jobs-hidden-token'];
  return typeof value === 'string' && value.length === 43 && /^[A-Za-z0-9_-]{43}$/.test(value)
    ? value
    : '';
}
function key(req, user, grant) {
  const binding = digest(
    JSON.stringify([
      String(req.user._id),
      req.headers?.authorization || '',
      Number(user.sessionRevision || 0),
      user.password || ''
    ])
  );
  return `jobs:v3:hidden:grant:${binding}:${digest(grant)}`;
}
async function unlock(req) {
  const password = req.body?.password;
  if (
    typeof password !== 'string' ||
    !password.length ||
    password.length > 1024 ||
    Object.keys(req.body).some((name) => name !== 'password')
  )
    throw fail(400, 'JOBS_HIDDEN_PASSWORD_REQUIRED', 'Enter your account password.');
  const redis = client();
  const user = await account(req);
  if (!user.password)
    throw fail(
      403,
      'JOBS_HIDDEN_PASSWORD_UNAVAILABLE',
      'This account has no password. Use the account password setup or recovery flow before accessing hidden jobs.'
    );
  if (comparisons >= 2) throw unavailable();
  const attemptsKey = `jobs:v3:hidden:attempts:${digest(req.user._id)}`;
  comparisons++;
  let valid;
  try {
    try {
      const attempts = Number(
        await redis.eval(COUNTER, { keys: [attemptsKey], arguments: ['900000'] })
      );
      if (!Number.isFinite(attempts) || attempts < 1) throw unavailable();
      if (attempts > 5) {
        const remaining = Number(await redis.pTTL(attemptsKey));
        throw Object.assign(
          fail(
            429,
            'JOBS_HIDDEN_TOO_MANY_ATTEMPTS',
            'Too many failed password confirmations. Try again later.'
          ),
          { retryAfter: Math.max(1, Math.ceil((remaining > 0 ? remaining : 900000) / 1000)) }
        );
      }
    } catch (error) {
      if (error.status === 429) throw error;
      throw unavailable();
    }
    valid = await bcrypt.compare(password, user.password);
  } finally {
    comparisons--;
  }
  if (!valid)
    throw fail(403, 'JOBS_HIDDEN_PASSWORD_INCORRECT', 'The account password is incorrect.');
  const grant = randomBytes(32).toString('base64url');
  const expiresAt = Date.now() + TTL_SECONDS * 1000;
  try {
    await redis.del(attemptsKey);
    if (
      (await redis.set(key(req, user, grant), String(expiresAt), { NX: true, EX: TTL_SECONDS })) !==
      'OK'
    )
      throw unavailable();
  } catch {
    throw unavailable();
  }
  return { token: grant, expiresAt };
}
async function isUnlocked(req) {
  const grant = token(req);
  if (!grant) return false;
  const redis = client();
  const user = await account(req);
  try {
    const expiresAt = Number(await redis.get(key(req, user, grant)));
    return Number.isFinite(expiresAt) && expiresAt > Date.now();
  } catch {
    throw unavailable();
  }
}
async function lock(req) {
  const grant = token(req);
  if (!grant) return;
  const redis = client();
  const user = await account(req);
  try {
    await redis.del(key(req, user, grant));
  } catch {
    throw unavailable();
  }
}
module.exports = { unlock, lock, isUnlocked, locked, TTL_SECONDS };
