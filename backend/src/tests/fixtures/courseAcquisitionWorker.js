'use strict';

const mongoose = require('mongoose');
const acquisition = require('../../services/courseCatalogAcquisitionService');
const seed = require('../../data/courseAcquisitionCatalog');
const uri = process.env.COURSE_ACQUISITION_TEST_MONGO;
if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/integration_live_acceptance\?/.test(uri || ''))
  throw Error('Only the owned disposable Mongo fixture is allowed.');
(async () => {
  await mongoose.connect(uri);
  process.on('message', async (message) => {
    if (message === 'stop') {
      await mongoose.disconnect();
      process.exit(0);
    }
    if (message !== 'refresh') return;
    try {
      const result = await acquisition.refresh({
        fetchJson: async (url) => {
          await mongoose.connection.db
            .collection('acquisition_fixture_calls')
            .updateOne({ _id: 'calls' }, { $inc: { count: 1 } }, { upsert: true });
          await new Promise((resolve) => setTimeout(resolve, 60));
          return url === acquisition.SOURCES[0]
            ? {
                superblocks: seed.fcc.map((entry) => entry.manifestSlug || entry.slug),
              }
            : Object.fromEntries(seed.fcc.map((entry) => [entry.slug, { title: entry.title }]));
        },
      });
      process.send({ result });
    } catch (error) {
      process.send({ error: error.name });
    }
  });
  process.send({ ready: true });
})().catch((error) => {
  process.send?.({ error: error.name });
  process.exit(1);
});
