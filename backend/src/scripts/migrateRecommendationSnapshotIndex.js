'use strict';

const migrate = async (Recommendation) =>
  Recommendation.collection.createIndex(
    { userId: 1, snapshotVersion: 1, contextHash: 1 },
    {
      name: 'recommendation_evidence_snapshot',
      unique: true,
      partialFilterExpression: { snapshotVersion: 'recommendations-evidence-v1' },
    },
  );

if (require.main === module) {
  require('dotenv').config();
  const mongoose = require('mongoose');
  (async () => {
    try {
      await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
      console.log(await migrate(require('../models/recommendation')));
    } finally {
      await mongoose.disconnect();
    }
  })().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { migrate };
