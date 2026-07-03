const test = require('node:test');
const assert = require('node:assert/strict');
const cron = require('node-cron');
const { runWeeklyReportBatch, startWeeklyReportScheduler } = require('../services/weeklyReportService');

test('weekly report batch dry-run generates and sends nothing', async (t) => {
  const originalDryRun = process.env.WEEKLY_REPORT_DRY_RUN;
  const originalSchedulerDryRun = process.env.WEEKLY_REPORT_SCHEDULER_DRY_RUN;
  t.after(() => {
    if (originalDryRun === undefined) delete process.env.WEEKLY_REPORT_DRY_RUN;
    else process.env.WEEKLY_REPORT_DRY_RUN = originalDryRun;
    if (originalSchedulerDryRun === undefined) delete process.env.WEEKLY_REPORT_SCHEDULER_DRY_RUN;
    else process.env.WEEKLY_REPORT_SCHEDULER_DRY_RUN = originalSchedulerDryRun;
  });
  process.env.WEEKLY_REPORT_DRY_RUN = 'false';
  process.env.WEEKLY_REPORT_SCHEDULER_DRY_RUN = 'true';
  let generated = 0;
  let emailed = 0;
  const result = await runWeeklyReportBatch({
    usersOverride: [{ _id: 'user-1', email: 'developer@example.com' }],
    generate: async () => { generated += 1; },
    sendEmail: async () => { emailed += 1; }
  });

  assert.equal(generated, 0);
  assert.equal(emailed, 0);
  assert.equal(result.dryRun, true);
  assert.equal(result.skipped, 1);
});

test('weekly report batch non-dry-run allows generation and email path', async (t) => {
  const originalDryRun = process.env.WEEKLY_REPORT_DRY_RUN;
  const originalSchedulerDryRun = process.env.WEEKLY_REPORT_SCHEDULER_DRY_RUN;
  t.after(() => {
    if (originalDryRun === undefined) delete process.env.WEEKLY_REPORT_DRY_RUN;
    else process.env.WEEKLY_REPORT_DRY_RUN = originalDryRun;
    if (originalSchedulerDryRun === undefined) delete process.env.WEEKLY_REPORT_SCHEDULER_DRY_RUN;
    else process.env.WEEKLY_REPORT_SCHEDULER_DRY_RUN = originalSchedulerDryRun;
  });
  process.env.WEEKLY_REPORT_DRY_RUN = 'false';
  process.env.WEEKLY_REPORT_SCHEDULER_DRY_RUN = 'false';
  let generated = 0;
  let emailed = 0;
  const result = await runWeeklyReportBatch({
    usersOverride: [{ _id: 'user-1', email: 'developer@example.com' }],
    generate: async () => {
      generated += 1;
      return { _id: 'report-1' };
    },
    sendEmail: async () => {
      emailed += 1;
      return { sent: true };
    }
  });

  assert.equal(generated, 1);
  assert.equal(emailed, 1);
  assert.equal(result.dryRun, false);
  assert.equal(result.generated, 1);
  assert.equal(result.emailed, 1);
});

test('scheduler starts once and passes the configured timezone', (t) => {
  const originalSchedule = cron.schedule;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalEnabled = process.env.WEEKLY_REPORT_SCHEDULER_ENABLED;
  const originalTimezone = process.env.WEEKLY_REPORT_TIMEZONE;
  const task = { stop() {} };
  let starts = 0;
  let options;
  t.after(() => {
    cron.schedule = originalSchedule;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalEnabled === undefined) delete process.env.WEEKLY_REPORT_SCHEDULER_ENABLED;
    else process.env.WEEKLY_REPORT_SCHEDULER_ENABLED = originalEnabled;
    if (originalTimezone === undefined) delete process.env.WEEKLY_REPORT_TIMEZONE;
    else process.env.WEEKLY_REPORT_TIMEZONE = originalTimezone;
  });
  cron.schedule = (_expression, _callback, cronOptions) => {
    starts += 1;
    options = cronOptions;
    return task;
  };
  process.env.NODE_ENV = 'production';
  process.env.WEEKLY_REPORT_SCHEDULER_ENABLED = 'true';
  process.env.WEEKLY_REPORT_TIMEZONE = 'Asia/Karachi';

  assert.equal(startWeeklyReportScheduler(), task);
  assert.equal(startWeeklyReportScheduler(), task);
  assert.equal(starts, 1);
  assert.deepEqual(options, { timezone: 'Asia/Karachi' });
});
