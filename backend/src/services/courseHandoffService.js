'use strict';
const CareerSprint = require('../models/careerSprint');
const { getCurrentSprint, invalidateCareerSprintCache } = require('./careerSprintService');
const { ownedProgress, fail } = require('./courseProgressService');
const { digest, skills, safeCourseUrl } = require('../utils/courseIdentity');
const handoff = async (userId, courseId, body = {}) => {
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    Object.keys(body).some((key) => key !== 'targetSkill')
  )
    fail(400, 'Only targetSkill is accepted.');
  const progress = await ownedProgress(userId, courseId);
  if (progress.status === 'completed')
    fail(
      409,
      'This course is self-reported completed. Update My Learning before adding study work.',
    );
  const course = progress.course;
  if (!safeCourseUrl(course.url, course.platform))
    fail(409, 'The saved course link is unavailable.');
  const targetSkill =
    body.targetSkill === undefined
      ? skills(course.topics, 1)[0] || ''
      : skills([body.targetSkill], 1)[0];
  if (
    body.targetSkill !== undefined &&
    (typeof body.targetSkill !== 'string' ||
      body.targetSkill.length > 40 ||
      !targetSkill ||
      !skills(course.topics, 5).some((skill) => skill.toLowerCase() === targetSkill.toLowerCase()))
  )
    fail(400, 'Target skill must match a recorded course topic.');
  const sprint = await getCurrentSprint(userId);
  if (!sprint?._id) fail(503, 'Career Sprint is unavailable.');
  // Same owned atomic insertion pattern as Recommendations. Sprint supplies its existing manual-task defaults.
  const title = `Study ${course.title.slice(0, 88)} [${digest(courseId).slice(0, 12)}]`;
  const task = {
    title,
    description:
      `Study the recorded course and review what you learned.\nCourse: ${courseId}\nSkill: ${targetSkill || 'Not specified'}\n${course.url}`.slice(
        0,
        1000,
      ),
    category: 'learning',
    taskType: 'manual',
  };
  const marker = `\nCourse: ${courseId}\n`;
  const sourceMatch = { description: { $regex: marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') } };
  const updated = await CareerSprint.findOneAndUpdate(
    {
      _id: sprint._id,
      userId,
      'tasks.title': { $ne: title },
      $expr: { $lt: [{ $size: { $ifNull: ['$tasks', []] } }, 500] },
      tasks: { $not: { $elemMatch: sourceMatch } },
    },
    { $push: { tasks: task }, $inc: { __v: 1 } },
    { returnDocument: 'after', runValidators: true },
  ).lean();
  if (!updated) {
    const existing = await CareerSprint.findOne({
      _id: sprint._id,
      userId,
      $or: [{ tasks: { $elemMatch: sourceMatch } }, { 'tasks.title': title }],
    }).lean();
    if (!existing) fail(409, 'Sprint changed. Retry the handoff.');
    const task = existing.tasks.find(
      (item) => item.description.includes(marker) || item.title === title,
    );
    if (!task?.description.includes(`\nSkill: ${targetSkill || 'Not specified'}\n`))
      fail(409, 'This course is already in the current Sprint with a different target skill.');
  }
  invalidateCareerSprintCache(userId);
  return {
    sprintId: String(sprint._id),
    courseId,
    targetSkill: targetSkill || null,
    alreadyAdded: !updated,
    route: '/app/career-sprint',
  };
};
module.exports = { handoff };
