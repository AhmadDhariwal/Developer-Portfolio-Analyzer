const { createHash } = require('node:crypto');
const governance = require('../services/integrationMongoGovernanceService');
const metrics = require('../services/notificationMetrics');

function admission(operation, maximum) {
  return async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const stop = metrics.duration.startTimer({ operation: 'admission' });
    try {
      const identity = createHash('sha256').update(String(req.user._id)).digest('hex');
      const result = await governance.requestWindow(
        `notifications:v1:rate:${operation}:${identity}`,
        maximum,
        60000
      );
      if (result.count > maximum) {
        metrics.outcomes.inc({ operation: 'admission', outcome: 'limited' });
        res.set('Retry-After', String(Math.max(1, Math.ceil((result.until - Date.now()) / 1000))));
        return res.status(429).json({ message: 'Notification request limit reached.' });
      }
      metrics.outcomes.inc({ operation: 'admission', outcome: 'allowed' });
      return next();
    } catch {
      metrics.outcomes.inc({ operation: 'admission', outcome: 'unavailable' });
      return res.status(503).json({ message: 'Notification controls temporarily unavailable.' });
    } finally {
      stop();
    }
  };
}
module.exports = { admission };
