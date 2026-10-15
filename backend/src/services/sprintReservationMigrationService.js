'use strict';

const { calendar, POLICY, validateTimeZone } = require('../utils/sprintCalendar');
const CareerSprint = require('../models/careerSprint');
const Schedule = require('../models/sprintSchedule');
const { ensureSchedule } = require('./sprintReservationService');

const preflight = (records, { legacyTimeZone, legacyTimeZones = {} } = {}) => {
  const conflicts = [];
  const proposals = [];
  const problems = [];
  const windows = records.map((record) => ({
    record,
    id: String(record._id),
    owner: String(record.userId),
    start: new Date(record.sprintStartDate || record.weekStartDate),
    end: new Date(record.sprintEndDate || record.weekEndDate)
  }));
  for (const window of windows) {
    if (!Number.isFinite(+window.start) || !Number.isFinite(+window.end) || window.start > window.end) {
      problems.push({ id: window.id, owner: window.owner, reason: 'invalid-original-window' });
      continue;
    }
    for (const prior of windows) {
      if (
        prior.owner === window.owner &&
        prior.id < window.id &&
        prior.start <= window.end &&
        prior.end >= window.start
      )
        conflicts.push({
          owner: window.owner,
          ids: [prior.id, window.id],
          windows: [
            { id: prior.id, start: prior.start, end: prior.end },
            { id: window.id, start: window.start, end: window.end }
          ],
          reason: 'historical-window-overlap'
        });
    }
    if (window.record.occupiedDays?.length) continue;
    const pinned = window.record.calendarPolicy === POLICY;
    const zone = pinned
      ? window.record.timeZone
      : window.record.migrationCalendarTimeZone || legacyTimeZones[window.id] || legacyTimeZone;
    if (!zone) {
      problems.push({ id: window.id, owner: window.owner, reason: 'original-server-time-zone-required' });
      continue;
    }
    try {
      const timeZone = validateTimeZone(zone);
      const c = calendar({ calendarPolicy: POLICY, timeZone });
      const days = c.difference(window.start, window.end) + 1;
      if (days < 1 || days > 366) throw new Error();
      const occupiedDays = Array.from(
        { length: days },
        (_, index) => `${pinned ? POLICY : 'legacy'}:${timeZone}:${c.key(c.add(window.start, index))}`
      );
      proposals.push({
        id: window.id,
        owner: window.owner,
        start: window.start,
        end: window.end,
        version: window.record.__v,
        timeZone,
        occupiedDays,
        reservationPolicy: pinned ? POLICY : 'legacy-reservations-v1'
      });
    } catch {
      problems.push({
        id: window.id,
        owner: window.owner,
        reason: 'calendar-policy-unresolvable-or-window-over-366-days'
      });
    }
  }
  const tokens = new Map();
  for (const window of windows)
    for (const token of window.record.occupiedDays || []) tokens.set(`${window.owner}:${token}`, window.id);
  for (const proposed of proposals)
    for (const day of proposed.occupiedDays) {
      const key = `${proposed.owner}:${day}`;
      const other = tokens.get(key);
      if (other && !conflicts.some((item) => item.ids.includes(other) && item.ids.includes(proposed.id)))
        conflicts.push({ owner: proposed.owner, ids: [other, proposed.id], reason: 'calendar-reservation-conflict' });
      tokens.set(key, proposed.id);
    }
  return {
    safe: conflicts.length === 0 && problems.length === 0,
    recordCount: records.length,
    conflicts,
    problems,
    proposals
  };
};

const inspect = async (options = {}) => {
  const filter = options.userIds ? { userId: { $in: options.userIds } } : {};
  const records = await CareerSprint.find(filter).lean();
  const result = preflight(records, options);
  const schedules = await Schedule.find(options.userIds ? { _id: { $in: options.userIds } } : {}).lean();
  const expected = new Set(records.map((record) => record.scheduleToken || `legacy:${record._id}`));
  result.pendingOrOrphanedReservations = schedules.flatMap((schedule) =>
    (schedule.windows || [])
      .filter((window) => !expected.has(window.token))
      .map((window) => ({
        owner: String(schedule._id),
        sprintId: window.sprintId,
        token: window.token,
        start: window.start,
        end: window.end
      }))
  );
  if (result.pendingOrOrphanedReservations.length) result.safe = false;
  return result;
};

const apply = async (options = {}) => {
  if (options.deploymentAuthorized !== true)
    throw new Error('Explicit deployment authorization is required for migration writes.');
  const result = await inspect(options);
  if (!result.safe) return { ...result, applied: 0, stopped: true };
  let applied = 0;
  for (const proposal of result.proposals) {
    await ensureSchedule(proposal.owner);
    const write = await CareerSprint.updateOne(
      {
        _id: proposal.id,
        userId: proposal.owner,
        __v: proposal.version,
        'occupiedDays.0': { $exists: false },
        $expr: {
          $and: [
            { $eq: [{ $ifNull: ['$sprintStartDate', '$weekStartDate'] }, proposal.start] },
            { $eq: [{ $ifNull: ['$sprintEndDate', '$weekEndDate'] }, proposal.end] }
          ]
        }
      },
      {
        $set: {
          occupiedDays: proposal.occupiedDays,
          migrationCalendarTimeZone: proposal.timeZone,
          reservationPolicy: proposal.reservationPolicy
        },
        $inc: { __v: 1 }
      },
      { timestamps: false }
    );
    applied += write.modifiedCount;
  }
  return { safe: true, applied, pending: (await inspect(options)).proposals.length, stopped: false };
};
module.exports = { preflight, inspect, apply };
