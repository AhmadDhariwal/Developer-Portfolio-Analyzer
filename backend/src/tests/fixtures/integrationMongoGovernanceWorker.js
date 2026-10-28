'use strict';
const mongoose = require('mongoose');
if (
  !/^mongodb:\/\/127\.0\.0\.1:\d+\/integration_live_acceptance\?replicaSet=integration-live$/.test(
    process.env.INTEGRATION_TEST_URI || ''
  )
)
  throw Error('Disposable Mongo governance endpoint required.');
const governance = require('../../services/integrationGovernanceService');
const store = require('../../services/integrationMongoGovernanceService');
const cache = require('../../services/redisCacheService');
cache.getRedisCacheClient = () => {
  throw Error('Mongo governance must never access Redis.');
};
mongoose.connect(process.env.INTEGRATION_TEST_URI, { autoIndex: false }).then(
  () => process.send({ ready: true }),
  () => process.send({ ready: false })
);
process.on('message', async (message) => {
  try {
    let value;
    switch (message.action) {
      case 'reserve':
        value = await governance.reserve(
          message.provider,
          message.owner,
          message.duration || 60000
        );
        break;
      case 'release':
        await governance.finish(message.reservation);
        value = true;
        break;
      case 'job':
        value = await governance.withJob(message.provider, async () => {
          await new Promise((resolve) => setTimeout(resolve, 100));
          return true;
        });
        break;
      case 'cache': {
        const snapshot = await require('../../models/integrationInsight')
          .findOne({ userId: message.owner })
          .lean();
        const sprint = { _id: 'mongo-governance-fixture', userId: message.owner, tasks: [] };
        const counters = { memoryHits: 0, redisHits: 0, redisWrites: 0, pipelineExecutions: 0 };
        const result = await require('../../services/sprintOverviewCacheService').load(
          sprint,
          null,
          async () => ({ ...sprint, revision: snapshot?.updatedAt?.toISOString() || null }),
          counters,
          false,
          { integrationRevision: snapshot?.updatedAt || null }
        );
        value = { result, counters };
        break;
      }
      case 'initialize':
        await store.initialize();
        value = true;
        break;
      case 'stop':
        await mongoose.disconnect();
        process.send({ id: message.id, value: true }, () => process.exit(0));
        return;
      default:
        throw Error('Unknown fixture action.');
    }
    process.send({ id: message.id, value });
  } catch (error) {
    process.send({ id: message.id, error: { message: error.message, status: error.status } });
  }
});
