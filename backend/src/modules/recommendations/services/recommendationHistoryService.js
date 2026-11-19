'use strict';
const Recommendation = require('../models/recommendation');
const { RULE_VERSION } = require('./recommendationEngineService');

const summarize = (row) => ({
  id: String(row._id),
  title: String(row.title || '').slice(0, 500),
  priority: row.priority,
  careerStack: row.careerStack,
  experienceLevel: row.experienceLevel,
  createdAt: row.createdAt,
  snapshotVersion: row.snapshotVersion || 'legacy',
  legacy: row.snapshotVersion !== RULE_VERSION,
  historical: true,
  contextHash: row.contextHash || null,
});
const list = async (userId) =>
  (
    await Recommendation.find({ userId })
      .sort({ createdAt: -1, _id: -1 })
      .select('title priority careerStack experienceLevel createdAt snapshotVersion contextHash')
      .limit(50)
      .lean()
  ).map(summarize);

module.exports = { summarize, list };
