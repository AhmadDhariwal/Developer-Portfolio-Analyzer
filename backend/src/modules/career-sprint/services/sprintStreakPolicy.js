'use strict';

const { calendar, POLICY } = require('../utils/sprintCalendar');
const RESTORE_MS = 48 * 60 * 60 * 1000;

const anchor = (sprint) => {
  const actual = sprint.lastActiveDate ? new Date(sprint.lastActiveDate) : null;
  const bridge = sprint.streakRestoredAt ? new Date(sprint.streakRestoredAt) : null;
  return bridge && actual && bridge > actual ? bridge : actual;
};
const restoreState = (sprint, now = new Date()) => {
  const c = calendar(sprint);
  const last = anchor(sprint);
  const breakAt = last && Number(sprint.currentStreak) > 0 ? c.add(last, 2) : null;
  const expiresAt = breakAt ? new Date(+breakAt + RESTORE_MS) : null;
  const intervalId = sprint.lastActiveDate ? c.add(sprint.lastActiveDate, 2).toISOString() : null;
  const eligible = Boolean(breakAt && now >= breakAt && now < expiresAt && sprint.restoredIntervalId !== intervalId);
  return {
    policy: POLICY,
    breakAt,
    expiresAt,
    intervalId,
    canRestore: eligible,
    remainingRestoreMs: eligible ? +expiresAt - +now : 0
  };
};
const checkInactivity = (sprint, now = new Date()) => {
  const before = JSON.stringify([
    sprint.streakBroken,
    sprint.streakBrokenAt,
    sprint.streakWarning,
    sprint.streakStatus
  ]);
  const last = anchor(sprint);
  const gap = last ? calendar(sprint).difference(last, now) : 0;
  const state = restoreState(sprint, now);
  sprint.streakBroken = Boolean(last && sprint.currentStreak > 0 && gap >= 2);
  sprint.streakBrokenAt = sprint.streakBroken ? state.breakAt : null;
  sprint.streakWarning = Boolean(last && sprint.currentStreak > 0 && gap === 1);
  sprint.streakStatus = sprint.streakBroken ? 'broken' : sprint.streakWarning ? 'warning' : 'active';
  return {
    changed:
      before !==
      JSON.stringify([sprint.streakBroken, sprint.streakBrokenAt, sprint.streakWarning, sprint.streakStatus]),
    streakStatus: sprint.streakStatus
  };
};
const recordActivity = (sprint, now = new Date()) => {
  const c = calendar(sprint);
  const last = anchor(sprint);
  const gap = last ? c.difference(last, now) : null;
  if (gap !== 0) sprint.currentStreak = gap === 1 ? Number(sprint.currentStreak || 0) + 1 : 1;
  sprint.longestStreak = Math.max(Number(sprint.longestStreak || 0), Number(sprint.currentStreak || 1));
  sprint.lastActiveDate = now;
  sprint.streak = sprint.currentStreak;
  sprint.streakBroken = false;
  sprint.streakBrokenAt = null;
  sprint.streakWarning = false;
  sprint.streakStatus = 'active';
  return { changed: gap !== 0, streakStatus: 'active' };
};
const restoreStreak = (sprint, now = new Date()) => {
  const state = restoreState(sprint, now);
  if (!state.canRestore) return false;
  sprint.restoredIntervalId = state.intervalId;
  sprint.streakRestoredAt = now;
  checkInactivity(sprint, now);
  return true;
};
module.exports = { anchor, restoreState, checkInactivity, recordActivity, restoreStreak, RESTORE_MS };
