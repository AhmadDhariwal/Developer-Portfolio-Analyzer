// Representative real query plans on a disposable server, never application data.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { startMongo } = require('../tests/fixtures/disposableRequestMongo');

async function main() {
  const output = path.resolve(__dirname, '../../verification/interview-prep/release-finalization/index-plans.json');
  if (fs.existsSync(output)) throw Error('Refusing to overwrite retained evidence');
  const mongo = await startMongo({ replicaSet: 'release-index-audit' });
  const report = {
    scope: 'Disposable MongoDB; representative current admission queries, not staging query statistics',
    plans: []
  };
  try {
    await mongoose.connect(mongo.uri, { dbName: 'release_index_audit' });
    const AI = require('../models/aiProviderAdmission');
    const Governance = require('../models/integrationGovernanceState');
    const expiresAt = new Date(Date.now() + 600000);
    for (const model of [AI, Governance]) {
      await model.createIndexes();
      await model.insertMany(Array.from({ length: 1024 }, (_, i) => ({ _id: `fixture:${i}`, count: 1, expiresAt })));
      const indexes = await model.collection.listIndexes().toArray();
      assert.ok(indexes.some((index) => index.key.expiresAt === 1 && index.expireAfterSeconds === 0));
      const patterns =
        model === AI
          ? [
              ['quota', { _id: 'fixture:1', count: { $lt: 3 } }],
              ['lease', { _id: 'fixture:1', expiresAt: { $lte: new Date() } }],
              ['fenced-release', { _id: 'fixture:1', token: 'non-owner' }],
              ['circuit', { _id: 'fixture:1' }]
            ]
          : [
              ['single-state-read', { _id: 'fixture:1' }],
              ['batch-state-read', { _id: { $in: ['fixture:1', 'fixture:2'] } }],
              ['fixed-window-read', { _id: 'fixture:1' }],
              ['replace-state-filter', { _id: 'fixture:1' }]
            ];
      for (const [operation, predicate] of patterns) {
        const plan = await model.collection.find(predicate).explain('executionStats');
        assert.ok(!JSON.stringify(plan.queryPlanner.winningPlan).includes('COLLSCAN'));
        const bound = predicate._id.$in?.length || 1;
        assert.ok(plan.executionStats.totalDocsExamined <= bound);
        report.plans.push({
          model: model.modelName,
          operation,
          indexes,
          executionStats: plan.executionStats,
          winningPlan: plan.queryPlanner.winningPlan
        });
      }
    }
    report.status = 'PASS';
  } finally {
    await mongoose.disconnect();
    report.cleanup = await mongo.stop();
    fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  }
  console.log(JSON.stringify({ status: report.status, plans: report.plans.length, cleanup: report.cleanup }));
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
