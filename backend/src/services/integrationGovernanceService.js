'use strict';
const { AsyncLocalStorage } = require('node:async_hooks');
const { createHash, randomUUID } = require('node:crypto');
const cache = require('./redisCacheService');
const { COUNTER } = require('./jobGovernanceService');
const context = new AsyncLocalStorage();
const integer = (name, fallback, min, max) => {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
};
const hash = (value) => createHash('sha256').update(String(value)).digest('hex');
const unavailable = () =>
  Object.assign(Error('Integration controls temporarily unavailable.'), { status: 503 });
const limited = (seconds = 60) =>
  Object.assign(Error('Integration request limit reached.'), {
    status: 429,
    retryAfter: Math.ceil(seconds)
  });
// All keys share one Redis Cluster slot. No local correctness fallback.
const ADMIT = `
local now=tonumber(ARGV[1])
redis.call('ZREMRANGEBYSCORE',KEYS[1],'-inf',now)
redis.call('ZREMRANGEBYSCORE',KEYS[2],'-inf',now)
if redis.call('EXISTS',KEYS[5])==1 then return 0 end
if redis.call('ZCARD',KEYS[1])>=tonumber(ARGV[4]) or redis.call('ZCARD',KEYS[2])>=tonumber(ARGV[5]) then return 0 end
if tonumber(redis.call('GET',KEYS[3]) or '0')>=tonumber(ARGV[6]) or tonumber(redis.call('GET',KEYS[4]) or '0')>=tonumber(ARGV[7]) then return 0 end
for i=3,4 do local n=redis.call('INCR',KEYS[i]); if n==1 then redis.call('PEXPIRE',KEYS[i],60000) end end
for i=1,2 do redis.call('ZADD',KEYS[i],now+tonumber(ARGV[3]),ARGV[2]); redis.call('PEXPIRE',KEYS[i],tonumber(ARGV[3])+1000) end
return 1`;
const COOLDOWN = `local ttl=redis.call('PTTL',KEYS[1]); if ttl<tonumber(ARGV[1]) then redis.call('SET',KEYS[1],'1','PX',ARGV[1]) end return 1`;
async function reserve(provider, owner, duration) {
  const redis = cache.getRedisCacheClient();
  if (!redis) throw unavailable();
  const base = 'integrations:v1:{controls}';
  const token = randomUUID();
  const keys = [
    `${base}:active`,
    `${base}:${provider}:active`,
    `${base}:${provider}:requests`,
    `${base}:${provider}:user:${hash(owner)}`,
    `${base}:${provider}:cooldown`
  ];
  try {
    const allowed = await redis.eval(ADMIT, {
      keys,
      arguments: [
        Date.now(),
        token,
        duration,
        integer('INTEGRATION_GLOBAL_CONCURRENCY', 8, 1, 64),
        integer('INTEGRATION_PROVIDER_CONCURRENCY', 2, 1, 16),
        integer('INTEGRATION_PROVIDER_REQUESTS_PER_MIN', 60, 1, 10000),
        integer('INTEGRATION_USER_PROVIDER_REQUESTS_PER_MIN', 20, 1, 1000)
      ].map(String)
    });
    if (Number(allowed) !== 1) throw limited();
    return { redis, keys, token };
  } catch (error) {
    if (error.status) throw error;
    throw unavailable();
  }
}
function retryAfter(headers = {}) {
  const value = headers['retry-after'];
  const delay =
    value === undefined
      ? 60000
      : /^\d+(\.\d+)?$/.test(String(value))
        ? Number(value) * 1000
        : Date.parse(String(value)) - Date.now();
  const reset = Number(headers['x-ratelimit-reset']) * 1000 - Date.now();
  return Math.max(
    1000,
    Number.isFinite(delay) ? delay : 60000,
    Number.isFinite(reset) && Number(headers['x-ratelimit-remaining']) === 0 ? reset : 0
  );
}
async function finish(reservation, error) {
  const { redis, keys, token } = reservation;
  try {
    if (error) {
      const status = error.response?.status;
      const failureKey = keys[4] + ':failures';
      const failures = Number(
        await redis.eval(COUNTER, { keys: [failureKey], arguments: ['60000'] })
      );
      if ([401, 403, 429].includes(status) || failures >= 3) {
        await redis.eval(COOLDOWN, {
          keys: [keys[4]],
          arguments: [
            String([403, 429].includes(status) ? retryAfter(error.response?.headers) : 60000)
          ]
        });
      }
    }
  } finally {
    await Promise.allSettled([redis.zRem(keys[0], token), redis.zRem(keys[1], token)]);
  }
}
async function request(provider, operation, retry = false) {
  const state = context.getStore();
  if (!state?.owner || state.signal.aborted) throw unavailable();
  const timeout = Math.min(
    integer('INTEGRATION_REQUEST_TIMEOUT_MS', 10000, 1000, 30000),
    state.until - Date.now()
  );
  if (timeout <= 0) throw unavailable();
  const attempts = retry ? 2 : 1;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const reservation = await reserve(provider, state.owner, timeout + 2000);
    let failure;
    try {
      const result = await operation({
        timeout,
        signal: state.signal,
        maxRedirects: 0,
        maxContentLength: 2 * 1024 * 1024,
        maxBodyLength: 100 * 1024,
        proxy: false
      });
      if (
        result?.headers?.['x-ratelimit-remaining'] !== undefined &&
        Number(result.headers['x-ratelimit-remaining']) === 0
      ) {
        await reservation.redis.eval(COOLDOWN, {
          keys: [reservation.keys[4]],
          arguments: [String(retryAfter(result.headers))]
        });
      }
      const payload = result?.data;
      // Stack Exchange expresses backoff and quota inside successful JSON responses.
      if (payload && (Number(payload.backoff) > 0 || payload.quota_remaining === 0)) {
        await reservation.redis.eval(COOLDOWN, {
          keys: [reservation.keys[4]],
          arguments: [String(Math.max(60000, Number(payload.backoff || 0) * 1000))]
        });
      }
      return result;
    } catch (error) {
      failure = error;
      // Never retry exchanges, refreshes, quota errors, authentication failures or unsafe writes.
      if (
        attempt + 1 >= attempts ||
        ![502, 503, 504].includes(error.response?.status) ||
        state.signal.aborted ||
        state.until - Date.now() < timeout + 500
      )
        throw error;
    } finally {
      await finish(reservation, failure).catch(() => {});
    }
    await new Promise((resolve) => setTimeout(resolve, 100 + Math.floor(Math.random() * 300)));
  }
}
function assertActive() {
  const state = context.getStore();
  if (!state || state.signal.aborted || state.until <= Date.now())
    throw Object.assign(Error('Provider request timed out.'), { code: 'ERR_CANCELED' });
}
const JOB_ADMIT = `local now=tonumber(ARGV[1]); for i=1,2 do redis.call('ZREMRANGEBYSCORE',KEYS[i],'-inf',now) end if redis.call('ZCARD',KEYS[1])>=tonumber(ARGV[4]) or redis.call('ZCARD',KEYS[2])>=tonumber(ARGV[5]) then return 0 end for i=1,2 do redis.call('ZADD',KEYS[i],now+tonumber(ARGV[3]),ARGV[2]); redis.call('PEXPIRE',KEYS[i],tonumber(ARGV[3])+1000) end return 1`;
async function withJob(provider, operation) {
  const redis = cache.getRedisCacheClient();
  if (!redis) throw unavailable();
  const keys = ['integrations:v1:{controls}:jobs', 'integrations:v1:{controls}:jobs:' + provider];
  const token = randomUUID();
  let allowed;
  try {
    allowed = await redis.eval(JOB_ADMIT, {
      keys,
      arguments: [
        Date.now(),
        token,
        integer('INTEGRATION_OPERATION_TIMEOUT_MS', 60000, 5000, 120000) + 10000,
        integer('INTEGRATION_GLOBAL_CONCURRENCY', 8, 1, 64),
        integer('INTEGRATION_PROVIDER_CONCURRENCY', 2, 1, 16)
      ].map(String)
    });
  } catch {
    throw unavailable();
  }
  if (Number(allowed) !== 1) throw limited();
  try {
    return await operation();
  } finally {
    await Promise.allSettled(keys.map((key) => redis.zRem(key, token)));
  }
}
async function run(owner, operation) {
  const duration = integer('INTEGRATION_OPERATION_TIMEOUT_MS', 60000, 5000, 120000);
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(Object.assign(Error('Provider request timed out.'), { code: 'ERR_CANCELED' }));
    }, duration);
  });
  try {
    return await Promise.race([
      context.run(
        { owner: String(owner), until: Date.now() + duration, signal: controller.signal },
        operation
      ),
      deadline
    ]);
  } finally {
    clearTimeout(timer);
  }
}
function actionLimit(name, authenticated = true) {
  return async (req, res, next) => {
    const redis = cache.getRedisCacheClient();
    if (!redis)
      return res.status(503).json({ message: 'Integration controls temporarily unavailable.' });
    const key = `integrations:v1:{controls}:action:${name}:${hash(authenticated ? req.user?._id : req.ip)}`;
    try {
      const count = Number(await redis.eval(COUNTER, { keys: [key], arguments: ['60000'] }));
      if (count > integer('INTEGRATION_ACTIONS_PER_MIN', 10, 1, 1000)) {
        res.set('Retry-After', '60');
        return res.status(429).json({ message: 'Too many integration requests.' });
      }
      res.set('Cache-Control', 'private, no-store');
      next();
    } catch {
      return res.status(503).json({ message: 'Integration controls temporarily unavailable.' });
    }
  };
}
module.exports = {
  run,
  withJob,
  request,
  assertActive,
  actionLimit,
  integer,
  hash,
  reserve,
  finish,
  retryAfter,
  ADMIT,
  COOLDOWN
};
