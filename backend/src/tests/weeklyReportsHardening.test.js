const test = require('node:test');
const assert = require('node:assert/strict');
const calendar = require('../services/weeklyReportCalendar');
const { isGrounded } = require('../services/weeklyReportNarrative');
const Report = require('../models/weeklyReport');

test('configured week boundaries survive DST and do not depend on server timezone', (t) => {
  const old = process.env.WEEKLY_REPORT_TIMEZONE;
  t.after(() =>
    old === undefined
      ? delete process.env.WEEKLY_REPORT_TIMEZONE
      : (process.env.WEEKLY_REPORT_TIMEZONE = old),
  );
  process.env.WEEKLY_REPORT_TIMEZONE = 'America/New_York';
  const start = calendar.startOfWeek(new Date('2026-03-08T12:00:00Z'));
  assert.equal(start.toISOString(), '2026-03-02T05:00:00.000Z');
  assert.equal(calendar.endOfWeek(start).toISOString(), '2026-03-09T03:59:59.999Z');
  assert.equal(calendar.previousWeekRange(start).end.getTime(), start.getTime() - 1);
});

test('AI cannot introduce fabricated facts, achievements, numbers or malformed list values', () => {
  const facts = {
    progressSummary: 'Score 50.',
    insights: ['Observed 1.', 'Observed 2.'],
    recommendations: ['Review evidence.'],
    topAchievements: ['Completed 1.'],
  };
  assert.equal(isGrounded({ ...facts, insights: [...facts.insights].reverse() }, facts), true);
  for (const candidate of [
    null,
    { ...facts, progressSummary: '90% chance of being hired.' },
    { ...facts, topAchievements: ['Shipped 10 projects.'] },
    { ...facts, insights: [{ text: 'Observed 1.' }, 'Observed 2.'] },
  ])
    assert.equal(isGrounded(candidate, facts), false);
});

test('persistence retains ninth source and stale-source warning without changing scores', () => {
  const report = new Report({
    meta: {
      sourceFreshness: { detection: true },
      dataSourcesUsed: {
        learning: { available: true, status: 'Self-reported', freshness: 'stale' },
      },
    },
  });
  assert.equal(report.meta.sourceFreshness.detection, true);
  assert.equal(report.meta.dataSourcesUsed.learning.available, true);
});
