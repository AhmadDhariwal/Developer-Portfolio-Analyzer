// Read-only local catalog/admission inspection and authenticated feed acceptance.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
const cache = require('../services/redisCacheService');
const governance = require('../services/newsGovernanceService');
const catalog = require('../services/newsCatalogService');
const Article = require('../models/newsArticle');
const User = require('../models/user');
const { matchesTopic } = require('../utils/newsTopics');
const phase = process.argv.includes('--before') ? 'before' : 'after';
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI, { autoIndex: false, serverSelectionTimeoutMS: 5000 });
  await cache.initRedisCache();
  const user = await User.findOne({ role: 'developer', isActive: { $ne: false } });
  assert(user, 'An active local developer is required');
  const token = jwt.sign({ id: String(user._id) }, process.env.JWT_SECRET, {
    expiresIn: '5m',
    issuer: process.env.JWT_ISSUER || 'devinsight-api',
    audience: process.env.JWT_AUDIENCE || 'devinsight-web'
  });
  const redis = cache.getRedisCacheClient({ commandTimeoutMs: 3000 });
  const heartbeat = redis && (await redis.get('news:v1:{discovery}:worker'));
  const records = await Article.find().lean();
  const tagged = records.filter((doc) => doc.technologies.includes('devops'));
  const inferred = records.filter((doc) => matchesTopic(doc.article, 'devops'));
  const filters = {
    mode: 'explore',
    tab: 'latest',
    search: 'devops',
    category: 'All',
    source: 'All',
    dateRange: 'week',
    popularity: 'all',
    page: 1,
    limit: 12
  };
  const plan = await Article.find(catalog.predicate(filters)).explain('executionStats');
  const result = {
    phase,
    catalog: {
      total: records.length,
      devopsTagged: tagged.length,
      devopsTextMatches: inferred.length,
      missingDevopsTags: inferred.filter((doc) => !doc.technologies.includes('devops')).length,
      missingSearchTerms: tagged.filter((doc) => !doc.searchTerms.includes('devops')).length,
      sources: [...new Set(tagged.map((doc) => doc.source))],
      examples: tagged
        .slice(0, 3)
        .map((doc) => ({ title: doc.article.title, url: doc.article.url, technologies: doc.technologies })),
      indexes: await Article.collection.indexes(),
      plan: plan.queryPlanner.winningPlan
    },
    worker: {
      heartbeatAvailable: Boolean(heartbeat),
      heartbeatAgeMs: heartbeat ? Date.now() - Number(heartbeat) : null,
      state: redis ? JSON.parse((await redis.get('news:v1:{discovery}:state:devops')) || 'null') : null
    },
    providersBefore: await governance.health(),
    responses: []
  };
  for (const query of [
    'mode=personalized&tab=for-you&date=week&bypassCache=true',
    'mode=personalized&tab=for-you&date=week&category=DevOps&search=devops&bypassCache=true',
    'mode=explore&tab=latest&search=devops&date=week&bypassCache=true',
    'mode=explore&tab=latest&search=devops&date=month&bypassCache=true',
    'mode=explore&tab=latest&search=devops&date=month&category=Frontend&bypassCache=true'
  ]) {
    const response = await fetch('http://localhost:5000/api/news?' + query, {
      headers: { authorization: 'Bearer ' + token }
    });
    const body = await response.json();
    result.responses.push({
      query,
      http: response.status,
      total: body.total,
      items: body.items?.length,
      itemOrderHash: digest(body.items?.map((item) => item.id)),
      contextPresent: Boolean(body.recommendedBasedOn),
      scoredItems: body.items?.filter((item) => Number.isFinite(item.rankScore)).length,
      evidenceItems: body.items?.filter((item) => Array.isArray(item.relatedSkillEvidence)).length,
      coverage: body.coverage,
      enrichment: body.enrichment,
      telemetry: body.telemetry
    });
    assert.equal(response.status, 200);
  }
  result.providersAfter = await governance.health();
  result.providerCountersUnchanged = Object.keys(result.providersBefore).every((key) =>
    ['dailyUsed', 'monthlyUsed'].every(
      (field) => result.providersBefore[key][field] === result.providersAfter[key][field]
    )
  );
  if (phase === 'after') {
    assert.equal(result.responses[0].total, result.responses[1].total);
    assert.equal(result.responses[0].itemOrderHash, result.responses[1].itemOrderHash);
    assert(result.responses[2].total > 0 && result.responses[2].items > 0);
    assert.equal(
      result.responses[4].coverage.filterExcludedMatches,
      result.responses[4].coverage.broaderMatches - result.responses[4].total
    );
  }
  const output = path.resolve(__dirname, '../../verification/tech-news/search-corrections');
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, `api-${phase}.json`), JSON.stringify(result, null, 2) + '\n');
  console.log(
    JSON.stringify({
      phase,
      catalog: result.catalog.total,
      devops: tagged.length,
      heartbeat: result.worker,
      responses: result.responses.map(({ query, http, total, items }) => ({ query, http, total, items })),
      providerCountersUnchanged: result.providerCountersUnchanged
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
