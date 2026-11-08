'use strict';
// Explicit read-only audit by default. Never load .env or delete snapshots.
const mongoose = require('mongoose');
const UNIQUE_KEY = { userId: 1, scenarioHash: 1 };
const HISTORY_KEY = { userId: 1, createdAt: -1, _id: -1 };
const matches = (index, key) => JSON.stringify(index.key) === JSON.stringify(key);
const usableUnique = (index) =>
  matches(index, UNIQUE_KEY) && index.unique && !index.sparse && !index.partialFilterExpression;
async function audit(collection) {
  const indexes = await collection.indexes({ maxTimeMS: 3000 });
  const duplicates = await collection
    .aggregate(
      [
        {
          $group: { _id: { userId: '$userId', scenarioHash: '$scenarioHash' }, count: { $sum: 1 } },
        },
        { $match: { count: { $gt: 1 } } },
        { $count: 'groups' },
      ],
      { maxTimeMS: 5000 },
    )
    .toArray();
  return {
    indexes,
    duplicateGroups: duplicates[0]?.groups || 0,
    uniqueReady: indexes.some(usableUnique),
    historyReady: indexes.some((index) => matches(index, HISTORY_KEY)),
  };
}
async function migrate(collection, { apply = false } = {}) {
  const before = await audit(collection);
  if (!apply) return { readOnly: true, ...before };
  if (before.duplicateGroups)
    throw new Error(
      'Duplicate snapshots require reviewed preservation/reconciliation before index application.',
    );
  if (!before.uniqueReady)
    await collection.createIndex(UNIQUE_KEY, { name: 'scenario_unique_owner_hash', unique: true });
  if (!before.historyReady)
    await collection.createIndex(HISTORY_KEY, { name: 'scenario_history_cursor' });
  return { readOnly: false, ...(await audit(collection)) };
}
async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--apply')) throw new Error('Unsupported migration option.');
  const apply = args.includes('--apply');
  const uri = apply ? process.env.SCENARIO_MIGRATION_URI : process.env.SCENARIO_AUDIT_URI;
  if (!uri) throw new Error('Set an explicit Scenario audit/migration URI.');
  try {
    await mongoose.connect(uri, {
      autoIndex: false,
      autoCreate: false,
      serverSelectionTimeoutMS: 3000,
    });
    console.log(
      JSON.stringify(
        await migrate(mongoose.connection.db.collection('scenariosimulations'), { apply }),
        null,
        2,
      ),
    );
  } finally {
    await mongoose.disconnect();
  }
}
if (require.main === module)
  main().catch(() => {
    console.error(
      'Scenario index audit/application failed. Check explicit credentials, duplicates and index permissions; no snapshots were deleted.',
    );
    process.exitCode = 1;
  });
module.exports = { audit, migrate };
