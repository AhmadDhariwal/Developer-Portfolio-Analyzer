// Read-only local acceptance: never admits discovery or changes application quotas.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
const cache = require('../services/redisCacheService');
const governance = require('../services/newsGovernanceService');
const Article = require('../models/newsArticle');
const User = require('../models/user');
const { queryFor, matchesQuery } = require('../utils/newsQuery');
const { matchesTopic } = require('../utils/newsTopics');
const phase = process.argv.includes('--before') ? 'before' : 'after';

async function main() {
  await mongoose.connect(process.env.MONGODB_URI, { autoIndex: false, serverSelectionTimeoutMS: 5000 });
  console.log('Connected to local catalog');
  await cache.initRedisCache({ probeOnly: true });
  const user = await User.findOne({ role: 'developer', isActive: { $ne: false } });
  assert(user, 'Active local developer required');
  const token = jwt.sign({ id: String(user._id) }, process.env.JWT_SECRET, {
    expiresIn: '10m',
    issuer: process.env.JWT_ISSUER || 'devinsight-api',
    audience: process.env.JWT_AUDIENCE || 'devinsight-web'
  });
  const redis = cache.getRedisCacheClient({ commandTimeoutMs: 1500 });
  const day = new Date().toISOString().slice(0, 10);
  const counters = async () => ({
    global: await redis?.get(`news:v1:{discovery}:jobs:${day}`).catch(() => 'unavailable'),
    prewarm: await redis?.get(`news:v1:{discovery}:prewarm:${day}`).catch(() => 'unavailable'),
    providers: await governance.health()
  });
  const records = await Article.find().lean();
  const result = {
    phase,
    at: new Date().toISOString(),
    catalog: records.length,
    indexes: await Article.collection.indexes(),
    before: await counters(),
    responses: []
  };
  result.budgets = Object.fromEntries(
    [
      'NEWS_DISCOVERY_DAILY_JOBS',
      'NEWS_DISCOVERY_USER_MINUTE_JOBS',
      'NEWS_DISCOVERY_USER_DAILY_JOBS',
      'NEWS_DISCOVERY_PREWARM_DAILY_JOBS',
      'NEWS_PREWARM_RESERVED_USER_JOBS',
      'NEWS_PREWARM_STRATEGY'
    ].map((key) => [key, process.env[key]])
  );
  result.workerHeartbeat = await redis
    ?.get('news:v1:{discovery}:worker')
    .then((value) => ({
      present: Boolean(value),
      ageMs: value ? Date.now() - Number(value) : null
    }))
    .catch(() => ({ unavailable: true }));
  result.searchIndexAudit = ['kubernets', 'kubernetes', 'k8s', 'devops', 'EC2', 'generative ai'].map(
    (search) => {
      const parsed = queryFor(search);
      const matches = records.filter((doc) => matchesQuery(doc.article, search));
      return {
        search,
        textMatchesAcrossRetainedCatalog: matches.length,
        missingTechnologyTags: parsed.topic
          ? records.filter(
              (doc) => matchesTopic(doc.article, parsed.topic) && !doc.technologies.includes(parsed.topic)
            ).length
          : 0,
        missingSearchTerms: matches.filter((doc) =>
          parsed.topic
            ? !doc.searchTerms.includes(parsed.topic)
            : !parsed.groups.every((group) => group.some((term) => doc.searchTerms.includes(term)))
        ).length,
        examples: matches
          .slice(0, 2)
          .map((doc) => ({ title: doc.article.title, source: doc.source, technologies: doc.technologies }))
      };
    }
  );
  for (const search of ['kubernets', 'kubernetes', 'k8s', 'devops', 'EC2', 'generative ai']) {
    for (const date of ['week', 'month']) {
      const params = new URLSearchParams({
        mode: 'explore',
        tab: 'latest',
        search,
        date,
        bypassCache: 'true'
      });
      const response = await fetch(`http://localhost:5000/api/news?${params}`, {
        signal: AbortSignal.timeout(20000),
        headers: { authorization: `Bearer ${token}` }
      });
      const body = await response.json();
      assert.equal(response.status, 200);
      result.responses.push({
        search,
        date,
        query: queryFor(search),
        http: response.status,
        total: body.total,
        items: body.items?.map(({ title, source, url }) => ({ title, source, url })),
        coverage: body.coverage,
        enrichment: body.enrichment,
        serverTime: body.serverTime
      });
    }
  }
  result.after = await counters();
  result.countersUnchanged =
    result.before.global === result.after.global &&
    result.before.prewarm === result.after.prewarm &&
    Object.keys(result.before.providers).every((key) =>
      ['dailyUsed', 'monthlyUsed'].every(
        (field) => result.before.providers[key][field] === result.after.providers[key][field]
      )
    );
  const output = path.resolve(__dirname, '../../verification/tech-news/flow-audit');
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, `api-${phase}.json`), JSON.stringify(result, null, 2) + '\n');
  console.log(
    JSON.stringify({
      phase,
      catalog: result.catalog,
      countersUnchanged: result.countersUnchanged,
      global: result.before.global,
      prewarm: result.before.prewarm,
      responses: result.responses.map(({ search, date, http, total, coverage }) => ({
        search,
        date,
        http,
        total,
        coverage
      }))
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
