const { createHash } = require('node:crypto');
const cache = require('../services/redisCacheService');
const COUNTER =
  "local n = redis.call('INCR', KEYS[1]); if n == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end; return n";

function limiter(name, limit, windowMs, strict = false) {
  const local = new Map();
  return async (req, res, next) => {
    const now = Date.now();
    const until = (Math.floor(now / windowMs) + 1) * windowMs;
    // req.ip respects Express trust-proxy policy; never trust raw forwarded headers.
    const subject =
      name === 'contact-recipient' ? req.params.slug : req.user?._id || req.ip || 'unknown';
    const identity = createHash('sha256').update(String(subject)).digest('hex');
    const key = `public-portfolio:v3:rate:${name}:${identity}:${Math.floor(now / windowMs)}`;
    let count;
    try {
      const redis = cache.getRedisCacheClient();
      if (!redis) throw new Error('unavailable');
      count = Number(await redis.eval(COUNTER, { keys: [key], arguments: [String(until - now)] }));
    } catch {
      if (strict) {
        res.set('Retry-After', '30');
        return res
          .status(503)
          .json({ message: 'Portfolio action controls temporarily unavailable.' });
      }
      for (const [id, entry] of local) if (entry.until <= now) local.delete(id);
      if (!local.has(key) && local.size >= 2000)
        return res.status(503).json({ message: 'Portfolio service is busy.' });
      const entry = local.get(key) || { count: 0, until };
      count = ++entry.count;
      local.set(key, entry);
    }
    res.set('RateLimit-Limit', String(limit));
    res.set('RateLimit-Remaining', String(Math.max(0, limit - count)));
    if (count > limit) {
      res.set('Retry-After', String(Math.max(1, Math.ceil((until - now) / 1000))));
      return res.status(429).json({ message: 'Too many portfolio requests. Please retry later.' });
    }
    next();
  };
}
module.exports = {
  limiter,
  publicViewLimit: limiter('view', 60, 60000),
  resumeLimit: limiter('resume', 10, 60000),
  analyticsLimit: limiter('analytics', 30, 60000),
  mutationLimit: limiter('mutation', 20, 60000),
  uploadLimit: limiter('upload', 10, 3600000, true),
  contactRecipientLimit: limiter('contact-recipient', 20, 86400000, true),
  contactLimit: limiter('contact', 3, 3600000, true)
};
