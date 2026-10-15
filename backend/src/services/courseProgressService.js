'use strict';
const UserCourseProgress = require('../models/userCourseProgress');
const AnalysisCache = require('../models/analysisCache');
const { buildFallbackPool, normaliseCourse } = require('./courseService');
const { safeCourseUrl, validCourseId } = require('../utils/courseIdentity');
const { COURSE_POOL_VERSION, findCachedCourse } = require('./courseRecommendationService');
const STATUSES = ['saved', 'in_progress', 'completed'];
const fail = (status, message) => {
  const error = new Error(message);
  error.status = status;
  throw error;
};
const assertCourseId = (courseId) => {
  if (!validCourseId(courseId)) fail(400, 'Invalid course identity.');
};
const ownedProgress = async (userId, courseId) => {
  assertCourseId(courseId);
  const row = await UserCourseProgress.findOne({ userId, courseId }).lean();
  if (!row) fail(404, 'Save this course to My Learning first.');
  return row;
};
const snapshot = (course) => ({
  id: course.id,
  title: course.title,
  url: safeCourseUrl(course.url, course.platform),
  platform: course.platform,
  topics: course.topics,
  instructor: course.instructor,
  provenance: course.provenance,
});
const dto = (row) => ({
  courseId: row.courseId,
  course: snapshot(row.course),
  status: row.status,
  notes: row.notes,
  progressPercent: row.progressPercent,
  progressSource: 'user-entered',
  completionSource: 'self-reported',
  completedAt: row.completedAt,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});
const resolveCourse = async (userId, courseId) => {
  const catalog = buildFallbackPool('All', 100).find((course) => course.id === courseId);
  if (catalog) return catalog;
  const memory = findCachedCourse(userId, courseId);
  if (memory) return normaliseCourse({ ...memory, metadataSource: memory.provenance?.source });
  const cached = await AnalysisCache.findOne({
    userId,
    analysisVersion: COURSE_POOL_VERSION,
    'analysisData.allCourses.id': courseId,
    updatedAt: { $gte: new Date(Date.now() - 6 * 60 * 60 * 1000) },
  })
    .sort({ updatedAt: -1 })
    .select({ 'analysisData.allCourses': 1 })
    .lean();
  const source = cached?.analysisData?.allCourses?.find((course) => course.id === courseId);
  return source ? normaliseCourse({ ...source, metadataSource: source.provenance?.source }) : null;
};
const saveProgress = async (userId, courseId, body = {}) => {
  assertCourseId(courseId);
  if (!body || typeof body !== 'object' || Array.isArray(body))
    fail(400, 'Invalid progress payload.');
  if (Object.keys(body).some((key) => !['status', 'notes', 'progressPercent'].includes(key)))
    fail(400, 'Only status, notes and explicit progress are accepted.');
  if (!STATUSES.includes(body.status)) fail(400, 'Status must be saved, in_progress or completed.');
  if (body.notes !== undefined && (typeof body.notes !== 'string' || body.notes.length > 2000))
    fail(400, 'Notes must be text of at most 2000 characters.');
  if (
    body.progressPercent !== undefined &&
    body.progressPercent !== null &&
    (typeof body.progressPercent !== 'number' ||
      !Number.isFinite(body.progressPercent) ||
      body.progressPercent < 0 ||
      body.progressPercent > 100)
  )
    fail(400, 'Progress must be an explicit number from 0 to 100, or null.');
  const existing = await UserCourseProgress.findOne({ userId, courseId }).lean();
  const course = existing?.course || (await resolveCourse(userId, courseId));
  if (!course || !safeCourseUrl(course.url, course.platform))
    fail(404, 'Course is unavailable. Reload the catalog and try again.');
  const set = {
    status: body.status,
    completedAt: body.status === 'completed' ? existing?.completedAt || new Date() : null,
  };
  if (body.notes !== undefined)
    set.notes = body.notes.trim().replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
  if (body.progressPercent !== undefined) set.progressPercent = body.progressPercent;
  const query = { userId, courseId };
  const update = { $set: set, $setOnInsert: { userId, courseId, course: snapshot(course) } };
  let row;
  try {
    row = await UserCourseProgress.findOneAndUpdate(query, update, {
      upsert: true,
      returnDocument: 'after',
      runValidators: true,
    }).lean();
  } catch (error) {
    if (error.code !== 11000) throw error;
    row = await UserCourseProgress.findOneAndUpdate(
      query,
      { $set: set },
      { returnDocument: 'after', runValidators: true },
    ).lean();
  }
  return dto(row);
};
const listProgress = async (userId, query = {}) => {
  const filter = { userId };
  if (query.status && !STATUSES.includes(query.status)) fail(400, 'Invalid learning status.');
  if (query.status) filter.status = query.status;
  const page = Math.min(10000, Math.max(1, Number.parseInt(query.page, 10) || 1));
  const limit = Math.min(50, Math.max(1, Number.parseInt(query.limit, 10) || 20));
  const [rows, total] = await Promise.all([
    UserCourseProgress.find(filter)
      .sort({ updatedAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    UserCourseProgress.countDocuments(filter),
  ]);
  return { courses: rows.map(dto), total, page, totalPages: Math.max(1, Math.ceil(total / limit)) };
};
const removeProgress = async (userId, courseId) => {
  assertCourseId(courseId);
  await UserCourseProgress.deleteOne({ userId, courseId });
};
module.exports = {
  saveProgress,
  listProgress,
  removeProgress,
  ownedProgress,
  assertCourseId,
  fail,
};
