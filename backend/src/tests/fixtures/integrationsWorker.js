'use strict';
const mongoose = require('mongoose');
const cache = require('../../services/redisCacheService');
if (
  !/^mongodb:\/\/127\.0\.0\.1:\d+\/integration_acceptance\?replicaSet=integration-test$/.test(
    process.env.INTEGRATION_TEST_URI || ''
  ) ||
  !/^redis:\/\/127\.0\.0\.1:\d+$/.test(process.env.REDIS_URL || '')
)
  throw Error('Disposable endpoints required.');
const persistence = require('../../services/integrationPersistenceService');
const sync = require('../../services/integrationSyncService');
const { getAdapter } = require('../../services/integrations');
const Connection = require('../../models/integrationConnection');
const Insight = require('../../models/integrationInsight');
const controller = require('../../controllers/integrationscontroller');
getAdapter('github').refreshAccessToken = async () => {
  await Connection.db
    .collection('fixtureRefreshCounts')
    .updateOne({ _id: 'refresh' }, { $inc: { count: 1 } }, { upsert: true });
  await new Promise((resolve) => setTimeout(resolve, 100));
  return {
    accessToken: 'rotated-fixture-token',
    refreshToken: 'rotated-fixture-refresh',
    expiresIn: 3600
  };
};
getAdapter('github').ingestData = async () => ({
  profile: { publicRepos: 10, followers: 20 },
  activity: { starsReceived: 20 },
  inferredSkills: ['JavaScript']
});
getAdapter('leetcode').ingestData = async () => {
  await new Promise((resolve) => setTimeout(resolve, 200));
  return {
    profile: { solvedProblems: 100 },
    activity: { easy: 20, medium: 20, hard: 20 },
    inferredSkills: ['Algorithms']
  };
};
Promise.all([
  mongoose.connect(process.env.INTEGRATION_TEST_URI, { autoIndex: false }),
  cache.initRedisCache({ silent: true })
]).then(
  () => process.send({ ready: true }),
  () => process.send({ ready: false })
);
process.on('message', async (message) => {
  try {
    let value;
    switch (message.action) {
      case 'sync':
        value = await sync.syncProviderForUser(
          message.owner,
          message.provider || 'leetcode',
          'worker-test'
        );
        break;
      case 'claim':
        value = await persistence.claim(message.owner, message.provider || 'leetcode');
        break;
      case 'commit':
        value = await persistence.commit(
          { ...message.connection, leaseUntil: new Date(message.connection.leaseUntil) },
          message.insight,
          { reason: 'worker-test' }
        );
        break;
      case 'disconnect':
        value = await persistence.disconnect(message.owner, message.provider || 'leetcode');
        break;
      case 'read':
        value = await require('../../services/integrationInsightService').getIntegrationInsight(
          message.owner
        );
        break;
      case 'cache': {
        const snapshot = await Insight.findOne({ userId: message.owner }).lean();
        const service = require('../../services/sprintOverviewCacheService');
        const sprint = {
          _id: 'sprint-test',
          userId: message.owner,
          tasks: [],
          calendarVersion: 'unknown'
        };
        const counters = { pipelineExecutions: 0, memoryHits: 0, redisHits: 0, redisWrites: 0 };
        value = await service.load(
          sprint,
          null,
          async () => ({ ...sprint, score: snapshot?.integrationScore || 0 }),
          counters,
          false,
          { integrationRevision: snapshot?.updatedAt || null }
        );
        break;
      }
      case 'webhook': {
        const response = {
          statusCode: 200,
          status(code) {
            this.statusCode = code;
            return this;
          },
          json(body) {
            this.body = body;
            return this;
          }
        };
        await controller.githubWebhook(
          { headers: message.headers, body: message.body, rawBody: Buffer.from(message.raw) },
          response
        );
        value = { status: response.statusCode, body: response.body };
        break;
      }
      case 'stop':
        await cache.closeRedisCache();
        await mongoose.disconnect();
        process.send({ id: message.id, value: true }, () => process.exit(0));
        return;
      default:
        throw Error('Unsupported worker action.');
    }
    process.send({ id: message.id, value });
  } catch (error) {
    process.send({ id: message.id, error: { message: error.message, status: error.status } });
  }
});
