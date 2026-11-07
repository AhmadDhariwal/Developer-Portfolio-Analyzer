const cache = require('./redisCacheService');
const KEY = 'jobs:v2:public:pool';
const MAX_AGE_MS = 300000;
let memory = null;
let inflight = null;
// Compare observation times atomically so a slow Mongo read cannot overwrite a
// pool published by a completed ingestion. Explicit refresh replaces only KEY.
const PUBLISH = `local old = redis.call('GET', KEYS[1]); if old then
local ok, value = pcall(cjson.decode, old)
if ok and tonumber(value.observedAt or 0) > tonumber(ARGV[2]) then return 0 end end
redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[3]); return 1`;

const valid = (value) =>
  value?.version === 2 &&
  Array.isArray(value.jobs) &&
  value.jobs.length <= 1000 &&
  Number.isFinite(value.observedAt) &&
  value.observedAt <= Date.now() + 1000 &&
  Number(value.until) > Date.now() &&
  Number(value.until) <= Date.now() + MAX_AGE_MS;
async function publish(jobs, observedAt = Date.now()) {
  const value = {
    version: 2,
    jobs: jobs.slice(0, 1000),
    observedAt,
    until: Date.now() + MAX_AGE_MS
  };
  const redis = cache.getRedisCacheClient();
  if (redis)
    await redis
      .eval(PUBLISH, {
        keys: [KEY],
        arguments: [JSON.stringify(value), String(observedAt), String(MAX_AGE_MS)]
      })
      .catch(() => {});
  if (!memory || memory.value.observedAt <= observedAt)
    memory = { value, until: Math.min(value.until, Date.now() + 15000) };
  return value.jobs;
}

async function load(loader) {
  if (memory?.until > Date.now() && valid(memory.value)) return structuredClone(memory.value.jobs);
  if (inflight) return structuredClone(await inflight);
  inflight = (async () => {
    const redis = cache.getRedisCacheClient();
    if (redis) {
      try {
        const raw = await redis.get(KEY);
        const value = raw ? JSON.parse(raw) : null;
        if (valid(value)) {
          memory = { value, until: Math.min(value.until, Date.now() + 15000) };
          return value.jobs;
        }
      } catch {
        /* Mongo remains the durable fallback. */
      }
    }
    try {
      const observedAt = Date.now();
      return await publish(await loader(), observedAt);
    } catch (error) {
      // Emergency process fallback lasts at most one hour; job validity is still
      // checked by callers against retention and provider expiry on every read.
      if (memory && memory.value.until + 3600000 > Date.now()) return memory.value.jobs;
      throw error;
    }
  })();
  try {
    return structuredClone(await inflight);
  } finally {
    inflight = null;
  }
}

module.exports = { load, publish, KEY };
