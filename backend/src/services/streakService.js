/**
 * Day-based streak service.
 *
 * Rules:
 *   - A "streak day" = any calendar day on which the user completes ≥ 1 task.
 *   - If today == lastActiveDate          → no change (already counted today)
 *   - If today == lastActiveDate + 1 day  → currentStreak++
 *   - If today >  lastActiveDate + 1 day  → streak broken, reset to 1
 *   - On break: update longestStreak if needed
 *   - Restore: allowed for 1–3 missed calendar days (not elapsed hours).
 */

const { startOfDay, daysBetween, isSameDay } = require('../utils/dateUtils');

const MAX_RESTORE_DAYS = 3;

// Restoration bridges a gap without claiming a task was completed that day.
const activityAnchor = (sprint) => {
  const real = sprint.lastActiveDate ? startOfDay(sprint.lastActiveDate) : null;
  const restored = sprint.streakRestoredAt ? startOfDay(sprint.streakRestoredAt) : null;
  return restored && real && restored > real ? restored : real;
};

/**
 * Call this whenever a task is completed.
 * Mutates the sprint document in-place; caller must save().
 *
 * @param {Object} sprint  - Mongoose sprint document
 * @returns {{ changed: boolean, streakStatus: string }}
 */
const recordActivity = (sprint) => {
  const today = startOfDay(new Date());
  const last = activityAnchor(sprint);

  // Already recorded today — nothing to do
  if (last && isSameDay(last, today)) {
    sprint.lastActiveDate = today;
    sprint.streakStatus = resolveStatus(sprint);
    return { changed: false, streakStatus: sprint.streakStatus };
  }

  if (!last) {
    // First ever activity
    sprint.currentStreak = 1;
  } else {
    const gap = daysBetween(last, today);
    if (gap === 1) {
      // Consecutive day
      sprint.currentStreak = (sprint.currentStreak || 0) + 1;
    } else {
      // Gap > 1 — streak broken
      sprint.longestStreak = Math.max(sprint.longestStreak || 0, sprint.currentStreak || 0);
      sprint.currentStreak = 1;
      sprint.streakBroken = true;
      sprint.streakBrokenAt = new Date();
    }
  }

  // Update longest
  sprint.longestStreak = Math.max(sprint.longestStreak || 0, sprint.currentStreak);

  // Clear broken flag if we're back on track
  if (sprint.streakBroken && sprint.currentStreak > 0) {
    sprint.streakBroken = false;
    sprint.streakBrokenAt = null;
  }

  // Any real activity clears warning state for the day.
  sprint.streakWarning = false;

  sprint.lastActiveDate = today;
  sprint.streak = sprint.currentStreak; // keep legacy field in sync
  sprint.streakStatus = resolveStatus(sprint);

  return { changed: true, streakStatus: sprint.streakStatus };
};

/**
 * Check if the streak should be marked as broken due to inactivity.
 * Call on login / daily cron.
 * Mutates sprint in-place; caller must save() if changed === true.
 */
const checkInactivity = (sprint) => {
  const today = startOfDay(new Date());
  const last = activityAnchor(sprint);

  if (!last || (sprint.currentStreak || 0) === 0) {
    sprint.streakStatus = resolveStatus(sprint);
    return { changed: false };
  }

  const gap = daysBetween(last, today);

  if (gap > 1 && !sprint.streakBroken) {
    // Missed at least one day
    sprint.longestStreak = Math.max(sprint.longestStreak || 0, sprint.currentStreak || 0);
    sprint.streakBroken = true;
    sprint.streakBrokenAt = new Date();
    sprint.streakWarning = false;
    sprint.streakStatus = 'broken';
    return { changed: true, streakStatus: 'broken' };
  }

  if (gap === 1 && !sprint.streakWarning && !sprint.streakBroken) {
    // Haven't done anything today yet — warn
    sprint.streakWarning = true;
    sprint.streakStatus = 'warning';
    return { changed: true, streakStatus: 'warning' };
  }

  sprint.streakStatus = resolveStatus(sprint);
  return { changed: false };
};

/**
 * Restore a broken streak.
 * Allowed only if missedDays ≤ MAX_RESTORE_DAYS.
 * Returns true if restore was applied.
 */
const restoreStreak = (sprint) => {
  if (!canRestore(sprint)) return false;

  const today = startOfDay(new Date());
  const last = activityAnchor(sprint);
  const missedDays = last ? daysBetween(last, today) - 1 : 999;

  if (missedDays > MAX_RESTORE_DAYS) return false;

  // Restore: keep the streak as-is (don't increment — user just bridged the gap)
  sprint.streakBroken = false;
  sprint.streakBrokenAt = null;
  sprint.streakWarning = false;
  sprint.streakStatus = 'active';
  sprint.streakRestoredAt = new Date();
  // Keep the actual activity date; streakRestoredAt records the bridge separately.
  return true;
};

/** True if the user is eligible to restore their streak. */
const canRestore = (sprint) => {
  if (!sprint.streakBroken || !sprint.streakBrokenAt) return false;
  const last = activityAnchor(sprint);
  if (!last) return false;
  const today = startOfDay(new Date());
  const missedDays = daysBetween(last, today) - 1;
  return missedDays >= 1 && missedDays <= MAX_RESTORE_DAYS;
};

const resolveStatus = (sprint) => {
  if (sprint.streakBroken) return 'broken';
  if (sprint.streakWarning) return 'warning';
  return 'active';
};

const current = require('./sprintStreakPolicy');
const { isCurrentPolicy } = require('../utils/sprintCalendar');
const dispatch =
  (legacyFn, currentFn) =>
  (sprint, ...args) =>
    (isCurrentPolicy(sprint) ? currentFn : legacyFn)(sprint, ...args);
module.exports = {
  recordActivity: dispatch(recordActivity, current.recordActivity),
  checkInactivity: dispatch(checkInactivity, current.checkInactivity),
  restoreStreak: dispatch(restoreStreak, current.restoreStreak),
  canRestore: dispatch(canRestore, (sprint, now) => current.restoreState(sprint, now).canRestore),
  activityAnchor: dispatch(activityAnchor, current.anchor),
  MAX_RESTORE_DAYS
};
