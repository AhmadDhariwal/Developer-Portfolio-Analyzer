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
  NEWS_INGESTION_ENABLED: flag,
  NEWS_DISCOVERY_ENABLED: flag,
  NEWS_REFRESH_MIN_INTERVAL_MS: integer(60000, 3600000),
  NEWS_DISCOVERY_PREWARM_TOPICS: z
    .string()
    .max(323)
    .refine(
      (value) =>
        value.split(',').length <= 4 &&
        value.split(',').every((topic) => require('../utils/newsQuery').queryFor(topic)),
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

module.exports = { NEWS_PROVIDER_KEYS, newsEnvShape, validateNewsRelationships };
