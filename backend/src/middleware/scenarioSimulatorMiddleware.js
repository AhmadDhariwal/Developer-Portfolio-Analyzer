'use strict';
const rateLimit = require('express-rate-limit');
const cache = require('../services/redisCacheService');
const { digest } = require('../utils/scenarioIdentity');
const script =
  "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('PEXPIRE',KEYS[1],ARGV[1]) end; return n";
const limiter = (operation, maximum) => {
  const local = rateLimit({
    windowMs: 60000,
    limit: maximum,
    keyGenerator: (req) => String(req.user._id),
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Scenario request quota exceeded.' },
  });
  return async (req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    const redis = cache.getRedisCacheClient({ commandTimeoutMs: 150 });
    if (redis) {
      try {
        const count = Number(
          await redis.eval(script, {
            keys: [
              `scenario:quota:${operation}:${digest(String(req.user._id))}:${Math.floor(Date.now() / 60000)}`,
            ],
            arguments: ['60000'],
          }),
        );
        if (!Number.isInteger(count) || count < 1) throw new Error('Shared quota counter unavailable.');
        if (count > maximum) {
          res.set('Retry-After', '60');
          return res.status(429).json({ message: 'Scenario request quota exceeded.' });
        }
        return next();
      } catch {
        require('../services/scenarioTelemetryService').event('quota', 'shared-unavailable');
      }
    }
    if (process.env.NODE_ENV === 'production' && process.env.SCENARIO_LIMIT_MODE !== 'single-instance') {
      res.set('Retry-After', '2');
      return res.status(503).json({ message: 'Shared Scenario quota service is unavailable.' });
    }
    return local(req, res, next);
  };
};
const limits = {
  context: limiter('context', 30),
  refresh: limiter('refresh', 6),
  evaluate: limiter('evaluate', 60),
  history: limiter('history', 60),
  save: limiter('save', 20),
  export: limiter('export', 10),
  delete: limiter('delete', 20),
};
const contextLimit = (req, res, next) =>
  limits.context(req, res, () =>
    String(req.query.forceRefresh) === 'true' ? limits.refresh(req, res, next) : next(),
  );
module.exports = { limits, contextLimit };
