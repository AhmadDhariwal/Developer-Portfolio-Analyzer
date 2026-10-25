'use strict';
// Explicit read-only audit. Never loads .env, creates indexes or edits records.
const mongoose = require('mongoose');
const main = async () => {
  if (!process.env.SCENARIO_AUDIT_URI)
    throw new Error('Set SCENARIO_AUDIT_URI explicitly to a read-only connection.');
  try {
    await mongoose.connect(process.env.SCENARIO_AUDIT_URI, {
      autoIndex: false,
      serverSelectionTimeoutMS: 3000,
    });
    const collection = mongoose.connection.db.collection('scenariosimulations');
    const indexes = await collection.indexes({ maxTimeMS: 3000 });
    const duplicates = await collection
      .aggregate(
        [
          { $group: { _id: { userId: '$userId', scenarioHash: '$scenarioHash' }, records: { $sum: 1 } } },
          { $match: { records: { $gt: 1 } } },
          { $count: 'groups' },
        ],
        { maxTimeMS: 5000 },
      )
      .toArray();
    console.log(
      JSON.stringify({ readOnly: true, indexes, duplicateGroups: duplicates[0]?.groups || 0 }, null, 2),
    );
  } finally {
    await mongoose.disconnect();
  }
};
main().catch(() => {
  console.error(
    'Scenario audit unavailable. Verify the explicit read-only connection and database permissions.',
  );
  process.exitCode = 1;
});
