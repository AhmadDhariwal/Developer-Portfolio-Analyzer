'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { MongoClient, ObjectId } = require('mongodb');
const { start } = require('./fixtures/scenarioMongo');
const { migrate } = require('../scripts/migrateScenarioSimulationUniqueIndex');

test('migration audits without deleting history, refuses duplicates, and applies existing index contracts only on request', async (t) => {
  const mongo = await start();
  const client = new MongoClient(mongo.uri);
  t.after(async () => {
    await client.close();
    await mongo.stop();
  });
  await client.connect();
  const duplicate = client.db().collection('duplicate_snapshots');
  const owner = new ObjectId();
  await duplicate.insertMany([
    { userId: owner, scenarioHash: 'same', result: { score: 1 } },
    { userId: owner, scenarioHash: 'same', result: { score: 2 } },
  ]);
  const before = await duplicate.find().toArray();
  const readOnly = await migrate(duplicate);
  assert.equal(readOnly.readOnly, true);
  assert.equal(readOnly.duplicateGroups, 1);
  assert.equal((await duplicate.indexes()).length, 1);
  await assert.rejects(migrate(duplicate, { apply: true }), /preservation/);
  assert.deepEqual(await duplicate.find().toArray(), before);

  const collection = client.db().collection('index_snapshots');
  await collection.createIndex({ userId: 1, scenarioHash: 1 });
  const other = new ObjectId();
  await collection.insertMany(
    Array.from({ length: 1020 }, (_, index) => ({
      userId: index < 20 ? owner : other,
      scenarioHash: String(index),
      createdAt: new Date(1700000000000 + index),
    })),
  );
  const beforeIndexes = await collection.indexes();
  assert.equal((await migrate(collection)).uniqueReady, false);
  assert.deepEqual(await collection.indexes(), beforeIndexes);
  const applied = await migrate(collection, { apply: true });
  assert(applied.uniqueReady && applied.historyReady);
  assert.equal(await collection.countDocuments(), 1020);
  assert.deepEqual(await migrate(collection, { apply: true }), applied);
  const history = await collection
    .find({ userId: owner })
    .sort({ createdAt: -1, _id: -1 })
    .limit(5)
    .explain('executionStats');
  const identity = await collection
    .find({ userId: owner, scenarioHash: '1' })
    .explain('executionStats');
  for (const plan of [history, identity]) {
    assert(!JSON.stringify(plan.queryPlanner.winningPlan).includes('COLLSCAN'));
    assert(plan.executionStats.totalDocsExamined <= 5);
  }
  t.diagnostic(
    JSON.stringify({
      disposable: true,
      syntheticIndexDocuments: 1020,
      history: history.executionStats,
      identity: identity.executionStats,
    }),
  );
});
