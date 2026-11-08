const bcrypt = require('bcryptjs');
const { createHash, randomBytes } = require('node:crypto');
const User = require('../models/user');
const cache = require('./redisCacheService');
const TTL_SECONDS = 300;
const fail = (status, code, message) => Object.assign(new Error(message), { status, code });
const locked = () => fail(403, 'JOBS_HIDDEN_LOCKED', 'Confirm your account password to access hidden jobs.');
const unavailable = () => fail(503, 'JOBS_HIDDEN_UNAVAILABLE', 'Hidden jobs protection is temporarily unavailable.');
const digest = (value) => createHash('sha256').update(String(value)).digest('hex');
let comparisons = 0;

async function account(req) {
  let user;
  try {
    user = await User.findById(req.user._id).select('+password sessionRevision isActive').maxTimeMS(1500).lean();
  } catch { throw unavailable(); }
  if (!user || user.isActive === false || Number(user.sessionRevision || 0) !== Number(req.user.sessionRevision || 0))
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
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : '';
}
function key(req, user, grant) {
  const binding = digest(JSON.stringify([String(req.user._id), req.headers?.authorization || '',
    Number(user.sessionRevision || 0), user.password || '']));
  return `jobs:v3:hidden:grant:${binding}:${digest(grant)}`;
}
async function unlock(req) {
  const password = req.body?.password;
  if (typeof password !== 'string' || !password.length || password.length > 1024)
    throw fail(400, 'JOBS_HIDDEN_PASSWORD_REQUIRED', 'Enter your account password.');
  const redis = client();
  const user = await account(req);
  if (!user.password)
    throw fail(403, 'JOBS_HIDDEN_PASSWORD_UNAVAILABLE', 'This account has no password. Add an account password in Settings before accessing hidden jobs.');
  if (comparisons >= 2) throw unavailable();
  comparisons++;
  let valid;
  try { valid = await bcrypt.compare(password, user.password); }
  finally { comparisons--; }
  if (!valid) throw fail(403, 'JOBS_HIDDEN_PASSWORD_INCORRECT', 'The account password is incorrect.');
  const grant = randomBytes(32).toString('base64url');
  const expiresAt = Date.now() + TTL_SECONDS * 1000;
  try {
    if (await redis.set(key(req, user, grant), String(expiresAt), { NX: true, EX: TTL_SECONDS }) !== 'OK') throw unavailable();
  } catch { throw unavailable(); }
  return { token: grant, expiresAt };
}
async function isUnlocked(req) {
  const grant = token(req);
  if (!grant) return false;
  const redis = client();
  const user = await account(req);
  try { return Number(await redis.get(key(req, user, grant))) > Date.now(); }
  catch { throw unavailable(); }
}
async function lock(req) {
  const grant = token(req);
  if (!grant) return;
  const redis = client();
  const user = await account(req);
  try { await redis.del(key(req, user, grant)); }
  catch { throw unavailable(); }
}
module.exports = { unlock, lock, isUnlocked, locked, TTL_SECONDS };
