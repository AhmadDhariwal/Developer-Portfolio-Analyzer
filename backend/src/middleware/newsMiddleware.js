const { queryFor } = require('../utils/newsQuery');
const rateLimit = require('express-rate-limit');
const cache = require('../services/redisCacheService');
const { COUNTER } = require('../services/newsGovernanceService');

// Local fallback remains bounded by express-rate-limit's expiring store. Shared
// counters apply after JWT authentication; no client-supplied user ID is trusted.
function limiter(kind, maximum) {
  const local = rateLimit({
    windowMs: 60000,
    limit: maximum,
    keyGenerator: (req) => String(req.user._id),
    standardHeaders: true,
    legacyHeaders: false
  });
  return async (req, res, next) => {
    const redis = cache.getRedisCacheClient({ commandTimeoutMs: 1000 });
    if (redis) {
      try {
        const count = Number(
          await redis.eval(COUNTER, {
            keys: [`news:v3:request:${kind}:${req.user._id}:${Math.floor(Date.now() / 60000)}`],
            arguments: ['60000']
          })
        );
        if (count > maximum) {
          res.set('Retry-After', '60');
          return res.status(429).json({ message: 'Too many news requests. Please try again later.' });
        }
        return next();
      } catch {
        /* Redis outages must not block cached browsing. */
      }
    }
    return local(req, res, next);
  };
}

const feedLimit = limiter('feed', 120);
const refreshLimit = limiter('refresh', 3);
const mutationLimit = limiter('mutation', 30);
function validateFeed(req, res, next) {
  const allowed = new Set([
    'tab',
    'category',
    'source',
    'date',
    'search',
    'popularity',
    'page',
    'limit',
    'mode',
    'refresh',
    'bypassCache'
  ]);
  if (req.query.mode !== undefined && !['personalized', 'explore'].includes(req.query.mode))
    return res.status(400).json({ message: 'News mode is invalid.' });
  for (const [key, value] of Object.entries(req.query || {})) {
    if (!allowed.has(key) || typeof value !== 'string' || value.length > 160)
      return res.status(400).json({ message: 'News filters are invalid.' });
  }
  if (req.query.search?.trim() && !queryFor(req.query.search))
    return res.status(400).json({
      message:
        'Use a technology phrase of 2–80 characters and at most six words; URLs, identifiers and search operators are not supported.'
    });
  for (const [key, maximum] of [
    ['page', 10000],
    ['limit', 30]
  ]) {
    if (
      req.query[key] !== undefined &&
      (!/^\d+$/.test(req.query[key]) || Number(req.query[key]) < 1 || Number(req.query[key]) > maximum)
    )
      return res.status(400).json({ message: 'News pagination is invalid.' });
  }
  // Browser/proxy caches must never reuse one account's personalized response.
  res.set('Cache-Control', 'private, no-store');
  if (['refresh', 'bypassCache'].some((key) => ['1', 'true', 'yes'].includes(String(req.query[key]).toLowerCase())))
    return refreshLimit(req, res, next);
  return next();
}

module.exports = { feedLimit, mutationLimit, validateFeed };
