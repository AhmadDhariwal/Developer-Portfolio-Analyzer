const NewsCache = require('../models/news');
const cache = require('./redisCacheService');
const governance = require('./newsGovernanceService');
const catalog = require('./newsCatalogService');
const { normalizeItem } = require('../utils/newsFormatter');

const KEY = 'news:v3:public:pool';
const FRESH_MS = 20 * 60000;
const STALE_MS = 24 * 3600000;
let memory;
let memoryUntil = 0;
let inflight;

const usable = (value) => value && new Date(value.expiresAt).getTime() > Date.now();
const toView = (value) => {
  if (!usable(value)) return null;
  const times = value.filters?.sourceTimes;
  if (!times) return value;
  const allItems = (value.allItems || []).filter(
    (item) => Date.now() - Number(times[item.source] || 0) < STALE_MS
  );
  const providerUsed = [...new Set(allItems.map((item) => item.source))];
  return {
    ...value,
    allItems,
    providerUsed,
    total: allItems.length,
    lastUpdated: providerUsed.length ? new Date(Math.min(...providerUsed.map((name) => times[name]))) : null
  };
};
const freshness = (value) =>
  !usable(value) || !value.allItems?.length
    ? 'warming'
    : Date.now() - new Date(value.lastUpdated).getTime() <= FRESH_MS
      ? 'fresh'
      : 'stale';

async function readPool({ bypass = false } = {}) {
  if (!bypass && (memory === null || usable(memory)) && memoryUntil > Date.now()) return toView(memory);
  if (!bypass && inflight) return inflight;
  const read = async () => {
    let value;
    const redis = cache.getRedisCacheClient({ commandTimeoutMs: 1000 });
    if (redis) {
      try {
        value = JSON.parse(await redis.get(KEY));
      } catch {
        /* Mongo fallback. */
      }
    }
    if (!usable(value)) {
      try {
        value = await NewsCache.findOne({ cacheKey: KEY, expiresAt: { $gt: new Date() } }).lean();
      } catch {
        /* Retain bounded stale memory. */
      }
    }
    if (!usable(value)) {
      memoryUntil = Date.now() + 5000;
      if (!usable(memory)) memory = null;
      return toView(memory);
    }
    memory = value;
    memoryUntil = Date.now() + 5000;
    return toView(value);
  };
  if (bypass) return read();
  inflight = read().finally(() => {
    inflight = null;
  });
  return inflight;
}

async function refreshPool(loader) {
  return governance.withLease('ingestion', 120, async (lease) => {
    const previous = await readPool({ bypass: true });
    // A failed or empty run is also paced; no worker hot-loops on cold starts.
    if (Date.now() - Number(previous?.filters?.attemptedAt || 0) < 60000) return { skipped: true };
    const attemptedAt = Date.now();
    const result = await loader();
    const sourceTimes = { ...(previous?.filters?.sourceTimes || {}) };
    const buckets = {};
    const now = Date.now();
    for (const diagnostic of result.providerDiagnostics) {
      const name = diagnostic.provider;
      const incoming = (result.sourceBuckets[name] || []).map(normalizeItem).filter(Boolean);
      if (incoming.length) {
        buckets[name] = incoming;
        sourceTimes[name] = now;
      } else if (
        diagnostic.enabled &&
        diagnostic.configured &&
        now - Number(sourceTimes[name] || 0) < STALE_MS
      ) {
        buckets[name] = (previous?.allItems || []).filter((item) => item.source === name);
      }
    }
    const seen = new Set();
    const titles = new Set();
    const allItems = Object.values(buckets)
      .flat()
      .map(normalizeItem)
      .filter((item) => {
        if (!item || seen.has(item.url) || titles.has(item.title.toLowerCase())) return false;
        seen.add(item.url);
        titles.add(item.title.toLowerCase());
        return true;
      })
      .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt) || a.url.localeCompare(b.url))
      .slice(0, 300);
    const providerUsed = [...new Set(allItems.map((item) => item.source))];
    const oldest = providerUsed.length ? Math.min(...providerUsed.map((name) => sourceTimes[name])) : null;
    const snapshot = {
      cacheKey: KEY,
      filters: { attemptedAt, sourceTimes },
      allItems,
      total: allItems.length,
      providerUsed,
      providerDiagnostics: result.providerDiagnostics.map((diagnostic) => ({
        ...diagnostic,
        lastSuccess:
          diagnostic.lastSuccess ||
          (sourceTimes[diagnostic.provider] ? new Date(sourceTimes[diagnostic.provider]).toISOString() : null)
      })),
      providerFailureCount: result.providerFailureCount,
      lastUpdated: oldest ? new Date(oldest) : null,
      expiresAt: new Date(
        (providerUsed.length ? Math.max(...providerUsed.map((name) => sourceTimes[name])) : now) + STALE_MS
      ),
      trendingTopics: [
        'javascript',
        'typescript',
        'react',
        'angular',
        'node',
        'docker',
        'kubernetes',
        'ai',
        'llm',
        'security'
      ]
        .map((topic) => [
          topic,
          allItems.filter((item) =>
            new RegExp(`(^|[^a-z0-9])${topic}(?=$|[^a-z0-9])`, 'i').test(`${item.title} ${item.description}`)
          ).length
        ])
        .filter(([, count]) => count)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 8)
        .map(([topic]) => topic),
      sourceSummary: Object.fromEntries(
        providerUsed.map((name) => [name, allItems.filter((item) => item.source === name).length])
      )
    };
    // Persist before publishing. A failed Mongo write cannot discard the last good snapshot.
    const publisher = cache.getRedisCacheClient({ commandTimeoutMs: 1000 });
    if (!publisher || (await publisher.get(lease.key).catch(() => null)) !== lease.token)
      return { skipped: true, reason: 'lease_lost' };
    const ingestion = await catalog.ingest(Object.values(result.sourceBuckets).flat());
    try {
      await NewsCache.updateOne(
        {
          cacheKey: KEY,
          $or: [
            { 'filters.attemptedAt': { $lte: attemptedAt } },
            { 'filters.attemptedAt': { $exists: false } }
          ]
        },
        { $set: snapshot },
        { upsert: true }
      );
    } catch (error) {
      if (error.code === 11000) return { skipped: true, reason: 'newer_snapshot' };
      throw error;
    }
    memory = snapshot;
    memoryUntil = now + 5000;
    const redis = cache.getRedisCacheClient({ commandTimeoutMs: 1000 });
    if (redis)
      await redis
        .eval(
          "if redis.call('GET', KEYS[2]) ~= ARGV[1] then return 0 end; local old = redis.call('GET', KEYS[1]); if old and tonumber(cjson.decode(old).filters.attemptedAt) > tonumber(ARGV[2]) then return 0 end; redis.call('SET', KEYS[1], ARGV[3], 'PX', ARGV[4]); return 1",
          {
            keys: [KEY, lease.key],
            arguments: [
              lease.token,
              String(attemptedAt),
              JSON.stringify(snapshot),
              String(Math.max(1, snapshot.expiresAt.getTime() - Date.now()))
            ]
          }
        )
        .catch(() => {});
    return {
      articles: allItems.length,
      ...ingestion,
      successful: result.providerDiagnostics.some((entry) => entry.reachable),
      providerFailureCount: result.providerFailureCount
    };
  });
}

module.exports = { KEY, FRESH_MS, STALE_MS, readPool, refreshPool, freshness };
