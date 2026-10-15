'use strict';

const crypto = require('node:crypto');
const CareerSprint = require('../models/careerSprint');
const Schedule = require('../models/sprintSchedule');

const ensureSchedule = async (userId) => {
  if (await Schedule.exists({ _id: userId })) return;
  // Seed exact original instants, including ALL unmigrated historical records.
  // Concurrent initializers never replace the winner's reservation document.
  const records = await CareerSprint.find({ userId })
    .select('_id sprintStartDate sprintEndDate weekStartDate weekEndDate scheduleToken')
    .lean();
  const windows = records.map((record) => ({
    sprintId: String(record._id),
    start: record.sprintStartDate || record.weekStartDate,
    end: record.sprintEndDate || record.weekEndDate,
    token: record.scheduleToken || `legacy:${record._id}`
  }));
  if (
    windows.some(
      (window) =>
        !Number.isFinite(+new Date(window.start)) ||
        !Number.isFinite(+new Date(window.end)) ||
        !window.start ||
        !window.end ||
        new Date(window.start) > new Date(window.end)
    )
  ) {
    const error = new Error('An original Sprint window requires explicit data repair before scheduling.');
    error.statusCode = 409;
    throw error;
  }
  try {
    await Schedule.updateOne({ _id: userId }, { $setOnInsert: { windows } }, { upsert: true });
  } catch (error) {
    if (error.code !== 11000) throw error;
  }
};
const reserve = async (userId, sprintId, start, end) => {
  await ensureSchedule(userId);
  const token = crypto.randomUUID();
  const result = await Schedule.updateOne(
    {
      _id: userId,
      windows: {
        $not: { $elemMatch: { sprintId: { $ne: String(sprintId) }, start: { $lte: end }, end: { $gte: start } } }
      }
    },
    { $push: { windows: { sprintId: String(sprintId), start, end, token } } }
  );
  if (result.modifiedCount !== 1) {
    const error = new Error('Sprint dates overlap an existing or reserved sprint.');
    error.statusCode = 409;
    throw error;
  }
  return token;
};
const release = async (userId, token) => {
  if (token) await Schedule.updateOne({ _id: userId }, { $pull: { windows: { token } } });
};
// A failed cleanup conservatively retains the reservation. Preflight reports it;
// it cannot admit an overlap or erase another request's pending reservation.
const releaseSafely = (userId, token) => release(userId, token).catch(() => {});
module.exports = { ensureSchedule, reserve, release, releaseSafely };
