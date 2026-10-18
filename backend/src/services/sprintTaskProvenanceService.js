'use strict';

const User = require('../models/user');
const Recommendation = require('../models/recommendation');
const developerContext = require('./developerContextService');
const { currentActions } = require('./sprintRecommendationAdapter');
const { getDeveloperSignals } = require('./developerSignalService');
const fields = [
  'sourceRecommendationId',
  'sourceRecommendationSnapshotId',
  'sourceRecommendationHash',
  'sourceRule',
  'evidenceLimitation'
];
const attach = async (userId, inputs, normalized) => {
  if (!inputs.some((task) => task?.sourceRecommendationId)) return normalized;
  const user = await User.findById(userId).lean();
  const [documents, signals] = await Promise.all([
    Recommendation.find({ userId, snapshotVersion: 'recommendations-evidence-v1' })
      .sort({ createdAt: -1 })
      .limit(6)
      .lean(),
    getDeveloperSignals(userId).catch(() => ({}))
  ]);
  const current = await currentActions({
    userId,
    user,
    careerStack: developerContext.resolveCareerStack(user),
    experienceLevel: developerContext.resolveExperienceLevel(user),
    documents,
    signals
  });
  return normalized.map((task) => {
    const input = inputs.find((item) => item?.title?.trim().replace(/\s+/g, ' ') === task.title);
    if (!input?.sourceRecommendationId) return task;
    const action = current.tasks.find(
      (item) =>
        item.sourceRecommendationId === input.sourceRecommendationId &&
        item.sourceRecommendationSnapshotId === input.sourceRecommendationSnapshotId &&
        item.sourceRecommendationHash === input.sourceRecommendationHash &&
        item.title === task.title
    );
    if (!action) {
      const error = new Error(
        'Recommendation context changed. Generate a current preview before saving this source reference.'
      );
      error.statusCode = 409;
      throw error;
    }
    return { ...task, ...Object.fromEntries(fields.map((key) => [key, action[key]])) };
  });
};
module.exports = { attach, fields };
