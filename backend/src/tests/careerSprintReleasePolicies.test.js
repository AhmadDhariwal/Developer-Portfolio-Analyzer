'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { POLICY, calendar, sprintWindow, validateTimeZone, preferenceTimeZone } = require('../utils/sprintCalendar');
const streak = require('../services/sprintStreakPolicy');
const legacy = require('../services/streakService');
const { preflight } = require('../services/sprintReservationMigrationService');
const draft = require('../services/sprintDraftContextService');
const selection = require('../services/sprintAiSelectionService');

test('IANA validation, date-only parsing, pinned weeks and DST use Temporal calendar arithmetic', () => {
  for (const zone of ['UTC', 'Asia/Karachi', 'America/New_York']) assert.ok(validateTimeZone(zone));
  for (const zone of ['', '+05:00', 'Mars/Olympus', null, {}])
    assert.throws(() => validateTimeZone(zone), { statusCode: 400 });
  assert.equal(preferenceTimeZone('invalid'), 'UTC');
  const window = sprintWindow('America/New_York', '2026-03-02', '2026-03-08');
  assert.equal(window.calendarPolicy, POLICY);
  assert.equal(window.sprintStartDate.toISOString(), '2026-03-02T05:00:00.000Z');
  assert.equal(window.sprintEndDate.toISOString(), '2026-03-09T03:59:59.999Z');
  assert.equal(calendar(window).difference(window.sprintStartDate, window.sprintEndDate), 6);
  assert.equal(window.occupiedDays.length, 7);
  assert.throws(() => sprintWindow('UTC', '2026-02-30', '2026-03-04'));
  assert.throws(() => sprintWindow('America/New_York', '2026-03-08T02:30:00', null), { statusCode: 400 });
  assert.throws(() => sprintWindow('UTC', '2026-01-01', '2027-01-02'), { statusCode: 400 });
});

test('break instant and exclusive exact 48-hour expiry across spring/fall DST and local midnight', () => {
  for (const [zone, active, warning, broken, expiry] of [
    ['UTC', '2026-10-13T23:59:00Z', '2026-10-14T23:59:59Z', '2026-10-15T00:00:00Z', '2026-10-17T00:00:00Z'],
    ['Asia/Karachi', '2026-10-13T18:59:00Z', '2026-10-14T18:59:59Z', '2026-10-14T19:00:00Z', '2026-10-16T19:00:00Z'],
    [
      'America/New_York',
      '2026-03-07T04:59:00Z',
      '2026-03-08T04:59:59Z',
      '2026-03-08T05:00:00Z',
      '2026-03-10T05:00:00Z'
    ],
    ['America/New_York', '2026-10-31T03:59:00Z', '2026-11-01T03:59:59Z', '2026-11-01T04:00:00Z', '2026-11-03T04:00:00Z']
  ]) {
    const sprint = { calendarPolicy: POLICY, timeZone: zone, lastActiveDate: new Date(active), currentStreak: 4 };
    streak.checkInactivity(sprint, new Date(warning));
    assert.equal(sprint.streakStatus, 'warning');
    streak.checkInactivity(sprint, new Date(+new Date(broken) + 3600000));
    assert.equal(sprint.streakStatus, 'broken');
    assert.equal(sprint.streakBrokenAt.toISOString(), broken.replace('Z', '.000Z'));
    const state = streak.restoreState(sprint, new Date(broken));
    assert.equal(state.expiresAt.toISOString(), expiry.replace('Z', '.000Z'));
    assert.equal(+state.expiresAt - +state.breakAt, 48 * 3600000);
    assert.equal(streak.restoreState(sprint, new Date(+new Date(expiry) - 1)).canRestore, true);
    assert.equal(streak.restoreState(sprint, new Date(expiry)).canRestore, false);
    assert.equal(streak.restoreStreak(sprint, new Date(expiry)), false);
  }
});

test('restore bridges an interval once, never creates activity/XP, and real activity resumes the streak', () => {
  const sprint = {
    calendarPolicy: POLICY,
    timeZone: 'UTC',
    lastActiveDate: new Date('2026-10-13T12:00Z'),
    currentStreak: 4,
    longestStreak: 4,
    xpPoints: 23,
    tasks: []
  };
  const bridge = new Date('2026-10-15T12:00Z');
  assert.equal(streak.restoreStreak(sprint, bridge), true);
  assert.equal(streak.restoreStreak(sprint, bridge), false);
  assert.equal(sprint.lastActiveDate.toISOString(), '2026-10-13T12:00:00.000Z');
  assert.equal(sprint.xpPoints, 23);
  assert.equal(sprint.tasks.length, 0);
  assert.equal(streak.restoreStreak(sprint, new Date('2026-10-17T12:00Z')), false);
  streak.recordActivity(sprint, new Date('2026-10-16T12:00Z'));
  assert.equal(sprint.currentStreak, 5);
  streak.recordActivity(sprint, new Date('2026-10-16T15:00Z'));
  assert.equal(sprint.currentStreak, 5);
});

test('legacy policy remains legacy without adding a new-policy eligibility window', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-15T12:00Z') });
  const sprint = {
    currentStreak: 4,
    lastActiveDate: new Date('2026-10-11T12:00Z'),
    streakBroken: true,
    streakBrokenAt: new Date()
  };
  assert.equal(legacy.canRestore(sprint), true);
  assert.equal(legacy.restoreStreak(sprint), true);
  assert.equal(sprint.calendarPolicy, undefined);
  assert.equal(sprint.restoredIntervalId, undefined);
});

test('reservation preflight detects exact owned historical conflicts without modifying records', () => {
  const record = (id, userId, start, end) => ({
    _id: id,
    userId,
    weekStartDate: new Date(start),
    weekEndDate: new Date(end),
    tasks: [{ title: 'History' }],
    xpPoints: 42,
    currentStreak: 3
  });
  const records = [
    record('a', 'owner', '2026-10-01', '2026-10-07T23:59:59.999Z'),
    record('b', 'owner', '2026-10-07', '2026-10-14'),
    record('c', 'other', '2026-10-01', '2026-10-07')
  ];
  const before = JSON.stringify(records);
  const missingZone = preflight(records);
  assert.equal(missingZone.safe, false);
  assert.equal(missingZone.problems.length, 3);
  const report = preflight(records, { legacyTimeZone: 'UTC' });
  assert.equal(report.safe, false);
  assert.equal(report.conflicts.length, 1);
  assert.deepEqual(report.conflicts[0].ids, ['a', 'b']);
  assert.equal(report.proposals.length, 3);
  assert.equal(JSON.stringify(records), before);
  assert.equal(preflight([records[0], records[2]], { legacyTimeZone: 'UTC' }).safe, true);
});

test('draft context changes and legacy uncertainty require the current fingerprint acknowledgement', () => {
  const context = { version: draft.VERSION, ownerId: 'owner', careerStack: 'Backend', fingerprint: 'current' };
  assert.equal(draft.compatibility({}, context).status, 'legacy-context-unknown');
  assert.throws(() => draft.requireAcknowledgement({}, context, true), { statusCode: 409 });
  assert.doesNotThrow(() => draft.requireAcknowledgement({}, context, 'current'));
  const plan = { context: { ...context, fingerprint: 'old' } };
  assert.equal(draft.compatibility(plan, context).status, 'different-context');
  assert.throws(() => draft.requireAcknowledgement(plan, context, 'old'), { statusCode: 409 });
  assert.equal(plan.context.fingerprint, 'old');
});

test('AI target selection cannot introduce fabricated wording, scores, dates, ownership or source IDs', () => {
  const tasks = [
    { title: 'Practice a React component', category: 'practice', points: 4 },
    { title: 'Build an API project', category: 'project', points: 5 }
  ];
  const ids = selection.targets(tasks).map((target) => target.id);
  assert.deepEqual(selection.validate({ taskIds: [...ids].reverse() }, tasks).tasks, [...tasks].reverse());
  for (const extra of [
    { description: 'You are a certified expert' },
    { xpPoints: 99 },
    { isCompleted: true },
    { startDate: '2026-01-01' },
    { userId: 'foreign' },
    { sourceRecommendationId: 'made-up' }
  ])
    assert.equal(selection.validate({ taskIds: ids, ...extra }, tasks).ok, false);
  assert.equal(selection.validate({ taskIds: [ids[0], ids[0]] }, tasks).ok, false);
  assert.equal(selection.validate({ taskIds: [ids[0], 'fabricated-id'] }, tasks).ok, false);
  assert.equal(selection.validate({ tasks }, tasks).ok, false);
});
