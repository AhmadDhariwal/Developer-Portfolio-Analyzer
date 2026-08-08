'use strict';

/**
 * Idempotent Career Sprint index ensure.
 * Safe to re-run against existing data.
 */
const CareerSprint = require('../models/careerSprint');

const REQUIRED_INDEXES = [
  { key: { userId: 1, updatedAt: -1 }, name: 'career_sprint_user_updated_at' },
  { key: { userId: 1, sprintStartDate: 1, sprintEndDate: 1 }, name: 'career_sprint_user_sprint_window' },
  { key: { userId: 1, weekStartDate: -1 }, name: 'career_sprint_user_week_start_desc' },
  { key: { userId: 1, weekStartDate: 1, weekEndDate: 1 }, name: 'career_sprint_user_week_window' },
  { key: { userId: 1, 'tasks.isCompleted': 1, 'tasks.endDate': 1 }, name: 'career_sprint_user_task_completion' }
];

const ensureCareerSprintIndexes = async (model = CareerSprint) => {
  const collection = model.collection;
  const existing = await collection.indexes();
  const existingNames = new Set(existing.map((index) => index.name));
  const created = [];
  const skipped = [];

  for (const index of REQUIRED_INDEXES) {
    if (existingNames.has(index.name)) {
      skipped.push(index.name);
      continue;
    }
    const alreadySameKey = existing.some((item) => JSON.stringify(item.key) === JSON.stringify(index.key));
    if (alreadySameKey) {
      skipped.push(index.name);
      continue;
    }
    await collection.createIndex(index.key, { name: index.name, background: true });
    created.push(index.name);
  }

  return {
    created,
    skipped,
    totalRequired: REQUIRED_INDEXES.length
  };
};

const explainCareerSprintQueryPlans = async (model = CareerSprint) => {
  const userId = new (require('mongoose').Types.ObjectId)();
  const now = new Date();
  const current = await model.findOne({
    userId,
    $or: [
      { sprintStartDate: { $lte: now }, sprintEndDate: { $gte: now } },
      { weekStartDate: { $lte: now }, weekEndDate: { $gte: now } }
    ]
  }).sort({ updatedAt: -1 }).lean().explain('executionStats');

  const previous = await model.findOne({
    userId,
    weekStartDate: { $lt: now }
  }).sort({ weekStartDate: -1 }).lean().explain('executionStats');

  return { current, previous };
};

module.exports = {
  ensureCareerSprintIndexes,
  explainCareerSprintQueryPlans,
  REQUIRED_INDEXES
};

if (require.main === module) {
  const mongoose = require('mongoose');
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    console.error('MONGODB_URI is required');
    process.exit(1);
  }
  mongoose.connect(uri).then(async () => {
    const result = await ensureCareerSprintIndexes();
    console.log(JSON.stringify(result, null, 2));
    await mongoose.disconnect();
  }).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
