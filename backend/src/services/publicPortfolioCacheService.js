const { createHash, randomUUID } = require('node:crypto');
const redisCache = require('./redisCacheService');
const Cache = require('../models/publicProfileCache');

const revisionFor = (profile, user) => {
  const { totalViews, uniqueViews, lastViewedAt, updatedAt, ...content } = profile;
  return createHash('sha256')
    .update(JSON.stringify([content, user]))
    .digest('hex');
};

// The caller must authorize against current Mongo profile/account state before
// EVERY lookup. Content-addressed keys make old worker entries unreachable after
// edits, including writes made while Redis was down. Never cache previews.
function createPortfolioCache({
  store = Cache,
  redis = redisCache,
  max = 200,
  freshMs = 300000,
  staleMs = 3600000
} = {}) {
  const memory = new Map();
  const flights = new Map();
  async function get(profile, user, loader) {
    if (profile.isPublic !== true)
      throw Object.assign(new Error('Public profile not found.'), { statusCode: 404 });
    const key = `public-portfolio:v3:${profile._id}:${revisionFor(profile, user)}`;
    const now = Date.now();
    for (const [id, entry] of memory)
      if (new Date(entry.expiresAt).getTime() <= now) memory.delete(id);
    let cached = memory.get(key);
    const remember = (entry) => {
      memory.delete(key);
      while (memory.size >= max) memory.delete(memory.keys().next().value);
      memory.set(key, entry);
    };
    if (!cached) {
      try {
        const raw = await redis.getRedisCacheClient()?.get(key);
        if (raw) cached = JSON.parse(raw);
      } catch {
        /* Mongo remains authoritative and available as fallback. */
      }
      if (!cached) {
        try {
          cached = await store
            .findOne({ profileId: profile._id, key, expiresAt: { $gt: new Date(now) } })
            .lean();
        } catch {
          /* Optional cache failure must not block rendering. */
        }
      }
    }
    if (cached && new Date(cached.expiresAt).getTime() > now) remember(cached);
    else cached = null;
    if (cached && new Date(cached.freshUntil).getTime() > now)
      return structuredClone(cached.payload);
    if (flights.has(key)) return structuredClone(await flights.get(key));
    if (flights.size >= max)
      throw Object.assign(new Error('Portfolio service is busy.'), { statusCode: 503 });
    const flight = (async () => {
      const client = redis.getRedisCacheClient();
      const lockKey = `${key}:lock`;
      const token = randomUUID();
      let locked = false;
      try {
        if (client) {
          try {
            locked = (await client.set(lockKey, token, { NX: true, EX: 10 })) === 'OK';
            if (!locked) {
              // Another worker is building this exact public revision. Never
              // wait indefinitely or build private data into a shared key.
              for (let attempt = 0; attempt < 20; attempt++) {
                await new Promise((resolve) => setTimeout(resolve, 50));
                const raw = await client.get(key);
                if (raw) {
                  const entry = JSON.parse(raw);
                  if (new Date(entry.freshUntil).getTime() > Date.now()) {
                    remember(entry);
                    return entry.payload;
                  }
                }
              }
              throw Object.assign(new Error('Portfolio is being refreshed.'), { statusCode: 503 });
            }
          } catch (error) {
            if (error.statusCode) throw error;
            // Redis outage: per-process single-flight and Mongo remain usable.
          }
        }
        const payload = await loader();
        const entry = {
          key,
          payload,
          freshUntil: new Date(Date.now() + freshMs),
          expiresAt: new Date(Date.now() + staleMs)
        };
        remember(entry);
        await Promise.allSettled([
          store.updateOne({ profileId: profile._id }, { $set: entry }, { upsert: true }),
          redis
            .getRedisCacheClient()
            ?.set(key, JSON.stringify(entry), { EX: Math.ceil(staleMs / 1000) })
        ]);
        return payload;
      } catch (error) {
        // Only same-revision public data may be stale. Authorization failures
        // occur outside this function and can never reach this fallback.
        if (cached && new Date(cached.expiresAt).getTime() > Date.now()) return cached.payload;
        throw error;
      } finally {
        if (locked) {
          try {
            await client.eval(
              "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end; return 0",
              { keys: [lockKey], arguments: [token] }
            );
          } catch {
            /* Lock expires without deleting a successor's lease. */
          }
        }
      }
    })();
    flights.set(key, flight);
    try {
      return structuredClone(await flight);
    } finally {
      flights.delete(key);
    }
  }
  return { get };
}
module.exports = { createPortfolioCache, revisionFor, portfolioCache: createPortfolioCache() };
