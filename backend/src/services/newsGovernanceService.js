const { randomUUID } = require('node:crypto');
const cache = require('./redisCacheService');
const telemetry = require('./newsMetricsService');

const { NEWS_PROVIDER_KEYS: SOURCES } = require('../config/newsConfig');
const positive = (value, fallback, maximum) => {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? Math.min(number, maximum) : fallback;
};
function policy(source) {
  if (!SOURCES.includes(source)) throw new Error('Unknown news provider');
  const prefix = `NEWS_${source.toUpperCase()}_`;
  const free = ['hackernews', 'devto'].includes(source);
  const permitted =
    process.env[`${prefix}CONTENT_APPROVED`] === 'true' ||
    (free && process.env[`${prefix}CONTENT_APPROVED`] !== 'false');
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

const FAMILIES = [
  ['hackernews', 'hackernewssearch'],
  ['devto', 'devtosearch'],
  ['githubreleases', 'githubadvisories']
];
function sharedPolicy(source) {
  const family = FAMILIES.find((names) => names.includes(source)) || [source];
  const prefix = 'NEWS_' + (source.startsWith('github') ? 'GITHUB' : family[0].toUpperCase()) + '_SHARED_';
  return {
    sibling: family.find((name) => name !== source) || source,
    paired: family.length > 1,
    daily: positive(
      process.env[prefix + 'DAILY_BUDGET'],
      family.reduce((sum, name) => sum + policy(name).daily, 0),
      2000
    ),
    monthly: positive(
      process.env[prefix + 'MONTHLY_BUDGET'],
      family.reduce((sum, name) => sum + policy(name).monthly, 0),
      60000
    ),
    interval: Math.max(
      source.startsWith('github') ? 300000 : 60000,
      positive(process.env[prefix + 'MIN_INTERVAL_MS'], 60000, 86400000)
    ),
    family: family[0]
  };
}

// All admission decisions and counters are atomic. A reservation is never refunded:
// a transport failure may still have consumed a provider credit.
const ADMIT = `
local now = tonumber(ARGV[1])
local reason = 'allowed'
local wait = 0
local function block(code, delay)
  if delay > wait then reason = code; wait = delay end
end
local function timed(key, code)
  local ttl = redis.call('PTTL', key)
  if string.find(code, 'cooldown') then
    local stored = redis.call('GET', key)
    if stored == 'upstream_rate_limit' or stored == 'upstream_access_denied' or stored == 'circuit_open' then code = stored end
  end
  if ttl ~= -2 then block(code, ttl > 0 and ttl or 60000) end
end
local function active(key, maximum, code)
  if redis.call('ZCOUNT', key, '(' .. now, '+inf') >= maximum then
    local first = redis.call('ZRANGEBYSCORE', key, '(' .. now, '+inf', 'WITHSCORES', 'LIMIT', 0, 1)
    block(code, tonumber(first[2]) - now)
  end
end
timed(KEYS[4], 'cooldown')
timed(KEYS[5], 'interval')
active(KEYS[1], tonumber(ARGV[3]), 'concurrency')
if tonumber(redis.call('GET', KEYS[2]) or '0') >= tonumber(ARGV[4]) then block('daily_budget', tonumber(ARGV[6]) - now) end
if tonumber(redis.call('GET', KEYS[3]) or '0') >= tonumber(ARGV[5]) then block('monthly_budget', tonumber(ARGV[7]) - now) end
if ARGV[12] == '1' then
  timed(KEYS[9], 'shared_cooldown')
  timed(KEYS[10], 'shared_interval')
  active(KEYS[8], 1, 'shared_concurrency')
  if tonumber(redis.call('GET', KEYS[2]) or '0') + tonumber(redis.call('GET', KEYS[6]) or '0') >= tonumber(ARGV[9]) then block('shared_daily_budget', tonumber(ARGV[6]) - now) end
  if tonumber(redis.call('GET', KEYS[3]) or '0') + tonumber(redis.call('GET', KEYS[7]) or '0') >= tonumber(ARGV[10]) then block('shared_monthly_budget', tonumber(ARGV[7]) - now) end
end
if wait > 0 then return {0, reason, wait} end
if ARGV[13] == 'inspect' then return {1, 'allowed', 0} end
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
if ARGV[12] == '1' then
  redis.call('SET', KEYS[10], '1', 'PX', ARGV[11])
end
redis.call('INCR', KEYS[2]); redis.call('PEXPIREAT', KEYS[2], ARGV[6])
redis.call('INCR', KEYS[3]); redis.call('PEXPIREAT', KEYS[3], ARGV[7])
redis.call('ZADD', KEYS[1], now + 30000, ARGV[2]); redis.call('PEXPIRE', KEYS[1], 31000)
redis.call('SET', KEYS[5], '1', 'PX', ARGV[8])
return {1, 'allowed'}
`;
const RELEASE =
  "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0";
const EXTEND =
  "local ttl = redis.call('PTTL', KEYS[1]); if ttl < tonumber(ARGV[1]) then redis.call('SET', KEYS[1], ARGV[2], 'PX', ARGV[1]) end return 1";
const COUNTER =
  "local n = redis.call('INCR', KEYS[1]); if n == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end return n";

async function reserve(source, inspectOnly = false, priority = 'user') {
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
  const shared = sharedPolicy(source);
  const sibling = `news:v3:{${shared.sibling}}`;
  const token = randomUUID();
  try {
    const searchSibling = ['hackernews', 'devto'].includes(source) ? policy(shared.sibling) : null;
    // Broad ingestion cannot spend the configured search adapter's headroom.
    const ownDaily = searchSibling
      ? Math.min(limits.daily, Math.max(0, shared.daily - searchSibling.daily))
      : limits.daily;
    const ownMonthly = searchSibling
      ? Math.min(limits.monthly, Math.max(0, shared.monthly - searchSibling.monthly))
      : limits.monthly;
    const [allowed, reason, wait = 0] = await redis.eval(ADMIT, {
      keys: [
        `${base}:active`,
        `${base}:day:${date.toISOString().slice(0, 10)}`,
        `${base}:month:${date.toISOString().slice(0, 7)}`,
        `${base}:cooldown`,
        `${base}:interval`,
        `${sibling}:day:${date.toISOString().slice(0, 10)}`,
        `${sibling}:month:${date.toISOString().slice(0, 7)}`,
        `${sibling}:active`,
        `${sibling}:cooldown`,
        `news:v3:{${shared.family}}:shared:interval`
      ],
      arguments: [
        now,
        token,
        limits.concurrency,
        priority === 'prewarm' ? Math.floor(ownDaily / 2) : ownDaily,
        priority === 'prewarm' ? Math.floor(ownMonthly / 2) : ownMonthly,
        dayEnd,
        monthEnd,
        limits.interval,
        priority === 'prewarm' ? Math.floor(shared.daily / 2) : shared.daily,
        priority === 'prewarm' ? Math.floor(shared.monthly / 2) : shared.monthly,
        shared.interval,
        shared.paired ? 1 : 0,
        inspectOnly ? 'inspect' : 'reserve'
      ].map(String)
    });
    if (!inspectOnly)
      telemetry.admission.inc({ provider: source, reason: Number(allowed) === 1 ? 'allowed' : reason });
    return {
      allowed: Number(allowed) === 1,
      reason,
      nextEligibleAt: Number(wait) > 0 ? new Date(now + Number(wait)).toISOString() : null,
      ...(inspectOnly ? {} : { token, base })
    };
  } catch {
    return { allowed: false, reason: 'quota_store_unavailable' };
  }
}

function retryDelay(headers = {}, now = Date.now(), fallback = 21600000) {
  const retry = headers['retry-after'];
  if (retry !== undefined) {
    const numeric = Number(retry);
    const delay = Number.isFinite(numeric) ? numeric * 1000 : Date.parse(String(retry)) - now;
    if (Number.isFinite(delay) && delay > 0) return Math.ceil(Math.max(1000, delay));
  }
  // Unknown reset windows must not cause an immediate retry.
  return fallback;
}

async function finish(reservation, { status = 200, headers = {}, failed = false } = {}) {
  if (!reservation.allowed) return;
  const redis = cache.getRedisCacheClient({ commandTimeoutMs: 1000 });
  if (!redis) return;
  const base = reservation.base;
  try {
    const remaining = headers['x-ratelimit-requests-remaining'] ?? headers['x-ratelimit-remaining'];
    const rateLimited = status === 429 || (remaining !== undefined && Number(remaining) <= 0);
    let delay = 0;
    if (rateLimited) {
      delay = retryDelay(headers, Date.now(), 0);
      const reset = Number(headers['x-ratelimit-reset']);
      const rapidReset = Number(headers['x-ratelimit-requests-reset']);
      if (Number.isFinite(reset) && reset > 0)
        delay = Math.max(delay, base === 'news:v3:{reddit}' ? reset * 1000 : reset * 1000 - Date.now());
      if (Number.isFinite(rapidReset) && rapidReset > 0) delay = Math.max(delay, rapidReset * 1000);
      if (delay <= 0) delay = 21600000;
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
    const reason = rateLimited
      ? 'upstream_rate_limit'
      : status === 401 || status === 403
        ? 'upstream_access_denied'
        : delay
          ? 'circuit_open'
          : failed
            ? 'source_failure'
            : 'allowed';
    if (delay)
      await redis.eval(EXTEND, {
        keys: [`${base}:cooldown`],
        arguments: [String(Math.ceil(delay)), reason]
      });
    // Discovery budgets are independent, but a shared upstream's limit must not
    // be bypassed by switching between its adapters.
    if (
      delay &&
      (status === 429 ||
        status === 401 ||
        status === 403 ||
        (remaining !== undefined && Number(remaining) <= 0))
    ) {
      const families = [
        ['hackernews', 'hackernewssearch'],
        ['devto', 'devtosearch'],
        ['githubreleases', 'githubadvisories']
      ];
      const family = families.find((names) => names.some((name) => base === `news:v3:{${name}}`));
      for (const name of family || []) {
        if (`news:v3:{${name}}` !== base)
          await redis.eval(EXTEND, {
            keys: [`news:v3:{${name}}:cooldown`],
            arguments: [String(Math.ceil(delay)), reason]
          });
      }
    }
    await redis.zRem(`${base}:active`, reservation.token);
    return { reason, nextEligibleAt: delay ? new Date(Date.now() + delay).toISOString() : null };
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
      const metadata = {
        contentApproved:
          process.env[`NEWS_${source.toUpperCase()}_CONTENT_APPROVED`] === 'true' ||
          (['hackernews', 'devto'].includes(source) &&
            process.env[`NEWS_${source.toUpperCase()}_CONTENT_APPROVED`] !== 'false'),
        restricted: ['newsapi', 'gnews', 'reddit'].includes(source),
        enabled: limits.daily > 0 && limits.monthly > 0
      };
      output[source] = { ...metadata, limits, quotaStoreAvailable: false };
      if (!redis) return;
      try {
        const [day, month, cooldown] = await redis.mGet([
          `${base}:day:${date.slice(0, 10)}`,
          `${base}:month:${date.slice(0, 7)}`,
          `${base}:cooldown`
        ]);
        output[source] = {
          ...metadata,
          limits,
          quotaStoreAvailable: true,
          dailyUsed: Number(day || 0),
          monthlyUsed: Number(month || 0),
          coolingDown: Boolean(cooldown),
          admission: await reserve(source, true)
        };
      } catch {
        /* Absence of quota state is reported, never inferred as zero use. */
      }
    })
  );
  return output;
}

module.exports = {
  sharedPolicy,
  reserve,
  inspect: (source) => reserve(source, true),
  finish,
  retryDelay,
  withLease,
  policy,
  health,
  COUNTER
};
