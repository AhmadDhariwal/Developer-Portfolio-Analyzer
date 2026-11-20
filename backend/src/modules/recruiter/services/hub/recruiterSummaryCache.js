const { createHash, randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const {
  getRedisCacheClient,
  acquireCacheLock,
  releaseCacheLock
} = require('../../../../core/cache/redisCacheService');

const getRecruiterSummary = async ({ recruiterId, organizationId, teamIds, revision }, build) => {
  const ttl = Math.min(
    300,
    Number.parseInt(process.env.RECRUITER_SUMMARY_CACHE_TTL_SECONDS, 10) || 0
  );
  const redis = ttl > 0 && getRedisCacheClient();
  if (!redis) return build();

  // The caller has already read MongoDB and applied current visibility.
  // Content identity also invalidates successful writes during a Redis outage.
  const digest = createHash('sha256')
    .update(JSON.stringify([new Date().toISOString().slice(0, 10), teamIds, revision]))
    .digest('hex');
  const key = `recruiter:analytics:v1:${organizationId}:${recruiterId}:${digest}`;
  const lockKey = `${key}:lock`;
  const token = randomUUID();
  let locked = false;
  let result;
  try {
    const existing = await redis.get(key);
    if (existing) return JSON.parse(existing);
    locked = await acquireCacheLock(lockKey, token, 5);
    if (locked === false) {
      await delay(50);
      const filled = await redis.get(key);
      if (filled) return JSON.parse(filled);
    }
    result = build();
    if (locked) await redis.setEx(key, ttl, JSON.stringify(result));
  } catch {
    // Cache failures never require a second MongoDB read.
  } finally {
    if (locked) await releaseCacheLock(lockKey, token);
  }
  return result ?? build();
};

module.exports = { getRecruiterSummary };
