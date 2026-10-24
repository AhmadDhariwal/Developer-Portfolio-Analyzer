const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
const { z } = require('zod');
const { newsEnvShape, validateNewsRelationships } = require('../config/newsConfig');
const cache = require('../services/redisCacheService');
const governance = require('../services/newsGovernanceService');

async function inspect(query) {
  const parsed = z.object(newsEnvShape).safeParse(process.env);
  if (!parsed.success)
    throw new Error(
      'Invalid news configuration: ' + parsed.error.issues.map((issue) => issue.path.join('.')).join(', ')
    );
  validateNewsRelationships(parsed.data);
  const redis = await cache.initRedisCache({ silent: true, probeOnly: true });
  const output = {
    checkedAt: new Date().toISOString(),
    applicationWrites: 0,
    ingestionEnabled: process.env.NEWS_INGESTION_ENABLED !== 'false',
    discoveryEnabled: process.env.NEWS_DISCOVERY_ENABLED === 'true',
    redisAvailable: Boolean(redis),
    workerHeartbeatAt: redis ? await redis.get('news:v1:{discovery}:worker') : null,
    cache: {
      freshMs: Number(process.env.NEWS_QUERY_FRESH_TTL_MS || 1800000),
      negativeMs: Number(process.env.NEWS_QUERY_NEGATIVE_TTL_MS || 300000),
      retentionMs: Number(process.env.NEWS_QUERY_STALE_TTL_MS || 86400000)
    },
    providers: await governance.health()
  };
  if (query) {
    const discovery = require('../services/newsDiscoveryService');
    const { queryFor } = require('../utils/newsQuery');
    if (!queryFor(query)) throw new Error('Use a valid public technology query');
    const value = redis && (await redis.get(discovery.topicKey(query)));
    const snapshot = value ? JSON.parse(value) : null;
    output.query = {
      state: redis ? JSON.parse((await redis.get(discovery.stateKey(query))) || 'null') : null,
      cacheVersion: snapshot?.filters?.version || null,
      lastSuccessfulCheckAt: snapshot?.filters?.lastSuccessfulCheckAt || null,
      matches: snapshot?.total ?? null
    };
  }
  return output;
}
if (require.main === module)
  inspect(process.argv[2])
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch(() => {
      console.error('News diagnostics failed: configuration or infrastructure unavailable.');
      process.exitCode = 1;
    })
    .finally(() => cache.closeRedisCache());
module.exports = { inspect };
