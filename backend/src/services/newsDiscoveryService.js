const TopicCache = require('../models/newsTopicCache');
const cache = require('./redisCacheService');
const governance = require('./newsGovernanceService');
const providers = require('./newsDiscoveryProviders');
const { normalizeItem } = require('../utils/newsFormatter');

const BASE = 'news:v1:{discovery}';
const QUEUE = `${BASE}:queue`;
const RETENTION = 24 * 3600000;
const MINIMUM = 6;
const memory = new Map();
const inFlight = new Map();
const stateMemory = new Map();
const stateFlight = new Map();
const topicKey = (topic) => `${BASE}:topic:${topic}`;
const stateKey = (topic) => `${BASE}:state:${topic}`;
const usable = (value) =>
  Number.isFinite(new Date(value?.expiresAt).getTime()) && new Date(value.expiresAt).getTime() > Date.now();
const SEARCHING =
  "if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end; redis.call('SET', KEYS[2], ARGV[2], 'PX', 180000); return 1";
const ENQUEUE = `
local old = redis.call('GET', KEYS[2])
if old then return old end
if redis.call('ZSCORE', KEYS[1], ARGV[2]) then return ARGV[3] end
if redis.call('ZCARD', KEYS[1]) >= 16 then return ARGV[5] end
if tonumber(redis.call('GET', KEYS[3]) or '0') >= tonumber(ARGV[6]) then return ARGV[7] end
redis.call('INCR', KEYS[3]); redis.call('PEXPIREAT', KEYS[3], ARGV[4])
redis.call('SET', KEYS[2], ARGV[3], 'PX', 180000)
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
if ARGV[5] ~= '' then redis.call('SET', KEYS[4], ARGV[5], 'PX', ARGV[6]) end
return 1
`;
const status = (value, reason, delay = 0, extra = {}) => ({
  status: value,
  reason,
  nextEligibleAt: delay ? new Date(Date.now() + delay).toISOString() : null,
  ...extra
});
const validTopic = (topic) => Object.hasOwn(providers.TOPICS, topic);
const view = (snapshot, topic) => {
  if (!usable(snapshot)) return null;
  const permitted = new Set(
    providers.available(topic).map((key) => providers.SOURCE_NAMES[providers.KEYS.indexOf(key)])
  );
  const allItems = (snapshot.allItems || [])
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
  const previous = memory.get(topic);
  if (previous && previous.until > Date.now()) return view(previous.value, topic);
  if (inFlight.has(topic)) return inFlight.get(topic);
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
    memory.set(topic, { value, until: Date.now() + 5000 });
    return view(value, topic);
  })().finally(() => inFlight.delete(topic));
  inFlight.set(topic, read);
  return read;
}
function classify(filters, total, broadTotal, diagnostics = []) {
  if (total >= MINIMUM) return 'sufficient';
  if (!filters.search) return 'general_pool';
  if (!providers.topicFor(filters.search)) return 'unsupported_query';
  if (filters.source !== 'All') {
    const source = diagnostics.find((item) => item.provider === filters.source);
    return source?.reachable && !source.articlesFetched ? 'source_exhausted' : 'restrictive_filters';
  }
  if (
    filters.dateRange === 'today' ||
    filters.popularity === 'high' ||
    (filters.category !== 'All' &&
      filters.category !== providers.TOPICS[providers.topicFor(filters.search)].category) ||
    broadTotal >= MINIMUM
  )
    return 'restrictive_filters';
  return 'coverage_gap';
}
async function coverage({ filters, total, broadTotal, diagnostics = [], revalidate = false, lastUpdated = null }) {
  const topic = providers.topicFor(filters.search);
  const classification = classify(filters, total, broadTotal, diagnostics);
  const result = { status: classification, topic, cachedMatches: total, minimum: MINIMUM };
  const refreshEligible =
    revalidate &&
    classification === 'sufficient' &&
    topic &&
    lastUpdated &&
    Date.now() - new Date(lastUpdated).getTime() >= 1800000 &&
    classify(filters, 0, 0) === 'coverage_gap';
  if (classification !== 'coverage_gap' && !refreshEligible)
    return { coverage: result, enrichment: status('not_needed', classification) };
  if (!providers.enabled() || !providers.available(topic).length)
    return { coverage: result, enrichment: status('disabled', 'no_approved_sources') };
  const cached = stateMemory.get(topic);
  if (cached?.until > Date.now()) return { coverage: result, enrichment: cached.value };
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
  if (!stateFlight.has(topic))
    stateFlight.set(
      topic,
      enqueue(topic).finally(() => stateFlight.delete(topic))
    );
  return { coverage: result, enrichment: await stateFlight.get(topic) };
}
async function enqueue(topic) {
  const redis = cache.getRedisCacheClient({ commandTimeoutMs: 1000 });
  let value = status('unavailable', 'quota_store_unavailable', 60000);
  if (redis) {
    const now = Date.now();
    const date = new Date(now);
    const end = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
    const daily = Math.max(1, Math.min(48, Number.parseInt(process.env.NEWS_DISCOVERY_DAILY_JOBS, 10) || 12));
    try {
      value = JSON.parse(
        await redis.eval(ENQUEUE, {
          keys: [QUEUE, stateKey(topic), `${BASE}:jobs:${date.toISOString().slice(0, 10)}`],
          arguments: [
            String(now),
            topic,
            JSON.stringify(status('queued', 'background_discovery')),
            String(end),
            JSON.stringify(status('unavailable', 'queue_full', 60000)),
            String(daily),
            JSON.stringify(status('quota_limited', 'discovery_daily_budget', end - now))
          ]
        })
      );
    } catch {
      /* No local provider or queue fallback. */
    }
  }
  stateMemory.set(topic, { value, until: Date.now() + 5000 });
  return value;
}
function buildSnapshot(topic, previous, outcomes, attemptedAt) {
  const sourceTimes = { ...(previous?.filters?.sourceTimes || {}) };
  const buckets = {};
  for (const item of previous?.allItems || []) {
    if (attemptedAt - Number(sourceTimes[item.source] || 0) < RETENTION) (buckets[item.source] ||= []).push(item);
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
      if (!item || !providers.matchesTopic(item, topic) || urls.has(item.url) || titles.has(item.title.toLowerCase()))
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
    filters: { topic, attemptedAt, sourceTimes },
    allItems,
    total: allItems.length,
    providerUsed,
    providerDiagnostics: outcomes.map(({ provider, status: value, items }) => ({
      provider,
      status: value,
      articlesFetched: items.length,
      checkedAt: new Date(attemptedAt).toISOString()
    })),
    lastUpdated: providerUsed.length
      ? new Date(Math.min(...providerUsed.map((source) => sourceTimes[source])))
      : new Date(attemptedAt),
    expiresAt: new Date(
      (providerUsed.length ? Math.max(...providerUsed.map((source) => sourceTimes[source])) : attemptedAt) + RETENTION
    )
  };
}
async function processQueue() {
  if (!providers.enabled()) return { skipped: true, reason: 'disabled' };
  return governance.withLease('discovery-worker', 90, async (lease) => {
    const redis = cache.getRedisCacheClient({ commandTimeoutMs: 1000 });
    if (!redis) return { skipped: true, reason: 'quota_store_unavailable' };
    const topic = await redis.eval(CLAIM, { keys: [QUEUE, lease.key], arguments: [lease.token, String(Date.now())] });
    if (!validTopic(topic)) return { skipped: true, reason: 'no_job' };
    const attemptedAt = Date.now();
    if (
      Number(
        await redis.eval(SEARCHING, {
          keys: [lease.key, stateKey(topic)],
          arguments: [lease.token, JSON.stringify(status('searching', 'background_discovery'))]
        })
      ) !== 1
    )
      return { skipped: true, reason: 'lease_lost' };
    const previous = await readTopic(topic);
    const outcomes = [];
    const collected = new Set();
    // One global worker, sequential attempts, at most four requests, no immediate retries.
    for (const provider of providers.available(topic).slice(0, 4)) {
      if ((await redis.get(lease.key)) !== lease.token) return { skipped: true, reason: 'lease_lost' };
      const outcome = await providers.search(provider, topic);
      outcomes.push({ ...outcome, provider });
      outcome.items.forEach((item) => collected.add(item.url));
      if (collected.size >= MINIMUM) break;
    }
    let value;
    let snapshot;
    const found = outcomes.reduce((sum, outcome) => sum + outcome.items.length, 0);
    const limited = outcomes.some((outcome) => outcome.status === 'quota_limited');
    const unavailable = outcomes.some((outcome) => outcome.status === 'unavailable');
    const successful = outcomes.some((outcome) => outcome.status === 'success');
    const delay = found ? 1800000 : limited ? 3600000 : unavailable ? 300000 : 7200000;
    value = status(
      found ? 'ready' : limited ? 'quota_limited' : unavailable ? 'unavailable' : successful ? 'exhausted' : 'disabled',
      found
        ? 'articles_cached'
        : limited
          ? 'provider_admission'
          : unavailable
            ? 'source_failure'
            : successful
              ? 'no_matching_articles'
              : 'no_approved_sources',
      delay,
      {
        lastAttemptAt: new Date(attemptedAt).toISOString(),
        sourceHealth: outcomes.map(({ provider, status: state, items }) => ({
          provider,
          status: state,
          articlesFound: items.length
        }))
      }
    );
    if ((await redis.get(lease.key)) !== lease.token) return { skipped: true, reason: 'lease_lost' };
    if (successful) {
      snapshot = buildSnapshot(topic, previous, outcomes, attemptedAt);
      try {
        await TopicCache.updateOne(
          {
            cacheKey: topicKey(topic),
            $or: [{ 'filters.attemptedAt': { $lte: attemptedAt } }, { 'filters.attemptedAt': { $exists: false } }]
          },
          { $set: snapshot },
          { upsert: true }
        );
      } catch {
        snapshot = null;
        value = status('unavailable', 'cache_persistence_failed', 300000);
      }
    }
    const committed = await redis.eval(COMMIT, {
      keys: [lease.key, stateKey(topic), QUEUE, topicKey(topic)],
      arguments: [
        lease.token,
        JSON.stringify(value),
        String(Math.max(1, Date.parse(value.nextEligibleAt) - Date.now())),
        topic,
        snapshot ? JSON.stringify(snapshot) : '',
        String(snapshot ? Math.max(1, snapshot.expiresAt.getTime() - Date.now()) : RETENTION)
      ]
    });
    if (Number(committed) === 1) {
      stateMemory.set(topic, { value, until: Date.now() + 5000 });
      if (snapshot) memory.set(topic, { value: snapshot, until: Date.now() + 5000 });
    }
    return { topic, status: value.status, committed: Number(committed) === 1 };
  });
}

let prewarmUntil = 0;
async function prewarm() {
  if (!providers.enabled() || process.env.NEWS_DISCOVERY_PREWARM_ENABLED !== 'true' || prewarmUntil > Date.now())
    return;
  prewarmUntil = Date.now() + 3600000;
  return governance.withLease('discovery-prewarm', 30, async () => {
    const redis = cache.getRedisCacheClient({ commandTimeoutMs: 1000 });
    if (!redis) return;
    const daily = Math.max(
      0,
      Math.min(4, Number.parseInt(process.env.NEWS_DISCOVERY_PREWARM_DAILY_JOBS ?? '4', 10) || 0)
    );
    const date = new Date();
    const ttl = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1) - date.getTime();
    const configured = (process.env.NEWS_DISCOVERY_PREWARM_TOPICS || 'devops,kubernetes,security,ai')
      .split(',')
      .map(providers.topicFor)
      .filter(Boolean);
    for (const topic of [...new Set(configured)].slice(0, 4)) {
      const snapshot = await readTopic(topic);
      if (snapshot?.allItems?.length >= MINIMUM && Date.now() - new Date(snapshot.lastUpdated).getTime() < 3600000)
        continue;
      if (
        !daily ||
        Number(
          await redis.eval(governance.COUNTER, {
            keys: [`${BASE}:prewarm:${date.toISOString().slice(0, 10)}`],
            arguments: [String(ttl)]
          })
        ) > daily
      )
        break;
      await coverage({
        filters: { search: topic, category: 'All', source: 'All', dateRange: 'month', popularity: 'all' },
        total: 0,
        broadTotal: 0
      });
    }
  });
}

module.exports = {
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
