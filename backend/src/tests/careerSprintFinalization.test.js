'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const {
  normalizeTask,
  xpForTask,
  levelFromXp,
  calcWeightedProgress,
  serializeSprint
} = require('../services/careerSprintService');
const streak = require('../services/streakService');

test('all task categories and priorities retain deterministic defaults and XP', () => {
  for (const [category, points] of Object.entries({ learning: 3, project: 5, practice: 4 })) {
    for (const [priority, base] of Object.entries({ high: 15, medium: 10, low: 5 })) {
      const task = normalizeTask({ title: 'Review owned work', category, priority });
      assert.equal(task.points, points);
      assert.equal(xpForTask(task), base + points);
      for (const valid of [1, 10])
        assert.equal(normalizeTask({ title: 'Review work', category, points: valid }).points, valid);
    }
  }
});

test('invalid payloads fail instead of silently changing their meaning', () => {
  const invalid = [
    null,
    [],
    {},
    { title: ' ' },
    { title: 'x'.repeat(121) },
    { title: 'Task', description: 'x'.repeat(1001) },
    ...[0, -1, 11, Infinity, NaN, null, '5'].map((points) => ({ title: 'Task', points })),
    { title: 'Task', category: 'credential' },
    { title: 'Task', priority: 'urgent' },
    { title: 'Task', taskType: 'verified' },
    { title: 'Task', isCompleted: true },
    { title: 'Task', startDate: '2026-10-10', endDate: '2026-10-09' },
    { title: 'Task', startDate: 'bad' }
  ];
  for (const payload of invalid)
    assert.throws(
      () => normalizeTask(payload),
      (error) => [400, 413].includes(error.statusCode)
    );
  assert.equal(normalizeTask({ title: ' Task\u0000 title ', xpPoints: 999 }).title, 'Task title');
  assert.equal(normalizeTask({ title: 'Task', completedAt: new Date(), xpPoints: 999 }).isCompleted, false);
});

test('XP boundaries and weighted progress round according to approved scoring', () => {
  assert.equal(levelFromXp(Infinity), 1);
  assert.equal(xpForTask({ priority: 'medium', points: Infinity }), 10);
  for (const [xp, level] of [
    [0, 1],
    [99, 1],
    [100, 2],
    [199, 2],
    [200, 3]
  ])
    assert.equal(levelFromXp(xp), level);
  assert.equal(calcWeightedProgress([]), 0);
  assert.equal(calcWeightedProgress([{ points: 1, isCompleted: true }, { points: 2 }]), 33);
  assert.equal(calcWeightedProgress([{ points: 10, isCompleted: true }]), 100);
});

test('analytics exclude incomplete work from activity and apply overdue penalty', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-15T12:00:00Z') });
  const result = await serializeSprint(
    {
      userId: 'owner',
      calendarPolicy: 'sprint-calendar-48h-v1',
      timeZone: 'UTC',
      tasks: [
        { points: 5, isCompleted: true, completedAt: new Date(), endDate: new Date('2026-10-14') },
        { points: 5, isCompleted: false, completedAt: null, endDate: new Date('2026-10-14') }
      ]
    },
    { signals: null }
  );
  assert.equal(result.analytics.progressPercent, 50);
  assert.equal(result.analytics.overdueTasks, 1);
  assert.equal(result.analytics.completedInLastSevenDays, 1);
  assert.equal(result.analytics.productivityScore, 19);
  assert.equal(result.analytics.consistencyScore, 33);
});

test('streak restoration bridges once without fabricating a completion day', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-15T12:00:00Z') });
  const sprint = { currentStreak: 4, longestStreak: 4, lastActiveDate: new Date('2026-10-13T12:00:00Z') };
  assert.equal(streak.checkInactivity(sprint).changed, true);
  assert.equal(streak.canRestore(sprint), true);
  assert.equal(streak.restoreStreak(sprint), true);
  assert.equal(streak.restoreStreak(sprint), false);
  assert.equal(streak.checkInactivity(sprint).changed, false);
  assert.equal(sprint.currentStreak, 4);
  assert.equal(sprint.lastActiveDate.toISOString(), '2026-10-13T12:00:00.000Z');
  streak.recordActivity(sprint);
  streak.recordActivity(sprint);
  assert.equal(sprint.currentStreak, 4);
  t.mock.timers.setTime(new Date('2026-10-16T12:00:00Z').getTime());
  streak.recordActivity(sprint);
  assert.equal(sprint.currentStreak, 5);
  assert.equal(sprint.longestStreak, 5);
});

test('existing restore eligibility is calendar based, including its last permitted day', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-15T12:00:00Z') });
  const make = (day) => ({
    streakBroken: true,
    streakBrokenAt: new Date(),
    lastActiveDate: new Date(`2026-10-${day}T12:00:00Z`)
  });
  assert.equal(streak.canRestore(make('11')), true);
  assert.equal(streak.canRestore(make('10')), false);
  assert.equal(streak.canRestore(make('16')), false);
});

test('server-calendar day calculations survive DST and midnight in supported host zones', () => {
  for (const timezone of ['UTC', 'Asia/Karachi', 'America/New_York']) {
    const code = `const assert=require('node:assert/strict'); const d=require(${JSON.stringify(require.resolve('../utils/dateUtils'))});
      for(const date of ['2026-03-08T00:00:00','2026-11-01T00:00:00']) {
        const start=new Date(date); assert.equal(d.daysBetween(start,d.addDays(start,1)),1);
        assert.equal(d.daysBetween(start,new Date(+d.endOfDay(start)+1)),1);
      }`;
    execFileSync(process.execPath, ['-e', code], { env: { ...process.env, TZ: timezone } });
  }
});
