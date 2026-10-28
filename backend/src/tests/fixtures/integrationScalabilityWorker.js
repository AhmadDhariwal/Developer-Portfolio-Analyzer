'use strict';
const mongoose = require('mongoose');
const fs = require('node:fs');
const path = require('node:path');
if (
  !/^mongodb:\/\/127\.0\.0\.1:\d+\/integration_live_acceptance(?:_baseline)?\?replicaSet=integration-live$/.test(
    process.env.INTEGRATION_TEST_URI || ''
  )
)
  throw Error('Disposable endpoint required');
const governance = require('../../services/integrationGovernanceService');
const snapshots = require('../../services/integrationPublicSnapshotService');
const { getAdapter } = require('../../services/integrations');
const captured = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, '../../../verification/integrations/real-provider-live-followup.json')
  )
)
  .providers.find((row) => row.provider === 'leetcode')
  .requests.at(-1).sample;
let calls = 0,
  redisCommands = 0,
  conflicts = 0,
  commands = 0;
const durations = [];
require('../../services/redisCacheService').getRedisCacheClient = () => {
  redisCommands++;
  throw Error('Optional Redis unavailable');
};
require('axios').post = async (url, data) => {
  if (url !== 'https://leetcode.com/graphql') throw Error('Unexpected provider boundary');
  calls++;
  await mongoose.connection
    .collection('scalabilityFixtureCalls')
    .updateOne({ _id: 'leetcode' }, { $inc: { count: 1 } }, { upsert: true });
  await new Promise((resolve) => setTimeout(resolve, 15));
  return { data: { data: { matchedUser: { ...captured, username: data.variables.username } } } };
};
mongoose
  .connect(process.env.INTEGRATION_TEST_URI, {
    autoIndex: false,
    monitorCommands: true,
    maxPoolSize: 8
  })
  .then(async () => {
    const client = mongoose.connection.getClient();
    client.on('commandStarted', () => commands++);
    client.on('commandSucceeded', (event) => {
      if (durations.length < 50000) durations.push(event.duration);
    });
    client.on('commandFailed', (event) => {
      if (event.failure?.code === 112) conflicts++;
    });
    await require('../../services/integrationMongoGovernanceService').initialize();
    await snapshots.initialize();
    process.send({ ready: true });
  })
  .catch(() => process.send({ ready: false }));
process.on('message', async (message) => {
  try {
    let value;
    if (message.action === 'ingest' || message.action === 'baseline') {
      const start = performance.now();
      try {
        const observation = await governance.run(message.owner, () =>
          message.action === 'baseline'
            ? getAdapter('leetcode').ingestData({ externalUsername: message.username })
            : snapshots.ingest(getAdapter('leetcode'), { externalUsername: message.username })
        );
        value = {
          status: 200,
          username: observation.profile.username,
          ms: performance.now() - start
        };
      } catch (error) {
        value = { status: error.status || 502, ms: performance.now() - start };
      }
    } else if (message.action === 'stats') {
      value = {
        calls,
        redisCommands,
        conflicts,
        commands,
        durations,
        memory: process.memoryUsage()
      };
    } else if (message.action === 'stop') {
      await mongoose.disconnect();
      process.send({ id: message.id, value: true }, () => process.exit(0));
      return;
    } else throw Error('Unknown action');
    process.send({ id: message.id, value });
  } catch (error) {
    process.send({ id: message.id, error: error.message });
  }
});
