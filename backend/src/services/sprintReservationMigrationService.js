'use strict';

const { calendar, POLICY, validateTimeZone } = require('../utils/sprintCalendar');
const CareerSprint = require('../models/careerSprint');
const Schedule = require('../models/sprintSchedule');
const { ensureSchedule } = require('./sprintReservationService');
const { EXCEPTION_POLICY } = require('./sprintLegacyPolicy');

const preflight = (records, { legacyTimeZone, legacyTimeZones = {}, legacyExceptions = {} } = {}) => {
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
    const exception = legacyExceptions[window.id] || window.record.legacyException;
    if (exception) {
      if (
        window.record.calendarPolicy ||
        exception.owner !== window.owner ||
        exception.start !== window.start.toISOString() ||
        exception.end !== window.end.toISOString() ||
        !['timezone-provenance-unresolved', 'historical-overlap'].includes(exception.reason) ||
        typeof exception.evidence !== 'string' ||
        !exception.evidence.trim() ||
        window.record.occupiedDays?.length
      ) {
        problems.push({ id: window.id, reason: 'legacy-exception-snapshot-mismatch' });
      } else {
        window.exception = exception;
        if (window.record.reservationPolicy !== EXCEPTION_POLICY || !window.record.legacyException)
          proposals.push({
            id: window.id,
            owner: window.owner,
            start: window.start,
            end: window.end,
            version: window.record.__v,
            reservationPolicy: EXCEPTION_POLICY,
            legacyException: exception
          });
      }
    }
  }
  for (const window of windows) {
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
    if (
      window.exception ||
      !Number.isFinite(+window.start) ||
      !Number.isFinite(+window.end) ||
      window.start > window.end
    )
      continue;
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
    for (const day of proposed.occupiedDays || []) {
      const key = `${proposed.owner}:${day}`;
      const other = tokens.get(key);
      if (other && !conflicts.some((item) => item.ids.includes(other) && item.ids.includes(proposed.id)))
        conflicts.push({
          owner: proposed.owner,
          ids: [other, proposed.id],
          reason: 'calendar-reservation-conflict'
        });
      tokens.set(key, proposed.id);
    }
  return {
    safe:
      conflicts.every(
        (conflict) =>
          conflict.reason === 'historical-window-overlap' &&
          conflict.ids.every((id) => windows.find((window) => window.id === id)?.exception)
      ) && problems.length === 0,
    recordCount: records.length,
    conflicts: conflicts.map((conflict) => ({
      ...conflict,
      grandfathered:
        conflict.reason === 'historical-window-overlap' &&
        conflict.ids.every((id) => Boolean(windows.find((window) => window.id === id)?.exception))
    })),
    problems,
    exceptions: windows.filter((window) => window.exception).map((window) => ({ id: window.id, ...window.exception })),
    proposals
  };
};

const inspect = async (options = {}) => {
  const filter = options.userIds ? { userId: { $in: options.userIds } } : {};
  const records = await CareerSprint.find(filter).lean();
  const result = preflight(records, options);
  const schedules = await Schedule.find(options.userIds ? { _id: { $in: options.userIds } } : {}).lean();
  result.scheduleOwnersToSeed = [...new Set(records.map((record) => String(record.userId)))].filter(
    (owner) => !schedules.some((schedule) => String(schedule._id) === owner)
  );
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
  result.reservationMismatches = schedules.flatMap((schedule) =>
    records
      .filter((record) => String(record.userId) === String(schedule._id))
      .flatMap((record) => {
        const matching = (schedule.windows || []).filter(
          (window) =>
            window.token === (record.scheduleToken || `legacy:${record._id}`) &&
            window.sprintId === String(record._id) &&
            +window.start === +new Date(record.sprintStartDate || record.weekStartDate) &&
            +window.end === +new Date(record.sprintEndDate || record.weekEndDate)
        );
        return matching.length === 1
          ? []
          : [{ id: String(record._id), reason: 'exact-reservation-missing-or-duplicated' }];
      })
  );
  if (result.reservationMismatches.length) result.safe = false;
  if (result.pendingOrOrphanedReservations.length) result.safe = false;
  return result;
};

const apply = async (options = {}) => {
  if (options.deploymentAuthorized !== true)
    throw new Error('Explicit deployment authorization is required for migration writes.');
  const result = await inspect(options);
  if (!result.safe) return { ...result, applied: 0, stopped: true };
  for (const owner of result.scheduleOwnersToSeed) await ensureSchedule(owner);
  const reserved = await inspect(options);
  if (!reserved.safe) return { ...reserved, applied: 0, stopped: true };
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
          ...(proposal.legacyException
            ? { legacyException: proposal.legacyException }
            : {
                occupiedDays: proposal.occupiedDays,
                migrationCalendarTimeZone: proposal.timeZone
              }),
          reservationPolicy: proposal.reservationPolicy
        },
        $inc: { __v: 1 }
      },
      { timestamps: false }
    );
    applied += write.modifiedCount;
    if (write.modifiedCount !== 1)
      return { safe: false, applied, stopped: true, reason: 'record-changed-reinspect-required' };
  }
  const final = await inspect(options);
  return {
    ...final,
    applied,
    pending: final.proposals.length,
    stopped: !final.safe || final.proposals.length > 0
  };
};
module.exports = { preflight, inspect, apply };
