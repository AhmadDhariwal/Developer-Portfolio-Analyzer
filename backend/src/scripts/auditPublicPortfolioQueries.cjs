// Uses only the disposable verifier database. No dotenv or application credentials.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const mongoose = require('mongoose');
const { performance } = require('node:perf_hooks');
async function main() {
  const uri = process.env.MONGODB_URI || '';
  assert.match(
    uri,
    /^mongodb:\/\/127\.0\.0\.1:\d+\/integration_live_acceptance\?replicaSet=portfolio-final$/
  );
  await mongoose.connect(uri, { dbName: 'portfolio_final_query_fixture', autoIndex: false });
  const Profile = require('../models/publicProfile');
  const Visit = require('../models/publicPortfolioVisit');
  const Legacy = require('../models/publicProfileView');
  const Cache = require('../models/publicProfileCache');
  const User = require('../models/user');
  const redis = require('../services/redisCacheService');
  try {
    for (const model of [Profile, Visit, Legacy, Cache]) await model.createIndexes();
    const id = new mongoose.Types.ObjectId();
    const owner = new mongoose.Types.ObjectId();
    await User.collection.insertOne({ _id: owner, isActive: true, sessionRevision: 1 });
    await Profile.collection.insertOne({
      _id: id,
      userId: owner,
      slug: 'query-fixture',
      isPublic: true
    });
    const now = new Date();
    const old = new Date(now.getTime() - 30 * 86400000);
    const other = new mongoose.Types.ObjectId();
    const rows = Array.from({ length: 2020 }, (_, i) => ({
      profileId: i < 1010 ? id : other,
      viewerHash: `fixture-${i}`,
      recordType: 'view',
      viewedAt: i < 1000 ? old : now,
      expiresAt: new Date(now.getTime() + 86400000)
    }));
    await Legacy.collection.insertMany(rows);
    await Visit.collection.insertMany(rows);
    const filter = {
      profileId: id,
      recordType: { $ne: 'unique_guard' },
      viewedAt: { $gte: new Date(now.getTime() - 6 * 86400000) }
    };
    const report = { fixtureOnly: true, queries: {}, cache: {} };
    const notifications = require('../services/notificationPersistenceService');
    let attemptedWrite = false;
    await assert.rejects(
      notifications.commit(
        owner,
        async () => {
          attemptedWrite = true;
        },
        null,
        0
      ),
      { status: 401 }
    );
    assert.equal(attemptedWrite, false);
    const assets = require('../services/storedAssetService');
    const document = await Profile.findById(id);
    document.headline = 'Revoked write';
    await assert.rejects(assets.commitPortfolio(document, new Set(), null, 0), { status: 401 });
    assert.notEqual((await Profile.findById(id).lean()).headline, 'Revoked write');
    report.sessionFences = {
      notificationCommitRejected: true,
      assetCommitRejected: true,
      persistedWrite: false
    };
    const analytics = require('../services/publicPortfolioAnalyticsPersistence');
    const receipt = {
      profileId: id,
      viewerHash: 'atomic-test',
      viewedAt: now,
      expiresAt: new Date(now.getTime() + 86400000)
    };
    await Promise.all(
      Array.from({ length: 5 }, () => analytics.record({ _id: id, userId: owner }, receipt))
    );
    for (let i = 0; i < 10; i++) await analytics.record({ _id: id, userId: owner }, receipt);
    const counted = await Profile.findById(id).lean();
    assert.equal(counted.totalViews, 1);
    assert.equal(counted.uniqueViews, 1);
    assert.equal(await Visit.countDocuments({ profileId: id, viewerHash: receipt.viewerHash }), 1);
    report.analytics = {
      concurrentFirstViews: 5,
      repeatedViews: 10,
      totalViews: counted.totalViews,
      uniqueViews: counted.uniqueViews,
      receipts: 1
    };
    for (const [name, query] of [
      ['published-slug', Profile.find({ slug: 'query-fixture', isPublic: true })],
      ['owner-profile', Profile.find({ userId: owner })],
      ['visitor-receipt', Visit.find({ profileId: id, viewerHash: 'fixture-1001' })],
      ['current-seven-days', Visit.find(filter)],
      ['legacy-seven-days', Legacy.find(filter)]
    ]) {
      const plan = await query.explain('executionStats');
      report.queries[name] = {
        returned: plan.executionStats.nReturned,
        documentsExamined: plan.executionStats.totalDocsExamined,
        keysExamined: plan.executionStats.totalKeysExamined,
        executionMilliseconds: plan.executionStats.executionTimeMillis,
        winningPlan: plan.queryPlanner.winningPlan
      };
    }
    assert.equal(report.queries['current-seven-days'].returned, 11);
    assert.equal(report.queries['visitor-receipt'].documentsExamined, 1);
    assert.equal(report.queries['legacy-seven-days'].returned, 10);
    assert.equal(report.queries['legacy-seven-days'].documentsExamined, 10);
    report.legacyIndexes = await Legacy.collection.listIndexes().toArray();
    assert.ok(
      report.legacyIndexes.some((index) => index.key.profileId === 1 && index.key.viewedAt === 1)
    );
    assert.ok(
      report.legacyIndexes.some(
        (index) =>
          index.unique === true && index.partialFilterExpression?.recordType === 'unique_guard'
      )
    );
    assert.ok(
      report.legacyIndexes.some(
        (index) => index.key.uniqueWindowUntil === 1 && index.expireAfterSeconds === 0
      )
    );
    await redis.initRedisCache({ silent: true, probeOnly: true });
    const { createPortfolioCache } = require('../services/publicPortfolioCacheService');
    const profile = { _id: id, isPublic: true, slug: 'query-fixture' };
    let loads = 0;
    const loader = async () => {
      loads++;
      return { slug: profile.slug, projects: [] };
    };
    const cache = createPortfolioCache();
    const start = performance.now();
    await cache.get(profile, { name: 'Fixture' }, loader);
    report.cache.coldMilliseconds = performance.now() - start;
    const warm = [];
    for (let i = 0; i < 50; i++) {
      const at = performance.now();
      await cache.get(profile, { name: 'Fixture' }, loader);
      warm.push(performance.now() - at);
    }
    warm.sort((a, b) => a - b);
    report.cache.warmP50Milliseconds = warm[24];
    report.cache.warmP95Milliseconds = warm[47];
    await createPortfolioCache().get(profile, { name: 'Fixture' }, loader);
    report.cache.loaderCallsFor52Reads = loads;
    assert.equal(loads, 1);
    fs.writeFileSync(process.argv[2], JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } finally {
    await redis.closeRedisCache();
    assert.equal(mongoose.connection.name, 'portfolio_final_query_fixture');
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
