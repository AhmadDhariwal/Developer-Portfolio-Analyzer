const { z } = require('zod');

const NEWS_PROVIDER_KEYS = [
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
  'kubernetesblog',
  'cloudflarechangelog'
];
const flag = z.enum(['true', 'false']).optional();
const integer = (min, max) => z.coerce.number().int().min(min).max(max).optional();
const newsEnvShape = {
  NEWS_CATALOG_RETENTION_DAYS: integer(1, 35),
  NEWS_CATALOG_RANKING_LIMIT: integer(100, 10000),
  NEWS_PREWARM_STRATEGY: z.enum(['demand-coverage', 'demand-only']).optional(),
  NEWS_PREWARM_MIN_DEMAND: integer(2, 100),
  NEWS_PREWARM_TARGET_ARTICLES: integer(1, 40),
  NEWS_PREWARM_FRESHNESS_MS: integer(60000, 86400000),
  NEWS_PREWARM_EVALUATION_MS: integer(60000, 86400000),
  NEWS_PREWARM_MAX_CANDIDATES: integer(1, 4),
  NEWS_PREWARM_RESERVED_USER_JOBS: integer(1, 48),
  NEWS_INGESTION_ENABLED: flag,
  NEWS_DISCOVERY_ENABLED: flag,
  NEWS_REFRESH_MIN_INTERVAL_MS: integer(60000, 3600000),
  NEWS_DISCOVERY_PREWARM_TOPICS: z
    .string()
    .max(323)
    .refine(
      (value) =>
        value === '' ||
        (value.split(',').length <= 4 &&
          value.split(',').every((topic) => require('../utils/newsQuery').queryFor(topic))),
      'Use up to four valid public technology phrases'
    )
    .optional(),
  NEWS_DISCOVERY_PREWARM_ENABLED: flag,
  NEWS_DISCOVERY_DAILY_JOBS: integer(1, 48),
  NEWS_DISCOVERY_PREWARM_DAILY_JOBS: integer(0, 4),
  NEWS_DISCOVERY_USER_MINUTE_JOBS: integer(1, 12),
  NEWS_DISCOVERY_USER_DAILY_JOBS: integer(1, 48),
  NEWS_DISCOVERY_RESULTS_PER_PROVIDER: integer(1, 30),
  NEWS_QUERY_FRESH_TTL_MS: integer(60000, 3600000),
  NEWS_QUERY_STALE_TTL_MS: integer(3600000, 86400000),
  NEWS_QUERY_NEGATIVE_TTL_MS: integer(30000, 900000),
  NEWS_QUERY_MEMORY_ENTRIES: integer(40, 256)
};
for (const key of NEWS_PROVIDER_KEYS) {
  const prefix = `NEWS_${key.toUpperCase()}_`;
  newsEnvShape[`${prefix}CONTENT_APPROVED`] = flag;
  newsEnvShape[`${prefix}RETENTION_HOURS`] = integer(1, 840);
  newsEnvShape[`${prefix}DAILY_BUDGET`] = integer(0, 1000);
  newsEnvShape[`${prefix}MONTHLY_BUDGET`] = integer(0, 30000);
  newsEnvShape[`${prefix}MIN_INTERVAL_MS`] = integer(0, 86400000);
}
for (const family of ['HACKERNEWS', 'DEVTO', 'GITHUB']) {
  const prefix = `NEWS_${family}_SHARED_`;
  newsEnvShape[`${prefix}DAILY_BUDGET`] = integer(0, 2000);
  newsEnvShape[`${prefix}MONTHLY_BUDGET`] = integer(0, 60000);
  newsEnvShape[`${prefix}MIN_INTERVAL_MS`] = integer(0, 86400000);
}

function validateNewsRelationships(env) {
  const fresh = Number(env.NEWS_QUERY_FRESH_TTL_MS || 1800000);
  const stale = Number(env.NEWS_QUERY_STALE_TTL_MS || 86400000);
  if (stale < fresh) throw new Error('NEWS_QUERY_STALE_TTL_MS must be at least NEWS_QUERY_FRESH_TTL_MS');
}

function auditNewsConfiguration(env, text = '') {
  const known = new Set(require('./newsEnvCatalog').entries.map((entry) => entry.key));
  const newsKey = (key) => key.startsWith('NEWS_') || key === 'GNEWS_API_KEY';
  const unknown = Object.keys(env).filter((key) => newsKey(key) && !known.has(key));
  const seen = new Set();
  const duplicate = [];
  for (const line of text.split(/\r?\n/)) {
    const key = line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=/)?.[1];
    if (!key || !newsKey(key)) continue;
    if (seen.has(key)) duplicate.push(key);
    seen.add(key);
  }
  if (unknown.length || duplicate.length)
    throw new Error(
      `News configuration keys: unknown=${unknown.join(',')}; duplicate=${duplicate.join(',')}`
    );
  return {
    missing: [...known].filter((key) => !Object.hasOwn(env, key)),
    deprecated: env.NEWS_DISCOVERY_PREWARM_TOPICS ? ['NEWS_DISCOVERY_PREWARM_TOPICS (ignored)'] : []
  };
}
module.exports = { NEWS_PROVIDER_KEYS, newsEnvShape, validateNewsRelationships, auditNewsConfiguration };
