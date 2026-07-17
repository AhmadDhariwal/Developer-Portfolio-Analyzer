require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const ScenarioSimulation = require('../models/scenarioSimulation');
const User = require('../models/user');
const { saveScenarioForUser } = require('../services/scenarioSimulatorService');

const INDEX_KEY = { userId: 1, scenarioHash: 1 };
const INDEX_NAME = 'userId_1_scenarioHash_1';

const hasIndexKey = (index) => index?.key?.userId === 1
  && index?.key?.scenarioHash === 1
  && Object.keys(index.key).length === 2;

const isValidScenario = (scenario) => Boolean(
  scenario?.userId
  && String(scenario?.scenarioHash || '').trim()
  && String(scenario?.name || '').trim()
  && Number.isFinite(Number(scenario?.baselineHiringScore))
  && Number.isFinite(Number(scenario?.baselineJobMatch))
);

const findDuplicateGroups = () => ScenarioSimulation.collection.aggregate([
  { $group: { _id: { userId: '$userId', scenarioHash: '$scenarioHash' }, count: { $sum: 1 } } },
  { $match: { count: { $gt: 1 } } }
]).toArray();

const removeConfirmedDuplicates = async () => {
  const groups = await findDuplicateGroups();
  let removed = 0;

  for (const group of groups) {
    const scenarios = await ScenarioSimulation.find(group._id)
      .sort({ updatedAt: -1, createdAt: -1, _id: -1 })
      .lean();
    const keeper = scenarios.find(isValidScenario) || scenarios[0];
    const duplicateIds = scenarios
      .filter((scenario) => !scenario._id.equals(keeper._id))
      .map((scenario) => scenario._id);

    if (duplicateIds.length) {
      const result = await ScenarioSimulation.deleteMany({ _id: { $in: duplicateIds } });
      removed += Number(result.deletedCount || 0);
    }
  }

  return { groups: groups.length, removed };
};

const ensureUniqueIndex = async () => {
  const indexes = await ScenarioSimulation.collection.indexes();
  const nonUniqueIndexes = indexes.filter((index) => hasIndexKey(index) && !index.unique);
  for (const index of nonUniqueIndexes) {
    await ScenarioSimulation.collection.dropIndex(index.name);
  }

  const remainingIndexes = await ScenarioSimulation.collection.indexes();
  const uniqueIndex = remainingIndexes.find((index) => hasIndexKey(index) && index.unique);
  if (!uniqueIndex) {
    await ScenarioSimulation.collection.createIndex(INDEX_KEY, { name: INDEX_NAME, unique: true });
  }

  const finalIndexes = await ScenarioSimulation.collection.indexes();
  return {
    dropped: nonUniqueIndexes.length,
    unique: finalIndexes.some((index) => hasIndexKey(index) && index.unique)
  };
};

const verifyConcurrentSaves = async () => {
  const nonce = `scenario-index-verify-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const user = await User.create({
    name: 'Scenario Index Verification',
    email: `${nonce}@example.invalid`,
    authProvider: 'github',
    providers: ['github'],
    isActive: true
  });
  const payload = {
    baselineHiringScore: 50,
    baselineJobMatch: 45,
    role: 'full stack',
    experienceLevel: 'mid',
    durationWeeks: 6,
    skills: ['React', 'TypeScript'],
    projects: []
  };

  try {
    const [first, second] = await Promise.all([
      saveScenarioForUser(user._id, payload),
      saveScenarioForUser(user._id, payload)
    ]);
    const count = await ScenarioSimulation.countDocuments({ userId: user._id, scenarioHash: first.scenarioHash });
    const passed = String(first._id) === String(second._id) && count === 1;
    if (!passed) throw new Error('Concurrent scenario save verification failed.');
    return { records: count, passed };
  } finally {
    await ScenarioSimulation.deleteMany({ userId: user._id });
    await User.deleteOne({ _id: user._id });
  }
};

const run = async () => {
  await connectDB();
  try {
    let cleanup = await removeConfirmedDuplicates();
    let index;
    let dropped = 0;
    try {
      index = await ensureUniqueIndex();
      dropped += index.dropped;
    } catch (error) {
      if (error?.code !== 11000) throw error;
      const retryCleanup = await removeConfirmedDuplicates();
      cleanup = {
        groups: cleanup.groups + retryCleanup.groups,
        removed: cleanup.removed + retryCleanup.removed
      };
      index = await ensureUniqueIndex();
      dropped += index.dropped;
    }

    const remainingGroups = (await findDuplicateGroups()).length;
    const verification = process.argv.includes('--verify') ? await verifyConcurrentSaves() : null;
    console.log(`[scenario-simulation-index] duplicateGroups=${cleanup.groups} duplicatesRemoved=${cleanup.removed} nonUniqueIndexesDropped=${dropped} uniqueIndex=${index.unique} remainingDuplicateGroups=${remainingGroups}${verification ? ` verificationRecords=${verification.records} verificationPassed=${verification.passed}` : ''}`);
  } finally {
    await mongoose.connection.close();
  }
};

run().catch(async (error) => {
  console.error(`[scenario-simulation-index] failed: ${error.message}`);
  await mongoose.connection.close().catch(() => {});
  process.exit(1);
});