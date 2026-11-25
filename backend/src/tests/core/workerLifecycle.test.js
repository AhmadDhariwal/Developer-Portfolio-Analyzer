const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

test('all six worker stop hooks cancel scheduling and await owned work', async () => {
  const previous = {
    NODE_ENV: process.env.NODE_ENV,
    WEEKLY_REPORT_SCHEDULER_ENABLED: process.env.WEEKLY_REPORT_SCHEDULER_ENABLED
  };
  process.env.NODE_ENV = 'production';
  process.env.WEEKLY_REPORT_SCHEDULER_ENABLED = 'true';
  const cases = [
    [
      'core/messaging/emailRetryQueueService.js',
      'startEmailRetryWorker',
      'stopEmailRetryWorker',
      'email'
    ],
    [
      'modules/integrations/services/integrationSyncService.js',
      'startIntegrationSyncWorker',
      'stopIntegrationSyncWorker',
      'integration'
    ],
    [
      'modules/jobs/services/jobSourceSyncService.js',
      'startJobSourceSyncWorker',
      'stopJobSourceSyncWorker',
      'jobs'
    ],
    [
      'modules/weekly-reports/services/weeklyReportService.js',
      'startWeeklyReportScheduler',
      'stopWeeklyReportScheduler',
      'weekly'
    ],
    [
      'modules/interview-prep/services/interviewQuestionIngestionService.js',
      'startInterviewQuestionIngestionScheduler',
      'stopInterviewQuestionIngestionScheduler',
      'ingestion'
    ],
    [
      'modules/interview-prep/services/interviewQuestionMaintenanceService.js',
      'startInterviewQuestionMaintenanceScheduler',
      'stopInterviewQuestionMaintenanceScheduler',
      'maintenance'
    ]
  ];
  try {
    for (const [relative, start, stop, kind] of cases) {
      let resolveWork;
      const work = new Promise((resolve) => {
        resolveWork = resolve;
      });
      let tick;
      let stopped = false;
      const handle = {
        unref() {},
        stop() {
          stopped = true;
        },
        destroy() {}
      };
      const clocks = {
        setInterval(callback) {
          tick = callback;
          return handle;
        },
        clearInterval() {
          stopped = true;
        }
      };
      const query = {
        sort() {
          return this;
        },
        limit() {
          return this;
        },
        select() {
          return this;
        },
        lean() {
          return work;
        }
      };
      const filename = path.resolve(__dirname, '../../', relative);
      const unit = new Module(filename, module);
      unit.filename = filename;
      unit.paths = Module._nodeModulePaths(path.dirname(filename));
      const original = unit.require.bind(unit);
      unit.require = (name) => {
        if (name === '__lifecycleClocks') return clocks;
        if (name === 'node-cron')
          return {
            schedule(_expression, callback) {
              tick = callback;
              return handle;
            }
          };
        if (name === 'mongoose')
          return { connection: { readyState: 1 }, Schema: require('mongoose').Schema };
        if (kind === 'email' && name === './models/emailDeliveryJob') return { find: () => query };
        if (kind === 'integration' && name === '../models/integrationConnection')
          return { find: () => query };
        if (kind === 'jobs' && name === './jobService') return { refreshJobCache: () => work };
        if (kind === 'weekly' && name === './weeklyReportCoordinationService')
          return { withLease: () => work };
        if (['ingestion', 'maintenance'].includes(kind) && name === './interviewJobService')
          return { runInterviewJob: () => work };
        return original(name);
      };
      unit._compile(
        "const { setInterval, clearInterval } = require('__lifecycleClocks');\n" +
          fs.readFileSync(filename, 'utf8'),
        filename
      );
      unit.exports[start]();
      if (kind !== 'jobs') tick();
      let drained = false;
      const drain = Promise.resolve(unit.exports[stop]()).then(() => {
        drained = true;
      });
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(stopped, true, `${kind} cancels its schedule`);
      assert.equal(drained, false, `${kind} retains owned work until completion`);
      resolveWork([]);
      await drain;
      await unit.exports[stop]();
      console.log(JSON.stringify({ worker: kind, drained: true }));
    }
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test('installed node-cron tasks are removed from its registry on repeated start and stop', async () => {
  const cron = require('node-cron');
  const ingestion = require('../../modules/interview-prep/services/interviewQuestionIngestionService');
  const maintenance = require('../../modules/interview-prep/services/interviewQuestionMaintenanceService');
  const before = cron.getTasks().size;
  for (let index = 0; index < 5; index++) {
    ingestion.startInterviewQuestionIngestionScheduler();
    maintenance.startInterviewQuestionMaintenanceScheduler();
    assert.equal(cron.getTasks().size, before + 2);
    await ingestion.stopInterviewQuestionIngestionScheduler();
    await maintenance.stopInterviewQuestionMaintenanceScheduler();
    assert.equal(cron.getTasks().size, before);
  }
});
