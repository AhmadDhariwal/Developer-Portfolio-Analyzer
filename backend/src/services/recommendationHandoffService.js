'use strict';

const CareerSprint = require('../models/careerSprint');
const { getCurrentSprint, invalidateCareerSprintCache } = require('./careerSprintService');

// The current snapshot is resolved server-side. Callers cannot supply task content,
// ownership, points, source facts, priorities or a different sprint owner.
const handoff = async ({ userId, recommendation, signalHash, expectedSignalHash }) => {
  if (!userId) return { status: 401, message: 'Authentication required.' };
  if (!recommendation) return { status: 404, message: 'Current recommendation not found.' };
  if (signalHash !== expectedSignalHash)
    return {
      status: 409,
      message: 'Recommendation context changed. Refresh before starting a sprint.',
    };
  const sprint = await getCurrentSprint(userId);
  if (!sprint?._id) return { status: 503, message: 'Career Sprint is unavailable.' };
  const title = recommendation.title.slice(0, 120);
  const task = {
    title,
    description:
      `${recommendation.actionableNextStep}\nRecommendation: ${recommendation.id}\nContext: ${signalHash}`.slice(
        0,
        1000,
      ),
    priority: recommendation.priority.toLowerCase(),
    category:
      recommendation.category === 'projects'
        ? 'project'
        : recommendation.category === 'learning'
          ? 'learning'
          : 'practice',
    taskType: 'manual',
  };
  const updated = await CareerSprint.findOneAndUpdate(
    { _id: sprint._id, userId, 'tasks.title': { $ne: title } },
    { $push: { tasks: task } },
    { returnDocument: 'after', runValidators: true },
  ).lean();
  if (!updated) {
    const existing = await CareerSprint.findOne({
      _id: sprint._id,
      userId,
      'tasks.title': title,
    }).lean();
    if (!existing) return { status: 409, message: 'Sprint changed. Retry the handoff.' };
  }
  invalidateCareerSprintCache(userId);
  return {
    status: 200,
    sprintId: String(sprint._id),
    recommendationId: recommendation.id,
    alreadyAdded: !updated,
    route: '/app/career-sprint',
  };
};

module.exports = { handoff };
