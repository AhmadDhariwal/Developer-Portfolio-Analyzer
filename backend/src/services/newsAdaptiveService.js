const { createHash, createHmac } = require('node:crypto');
const cache = require('./redisCacheService');
const catalog = require('./newsCatalogService');
const { queryFor } = require('../utils/newsQuery');
const { TOPICS } = require('../utils/newsTopics');
const setting = (name, fallback) => Number(process.env[name] ?? fallback);
const BASE = 'news:adaptive:';
// Taxonomy-only aggregates; pseudonymous uniqueness tokens expire after eight days.
// Repeated searches by one account count once across the entire seven-day window.
const RECORD = `
if redis.call('SISMEMBER', KEYS[1], ARGV[1]) == 1 then return 0 end
if redis.call('SCARD', KEYS[1]) >= 8 then return 0 end
redis.call('SADD', KEYS[1], ARGV[1]); redis.call('PEXPIRE', KEYS[1], 172800000)
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', tonumber(ARGV[3]) - 604800000)
if redis.call('ZCARD', KEYS[2]) >= 10000 then return 0 end
redis.call('ZADD', KEYS[2], ARGV[3], ARGV[2]); redis.call('PEXPIRE', KEYS[2], 691200000)
return 1`;
async function record(search, account) {
  const topic = queryFor(search)?.topic;
  if (!topic || !account || !process.env.JWT_SECRET) return;
  const redis = cache.getRedisCacheClient({ commandTimeoutMs: 1000 });
  if (!redis) return;
  const day = new Date().toISOString().slice(0, 10);
  const hash = createHash('sha256').update(`${day}:${account}`).digest('hex');
  await redis
    .eval(RECORD, {
      keys: [BASE + 'user:' + hash, BASE + 'topic:' + topic],
      arguments: [
        topic,
        createHmac('sha256', process.env.JWT_SECRET).update(account).digest('hex'),
        String(Date.now())
      ]
    })
    .catch(() => {});
}
function select(demand, trends, now = Date.now()) {
  const demandOnly = process.env.NEWS_PREWARM_STRATEGY === 'demand-only';
  const minimum = setting('NEWS_PREWARM_MIN_DEMAND', 3);
  const target = setting('NEWS_PREWARM_TARGET_ARTICLES', 6);
  const stale = setting('NEWS_PREWARM_FRESHNESS_MS', 21600000);
  const coverage = new Map(trends.map((entry) => [entry._id, entry]));
  const candidates = new Set([...demand.keys(), ...coverage.keys()]);
  return [...candidates]
    .map((topic) => {
      const entry = coverage.get(topic);
      const count = entry?.count || 0;
      const aged = now - new Date(entry?.newest || 0).getTime() > stale;
      const searches = Math.min(100, demand.get(topic) || 0);
      return { topic, count, searches, aged, score: searches * 10 + Math.min(20, count) + (aged ? 5 : 0) };
    })
    .filter(
      (entry) =>
        (entry.count < target || entry.aged) &&
        (entry.searches >= minimum || (!demandOnly && demand.size === 0 && entry.count > 0))
    )
    .sort((a, b) => b.score - a.score || a.topic.localeCompare(b.topic))
    .slice(0, setting('NEWS_PREWARM_MAX_CANDIDATES', 2));
}
async function candidates() {
  const redis = cache.getRedisCacheClient({ commandTimeoutMs: 1000 });
  if (!redis) return [];
  const demand = new Map();
  const topics = Object.keys(TOPICS);
  const counts = await redis.eval(
    "local result = {}; for _, key in ipairs(KEYS) do table.insert(result, redis.call('ZCOUNT', key, ARGV[1], '+inf')) end; return result",
    { keys: topics.map((topic) => BASE + 'topic:' + topic), arguments: [String(Date.now() - 7 * 86400000)] }
  );
  topics.forEach((topic, index) => {
    if (Number(counts[index]) > 0) demand.set(topic, Number(counts[index]));
  });
  return select(demand, await catalog.trends());
}
module.exports = { record, select, candidates, RECORD };
