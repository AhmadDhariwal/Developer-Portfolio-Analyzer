const { createClient } = require('redis');

const CACHE_TTL_SECONDS = 60 * 60;
const INTERVIEW_CACHE_PREFIXES = ['interview:questions:', 'interview:search:', 'interview:custom:'];
const UPSTASH_DEFAULT_HOST = 'light-arachnid-164805.upstash.io';
const UPSTASH_DEFAULT_PORT = 6379;
const REDIS_CONNECT_TIMEOUT_MS = 3000;
const REDIS_COMMAND_TIMEOUT_MS = 2500;
const REDIS_RECONNECT_DELAY_MS = 15000;

let client;
let clientProxy;
let redisEnabled = false;
let connectPromise;
let reconnectTimer;
let closing = false;

const getRedisUrl = () => {
  const override = String(process.env.REDIS_URL || '').trim();
  if (override) return override;

  const token = String(process.env.UPSTASH_REDIS_TOKEN || '').trim();
  if (!token) return '';

  const host = String(process.env.UPSTASH_REDIS_HOST || UPSTASH_DEFAULT_HOST).trim() || UPSTASH_DEFAULT_HOST;
  if (!host) return '';
  const requestedPort = Number.parseInt(process.env.UPSTASH_REDIS_PORT || String(UPSTASH_DEFAULT_PORT), 10);
  const port = Number.isInteger(requestedPort) && requestedPort > 0 && requestedPort <= 65535
    ? requestedPort
    : UPSTASH_DEFAULT_PORT;
  return `rediss://default:${encodeURIComponent(token)}@${host}:${port}`;
};

const runWithCommandTimeout = async (operation) => {
  let timeout;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Redis command timed out.')), REDIS_COMMAND_TIMEOUT_MS);
        timeout.unref?.();
      })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
};

const createCommandProxy = (redisClient) => new Proxy(redisClient, {
  get(target, property, receiver) {
    const value = Reflect.get(target, property, receiver);
    if (typeof value !== 'function') return value;
    if (property === 'scanIterator') {
      return (...args) => {
        const iterator = value.apply(target, args);
        return {
          [Symbol.asyncIterator]() { return this; },
          next: () => runWithCommandTimeout(() => iterator.next()),
          return: () => (typeof iterator.return === 'function' ? iterator.return() : Promise.resolve({ done: true }))
        };
      };
    }
    return (...args) => runWithCommandTimeout(() => value.apply(target, args));
  }
});

const scheduleReconnect = () => {
  if (closing || reconnectTimer || !getRedisUrl()) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    initRedisCache();
  }, REDIS_RECONNECT_DELAY_MS);
  reconnectTimer.unref?.();
};

const setUnavailable = (redisClient, { schedule = true } = {}) => {
  if (client !== redisClient) return;
  redisEnabled = false;
  clientProxy = null;
  if (schedule) scheduleReconnect();
};

const initRedisCache = async ({ silent = false } = {}) => {
  closing = false;
  const redisUrl = getRedisUrl();
  if (!redisUrl) {
    if (!silent) console.log('[redis] Redis is not configured; cache disabled.');
    return null;
  }

  if (redisEnabled && client?.isReady) {
    return clientProxy || client;
  }

  if (connectPromise) {
    return connectPromise;
  }

  const redisClient = createClient({
    url: redisUrl,
    disableOfflineQueue: true,
    socket: {
      connectTimeout: REDIS_CONNECT_TIMEOUT_MS,
      reconnectStrategy: (retries) => {
        if (closing || retries >= 2) return false;
        return Math.min(500, 150 * (retries + 1));
      }
    }
  });
  client = redisClient;
  clientProxy = createCommandProxy(redisClient);
  redisClient.on('error', () => {
    setUnavailable(redisClient);
    if (!silent) console.warn('[redis] connection unavailable; using application fallbacks.');
  });
  redisClient.on('end', () => {
    setUnavailable(redisClient);
    if (client === redisClient) client = null;
  });
  redisClient.on('ready', () => {
    if (client !== redisClient) return;
    redisEnabled = true;
    clientProxy = createCommandProxy(redisClient);
  });

  connectPromise = redisClient.connect()
    .then(() => {
      if (closing || client !== redisClient) return null;
      redisEnabled = true;
      if (!silent) console.log('[redis] connected.');
      return clientProxy;
    })
    .catch(() => {
      setUnavailable(redisClient);
      if (client === redisClient) client = null;
      if (!silent) console.warn('[redis] connection unavailable; using application fallbacks.');
      return null;
    })
    .finally(() => {
      connectPromise = null;
    });

  return connectPromise;
};

const getCacheJson = async (key) => {
  const redis = getRedisCacheClient();
  if (!redis) return null;
  try {
    const raw = await redis.get(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    console.warn('[redis] cache read failed; using application fallback.');
    return null;
  }
};

const isRedisCacheEnabled = () => Boolean(redisEnabled && client?.isReady);
const getRedisCacheClient = () => (isRedisCacheEnabled() ? clientProxy : null);

const pingRedisCache = async () => {
  const redis = getRedisCacheClient();
  if (!redis) return null;
  try {
    return await redis.ping();
  } catch {
    return null;
  }
};

const setCacheJson = async (key, payload, ttlSeconds = CACHE_TTL_SECONDS) => {
  const redis = getRedisCacheClient();
  if (!redis) return;
  try {
    await redis.set(key, JSON.stringify(payload), { EX: ttlSeconds });
  } catch {
    console.warn('[redis] cache write failed; continuing without Redis.');
  }
};

const deleteCacheKey = async (key) => {
  const redis = getRedisCacheClient();
  if (!redis) return;
  try {
    await redis.del(key);
  } catch {
    console.warn('[redis] cache invalidation failed; continuing without Redis.');
  }
};

const deleteByPrefix = async (prefix) => {
  const redis = getRedisCacheClient();
  if (!redis) return;
  try {
    const keysToDelete = [];
    for await (const key of redis.scanIterator({ MATCH: `${prefix}*`, COUNT: 200 })) {
      keysToDelete.push(key);
      if (keysToDelete.length >= 200) {
        await redis.del(keysToDelete);
        keysToDelete.length = 0;
      }
    }

    if (keysToDelete.length > 0) {
      await redis.del(keysToDelete);
    }
  } catch {
    console.warn('[redis] cache invalidation failed; continuing without Redis.');
  }
};

const acquireCacheLock = async (key, token, ttlSeconds = 900) => {
  const redis = getRedisCacheClient();
  if (!redis) return null;
  try {
    const result = await redis.set(key, token, { NX: true, EX: ttlSeconds });
    return result === 'OK';
  } catch {
    console.warn('[redis] cache lock unavailable; using application fallback.');
    return null;
  }
};

const releaseCacheLock = async (key, token) => {
  const redis = getRedisCacheClient();
  if (!redis) return;
  try {
    const current = await redis.get(key);
    if (current === token) {
      await redis.del(key);
    }
  } catch {
    console.warn('[redis] cache lock release failed; continuing without Redis.');
  }
};

const invalidateInterviewPrepCache = async () => {
  await Promise.all(INTERVIEW_CACHE_PREFIXES.map((prefix) => deleteByPrefix(prefix)));
};

const closeRedisCache = async () => {
  closing = true;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
  const redisClient = client;
  client = null;
  clientProxy = null;
  redisEnabled = false;
  if (!redisClient?.isOpen) return;
  if (!redisClient.isReady) {
    redisClient.disconnect();
    return;
  }
  try {
    await redisClient.quit();
  } catch {
    redisClient.disconnect();
  }
};

module.exports = {
  CACHE_TTL_SECONDS,
  initRedisCache,
  closeRedisCache,
  isRedisCacheEnabled,
  getRedisCacheClient,
  pingRedisCache,
  getCacheJson,
  setCacheJson,
  deleteCacheKey,
  deleteByPrefix,
  acquireCacheLock,
  releaseCacheLock,
  invalidateInterviewPrepCache
};
