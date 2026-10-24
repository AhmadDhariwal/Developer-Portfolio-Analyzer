// Read-only operator audit. Credentials are represented only by presence booleans.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const dotenv = require('dotenv');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { entries } = require('../config/newsEnvCatalog');
const { newsEnvShape, auditNewsConfiguration, validateNewsRelationships } = require('../config/newsConfig');
const { z } = require('zod');
const root = path.resolve(__dirname, '../..');
const raw = fs.readFileSync(path.join(root, '.env'), 'utf8');
const local = dotenv.parse(raw);
const exampleRaw = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
const example = dotenv.parse(exampleRaw);
dotenv.config({ path: path.join(root, '.env'), quiet: true });
const cache = require('../services/redisCacheService');
const governor = require('../services/newsGovernanceService');
const catalog = require('../services/newsCatalogService');
const providers = require('../services/newsDiscoveryProviders');
const output = path.join(root, 'verification/tech-news/runtime-audit');
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const privateKey = (key) =>
  /API_KEY|ACCESS_TOKEN|USER_AGENT|NEWS_TEST_(REDIS_URL|MONGODB_URI|REDIS_NAMESPACE)/.test(key);
function consumers(key) {
  if (key === 'NEWS_DISCOVERY_PREWARM_TOPICS')
    return ['config/newsConfig.js: deprecated validation/audit only; no selector consumer'];
  if (key.startsWith('NEWS_TEST_'))
    return [
      key === 'NEWS_TEST_BROWSER'
        ? 'tests/newsFreeText.integration.test.js'
        : key === 'NEWS_TEST_LIVE_PROVIDERS'
          ? 'tests/newsLiveSearch.integration.test.js'
          : key === 'NEWS_TEST_MONGODB_URI'
            ? 'tests/newsCatalog.integration.test.js and isolated Mongo suites'
            : 'tests/fixtures/newsHubRedisFixture.js'
    ];
  if (/RETENTION_HOURS|CATALOG_/.test(key))
    return ['services/newsCatalogService.js: retentionMs/query/predicate'];
  if (/_SHARED_/.test(key)) return ['services/newsGovernanceService.js: sharedPolicy/reserve'];
  if (/_CONTENT_APPROVED$/.test(key))
    return ['services/newsGovernanceService.js: policy', 'services/newsCatalogService.js: sourceAllowed'];
  if (/_(DAILY_BUDGET|MONTHLY_BUDGET|MIN_INTERVAL_MS)$/.test(key))
    return ['services/newsGovernanceService.js: policy/reserve'];
  if (/API_KEY|REDDIT_ACCESS_TOKEN|REDDIT_USER_AGENT/.test(key))
    return ['services/newsService.js: credentials and broad adapters'];
  if (
    key.startsWith('NEWS_PREWARM_') &&
    key !== 'NEWS_PREWARM_EVALUATION_MS' &&
    key !== 'NEWS_PREWARM_RESERVED_USER_JOBS'
  )
    return ['services/newsAdaptiveService.js: select/candidates'];
  if (key === 'NEWS_DISCOVERY_RESULTS_PER_PROVIDER')
    return ['services/newsDiscoveryProviders.js: requestFor (HN/DEV only)'];
  if (key === 'NEWS_INGESTION_ENABLED')
    return [
      'services/newsService.js: startNewsIngestionScheduler',
      'services/newsDiscoveryService.js: startWorker'
    ];
  if (key === 'NEWS_DISCOVERY_ENABLED') return ['services/newsDiscoveryProviders.js: enabled'];
  return ['services/newsDiscoveryService.js: bounded runtime settings, coverage/enqueue/prewarm'];
}
function constraints(key) {
  let schema = newsEnvShape[key];
  while (schema?._def?.innerType) schema = schema._def.innerType;
  return schema
    ? { checks: schema._def.checks || [], allowedValues: schema._def.values || null, optional: true }
    : { optional: true, type: 'optional credential/test string' };
}
function fileAudit(text, parsed) {
  const lines = text.split(/\r?\n/);
  return {
    keys: Object.keys(parsed).length,
    ...auditNewsConfiguration(parsed, text),
    missingComments: entries
      .filter((entry) => {
        const index = lines.findIndex((line) => line.startsWith(entry.key + '='));
        return index < 1 || !lines[index - 1].startsWith('# ');
      })
      .map((entry) => entry.key),
    schemaValid: z.object(newsEnvShape).safeParse(parsed).success
  };
}
async function main() {
  validateNewsRelationships(local);
  const inventory = entries.map((entry) => ({
    key: entry.key,
    group: entry.group,
    configured: Object.hasOwn(local, entry.key),
    nonempty: Boolean(local[entry.key]),
    value: privateKey(entry.key) ? '<redacted>' : local[entry.key],
    exampleValue: privateKey(entry.key) ? '<placeholder>' : example[entry.key],
    templateDefault: privateKey(entry.key) ? '<empty>' : entry.value,
    runtimeDefault: privateKey(entry.key) ? '<empty>' : entry.runtimeDefault,
    constraints: constraints(entry.key),
    consumers: consumers(entry.key),
    purpose: entry.purpose,
    activationRequired: /CONTENT_APPROVED|BUDGET|INGESTION_ENABLED|DISCOVERY_ENABLED/.test(entry.key),
    unused: entry.key === 'NEWS_DISCOVERY_PREWARM_TOPICS'
  }));
  const result = {
    capturedAt: new Date().toISOString(),
    scope: 'read-only configured local runtime; entitlement is not established by a key or approval flag',
    inventory,
    files: {
      local: fileAudit(raw, local),
      example: fileAudit(exampleRaw, example),
      matchingAllKeys:
        JSON.stringify(Object.keys(local).sort()) === JSON.stringify(Object.keys(example).sort()),
      assignmentDigest: hash(local)
    },
    runtime: {},
    requests: []
  };
  assert.equal(inventory.length, 102);
  assert(result.files.matchingAllKeys && result.files.local.schemaValid && result.files.example.schemaValid);
  assert.equal(result.files.local.missingComments.length, 0);
  assert.equal(result.files.example.missingComments.length, 0);
  await mongoose.connect(process.env.MONGODB_URI, { autoIndex: false, serverSelectionTimeoutMS: 5000 });
  await cache.initRedisCache();
  const Article = require('../models/newsArticle');
  const User = require('../models/user');
  const pool = await require('../models/news').findOne({ cacheKey: 'news:v3:public:pool' }).lean();
  const health = await governor.health();
  const redis = cache.getRedisCacheClient({ commandTimeoutMs: 3000 });
  const heartbeat = redis && (await redis.get('news:v1:{discovery}:worker'));
  const state = redis && JSON.parse((await redis.get('news:v1:{discovery}:state:devops')) || 'null');
  const day = new Date().toISOString().slice(0, 10);
  const jobUsage =
    redis &&
    (await redis.eval(
      "return {redis.call('GET', KEYS[1]) or '0', redis.call('GET', KEYS[2]) or '0', redis.call('ZCARD', KEYS[3])}",
      {
        keys: [
          `news:v1:{discovery}:jobs:${day}`,
          `news:v1:{discovery}:prewarm:${day}`,
          'news:v1:{discovery}:queue'
        ],
        arguments: []
      }
    ));
  const available = new Set(providers.available('devops'));
  result.runtime = {
    flags: {
      ingestion: process.env.NEWS_INGESTION_ENABLED === 'true',
      discovery: providers.enabled(),
      prewarm: process.env.NEWS_DISCOVERY_PREWARM_ENABLED === 'true'
    },
    jobBudgets: {
      dailyLimit: Number(local.NEWS_DISCOVERY_DAILY_JOBS),
      dailyUsed: jobUsage ? Number(jobUsage[0]) : null,
      prewarmDailyLimit: Number(local.NEWS_DISCOVERY_PREWARM_DAILY_JOBS),
      prewarmAttemptCounter: jobUsage ? Number(jobUsage[1]) : null,
      reservedUserJobs: Number(local.NEWS_PREWARM_RESERVED_USER_JOBS),
      perAccountMinute: Number(local.NEWS_DISCOVERY_USER_MINUTE_JOBS),
      perAccountDay: Number(local.NEWS_DISCOVERY_USER_DAILY_JOBS),
      queuedJobs: jobUsage ? Number(jobUsage[2]) : null,
      nextUtcDay: new Date(new Date().setUTCHours(24, 0, 0, 0)).toISOString()
    },
    requiredConnections: {
      mongoConnected: mongoose.connection.readyState === 1,
      redisConnected: Boolean(redis),
      jwtPresent: Boolean(local.JWT_SECRET),
      mongoUriPresent: Boolean(local.MONGODB_URI),
      sharedRedisConfigured: Boolean(
        local.REDIS_URL || (local.UPSTASH_REDIS_HOST && local.UPSTASH_REDIS_TOKEN)
      )
    },
    heartbeatAvailable: Boolean(heartbeat),
    heartbeatAgeMs: heartbeat ? Date.now() - Number(heartbeat) : null,
    devopsState: state,
    catalog: {
      total: await Article.countDocuments(),
      devops: await Article.countDocuments({ technologies: 'devops' }),
      indexes: await Article.collection.indexes(),
      retentionHours: Object.fromEntries(
        Object.keys(catalog.SOURCE_KEYS).map((source) => [source, catalog.retentionMs(source) / 3600000])
      )
    },
    poolUpdated: pool?.lastUpdated || null,
    providers: Object.fromEntries(
      Object.entries(health).map(([key, value]) => [
        key,
        {
          ...value,
          credentialsNeeded: ['newsapi', 'gnews', 'reddit'].includes(key),
          credentialPresent:
            key === 'newsapi'
              ? Boolean(local.NEWS_API_KEY)
              : key === 'gnews'
                ? Boolean(local.GNEWS_API_KEY)
                : key === 'reddit'
                  ? Boolean(local.NEWS_REDDIT_ACCESS_TOKEN && local.NEWS_REDDIT_USER_AGENT)
                  : true,
          devopsDiscoveryCapable: available.has(key),
          lastBroadObservation:
            pool?.providerDiagnostics?.find(
              (item) =>
                item.provider ===
                {
                  hackernews: 'Hacker News',
                  devto: 'Dev.to',
                  newsapi: 'NewsAPI',
                  gnews: 'GNews',
                  reddit: 'Reddit',
                  githubreleases: 'GitHub Releases',
                  githubadvisories: 'GitHub Security Advisories',
                  kubernetesblog: 'Kubernetes Blog',
                  lobsters: 'Lobsters',
                  cloudflarechangelog: 'Cloudflare Changelog'
                }[key]
            ) || null,
          entitlement: 'operator documentation/contract not supplied; not certified by configuration'
        }
      ])
    )
  };
  const user = await User.findOne({ role: 'developer', isActive: { $ne: false } });
  assert(user, 'Active local developer required');
  const token = jwt.sign({ id: String(user._id) }, process.env.JWT_SECRET, {
    expiresIn: '5m',
    issuer: process.env.JWT_ISSUER || 'devinsight-api',
    audience: process.env.JWT_AUDIENCE || 'devinsight-web'
  });
  const readsBefore = await governor.health();
  for (const query of [
    'mode=explore&search=devops&date=week&bypassCache=true',
    'mode=explore&search=devops&date=month&page=2&bypassCache=true',
    'mode=explore&search=devops&source=Dev.to&bypassCache=true',
    'mode=personalized&tab=for-you&category=DevOps&search=devops&bypassCache=true'
  ]) {
    const response = await fetch('http://localhost:5000/api/news?' + query, {
      headers: { authorization: 'Bearer ' + token }
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    result.requests.push({
      query,
      http: response.status,
      serverTime: body.serverTime,
      total: body.total,
      items: body.items?.length,
      coverage: body.coverage,
      enrichment: body.enrichment,
      personalizedContext: Boolean(body.recommendedBasedOn),
      catalogVersion: body.telemetry?.catalogVersion
    });
  }
  const readsAfter = await governor.health();
  result.providerCountersUnchangedDuringReads = Object.keys(readsBefore).every((key) =>
    ['dailyUsed', 'monthlyUsed'].every((field) => readsBefore[key][field] === readsAfter[key][field])
  );
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'runtime.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(
    JSON.stringify({
      keys: inventory.length,
      parity: result.files.matchingAllKeys,
      missingComments: result.files.local.missingComments,
      catalog: result.runtime.catalog.total,
      devops: result.runtime.catalog.devops,
      heartbeat: result.runtime.heartbeatAvailable,
      providerCountersUnchanged: result.providerCountersUnchangedDuringReads
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
