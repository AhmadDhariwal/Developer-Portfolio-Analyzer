const { randomUUID } = require('node:crypto');
const cache = require('./redisCacheService');

const SOURCES = [
  'newsapi',
  'gnews',
  'hackernews',
  'devto',
  'reddit',
  'hackernewssearch',
  'githubreleases',
  'githubadvisories',
  'lobsters',
  'devtosearch',
  'kubernetesblog'
];
const positive = (value, fallback, maximum) => {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? Math.min(number, maximum) : fallback;
};
function policy(source) {
  if (!SOURCES.includes(source)) throw new Error('Unknown news provider');
  const prefix = `NEWS_${source.toUpperCase()}_`;
  const free = ['hackernews', 'devto'].includes(source);
  const permitted = free || process.env[`${prefix}CONTENT_APPROVED`] === 'true';
  return {
    daily: permitted ? positive(process.env[`${prefix}DAILY_BUDGET`], free ? 72 : 0, 1000) : 0,
    monthly: permitted ? positive(process.env[`${prefix}MONTHLY_BUDGET`], free ? 2200 : 0, 30000) : 0,
    concurrency: 1,
    interval: Math.max(
      source.startsWith('github') ? 300000 : source === 'lobsters' ? 600000 : 60000,
      positive(process.env[`${prefix}MIN_INTERVAL_MS`], 1200000, 86400000)
    )
  };
}

// All admission decisions and counters are atomic. A reservation is never refunded:
// a transport failure may still have consumed a provider credit.
const ADMIT = `
local now = tonumber(ARGV[1])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
if redis.call('EXISTS', KEYS[4]) == 1 then return {0, 'cooldown'} end
if redis.call('EXISTS', KEYS[5]) == 1 then return {0, 'interval'} end
if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[3]) then return {0, 'concurrency'} end
if tonumber(redis.call('GET', KEYS[2]) or '0') >= tonumber(ARGV[4]) then return {0, 'daily_budget'} end
if tonumber(redis.call('GET', KEYS[3]) or '0') >= tonumber(ARGV[5]) then return {0, 'monthly_budget'} end
redis.call('INCR', KEYS[2]); redis.call('PEXPIREAT', KEYS[2], ARGV[6])
redis.call('INCR', KEYS[3]); redis.call('PEXPIREAT', KEYS[3], ARGV[7])
redis.call('ZADD', KEYS[1], now + 30000, ARGV[2]); redis.call('PEXPIRE', KEYS[1], 31000)
redis.call('SET', KEYS[5], '1', 'PX', ARGV[8])
return {1, 'allowed'}
`;
const RELEASE = "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0";
const EXTEND =
  "local ttl = redis.call('PTTL', KEYS[1]); if ttl < tonumber(ARGV[1]) then redis.call('SET', KEYS[1], '1', 'PX', ARGV[1]) end return 1";
const COUNTER =
  "local n = redis.call('INCR', KEYS[1]); if n == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end return n";

async function reserve(source) {
  const limits = policy(source);
  if (!limits.daily || !limits.monthly || !limits.concurrency)
    return { allowed: false, reason: 'budget_not_configured' };
  const redis = cache.getRedisCacheClient({ commandTimeoutMs: 1000 });
  if (!redis) return { allowed: false, reason: 'quota_store_unavailable' };
  const now = Date.now();
  const date = new Date(now);
  const dayEnd = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
  const monthEnd = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
  const base = `news:v3:{${source}}`;
  const token = randomUUID();
  try {
    const [allowed, reason] = await redis.eval(ADMIT, {
      keys: [
        `${base}:active`,
        `${base}:day:${date.toISOString().slice(0, 10)}`,
        `${base}:month:${date.toISOString().slice(0, 7)}`,
        `${base}:cooldown`,
        `${base}:interval`
      ],
      arguments: [now, token, limits.concurrency, limits.daily, limits.monthly, dayEnd, monthEnd, limits.interval].map(
        String
      )
    });
    return { allowed: Number(allowed) === 1, reason, token, base };
  } catch {
    return { allowed: false, reason: 'quota_store_unavailable' };
  }
}

function retryDelay(headers = {}, now = Date.now()) {
  const retry = headers['retry-after'];
  if (retry !== undefined) {
    const numeric = Number(retry);
    const delay = Number.isFinite(numeric) ? numeric * 1000 : Date.parse(String(retry)) - now;
    if (Number.isFinite(delay) && delay > 0) return Math.ceil(Math.max(1000, delay));
  }
  // Unknown reset windows must not cause an immediate retry.
  return 21600000;
}

async function finish(reservation, { status = 200, headers = {}, failed = false } = {}) {
  if (!reservation.allowed) return;
  const redis = cache.getRedisCacheClient({ commandTimeoutMs: 1000 });
  if (!redis) return;
  const base = reservation.base;
  try {
    const remaining = headers['x-ratelimit-requests-remaining'] ?? headers['x-ratelimit-remaining'];
    let delay = 0;
    if (status === 429 || (remaining !== undefined && Number(remaining) <= 0)) {
      delay = retryDelay(headers);
      const reset = Number(headers['x-ratelimit-reset']);
      const rapidReset = Number(headers['x-ratelimit-requests-reset']);
      if (Number.isFinite(reset) && reset > 0) delay = Math.max(delay, reset * 1000 - Date.now());
      if (Number.isFinite(rapidReset) && rapidReset > 0) delay = Math.max(delay, rapidReset * 1000);
    } else if (status === 401 || status === 403) {
      delay = 21600000;
    } else if (failed) {
      const failures = await redis.eval(COUNTER, {
        keys: [`${base}:failures`],
        arguments: ['600000']
      });
      if (Number(failures) >= 3) delay = 300000;
    } else {
      await redis.del(`${base}:failures`);
    }
    if (delay)
      await redis.eval(EXTEND, {
        keys: [`${base}:cooldown`],
        arguments: [String(Math.ceil(delay))]
      });
    // Discovery budgets are independent, but a shared upstream's limit must not
    // be bypassed by switching between its adapters.
    if (delay && (status === 429 || status === 403 || (remaining !== undefined && Number(remaining) <= 0))) {
      const families = [
        ['hackernews', 'hackernewssearch'],
        ['devto', 'devtosearch'],
        ['githubreleases', 'githubadvisories']
      ];
      const family = families.find((names) => names.some((name) => base === `news:v3:{${name}}`));
      for (const name of family || []) {
        if (`news:v3:{${name}}` !== base)
          await redis.eval(EXTEND, { keys: [`news:v3:{${name}}:cooldown`], arguments: [String(Math.ceil(delay))] });
      }
    }
    await redis.zRem(`${base}:active`, reservation.token);
  } catch {
    // Slot and interval leases expire. Never retry uncertain Redis writes locally.
  }
}

async function withLease(name, seconds, work) {
  const redis = cache.getRedisCacheClient({ commandTimeoutMs: 1000 });
  if (!redis) return { skipped: true, reason: 'quota_store_unavailable' };
  const key = `news:v3:lease:${name}`;
  const token = randomUUID();
  try {
    if ((await redis.set(key, token, { NX: true, EX: seconds })) !== 'OK')
      return { skipped: true, reason: 'already_running' };
  } catch {
    return { skipped: true, reason: 'quota_store_unavailable' };
  }
  try {
    return await work({ key, token });
  } finally {
    await redis.eval(RELEASE, { keys: [key], arguments: [token] }).catch(() => {});
  }
}

async function health() {
  const redis = cache.getRedisCacheClient({ commandTimeoutMs: 1000 });
  const date = new Date().toISOString();
  const output = {};
  await Promise.all(
    SOURCES.map(async (source) => {
      const base = `news:v3:{${source}}`;
      const limits = policy(source);
      output[source] = { limits, quotaStoreAvailable: false };
      if (!redis) return;
      try {
        const [day, month, cooldown] = await redis.mGet([
          `${base}:day:${date.slice(0, 10)}`,
          `${base}:month:${date.slice(0, 7)}`,
          `${base}:cooldown`
        ]);
        output[source] = {
          limits,
          quotaStoreAvailable: true,
          dailyUsed: Number(day || 0),
          monthlyUsed: Number(month || 0),
          coolingDown: Boolean(cooldown)
        };
      } catch {
        /* Absence of quota state is reported, never inferred as zero use. */
      }
    })
  );
  return output;
}

module.exports = { reserve, finish, retryDelay, withLease, policy, health, COUNTER };
