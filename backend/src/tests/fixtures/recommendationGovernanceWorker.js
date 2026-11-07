'use strict';
const mongoose = require('mongoose');
process.once('message', async ({ uri, owner, ip }) => {
  try {
    if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/integration_live_acceptance\?replicaSet=/.test(uri))
      throw Error('Disposable loopback database required.');
    await mongoose.connect(uri);
    const controls = require('../../services/recommendationGovernanceService');
    const statuses = [];
    for (let index = 0; index < 2; index++) {
      try {
        await controls.consume(owner, ip, ['guest']);
        statuses.push(200);
      } catch (error) {
        statuses.push(error.status || 500);
      }
    }
    process.send({ statuses });
  } catch (error) {
    process.send({ error: error.message });
  } finally {
    await mongoose.disconnect();
    process.disconnect();
  }
});
