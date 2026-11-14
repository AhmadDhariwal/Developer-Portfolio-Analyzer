'use strict';
const mongoose = require('mongoose');
// Explicit operator tool: dry-run explains only. No syncIndexes, drops or history backfill.
async function inspect(db, { apply = false } = {}) {
  const connections = db.collection('integrationconnections');
  const logs = db.collection('integrationsynclogs');
  const now = new Date();
  const sample = await connections.findOne({}, { projection: { userId: 1 } });
  const representativeOwner =
    sample?.userId || new mongoose.Types.ObjectId('000000000000000000000000');
  const queries = {
    callback: () =>
      connections
        .find({
          provider: 'github',
          oauthState: 'readonly-index-audit',
          oauthStateExpiresAt: { $gt: now }
        })
        .limit(1)
        .explain('executionStats'),
    webhook: () =>
      connections
        .find({
          provider: 'github',
          externalAccountId: 'readonly-index-audit',
          ownershipVerified: true,
          status: { $in: ['connected', 'error'] }
        })
        .limit(100)
        .explain('executionStats'),
    polling: () =>
      connections
        .find(require('../services/integrationSyncService').buildDueConnectionFilter(now))
        .sort({ nextSyncAt: 1 })
        .limit(10)
        .explain('executionStats'),
    history: () =>
      logs
        .find({
          userId: representativeOwner,
          createdAt: { $gte: new Date(Date.now() - 86400000) }
        })
        .sort({ createdAt: -1 })
        .limit(5000)
        .explain('executionStats'),
    retention: () =>
      logs
        .find({ expiresAt: { $lte: now } })
        .limit(100)
        .explain('executionStats')
  };
  const before = {};
  for (const [name, query] of Object.entries(queries)) before[name] = await query();
  if (apply) {
    await connections.createIndex({ status: 1, nextSyncAt: 1 }, { name: 'integration_due_v1' });
    await connections.createIndex(
      { provider: 1, oauthState: 1 },
      { name: 'integration_oauth_state_v1', partialFilterExpression: { oauthState: { $gt: '' } } }
    );
    await connections.createIndex(
      { provider: 1, externalAccountId: 1 },
      {
        name: 'integration_webhook_identity_v1',
        partialFilterExpression: { ownershipVerified: true }
      }
    );
    await logs.createIndex({ userId: 1, createdAt: -1 }, { name: 'integration_history_v1' });
    await logs.createIndex(
      { expiresAt: 1 },
      { name: 'integration_retention_v1', expireAfterSeconds: 0 }
    );
  }
  const after = {};
  if (apply) for (const [name, query] of Object.entries(queries)) after[name] = await query();
  return {
    before,
    after,
    indexes: { connections: await connections.indexes(), logs: await logs.indexes() }
  };
}
if (require.main === module)
  (async () => {
    try {
      if (!process.env.MONGODB_URI) throw Error();
      await mongoose.connect(process.env.MONGODB_URI, {
        autoIndex: false,
        autoCreate: false,
        serverSelectionTimeoutMS: 5000
      });
      console.log(
        JSON.stringify(
          await inspect(mongoose.connection, { apply: process.argv.includes('--apply') }),
          null,
          2
        )
      );
    } catch {
      console.error('Integration index inspection failed.');
      process.exitCode = 1;
    } finally {
      await mongoose.disconnect();
    }
  })();
module.exports = { inspect };
