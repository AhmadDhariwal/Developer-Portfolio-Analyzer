/**
 * Date utilities for the Career Sprint system.
 * All comparisons are day-based (ignoring time).
 */

/** Return a Date set to midnight of the given date (or today). */
const startOfDay = (date = new Date()) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
};

/** Return a Date set to 23:59:59.999 of the given date. */
const endOfDay = (date = new Date()) => {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
};

/** Number of whole calendar days between two dates (ignores time). */
const daysBetween = (a, b) => {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((startOfDay(b) - startOfDay(a)) / msPerDay);
};

/** True if two dates fall on the same calendar day. */
const isSameDay = (a, b) => daysBetween(a, b) === 0;

/** True if date b is exactly 1 calendar day after date a. */
const isNextDay = (a, b) => daysBetween(a, b) === 1;

/** Add N calendar days to a date. */
const addDays = (date, n) => {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
};

/**
 * Distribute N tasks evenly across a date range.
 * Returns an array of { startDate, endDate } objects.
 * Uses inclusive day count: Apr 19 – Apr 27 = 9 days.
 */
const distributeTaskDates = (sprintStart, sprintEnd, taskCount) => {
  const start = startOfDay(sprintStart);
  const end   = startOfDay(sprintEnd);
  // +1 because both start and end days are inclusive
  const totalDays = Math.max(1, daysBetween(start, end) + 1);

  const slots = [];
  for (let i = 0; i < taskCount; i++) {
    const startOffset = Math.floor((i / taskCount) * totalDays);
    const endOffset   = Math.max(startOffset, Math.floor(((i + 1) / taskCount) * totalDays) - 1);
    slots.push({
      startDate: addDays(start, startOffset),
      endDate:   addDays(start, endOffset),
    });
  }
  return slots;
};

/**
 * Assign phase category based on position in sprint.
 * position: 0.0 – 1.0 (fraction through sprint)
 */
const phaseCategory = (position) => {
  if (position < 0.30) return 'learning';
  if (position < 0.70) return 'project';
  return 'practice';
};

module.exports = {
  startOfDay,
  endOfDay,
  daysBetween,
  isSameDay,
  isNextDay,
  addDays,
  distributeTaskDates,
  phaseCategory,
};
