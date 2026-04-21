/**
 * Day-based streak service.
 *
 * Rules:
 *   - A "streak day" = any calendar day on which the user completes ≥ 1 task.
 *   - If today == lastActiveDate          → no change (already counted today)
 *   - If today == lastActiveDate + 1 day  → currentStreak++
 *   - If today >  lastActiveDate + 1 day  → streak broken, reset to 1
 *   - On break: update longestStreak if needed
 *   - Restore: allowed if missedDays ≤ 3 (within 72 h of last active day)
 */

const { startOfDay, daysBetween, isSameDay } = require('../utils/dateUtils');

const MAX_RESTORE_DAYS = 3;

/**
 * Call this whenever a task is completed.
 * Mutates the sprint document in-place; caller must save().
 *
 * @param {Object} sprint  - Mongoose sprint document
 * @returns {{ changed: boolean, streakStatus: string }}
 */
const recordActivity = (sprint) => {
  const today = startOfDay(new Date());
  const last  = sprint.lastActiveDate ? startOfDay(sprint.lastActiveDate) : null;

  // Already recorded today — nothing to do
  if (last && isSameDay(last, today)) {
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
      sprint.streakBroken  = true;
      sprint.streakBrokenAt = new Date();
    }
  }

  // Update longest
  sprint.longestStreak = Math.max(sprint.longestStreak || 0, sprint.currentStreak);

  // Clear broken flag if we're back on track
  if (sprint.streakBroken && sprint.currentStreak > 0) {
    sprint.streakBroken   = false;
    sprint.streakBrokenAt = null;
  }

  sprint.lastActiveDate = today;
  sprint.streak         = sprint.currentStreak; // keep legacy field in sync
  sprint.streakStatus   = resolveStatus(sprint);

  return { changed: true, streakStatus: sprint.streakStatus };
};

/**
 * Check if the streak should be marked as broken due to inactivity.
 * Call on login / daily cron.
 * Mutates sprint in-place; caller must save() if changed === true.
 */
const checkInactivity = (sprint) => {
  const today = startOfDay(new Date());
  const last  = sprint.lastActiveDate ? startOfDay(sprint.lastActiveDate) : null;

  if (!last || (sprint.currentStreak || 0) === 0) {
    sprint.streakStatus = resolveStatus(sprint);
    return { changed: false };
  }

  const gap = daysBetween(last, today);

  if (gap > 1 && !sprint.streakBroken) {
    // Missed at least one day
    sprint.longestStreak  = Math.max(sprint.longestStreak || 0, sprint.currentStreak || 0);
    sprint.streakBroken   = true;
    sprint.streakBrokenAt = new Date();
    sprint.streakWarning  = false;
    sprint.streakStatus   = 'broken';
    return { changed: true, streakStatus: 'broken' };
  }

  if (gap === 1 && !sprint.streakWarning && !sprint.streakBroken) {
    // Haven't done anything today yet — warn
    sprint.streakWarning = true;
    sprint.streakStatus  = 'warning';
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
  if (!sprint.streakBroken || !sprint.streakBrokenAt) return false;

  const today = startOfDay(new Date());
  const last  = sprint.lastActiveDate ? startOfDay(sprint.lastActiveDate) : null;
  const missedDays = last ? daysBetween(last, today) - 1 : 999;

  if (missedDays > MAX_RESTORE_DAYS) return false;

  // Restore: keep the streak as-is (don't increment — user just bridged the gap)
  sprint.streakBroken   = false;
  sprint.streakBrokenAt = null;
  sprint.streakWarning  = false;
  sprint.streakStatus   = 'active';
  // Don't reset lastActiveDate — next real completion will advance it
  return true;
};

/** True if the user is eligible to restore their streak. */
const canRestore = (sprint) => {
  if (!sprint.streakBroken || !sprint.streakBrokenAt) return false;
  const last = sprint.lastActiveDate ? startOfDay(sprint.lastActiveDate) : null;
  if (!last) return false;
  const today = startOfDay(new Date());
  const missedDays = daysBetween(last, today) - 1;
  return missedDays <= MAX_RESTORE_DAYS;
};

const resolveStatus = (sprint) => {
  if (sprint.streakBroken)  return 'broken';
  if (sprint.streakWarning) return 'warning';
  return 'active';
};

module.exports = { recordActivity, checkInactivity, restoreStreak, canRestore, MAX_RESTORE_DAYS };
