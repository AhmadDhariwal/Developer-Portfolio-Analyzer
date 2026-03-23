const rateLimit = require('express-rate-limit');
const logger = require('../utils/logger');

const loginAttemptStore = new Map();

const cleanupAttempts = () => {
  const now = Date.now();
  const ttl = 30 * 60 * 1000;
  for (const [key, entry] of loginAttemptStore.entries()) {
    if (now - entry.lastAttemptAt > ttl) {
      loginAttemptStore.delete(key);
    }
  }
};

const makeLoginKey = (req) => {
  const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown_ip';
  const email = String(req.body?.email || '').trim().toLowerCase();
  return `${ip}:${email}`;
};

const globalRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.RATE_LIMIT_GLOBAL_MAX || 500),
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests. Please try again later.' }
});

const authRateLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: Number(process.env.RATE_LIMIT_AUTH_MAX || 20),
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many authentication attempts. Please try again later.' }
});

const bruteForceGuard = (req, res, next) => {
  cleanupAttempts();

  const key = makeLoginKey(req);
  const entry = loginAttemptStore.get(key);
  if (!entry) return next();

  if (!entry.blockedUntil || entry.blockedUntil <= Date.now()) return next();

  const waitSec = Math.ceil((entry.blockedUntil - Date.now()) / 1000);
  return res.status(429).json({
    message: `Account temporarily locked due to repeated failed logins. Try again in ${waitSec}s.`
  });
};

const registerAuthFailure = (req) => {
  const key = makeLoginKey(req);
  const now = Date.now();

  const maxFailures = Number(process.env.BRUTE_FORCE_MAX_ATTEMPTS || 6);
  const lockoutMs = Number(process.env.BRUTE_FORCE_LOCKOUT_MS || 10 * 60 * 1000);

  const entry = loginAttemptStore.get(key) || { count: 0, lastAttemptAt: now, blockedUntil: 0 };
  entry.count += 1;
  entry.lastAttemptAt = now;

  if (entry.count >= maxFailures) {
    entry.blockedUntil = now + lockoutMs;
    logger.warn('brute-force protection triggered', {
      key,
      attempts: entry.count,
      lockoutMs
    });
  }

  loginAttemptStore.set(key, entry);
};

const clearAuthFailures = (req) => {
  const key = makeLoginKey(req);
  loginAttemptStore.delete(key);
};

module.exports = {
  globalRateLimiter,
  authRateLimiter,
  bruteForceGuard,
  registerAuthFailure,
  clearAuthFailures
};
