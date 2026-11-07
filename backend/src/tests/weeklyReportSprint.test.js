'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  __test: { buildSprintSnapshot }
} = require('../services/weeklyReportService');
const Report = require('../models/weeklyReport');

test('report overdue count uses strict deadline precedence and excludes completed or unscheduled tasks', () => {
  const now = new Date('2026-11-07T00:00:00Z');
  const snapshot = buildSprintSnapshot(
    {
      tasks: [
        { endDate: '2026-11-06T23:59:59.999Z' },
        { deadline: '2026-11-06T12:00:00Z' },
        { dueDate: '2026-11-06T12:00:00Z' },
        { endDate: now },
        { endDate: '2026-11-08T00:00:00Z', deadline: '2026-11-06T00:00:00Z' },
        { isCompleted: true, endDate: '2026-11-06T12:00:00Z' },
        { endDate: 'invalid' },
        {}
      ]
    },
    now
  );
  assert.equal(snapshot.tasksOverdue, 3);
  assert.equal(snapshot.tasksCompleted, 1);
  assert.equal(snapshot.tasksTotal, 8);
  assert.equal(snapshot.completionRate, 13, 'Existing task-count scoring must remain unchanged.');
});

test('report deadlines normalized to pinned day-end become overdue only after that instant', () => {
  const { sprintWindow } = require('../utils/sprintCalendar');
  const task = { endDate: sprintWindow('Asia/Karachi', '2026-11-06', '2026-11-06').sprintEndDate };
  assert.equal(buildSprintSnapshot({ tasks: [task] }, task.endDate).tasksOverdue, 0);
  assert.equal(buildSprintSnapshot({ tasks: [task] }, new Date(+task.endDate + 1)).tasksOverdue, 1);
  assert.equal(buildSprintSnapshot(null).tasksOverdue, 0);
});

test('new report schema retains overdue count without inventing zero for historical snapshots', () => {
  const current = new Report({ meta: { sprint: { tasksOverdue: 3 } } });
  assert.equal(current.toObject().meta.sprint.tasksOverdue, 3);
  const historical = new Report({ meta: { sprint: { tasksCompleted: 1 } } });
  assert.equal(historical.toObject().meta.sprint.tasksOverdue, undefined);
});
