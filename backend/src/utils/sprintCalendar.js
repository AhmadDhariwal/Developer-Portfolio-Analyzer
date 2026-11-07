'use strict';

const { Temporal } = require('@js-temporal/polyfill');
const legacy = require('./dateUtils');
const POLICY = 'sprint-calendar-48h-v1';

const validateTimeZone = (value) => {
  try {
    if (typeof value !== 'string' || value.length > 100 || /^[+-]/.test(value)) throw new Error();
    const zone = new Intl.DateTimeFormat('en', { timeZone: value }).resolvedOptions().timeZone;
    Temporal.Instant.fromEpochMilliseconds(0).toZonedDateTimeISO(zone);
    return zone;
  } catch {
    const error = new Error('A valid IANA time zone is required.');
    error.statusCode = 400;
    throw error;
  }
};

const preferenceTimeZone = (value) => {
  try {
    return validateTimeZone(value);
  } catch {
    return 'UTC';
  }
};
const isCurrentPolicy = (sprint) => sprint?.calendarPolicy === POLICY;
const calendar = (sprint = {}) => {
  if (!isCurrentPolicy(sprint))
    return {
      start: legacy.startOfDay,
      end: legacy.endOfDay,
      add: legacy.addDays,
      difference: legacy.daysBetween,
      key: (value) => {
        const date = legacy.startOfDay(value);
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      }
    };
  const zone = validateTimeZone(sprint.timeZone);
  const day = (value = new Date()) => {
    try {
      if (!(value instanceof Date) && typeof value !== 'string') throw new Error();
      if (typeof value === 'string' && !/^\d{4}-\d{2}-\d{2}$/.test(value) && !/T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(value))
        throw new Error();
      return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
        ? Temporal.PlainDate.from(value)
        : Temporal.Instant.fromEpochMilliseconds(new Date(value).getTime()).toZonedDateTimeISO(zone).toPlainDate();
    } catch {
      const error = new Error('Invalid calendar date.');
      error.statusCode = 400;
      throw error;
    }
  };
  const instant = (date) => new Date(date.toZonedDateTime(zone).epochMilliseconds);
  return {
    start: (value) => instant(day(value)),
    end: (value) => new Date(+instant(day(value).add({ days: 1 })) - 1),
    add: (value, days) => instant(day(value).add({ days })),
    difference: (a, b) => day(a).until(day(b)).days,
    key: (value) => day(value).toString()
  };
};

const sprintWindow = (timeZone, start, end, now = new Date()) => {
  const pinned = { calendarPolicy: POLICY, timeZone: validateTimeZone(timeZone) };
  const c = calendar(pinned);
  const today = Temporal.PlainDate.from(c.key(now));
  const first = start || today.subtract({ days: today.dayOfWeek - 1 }).toString();
  const from = c.start(first);
  const to = end ? c.end(end) : c.end(c.add(from, 6));
  const count = c.difference(from, to) + 1;
  if (count < 1 || count > 366) {
    const error = new Error('Sprint windows must contain 1 to 366 calendar days.');
    error.statusCode = 400;
    throw error;
  }
  return {
    ...pinned,
    sprintStartDate: from,
    sprintEndDate: to,
    occupiedDays: Array.from({ length: count }, (_, i) => `${POLICY}:${timeZone}:${c.key(c.add(from, i))}`)
  };
};

module.exports = { POLICY, calendar, isCurrentPolicy, validateTimeZone, preferenceTimeZone, sprintWindow };
