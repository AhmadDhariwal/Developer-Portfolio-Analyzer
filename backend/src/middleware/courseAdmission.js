'use strict';
const { window } = require('../services/courseGovernanceService');

const isForceRefresh = (req) =>
  ['1', 'true', 'yes'].includes(
    String(req.query?.refresh || '')
      .trim()
      .toLowerCase(),
  );

async function enforceBucket(req, res, next, bucket, max) {
  try {
    const scope = String(req.user?._id || req.user?.id || req.ip || 'anonymous');
    const result = await window(bucket, scope, max);
    res.setHeader('RateLimit-Limit', String(result.limit));
    res.setHeader('RateLimit-Remaining', String(result.remaining));
    if (!result.allowed) {
      res.setHeader('Retry-After', String(result.retryAfterSeconds));
      return res.status(429).json({
        code: 'COURSE_RATE_LIMITED',
        message: 'Course request limit reached. Please retry shortly.',
        retryAfterSeconds: result.retryAfterSeconds,
      });
    }
    return next();
  } catch (error) {
    return res.status(Number(error?.statusCode) || 503).json({
      code: 'COURSE_ADMISSION_UNAVAILABLE',
      message: error?.publicMessage || 'Course admission is temporarily unavailable.',
    });
  }
}

async function admitCourseRead(req, res, next) {
  const refresh = isForceRefresh(req);
  const bucket = refresh ? 'refresh' : 'read';
  const max = refresh
    ? Number(process.env.COURSES_REFRESH_RATE_LIMIT_MAX || 20)
    : Number(process.env.COURSES_READ_RATE_LIMIT_MAX || 120);
  return enforceBucket(req, res, next, bucket, max);
}

async function admitCourseMutation(req, res, next) {
  const max = Number(process.env.COURSES_MUTATION_RATE_LIMIT_MAX || 60);
  return enforceBucket(req, res, next, 'mutation', max);
}

async function admitCourseSprint(req, res, next) {
  const max = Number(process.env.COURSES_SPRINT_RATE_LIMIT_MAX || 30);
  return enforceBucket(req, res, next, 'sprint', max);
}

module.exports = {
  admitCourseRead,
  admitCourseMutation,
  admitCourseSprint,
};
