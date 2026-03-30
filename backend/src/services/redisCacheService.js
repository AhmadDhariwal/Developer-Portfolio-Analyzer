const { createClient } = require('redis');

const CACHE_TTL_SECONDS = 60 * 60;
const INTERVIEW_CACHE_PREFIXES = ['interview:questions:', 'interview:search:'];

let client;
let redisEnabled = false;
let connectPromise;

const initRedisCache = async () => {
  const redisUrl = String(process.env.REDIS_URL || '').trim();
  if (!redisUrl) {
    console.log('[redis] REDIS_URL not set. Redis cache disabled.');
    return null;
  }

  if (redisEnabled && client) {
    return client;
  }

  if (connectPromise) {
    return connectPromise;
  }

  client = createClient({ url: redisUrl });
  client.on('error', (error) => {
    console.error('[redis] client error:', error.message);
  });

  connectPromise = client.connect()
    .then(() => {
      redisEnabled = true;
      console.log('[redis] connected.');
      return client;
    })
    .catch((error) => {
      redisEnabled = false;
      client = null;
      console.error('[redis] connection failed:', error.message);
      return null;
    })
    .finally(() => {
      connectPromise = null;
    });

  return connectPromise;
};

const getCacheJson = async (key) => {
  if (!redisEnabled || !client) return null;
  try {
    const raw = await client.get(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (error) {
    console.error('[redis] get cache failed:', error.message);
    return null;
  }
};

const setCacheJson = async (key, payload, ttlSeconds = CACHE_TTL_SECONDS) => {
  if (!redisEnabled || !client) return;
  try {
    await client.set(key, JSON.stringify(payload), { EX: ttlSeconds });
  } catch (error) {
    console.error('[redis] set cache failed:', error.message);
  }
};

const deleteByPrefix = async (prefix) => {
  if (!redisEnabled || !client) return;
  try {
    const keysToDelete = [];
    for await (const key of client.scanIterator({ MATCH: `${prefix}*`, COUNT: 200 })) {
      keysToDelete.push(key);
      if (keysToDelete.length >= 200) {
        await client.del(keysToDelete);
        keysToDelete.length = 0;
      }
    }

    if (keysToDelete.length > 0) {
      await client.del(keysToDelete);
    }
  } catch (error) {
    console.error('[redis] delete by prefix failed:', error.message);
  }
};

const invalidateInterviewPrepCache = async () => {
  await Promise.all(INTERVIEW_CACHE_PREFIXES.map((prefix) => deleteByPrefix(prefix)));
};

module.exports = {
  CACHE_TTL_SECONDS,
  initRedisCache,
  getCacheJson,
  setCacheJson,
  invalidateInterviewPrepCache
};