const TopicCache = require('../models/newsTopicCache');
const cache = require('./redisCacheService');
const governance = require('./newsGovernanceService');
const providers = require('./newsDiscoveryProviders');
const catalog = require('./newsCatalogService');
const adaptive = require('./newsAdaptiveService');
const { queryFor, matchesQuery, suggestionFor } = require('../utils/newsQuery');
const { normalizeItem } = require('../utils/newsFormatter');
const { NEWS_PROVIDER_KEYS } = require('../config/newsConfig');

const BASE = 'news:v1:{discovery}';
const QUEUE = `${BASE}:queue`;
const bounded = (name, fallback, min, max) => {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
};
const RETENTION = bounded('NEWS_QUERY_STALE_TTL_MS', 86400000, 3600000, 86400000);
const FRESH = bounded('NEWS_QUERY_FRESH_TTL_MS', 1800000, 60000, 3600000);
const NEGATIVE = bounded('NEWS_QUERY_NEGATIVE_TTL_MS', 300000, 30000, 900000);
const MAX_ENTRIES = bounded('NEWS_QUERY_MEMORY_ENTRIES', 128, 40, 256);
const REFRESH_INTERVAL = bounded('NEWS_REFRESH_MIN_INTERVAL_MS', 60000, 60000, 3600000);
const HEARTBEAT = BASE + ':worker';
let workerTimer;
let workerBusy = false;
let wakePending = false;
const touch = (map, key) => {
  const value = map.get(key);
  if (value) {
    map.delete(key);
    map.set(key, value);
  }
  return value;
};
const remember = (map, key, value) => {
  map.delete(key);
  for (const [name, entry] of map) if (entry.until <= Date.now()) map.delete(name);
  while (map.size >= MAX_ENTRIES) map.delete(map.keys().next().value);
  map.set(key, value);
};
const MINIMUM = 6;
const memory = new Map();
const inFlight = new Map();
const stateFlight = new Map();
const topicKey = (topic) => `${BASE}:topic:${queryFor(topic)?.key || 'invalid'}`;
const stateKey = (topic) =>
  `${BASE}:state:${topic === '__broad__' ? 'general' : queryFor(topic)?.key || 'invalid'}`;
const usable = (value) =>
  Number.isFinite(new Date(value?.expiresAt).getTime()) && new Date(value.expiresAt).getTime() > Date.now();
const SEARCHING =
  "if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end; redis.call('SET', KEYS[2], ARGV[2], 'PX', 180000); return 1";
const ENQUEUE = `
local old = redis.call('GET', KEYS[2])
if old then
  local state = cjson.decode(old)
  local active = state.status == 'queued' or state.status == 'searching' or state.status == 'processing'
  local successful = state.status == 'ready' or state.status == 'exhausted' or state.status == 'no_newer'
  local expired = not successful and type(state.nextEligibleAt) == 'string' and state.nextEligibleAt <= ARGV[16]
  if active or (not expired and ((ARGV[13] ~= 'manual' and ARGV[13] ~= 'stale') or not successful)) then return old end
  if successful and tonumber(ARGV[1]) < tonumber(state.checkedAtMs or 0) + tonumber(ARGV[14]) then return old end
end
if redis.call('ZSCORE', KEYS[1], ARGV[2]) then return ARGV[3] end
if ARGV[8] == 'prewarm' and redis.call('ZCARD', KEYS[1]) > 0 then return ARGV[5] end
if redis.call('ZCARD', KEYS[1]) >= 16 then return ARGV[5] end
if tonumber(redis.call('GET', KEYS[3]) or '0') >= tonumber(ARGV[6]) then return ARGV[7] end
if ARGV[8] == 'prewarm' and tonumber(redis.call('GET', KEYS[8]) or '0') >= tonumber(ARGV[15]) then return ARGV[17] end
if ARGV[8] ~= 'prewarm' then
  if tonumber(redis.call('GET', KEYS[4]) or '0') >= tonumber(ARGV[9]) then return ARGV[11] end
  if tonumber(redis.call('GET', KEYS[5]) or '0') >= tonumber(ARGV[10]) then return ARGV[12] end
  redis.call('INCR', KEYS[4]); redis.call('PEXPIRE', KEYS[4], 60000)
  redis.call('INCR', KEYS[5]); redis.call('PEXPIREAT', KEYS[5], ARGV[4])
end
if ARGV[8] == 'prewarm' then
  redis.call('INCR', KEYS[8]); redis.call('PEXPIREAT', KEYS[8], ARGV[4])
end
redis.call('INCR', KEYS[3]); redis.call('PEXPIREAT', KEYS[3], ARGV[4])
redis.call('SET', KEYS[2], ARGV[3], 'PX', 180000)
redis.call('SET', KEYS[6], ARGV[13], 'PX', 3600000)
if KEYS[7] then redis.call('SET', KEYS[7], ARGV[8] == 'prewarm' and 'prewarm' or 'user', 'PX', 3600000) end
redis.call('ZADD', KEYS[1], ARGV[1], ARGV[2]); redis.call('PEXPIRE', KEYS[1], 3600000)
return ARGV[3]
`;
const CLAIM = `
if redis.call('GET', KEYS[2]) ~= ARGV[1] then return '' end
local job = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[2], 'LIMIT', 0, 1)
if #job == 0 then return '' end
redis.call('ZADD', KEYS[1], tonumber(ARGV[2]) + 120000, job[1])
return job[1]
`;
const COMMIT = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[2], ARGV[2], 'PX', ARGV[3])
redis.call('ZREM', KEYS[3], ARGV[4])
if ARGV[5] ~= '' then
  redis.call('SET', KEYS[4], ARGV[5], 'PX', ARGV[6])
  redis.call('SET', KEYS[5], ARGV[7], 'PX', ARGV[6])
end
return 1
`;
const status = (value, reason, delay = 0, extra = {}) => ({
  status: value,
  reason,
  nextEligibleAt: delay ? new Date(Date.now() + delay).toISOString() : null,
  ...extra
});
const validTopic = (topic) => topic === '__broad__' || Boolean(queryFor(topic));
const view = (snapshot, topic) => {
  if (!usable(snapshot)) return null;
  const permitted = new Set(
    providers.available(topic).map((key) => providers.SOURCE_NAMES[providers.KEYS.indexOf(key)])
  );
  const allItems = (Array.isArray(snapshot.allItems) ? snapshot.allItems : [])
    .slice(0, 40)
    .map(normalizeItem)
    .filter(
      (item) =>
        item &&
        permitted.has(item.source) &&
        Date.now() - Number(snapshot.filters?.sourceTimes?.[item.source] || 0) < RETENTION
    );
  const providerUsed = [...new Set(allItems.map((item) => item.source))];
  return {
    ...snapshot,
    providerDiagnostics: Array.isArray(snapshot.providerDiagnostics)
      ? snapshot.providerDiagnostics.filter((item) => providers.KEYS.includes(item?.provider))
      : [],
    allItems,
    total: allItems.length,
    providerUsed,
    lastUpdated: providerUsed.length
      ? new Date(Math.min(...providerUsed.map((source) => Number(snapshot.filters.sourceTimes[source]))))
      : null
  };
};
async function readTopic(topic) {
  if (!validTopic(topic) || !providers.enabled() || !providers.available(topic).length) return null;
  topic = queryFor(topic).text;
  const previous = touch(memory, topic);
  if (previous && previous.until > Date.now()) {
    try {
      const redis = cache.getRedisCacheClient({ commandTimeoutMs: 1000 });
      const version = redis && (await redis.get(topicKey(topic) + ':version'));
      if (!version || version === String(previous.value?.filters?.version))
        return view(previous.value, topic);
    } catch {
      return view(previous.value, topic);
    }
  }
  if (inFlight.has(topic)) return inFlight.get(topic);
  if (inFlight.size >= 16) return null;
  const read = (async () => {
    let value;
    const redis = cache.getRedisCacheClient({ commandTimeoutMs: 1000 });
    if (redis) {
      try {
        value = JSON.parse(await redis.get(topicKey(topic)));
      } catch {
        /* Mongo fallback. */
      }
    }
    if (!usable(value)) {
      try {
        if (TopicCache.db && TopicCache.db.readyState !== 1) throw new Error('Topic store unavailable');
        const query = TopicCache.findOne({ cacheKey: topicKey(topic), expiresAt: { $gt: new Date() } });
        if (typeof query.maxTimeMS === 'function') query.maxTimeMS(300);
        let timer;
        try {
          value = await Promise.race([
            query.lean(),
            new Promise((_, reject) => {
              timer = setTimeout(() => reject(new Error('Topic read deadline')), 350);
            })
          ]);
        } finally {
          clearTimeout(timer);
        }
      } catch {
        value = previous?.value;
      }
    }
    remember(memory, topic, { value, until: Date.now() + 5000 });
    return view(value, topic);
  })().finally(() => inFlight.delete(topic));
  inFlight.set(topic, read);
  return read;
}
function classify(filters, total, broadTotal, diagnostics = []) {
  if (total >= MINIMUM) return 'sufficient';
  if (!filters.search) return 'general_pool';
  const query = queryFor(filters.search);
  if (!query) return 'unsupported_query';
  if (filters.source !== 'All' && !['Hacker News', 'Dev.to'].includes(filters.source)) {
    const source = diagnostics.find((item) => item.provider === filters.source);
    return source?.reachable && !source.articlesFetched ? 'source_exhausted' : 'restrictive_filters';
  }
  if (broadTotal >= MINIMUM) return 'restrictive_filters';
  return 'coverage_gap';
}
async function coverage({
  filters,
  total,
  broadTotal,
  diagnostics = [],
  revalidate = false,
  readOnly = false,
  queryAttemptAt = null,
  admissionKey = 'prewarm',
  dateExcludedMatches = 0,
  filterExcludedMatches = 0
}) {
  const topic = queryFor(filters.search)?.text || (revalidate || readOnly ? '__broad__' : null);
  const classification = classify(filters, total, broadTotal, diagnostics);
  const result = {
    status: classification,
    topic: topic === '__broad__' ? null : topic,
    cachedMatches: total,
    minimum: MINIMUM,
    broaderMatches: broadTotal,
    dateExcludedMatches,
    filterExcludedMatches,
    suggestedDate: dateExcludedMatches && filters.dateRange !== 'month' ? 'month' : null
  };
  const suggestion = suggestionFor(filters.search);
  if (suggestion) {
    result.suggestion = suggestion;
    return { coverage: result, enrichment: status('not_needed', 'spelling_suggestion') };
  }
  if (classification === 'unsupported_query')
    return { coverage: result, enrichment: status('not_needed', 'unsupported_query') };
  const refreshEligible =
    (revalidate || (queryAttemptAt && Date.now() - Number(queryAttemptAt) >= FRESH)) &&
    topic &&
    classify(filters, 0, 0) === 'coverage_gap';
  if (topic && providers.enabled()) {
    try {
      const redis = cache.getRedisCacheClient({ commandTimeoutMs: 1000 });
      const current = redis && JSON.parse((await redis.get(stateKey(topic))) || 'null');
      if (current?.status === 'queued' && !(await redis.get(HEARTBEAT)))
        return { coverage: result, enrichment: status('worker_unavailable', 'worker_offline', 20000) };
      const completed = current && ['ready', 'exhausted', 'no_newer'].includes(current.status);
      const expired =
        !completed && current?.nextEligibleAt && Date.parse(current.nextEligibleAt) <= Date.now();
      if (
        current &&
        (['queued', 'searching', 'processing'].includes(current.status) ||
          (!expired && (readOnly || (!revalidate && !(refreshEligible && completed)))))
      )
        return { coverage: result, enrichment: current };
    } catch {
      /* Admission below reports unavailable infrastructure for genuine gaps. */
    }
  }
  if (filters.page > 1) return { coverage: result, enrichment: status('not_needed', 'pagination_only') };
  if (readOnly)
    return {
      coverage: result,
      enrichment: status(
        providers.enabled() ? 'not_needed' : 'disabled',
        providers.enabled() ? 'catalog_only' : 'discovery_disabled'
      )
    };
  if (!providers.enabled()) return { coverage: result, enrichment: status('disabled', 'discovery_disabled') };
  if (topic === '__broad__' && revalidate)
    return { coverage: result, enrichment: await enqueue(topic, admissionKey, true) };
  if (classification !== 'coverage_gap' && !refreshEligible)
    return { coverage: result, enrichment: status('not_needed', classification) };
  if (!providers.enabled()) return { coverage: result, enrichment: status('disabled', 'discovery_disabled') };
  if (!providers.available(topic).length)
    return { coverage: result, enrichment: status('source_unavailable', 'no_approved_sources') };
  if (!refreshEligible && queryAttemptAt && Date.now() - Number(queryAttemptAt) < FRESH && broadTotal > 0)
    return {
      coverage: result,
      enrichment: status('ready', 'articles_cached', FRESH - (Date.now() - Number(queryAttemptAt)), {
        eligibilityReason: 'query_freshness'
      })
    };
  if (!refreshEligible && queryAttemptAt && !broadTotal && Date.now() - Number(queryAttemptAt) < NEGATIVE)
    return {
      coverage: result,
      enrichment: status(
        'exhausted',
        'no_matching_articles',
        NEGATIVE - (Date.now() - Number(queryAttemptAt))
      )
    };
  // Redis owns job state; a process-local status must not hide another worker's completion.
  if (filters.page > 1) {
    const key = `peek:${topic}`;
    if (!stateFlight.has(key))
      stateFlight.set(
        key,
        (async () => {
          const redis = cache.getRedisCacheClient({ commandTimeoutMs: 1000 });
          try {
            const value = redis ? JSON.parse(await redis.get(stateKey(topic))) : null;
            return value || status('not_needed', 'pagination_only');
          } catch {
            return status('unavailable', 'quota_store_unavailable', 60000);
          }
        })().finally(() => stateFlight.delete(key))
      );
    return { coverage: result, enrichment: await stateFlight.get(key) };
  }
  if (stateFlight.size >= 16)
    return { coverage: result, enrichment: status('quota_limited', 'admission_busy', 60000) };
  if (!stateFlight.has(topic))
    stateFlight.set(
      topic,
      enqueue(topic, admissionKey, revalidate, Boolean(refreshEligible && !revalidate)).finally(() =>
        stateFlight.delete(topic)
      )
    );
  return { coverage: result, enrichment: await stateFlight.get(topic) };
}
async function enqueue(topic, admissionKey, manual = false, stale = false) {
  const redis = cache.getRedisCacheClient({ commandTimeoutMs: 1000 });
  let value = status('unavailable', 'quota_store_unavailable', 60000);
  if (redis) {
    const now = Date.now();
    const date = new Date(now);
    const end = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
    const daily = Math.max(1, Math.min(48, Number.parseInt(process.env.NEWS_DISCOVERY_DAILY_JOBS, 10) || 12));
    try {
      const existing = JSON.parse((await redis.get(stateKey(topic))) || 'null');
      if (existing && ['queued', 'searching', 'processing'].includes(existing.status)) return existing;
      const successful = existing && ['ready', 'exhausted', 'no_newer'].includes(existing.status);
      const checkedAt = existing?.checkedAtMs || Date.parse(existing?.lastAttemptAt) || now;
      const expired = !successful && existing?.nextEligibleAt && Date.parse(existing.nextEligibleAt) <= now;
      if (
        existing &&
        !expired &&
        ((!manual && !stale) || !successful || now < checkedAt + (stale ? FRESH : REFRESH_INTERVAL))
      )
        return existing;
      // Read-only admission checks avoid spending job budgets when every source is blocked.
      if (typeof governance.inspect === 'function') {
        const candidates =
          topic === '__broad__'
            ? NEWS_PROVIDER_KEYS.filter(
                (provider) =>
                  !provider.endsWith('search') &&
                  governance.policy(provider).daily > 0 &&
                  governance.policy(provider).monthly > 0
              )
            : providers.available(topic);
        if (!candidates.length) return status('source_unavailable', 'no_approved_sources');
        const checks = await Promise.all(
          candidates.map(async (provider) => ({ provider, ...(await governance.inspect(provider)) }))
        );
        if (checks.length && checks.every((check) => !check.allowed)) {
          const timed = checks
            .filter((check) => check.nextEligibleAt)
            .sort((a, b) => Date.parse(a.nextEligibleAt) - Date.parse(b.nextEligibleAt));
          const denial = timed[0] || checks[0];
          return status(
            denial.reason === 'quota_store_unavailable'
              ? 'unavailable'
              : /interval|concurrency/.test(denial.reason)
                ? 'waiting'
                : 'quota_limited',
            denial.reason,
            0,
            {
              nextEligibleAt: denial.nextEligibleAt || null,
              sourceHealth: checks.map((check) => ({
                provider: check.provider,
                status: 'quota_limited',
                articlesFound: 0,
                reason: check.reason,
                nextEligibleAt: check.nextEligibleAt || null
              }))
            }
          );
        }
      }
      value = JSON.parse(
        await redis.eval(ENQUEUE, {
          keys: [
            QUEUE,
            stateKey(topic),
            `${BASE}:jobs:${date.toISOString().slice(0, 10)}`,
            `${BASE}:user:${admissionKey}:minute:${Math.floor(now / 60000)}`,
            `${BASE}:user:${admissionKey}:day:${date.toISOString().slice(0, 10)}`,
            stateKey(topic) + ':mode',
            stateKey(topic) + ':priority',
            `${BASE}:prewarm:${date.toISOString().slice(0, 10)}`
          ],
          arguments: [
            String(now),
            topic,
            JSON.stringify(status('queued', 'background_discovery', 0, { queuedAtMs: now })),
            String(end),
            JSON.stringify(status('unavailable', 'queue_full', 60000)),
            String(
              admissionKey === 'prewarm'
                ? Math.max(0, daily - bounded('NEWS_PREWARM_RESERVED_USER_JOBS', 6, 1, 48))
                : daily
            ),
            JSON.stringify(
              status('quota_limited', 'discovery_daily_budget', 0, {
                nextEligibleAt: new Date(end).toISOString()
              })
            ),
            admissionKey,
            String(bounded('NEWS_DISCOVERY_USER_MINUTE_JOBS', 3, 1, 12)),
            String(bounded('NEWS_DISCOVERY_USER_DAILY_JOBS', 6, 1, 48)),
            JSON.stringify(
              status('quota_limited', 'user_discovery_budget', 0, {
                nextEligibleAt: new Date(now - (now % 60000) + 60000).toISOString()
              })
            ),
            JSON.stringify(
              status('quota_limited', 'user_discovery_daily_budget', 0, {
                nextEligibleAt: new Date(end).toISOString()
              })
            ),
            manual ? 'manual' : stale ? 'stale' : 'automatic',
            String(stale ? FRESH : REFRESH_INTERVAL),
            String(bounded('NEWS_DISCOVERY_PREWARM_DAILY_JOBS', 4, 0, 4)),
            new Date(now).toISOString(),
            JSON.stringify(
              status('quota_limited', 'prewarm_daily_budget', 0, {
                nextEligibleAt: new Date(end).toISOString()
              })
            )
          ]
        })
      );
    } catch {
      /* No local provider or queue fallback. */
    }
  }
  if (value.status === 'queued') {
    wakeWorker();
    try {
      if (!(await redis.get(HEARTBEAT))) value = status('worker_unavailable', 'worker_offline', 20000);
    } catch {
      value = status('unavailable', 'quota_store_unavailable', 60000);
    }
  }
  return value;
}
function buildSnapshot(topic, previous, outcomes, attemptedAt) {
  const sourceTimes = { ...(previous?.filters?.sourceTimes || {}) };
  const buckets = {};
  for (const item of previous?.allItems || []) {
    if (attemptedAt - Number(sourceTimes[item.source] || 0) < RETENTION)
      (buckets[item.source] ||= []).push(item);
  }
  for (const outcome of outcomes) {
    const source = providers.SOURCE_NAMES[providers.KEYS.indexOf(outcome.provider)];
    if (outcome.items.length) {
      sourceTimes[source] = attemptedAt;
      buckets[source] = outcome.items;
    } else if (attemptedAt - Number(sourceTimes[source] || 0) < RETENTION)
      buckets[source] = (previous?.allItems || []).filter((item) => item.source === source);
  }
  const urls = new Set();
  const titles = new Set();
  const allItems = Object.values(buckets)
    .flat()
    .map(normalizeItem)
    .filter((item) => {
      if (!item || !matchesQuery(item, topic) || urls.has(item.url) || titles.has(item.title.toLowerCase()))
        return false;
      urls.add(item.url);
      titles.add(item.title.toLowerCase());
      return true;
    })
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt) || a.url.localeCompare(b.url))
    .slice(0, 40);
  const providerUsed = [...new Set(allItems.map((item) => item.source))];
  return {
    cacheKey: topicKey(topic),
    filters: {
      topic,
      attemptedAt,
      sourceTimes,
      version: String(attemptedAt),
      lastSuccessfulCheckAt: new Date(attemptedAt).toISOString()
    },
    allItems,
    total: allItems.length,
    providerUsed,
    providerDiagnostics: outcomes.map(({ provider, status: value, items, reason, nextEligibleAt }) => ({
      provider,
      status: value,
      articlesFetched: items.length,
      reason: reason || null,
      nextEligibleAt: nextEligibleAt || null,
      checkedAt: new Date(attemptedAt).toISOString()
    })),
    lastUpdated: providerUsed.length
      ? new Date(Math.min(...providerUsed.map((source) => sourceTimes[source])))
      : new Date(attemptedAt),
    expiresAt: new Date(
      providerUsed.length
        ? Math.max(...providerUsed.map((source) => sourceTimes[source])) + RETENTION
        : attemptedAt + NEGATIVE
    )
  };
}
async function processQueue() {
  if (!providers.enabled()) return { skipped: true, reason: 'disabled' };
  return governance.withLease('discovery-worker', 90, async (lease) => {
    const redis = cache.getRedisCacheClient({ commandTimeoutMs: 1000 });
    if (!redis) return { skipped: true, reason: 'quota_store_unavailable' };
    const topic = await redis.eval(CLAIM, {
      keys: [QUEUE, lease.key],
      arguments: [lease.token, String(Date.now())]
    });
    if (!validTopic(topic)) return { skipped: true, reason: 'no_job' };
    const attemptedAt = Date.now();
    const queuedState = JSON.parse((await redis.get(stateKey(topic))) || 'null');
    if (queuedState?.queuedAtMs)
      require('./newsMetricsService').queueDelay.observe(Math.max(0, attemptedAt - queuedState.queuedAtMs));
    if (
      Number(
        await redis.eval(SEARCHING, {
          keys: [lease.key, stateKey(topic)],
          arguments: [lease.token, JSON.stringify(status('searching', 'background_discovery'))]
        })
      ) !== 1
    )
      return { skipped: true, reason: 'lease_lost' };
    if (topic === '__broad__') {
      const result = await require('./newsService').refreshNewsPool();
      const value = status(
        result?.skipped
          ? 'waiting'
          : !result?.successful || result?.providerFailureCount
            ? 'source_unavailable'
            : result?.inserted
              ? 'ready'
              : 'no_newer',
        result?.reason ||
          (result?.skipped
            ? 'ingestion_cooldown'
            : !result?.successful || result?.providerFailureCount
              ? 'source_failure'
              : result?.inserted
                ? 'articles_cached'
                : 'no_newer_articles'),
        REFRESH_INTERVAL,
        {
          checkedAtMs: attemptedAt,
          newArticles: result?.inserted || 0,
          ...(result?.successful ? { lastSuccessfulCheckAt: new Date(attemptedAt).toISOString() } : {})
        }
      );
      await redis.eval(COMMIT, {
        keys: [lease.key, stateKey(topic), QUEUE, topicKey(topic), topicKey(topic) + ':version'],
        arguments: [
          lease.token,
          JSON.stringify(value),
          String(REFRESH_INTERVAL),
          topic,
          '',
          String(RETENTION),
          ''
        ]
      });
      return { topic, status: value.status };
    }
    const previous = await readTopic(topic);
    const manual = (await redis.get(stateKey(topic) + ':mode')) === 'manual';
    const outcomes = [];
    const collected = new Set();
    // One global worker, sequential attempts, at most four requests, no immediate retries.
    const selectedProviders = providers.available(topic).slice(0, 4);
    for (const [index, provider] of selectedProviders.entries()) {
      if ((await redis.get(lease.key)) !== lease.token) return { skipped: true, reason: 'lease_lost' };
      const priority = (await redis.get(stateKey(topic) + ':priority')) === 'prewarm' ? 'prewarm' : 'user';
      const outcome = await providers.search(provider, topic, priority);
      outcomes.push({ ...outcome, provider });
      outcome.items.forEach((item) => collected.add(item.url));
      if (
        collected.size >= MINIMUM &&
        !selectedProviders.slice(index + 1).some((key) => ['hackernewssearch', 'devtosearch'].includes(key))
      )
        break;
    }
    let value;
    let snapshot;
    const found = outcomes.reduce((sum, outcome) => sum + outcome.items.length, 0);
    const limited = outcomes.some((outcome) => outcome.status === 'quota_limited');
    const unavailable = outcomes.some((outcome) => outcome.status === 'unavailable');
    const successful = outcomes.some((outcome) => outcome.status === 'success');
    const denied = outcomes
      .filter((outcome) => outcome.nextEligibleAt)
      .sort((a, b) => Date.parse(a.nextEligibleAt) - Date.parse(b.nextEligibleAt))[0];
    const delay = found
      ? FRESH
      : denied
        ? Math.max(1, Date.parse(denied.nextEligibleAt) - Date.now())
        : limited
          ? 60000
          : unavailable
            ? 60000
            : NEGATIVE;
    value = status(
      found
        ? 'ready'
        : limited
          ? 'quota_limited'
          : unavailable
            ? 'source_unavailable'
            : successful
              ? 'exhausted'
              : 'disabled',
      found
        ? 'articles_cached'
        : limited
          ? denied?.reason || 'provider_admission'
          : unavailable
            ? 'source_failure'
            : successful
              ? 'no_matching_articles'
              : 'no_approved_sources',
      delay,
      {
        lastAttemptAt: new Date(attemptedAt).toISOString(),
        checkedAtMs: attemptedAt,
        sourceHealth: outcomes.map(({ provider, status: state, items, reason, nextEligibleAt }) => ({
          provider,
          status: state,
          articlesFound: items.length,
          reason: reason || null,
          nextEligibleAt: nextEligibleAt || null
        }))
      }
    );
    if ((await redis.get(lease.key)) !== lease.token) return { skipped: true, reason: 'lease_lost' };
    let ingestion;
    if (successful) {
      try {
        ingestion = await catalog.ingest(outcomes.flatMap((outcome) => outcome.items));
      } catch {
        value = status('unavailable', 'cache_persistence_failed', 60000);
      }
    }
    if (successful && ingestion) {
      await redis.eval(SEARCHING, {
        keys: [lease.key, stateKey(topic)],
        arguments: [lease.token, JSON.stringify(status('processing', 'saving_articles'))]
      });
      snapshot = buildSnapshot(topic, previous, outcomes, attemptedAt);
      value.lastSuccessfulCheckAt = new Date(attemptedAt).toISOString();
      value.cacheVersion = snapshot.filters.version;
      value.newArticles = ingestion.inserted;
      if (manual && !ingestion.inserted && !limited && !unavailable) {
        value.status = 'no_newer';
        value.reason = 'no_newer_articles';
      }
      let nextSourceAt = Date.now();
      if (typeof governance.inspect === 'function') {
        const admissions = await Promise.all(
          providers.available(topic).map((provider) => governance.inspect(provider))
        );
        if (admissions.length && admissions.every((admission) => !admission.allowed)) {
          const times = admissions
            .map((admission) => Date.parse(admission.nextEligibleAt))
            .filter(Number.isFinite);
          if (times.length) nextSourceAt = Math.min(...times);
        }
      }
      value.nextEligibleAt = new Date(Math.max(attemptedAt + REFRESH_INTERVAL, nextSourceAt)).toISOString();
      value.eligibilityReason =
        nextSourceAt > attemptedAt + REFRESH_INTERVAL ? 'provider_admission' : 'manual_refresh_interval';
      try {
        await TopicCache.updateOne(
          {
            cacheKey: topicKey(topic),
            $or: [
              { 'filters.attemptedAt': { $lte: attemptedAt } },
              { 'filters.attemptedAt': { $exists: false } }
            ]
          },
          { $set: snapshot },
          { upsert: true, maxTimeMS: 1000, timeoutMS: 2000 }
        );
      } catch {
        snapshot = null;
        value = status('unavailable', 'cache_persistence_failed', 60000, {
          lastAttemptAt: value.lastAttemptAt,
          sourceHealth: value.sourceHealth
        });
      }
    }
    const committed = await redis.eval(COMMIT, {
      keys: [lease.key, stateKey(topic), QUEUE, topicKey(topic), topicKey(topic) + ':version'],
      arguments: [
        lease.token,
        JSON.stringify(value),
        String(Math.max(1, snapshot ? delay : Date.parse(value.nextEligibleAt) - Date.now())),
        topic,
        snapshot ? JSON.stringify(snapshot) : '',
        String(snapshot ? Math.max(1, snapshot.expiresAt.getTime() - Date.now()) : RETENTION),
        snapshot?.filters.version || ''
      ]
    });
    if (Number(committed) === 1) {
      if (snapshot) remember(memory, topic, { value: snapshot, until: Date.now() + 5000 });
    }
    return { topic, status: value.status, committed: Number(committed) === 1 };
  });
}

// Independent short worker tick; feed admission only schedules asynchronous work.
async function workerTick() {
  if (!workerTimer || !providers.enabled()) return;
  try {
    const redis = cache.getRedisCacheClient({ commandTimeoutMs: 1000 });
    if (!redis) return;
    await redis.set(HEARTBEAT, String(Date.now()), { PX: 20000 });
    if (workerBusy) return;
    workerBusy = true;
    try {
      await processQueue();
    } finally {
      workerBusy = false;
    }
  } catch {
    /* Redis/provider outages are reflected by admission/status; no local fallback. */
  }
}

function wakeWorker() {
  if (!workerTimer || wakePending) return;
  wakePending = true;
  setImmediate(() => {
    wakePending = false;
    void workerTick();
  });
}
function startWorker() {
  if (workerTimer || process.env.NEWS_INGESTION_ENABLED === 'false') return;
  workerTimer = setInterval(() => {
    void workerTick();
  }, 5000);
  workerTimer.unref?.();
  wakeWorker();
}
function stopWorker() {
  clearInterval(workerTimer);
  workerTimer = null;
}

let prewarmUntil = 0;
async function prewarm() {
  if (
    !providers.enabled() ||
    process.env.NEWS_DISCOVERY_PREWARM_ENABLED !== 'true' ||
    prewarmUntil > Date.now()
  )
    return;
  prewarmUntil = Date.now() + bounded('NEWS_PREWARM_EVALUATION_MS', 3600000, 60000, 86400000);
  return governance.withLease('discovery-prewarm', 30, async () => {
    const redis = cache.getRedisCacheClient({ commandTimeoutMs: 1000 });
    if (!redis) return;
    if (!bounded('NEWS_DISCOVERY_PREWARM_DAILY_JOBS', 4, 0, 4)) return;
    const selected = await adaptive.candidates();
    for (const { topic } of selected) {
      const snapshot = await readTopic(topic);
      if (
        snapshot?.allItems?.length >= MINIMUM &&
        Date.now() - new Date(snapshot.lastUpdated).getTime() < 3600000
      )
        continue;
      await enqueue(topic, 'prewarm');
    }
  });
}

module.exports = {
  startWorker,
  stopWorker,
  HEARTBEAT,
  FRESH,
  NEGATIVE,
  readTopic,
  coverage,
  classify,
  processQueue,
  prewarm,
  buildSnapshot,
  MINIMUM,
  RETENTION,
  QUEUE,
  topicKey,
  stateKey,
  ENQUEUE,
  CLAIM,
  COMMIT
};
