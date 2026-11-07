'use strict';

// One bounded query, with real shared admission and no retries or database mutations.
const fs = require('node:fs');
const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
const axios = require('axios');
const cache = require('../services/redisCacheService');
const governance = require('../services/integrationGovernanceService');
const hashnode = require('../services/integrations/hashnodePublication');

async function main() {
  const name = process.argv.find((value) => value.startsWith('--output='))?.slice(9);
  if (!name || !/^[a-z0-9-]+\.json$/.test(name))
    throw Error('An explicit safe evidence filename is required.');
  const output = path.resolve(__dirname, '../../verification/integrations', name);
  if (fs.existsSync(output))
    throw Error('Evidence already exists; do not repeat the live query or overwrite evidence.');
  const result = {
    checkedAt: new Date().toISOString(),
    endpoint: 'https://gql-beta.hashnode.com',
    config: {
      HASHNODE_PAT: Boolean(String(process.env.HASHNODE_PAT || '').trim()),
      HASHNODE_PUBLICATION_HOST: Boolean(
        String(process.env.HASHNODE_PUBLICATION_HOST || '').trim()
      ),
      validation: hashnode.validateConfig()
    },
    outboundArticleQueries: 0,
    status: 'BLOCKED',
    stages: {
      fetch: 'BLOCKED',
      normalize: 'BLOCKED',
      mongo: 'BLOCKED',
      sync: 'BLOCKED',
      downstream: 'BLOCKED',
      disconnect: 'NOT_RUN'
    },
    databaseMutations: 0
  };
  const interceptor = axios.interceptors.request.use((config) => {
    if (config.url === result.endpoint) {
      result.outboundArticleQueries++;
      if (result.outboundArticleQueries > 1)
        throw Error('Only one live article query is permitted.');
    }
    return config;
  });
  try {
    if (!result.config.validation.ok) {
      result.reason = 'HASHNODE_CONFIGURATION_INVALID';
      return;
    }
    const redis = await cache.initRedisCache({ silent: true, probeOnly: true });
    result.redisReady = Boolean(redis);
    if (!redis) {
      result.reason = 'SHARED_REDIS_ADMISSION_UNAVAILABLE';
      return;
    }
    const observed = await governance.withJob('devblogs', () =>
      governance.run('hashnode-live-acceptance', () => hashnode.fetch())
    );
    result.status = 'FETCH_PASS';
    result.reason = 'ONE_AUTHENTICATED_OWNED_PRO_PUBLICATION_READ_SUCCEEDED';
    result.stages.fetch = 'PASS';
    result.observed = {
      publicationPostCount: observed.publicationPostCount,
      sampledPublicationPosts: observed.observedPublicationPosts,
      authoredArticles: observed.articles.length,
      excludedOtherAuthors: observed.observedPublicationPosts - observed.articles.length,
      hasMore: observed.hasMorePublicationPosts,
      reactions: observed.articles.reduce((sum, article) => sum + article.reactions, 0),
      tags: [...new Set(observed.articles.flatMap((article) => article.tags))],
      timestampsValid: observed.articles.every((article) =>
        Number.isFinite(Date.parse(article.publishedAt))
      )
    };
    // Public article observations only, retained for offline downstream verification without
    // another live request. Never include headers, the PAT or the configured host value.
    result.publicObservation = observed;
  } catch (error) {
    const allowed = [
      'HASHNODE_PRO_REQUIRED',
      'HASHNODE_AUTH_FAILED',
      'HASHNODE_OWNER_MISMATCH',
      'HASHNODE_READ_FAILED'
    ];
    result.reason = allowed.includes(error.code)
      ? error.code
      : 'LIVE_READ_OR_SHARED_ADMISSION_FAILED';
    // This is the adapter's classified status, not the upstream HTTP transport status.
    result.classifiedStatus = Number.isInteger(error.status) ? error.status : null;
    result.upstreamHttpStatus = null;
    result.requiresPro = error.code === 'HASHNODE_PRO_REQUIRED';
  } finally {
    axios.interceptors.request.eject(interceptor);
    await cache.closeRedisCache();
    fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
    const { publicObservation, ...summary } = result;
    console.log(JSON.stringify(summary, null, 2));
  }
}

main().catch(() => {
  console.error('Hashnode verification could not finish; no sensitive error details were printed.');
  process.exitCode = 1;
});
