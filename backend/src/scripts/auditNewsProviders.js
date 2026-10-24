// Default: read-only inventory. --live: one governed check per already approved public adapter.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const root = path.resolve(__dirname, '../..');
dotenv.config({ path: path.join(root, '.env'), quiet: true });
const cache = require('../services/redisCacheService');
const governor = require('../services/newsGovernanceService');
const catalog = require('../services/newsCatalogService');
const Article = require('../models/newsArticle');
const Pool = require('../models/news');
const { newsEnvShape, auditNewsConfiguration, validateNewsRelationships } = require('../config/newsConfig');
const { z } = require('zod');
const phase = process.argv.includes('--after') ? 'after' : 'before';
const live = process.argv.includes('--live');
const outputOption = process.argv.find((argument) => argument.startsWith('--output-dir='));
const outputDirectory = outputOption
  ? path.resolve(root, outputOption.slice('--output-dir='.length))
  : path.join(root, 'verification/tech-news/provider-finalization');

async function main() {
  const raw = fs.readFileSync(path.join(root, '.env'), 'utf8');
  const env = dotenv.parse(raw);
  const exampleRaw = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
  const example = dotenv.parse(exampleRaw);
  z.object(newsEnvShape).parse(env);
  validateNewsRelationships(env);
  const shape = (text, parsed) => ({
    ...auditNewsConfiguration(parsed, text),
    sha256: createHash('sha256').update(text).digest('hex')
  });
  await mongoose.connect(process.env.MONGODB_URI, { autoIndex: false, serverSelectionTimeoutMS: 5000 });
  const platform = await require('../models/platformSettings').findOne({ scope: 'global' }).lean();
  if (live) {
    if (!platform) throw new Error('Persisted platform settings required for live checks');
    await require('../services/platformSettingsService').getSettings();
  }
  await cache.initRedisCache({ silent: true, probeOnly: true });
  const redis = cache.getRedisCacheClient({ commandTimeoutMs: 1500 });
  const now = new Date();
  const read = (key) => (redis ? redis.get(key).catch(() => 'unavailable') : Promise.resolve('unavailable'));
  const heartbeat = await read('news:v1:{discovery}:worker');
  const counts = await Article.aggregate([
    {
      $group: {
        _id: '$source',
        retained: { $sum: 1 },
        unexpired: { $sum: { $cond: [{ $gt: ['$expiresAt', now] }, 1, 0] } },
        newest: { $max: '$publishedAt' }
      }
    }
  ]);
  const pool = await Pool.findOne({ cacheKey: 'news:v3:public:pool' }).lean();
  const result = {
    phase,
    checkedAt: now.toISOString(),
    applicationWrites: 0,
    providerRequests: 0,
    configuration: {
      local: shape(raw, env),
      example: shape(exampleRaw, example),
      credentialsPresent: Object.fromEntries(
        ['NEWS_API_KEY', 'GNEWS_API_KEY', 'NEWS_REDDIT_ACCESS_TOKEN', 'NEWS_REDDIT_USER_AGENT'].map((key) => [
          key,
          Boolean(env[key])
        ])
      )
    },
    flags: {
      ingestion: env.NEWS_INGESTION_ENABLED,
      discovery: env.NEWS_DISCOVERY_ENABLED,
      platformNewsEnabled: platform ? platform.integrations?.news?.enabled !== false : null
    },
    worker: {
      present: !!heartbeat && heartbeat !== 'unavailable',
      ageMs: heartbeat && heartbeat !== 'unavailable' ? Date.now() - Number(heartbeat) : null
    },
    ingestion: {
      attemptedAt: pool?.filters?.attemptedAt || null,
      leaseTtlMs: redis ? await redis.pTTL('news:v3:lease:ingestion').catch(() => null) : null
    },
    jobs: {
      limit: Number(env.NEWS_DISCOVERY_DAILY_JOBS),
      used: await read('news:v1:{discovery}:jobs:' + now.toISOString().slice(0, 10)),
      prewarmUsed: await read('news:v1:{discovery}:prewarm:' + now.toISOString().slice(0, 10)),
      nextDay: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString()
    },
    providers: await governor.health(),
    sharedFamilies: Object.fromEntries(
      ['hackernews', 'devto', 'githubreleases'].map((key) => [key, governor.sharedPolicy(key)])
    ),
    catalog: Object.fromEntries(
      Object.keys(catalog.SOURCE_KEYS).map((source) => [
        source,
        {
          ...(counts.find((row) => row._id === source) || { retained: 0, unexpired: 0 }),
          eligibleLast30Days: null,
          retentionHours: catalog.retentionMs(source) / 3600000,
          lastBroadObservation: pool?.providerDiagnostics?.find((item) => item.provider === source) || null
        }
      ])
    )
  };
  for (const source of Object.keys(result.catalog)) {
    result.catalog[source].eligibleLast30Days = await Article.countDocuments(
      catalog.predicate({
        source,
        category: 'All',
        dateRange: 'month',
        popularity: 'all'
      })
    );
  }
  if (live) {
    // No restricted/paid API, broad scheduler, quota reset, discovery job or persistence.
    // Reserve against the application's real counters; exhausted sources must remain blocked.
    process.env.NEWS_DISCOVERY_RESULTS_PER_PROVIDER = '5';
    const adapters = require('../services/newsDiscoveryProviders');
    result.live = [];
    for (const key of [
      'hackernewssearch',
      'devtosearch',
      'githubreleases',
      'githubadvisories',
      'kubernetesblog'
    ]) {
      const policy = governor.policy(key);
      if (!policy.daily || !policy.monthly || !adapters.enabled()) {
        result.live.push({ provider: key, status: 'disabled', externalRequest: false });
        continue;
      }
      const preflight = await governor.inspect(key);
      if (!preflight.allowed) {
        result.live.push({ provider: key, status: 'blocked', externalRequest: false, ...preflight });
        continue;
      }
      const response = await adapters.search(key, 'kubernetes');
      result.live.push({
        provider: key,
        ...require('../utils/newsProviderErrors').publicFields(response),
        normalizedArticles: response.items.length,
        catalogEligibleArticles: response.items.filter((item) => catalog.prepare(item)).length
      });
    }
    result.liveProvidersAfter = await governor.health();
    result.applicationWrites =
      'Only ordinary governed provider reservations/feedback for admitted minimal live checks';
    result.providerRequests = 'At most one per approved eligible public adapter; see live preflight results';
  }
  const output = outputDirectory;
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(
    path.join(output, live ? 'live.json' : `runtime-${phase}.json`),
    JSON.stringify(result, null, 2) + '\n'
  );
  console.log(
    JSON.stringify({
      phase,
      worker: result.worker,
      jobs: result.jobs,
      live: result.live,
      providers: Object.fromEntries(
        Object.entries(result.providers).map(([key, value]) => [
          key,
          {
            enabled: value.enabled,
            used: value.dailyUsed,
            admission: value.admission
          }
        ])
      ),
      catalog: Object.fromEntries(
        Object.entries(result.catalog).map(([key, value]) => [
          key,
          {
            retained: value.retained,
            eligible: value.eligibleLast30Days,
            lastBroadObservation: value.lastBroadObservation
          }
        ])
      )
    })
  );
}
main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cache.closeRedisCache();
    await mongoose.disconnect();
  });
