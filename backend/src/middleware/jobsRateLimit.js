const { createHash } = require('node:crypto');
const cache = require('../services/redisCacheService');
const { COUNTER } = require('../services/jobGovernanceService');
const local = new Map();
function limiter(name, limit, windowMs, strict = false) {
  return async (req, res, next) => {
    if (!req.user?._id) return res.status(401).json({ message: 'Authentication required.' });
    const now = Date.now();
    const until = (Math.floor(now / windowMs) + 1) * windowMs;
    const identity = createHash('sha256').update(String(req.user._id)).digest('hex');
    const key = `jobs:v2:rate:${name}:${identity}:${Math.floor(now / windowMs)}`;
    let count;
    const redis = cache.getRedisCacheClient();
    try {
      if (!redis) throw new Error('unavailable');
      count = Number(await redis.eval(COUNTER, { keys: [key], arguments: [String(until - now)] }));
    } catch {
      if (strict)
        return res.status(503).json({ message: 'Jobs action controls temporarily unavailable.' });
      for (const [id, entry] of local) if (entry.until <= now) local.delete(id);
      if (!local.has(key) && local.size >= 2000)
        return res.status(503).json({ message: 'Jobs Hub is busy. Please retry.' });
      const entry = local.get(key) || { count: 0, until };
      count = ++entry.count;
      local.set(key, entry);
    }
    res.set('RateLimit-Limit', String(limit));
    res.set('RateLimit-Remaining', String(Math.max(0, limit - count)));
    if (count > limit) {
      res.set('Retry-After', String(Math.max(1, Math.ceil((until - now) / 1000))));
      return res.status(429).json({ message: 'Too many Jobs Hub requests. Please retry later.' });
    }
    return next();
  };
}
const jobsRateLimit = limiter('read', 120, 60000);
const refreshLimit = limiter('refresh', 2, 900000, true);
const actionRateLimit = limiter('action', 30, 60000, true);
const jobsRefreshLimit = (req, res, next) =>
  ['true', '1'].includes(String(req.query.forceRefresh || req.query.refresh || '').toLowerCase())
    ? refreshLimit(req, res, next)
    : next();
const validateJobsRequest = (req, res, next) => {
  if (
    Object.entries(req.query).some(
      ([key, value]) => key.length > 40 || typeof value !== 'string' || value.length > 200
    )
  )
    return res.status(400).json({ message: 'Invalid Jobs Hub query.' });
  if (req.params.id) {
    try {
      require('../services/jobActionService').jobKey(req.params.id);
    } catch {
      return res.status(400).json({ message: 'Invalid job id.' });
    }
  }
  res.set('Cache-Control', 'private, no-store');
  return next();
};
module.exports = { jobsRateLimit, jobsRefreshLimit, actionRateLimit, validateJobsRequest, limiter };
