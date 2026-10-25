const { createClient } = require('redis');
const { randomUUID } = require('node:crypto');

const CACHE_TTL_SECONDS = 60 * 60;
const INTERVIEW_CACHE_PREFIXES = ['interview:questions:', 'interview:search:', 'interview:custom:'];
const UPSTASH_DEFAULT_HOST = 'light-arachnid-164805.upstash.io';
const UPSTASH_DEFAULT_PORT = 6379;
const REDIS_CONNECT_TIMEOUT_MS = 3000;
const REDIS_COMMAND_TIMEOUT_MS = 150;
// A timed-out wrapper does not remove an already-sent SDK reply waiter.
// Bound that backlog while a connected socket stops returning replies.
const REDIS_COMMAND_QUEUE_MAX_LENGTH = 2000;
const REDIS_RECONNECT_DELAY_MS = 15000;

let client;
let clientProxy;
let redisEnabled = false;
let connectPromise;
let reconnectTimer;
let closing = false;
const memoryCache = new Map();
const MAX_MEMORY_ENTRIES = 2000;
const INTERVIEW_MEMORY_TTL_SECONDS = 30;
const interviewRevisions = new Map();
const isInterviewKey = (key) => INTERVIEW_CACHE_PREFIXES.some((prefix) => key.startsWith(prefix));

const getMemoryValue = (key) => {
  const entry = memoryCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    memoryCache.delete(key);
    return null;
  }
  return entry.value;
};

const getRedisUrl = () => {
  const override = String(process.env.REDIS_URL || '').trim();
  if (override) return override;

  const token = String(process.env.UPSTASH_REDIS_TOKEN || '').trim();
  if (!token) return '';

  let host =
    String(process.env.UPSTASH_REDIS_HOST || UPSTASH_DEFAULT_HOST).trim() || UPSTASH_DEFAULT_HOST;
  host = host
    .replace(/^["']|["']$/g, '')
    .replace(/^[a-zA-Z]+:\/\//, '')
    .replace(/[/?#].*$/, '')
    .trim();
  if (!host) return '';
  const requestedPort = Number.parseInt(
    process.env.UPSTASH_REDIS_PORT || String(UPSTASH_DEFAULT_PORT),
    10
  );
  const port =
    Number.isInteger(requestedPort) && requestedPort > 0 && requestedPort <= 65535
      ? requestedPort
      : UPSTASH_DEFAULT_PORT;
  return `rediss://default:${encodeURIComponent(token)}@${host}:${port}`;
};

const runWithCommandTimeout = async (operation, commandTimeoutMs = REDIS_COMMAND_TIMEOUT_MS) => {
  let timeout;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Redis command timed out.')), commandTimeoutMs);
        timeout.unref?.();
      })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
};

const createCommandProxy = (redisClient, commandTimeoutMs = REDIS_COMMAND_TIMEOUT_MS) =>
  new Proxy(redisClient, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== 'function') return value;
      if (property === 'scanIterator') {
        return (...args) => {
          const iterator = value.apply(target, args);
          return {
            [Symbol.asyncIterator]() {
              return this;
            },
            next: () => runWithCommandTimeout(() => iterator.next(), commandTimeoutMs),
            return: () =>
              typeof iterator.return === 'function'
                ? iterator.return()
                : Promise.resolve({ done: true })
          };
        };
      }
      return (...args) => runWithCommandTimeout(() => value.apply(target, args), commandTimeoutMs);
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

const initRedisCache = async ({ silent = false, probeOnly = false } = {}) => {
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

  let redisClient;
  try {
    redisClient = createClient({
      url: redisUrl,
      disableOfflineQueue: true,
      commandsQueueMaxLength: REDIS_COMMAND_QUEUE_MAX_LENGTH,
      socket: {
        connectTimeout: REDIS_CONNECT_TIMEOUT_MS,
        reconnectStrategy: (retries) => {
          if (closing || retries >= 2) return false;
          return Math.min(500, 150 * (retries + 1));
        }
      }
    });
  } catch (error) {
    if (!silent)
      console.warn('[redis] invalid configuration; using application fallbacks:', error?.message);
    return null;
  }
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
    // Mutations may have succeeded while Redis was unavailable. Recovery starts
    // a fresh shared namespace instead of resurrecting pre-outage results.
    if (!probeOnly) redisClient.set('interview:revision:global', randomUUID()).catch(() => {});
  });

  connectPromise = redisClient
    .connect()
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

const nowMs = () => Number(process.hrtime.bigint()) / 1e6;

const getCacheJsonWithMeta = async (key) => {
  const startedAt = nowMs();
  const memoryValue = getMemoryValue(key);
  if (memoryValue !== null) {
    return { value: memoryValue, layer: 'memory', memoryMs: nowMs() - startedAt, redisMs: 0 };
  }
  const memoryMs = nowMs() - startedAt;
  const redis = getRedisCacheClient();
  if (!redis) return { value: null, layer: 'miss', memoryMs, redisMs: 0 };
  const redisStartedAt = nowMs();
  try {
    const readStartedAt = Date.now();
    const [raw, remainingMs] = isInterviewKey(key)
      ? await redis.eval(
          "local value = redis.call('GET', KEYS[1]); if not value then return {false, -2} end; return {value, redis.call('PTTL', KEYS[1])}",
          { keys: [key], arguments: [] }
        )
      : [await redis.get(key), CACHE_TTL_SECONDS * 1000];
    const redisMs = nowMs() - redisStartedAt;
    if (!raw || Number(remainingMs) <= 0) return { value: null, layer: 'miss', memoryMs, redisMs };
    const value = JSON.parse(raw);
    // Promotion must never reset the source TTL. The read start is deliberately
    // conservative; the Lua snapshot also prevents mixing an old value with a
    // replacement value's longer TTL during a concurrent write.
    const ttlMs = Math.min(
      Number(remainingMs),
      (isInterviewKey(key) ? INTERVIEW_MEMORY_TTL_SECONDS : CACHE_TTL_SECONDS) * 1000
    );
    if (ttlMs > 0)
      setMemoryCacheJson(key, value, Math.max(0, readStartedAt + ttlMs - Date.now()) / 1000);
    return { value, layer: 'redis', memoryMs, redisMs };
  } catch {
    console.warn('[redis] cache read failed; using application fallback.');
    return { value: null, layer: 'miss', memoryMs, redisMs: nowMs() - redisStartedAt };
  }
};

const getCacheJson = async (key) => (await getCacheJsonWithMeta(key)).value;

const isRedisCacheEnabled = () => Boolean(redisEnabled && client?.isReady);
// Existing callers retain the 150 ms deadline. News may opt into a bounded
// longer deadline for cross-region Upstash RTT without changing locked modules.
const getRedisCacheClient = ({ commandTimeoutMs } = {}) => {
  if (!isRedisCacheEnabled()) return null;
  return Number.isInteger(commandTimeoutMs) &&
    commandTimeoutMs >= REDIS_COMMAND_TIMEOUT_MS &&
    commandTimeoutMs <= 1500
    ? createCommandProxy(client, commandTimeoutMs)
    : clientProxy;
};

const pingRedisCache = async () => {
  const redis = getRedisCacheClient();
  if (!redis) return null;
  try {
    return await redis.ping();
  } catch {
    return null;
  }
};

const setMemoryCacheJson = (key, payload, ttlSeconds = CACHE_TTL_SECONDS) => {
  const ttl = isInterviewKey(key)
    ? Math.min(INTERVIEW_MEMORY_TTL_SECONDS, Number(ttlSeconds))
    : Number(ttlSeconds);
  if (!Number.isFinite(ttl) || ttl <= 0) return;
  memoryCache.delete(key);
  while (memoryCache.size >= MAX_MEMORY_ENTRIES)
    memoryCache.delete(memoryCache.keys().next().value);
  memoryCache.set(key, { value: payload, expiresAt: Date.now() + ttl * 1000 });
};

const setCacheJson = async (key, payload, ttlSeconds = CACHE_TTL_SECONDS) => {
  setMemoryCacheJson(key, payload, ttlSeconds);
  const redis = getRedisCacheClient();
  if (!redis) return;
  redis.set(key, JSON.stringify(payload), { EX: ttlSeconds }).catch(() => {
    console.warn('[redis] cache write failed; continuing without Redis.');
  });
};

const clearMemoryCache = () => memoryCache.clear();

const deleteCacheKey = async (key) => {
  memoryCache.delete(key);
  const redis = getRedisCacheClient();
  if (!redis) return;
  try {
    await redis.del(key);
  } catch {
    console.warn('[redis] cache invalidation failed; continuing without Redis.');
  }
};

const deleteByPrefix = async (prefix) => {
  for (const key of memoryCache.keys()) if (key.startsWith(prefix)) memoryCache.delete(key);
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

// Version reads are small Redis commands, never Mongo queries. Capturing the
// version before a loader runs prevents an old in-flight response from filling
// a newly invalidated cache namespace on any worker.
const resolveInterviewCacheKey = async (key, topicKey) => {
  const names = [
    'interview:revision:global',
    `interview:revision:topic=${encodeURIComponent(topicKey)}`
  ];
  const redis = getRedisCacheClient();
  if (redis) {
    try {
      const revisions = await redis.mGet(names);
      names.forEach((name, index) => interviewRevisions.set(name, revisions[index] || '0'));
    } catch {
      /* Bounded process cache remains usable during a Redis outage. */
    }
  }
  return `${key}:revision=${names.map((name) => interviewRevisions.get(name) || '0').join('.')}`;
};

const invalidateInterviewPrepCache = async (topicKey = '') => {
  const name = topicKey
    ? `interview:revision:topic=${encodeURIComponent(topicKey)}`
    : 'interview:revision:global';
  const revision = randomUUID();
  interviewRevisions.set(name, revision);
  for (const key of memoryCache.keys()) {
    if (isInterviewKey(key) && (!topicKey || key.includes(`:topic=${topicKey}:`)))
      memoryCache.delete(key);
  }
  const redis = getRedisCacheClient();
  if (redis) {
    // Revision keys intentionally outlive cached payloads; expiring a revision
    // could resurrect an older namespace. Unreachable payloads expire normally.
    try {
      await redis.set(name, revision);
    } catch {
      console.warn('[redis] interview invalidation unavailable; process cache remains bounded.');
    }
  }
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
  getCacheJsonWithMeta,
  setCacheJson,
  setMemoryCacheJson,
  clearMemoryCache,
  deleteCacheKey,
  deleteByPrefix,
  acquireCacheLock,
  releaseCacheLock,
  invalidateInterviewPrepCache,
  resolveInterviewCacheKey
};
