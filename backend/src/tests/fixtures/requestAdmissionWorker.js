'use strict';
const mongoose = require('mongoose');
const store = require('../../services/integrationMongoGovernanceService');
if (
  !/^mongodb:\/\/127\.0\.0\.1:\d+\/integration_live_acceptance\?replicaSet=integration-live$/.test(
    process.env.REQUEST_ADMISSION_TEST_URI || ''
  )
)
  throw Error('Disposable loopback replica set required.');
require('../../services/redisCacheService').getRedisCacheClient = () => {
  throw Error('Admission cannot access Redis.');
};
mongoose
  .connect(process.env.REQUEST_ADMISSION_TEST_URI, { autoIndex: false })
  .then(() => process.send({ ready: true }));
process.on('message', async (message) => {
  try {
    const value = await store.requestWindow(message.prefix, message.maximum, message.windowMs);
    process.send({ id: message.id, value });
  } catch (error) {
    process.send({ id: message.id, error: { status: error.status } });
  }
});
