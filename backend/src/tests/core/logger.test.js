const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../fixtures/publicPortfolioFixture');

const loadLogger = (getAnalyticsSettingsSync) =>
  load('core/observability/logger.js', {
    './platformSettingsService': { getAnalyticsSettingsSync }
  });

test('all log levels remain available when settings cannot be read on the first log', (t) => {
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = 'debug';
  t.after(() => {
    if (previous === undefined) delete process.env.LOG_LEVEL;
    else process.env.LOG_LEVEL = previous;
  });
  const output = [];
  for (const method of ['log', 'warn', 'error']) {
    t.mock.method(console, method, (line) => output.push({ method, line }));
  }
  const logger = loadLogger(() => {
    throw Object.assign(new Error('Platform settings are temporarily unavailable.'), {
      status: 503
    });
  });

  for (const level of ['debug', 'info', 'warn', 'error']) {
    assert.doesNotThrow(() =>
      logger[level]('startup diagnostic', { worker: 'interview-ingestion' })
    );
  }
  assert.deepEqual(
    output.map(({ method }) => method),
    ['log', 'log', 'warn', 'error']
  );
  assert.deepEqual(
    output.map(({ line }) => JSON.parse(line).level),
    ['debug', 'info', 'warn', 'error']
  );
  for (const { line } of output) {
    const record = JSON.parse(line);
    assert.equal(record.message, 'startup diagnostic');
    assert.equal(record.worker, 'interview-ingestion');
    assert.ok(Number.isFinite(Date.parse(record.ts)));
  }
});

test('logging retains its configured format during an outage and follows recovered settings', (t) => {
  let analytics = { enableStructuredLogging: false };
  const logger = loadLogger(() => {
    if (!analytics) throw new Error('Settings storage unavailable');
    return analytics;
  });
  const output = [];
  t.mock.method(console, 'warn', (line) => output.push(line));

  logger.warn('configured');
  analytics = null;
  logger.warn('outage');
  analytics = { enableStructuredLogging: true };
  logger.warn('recovered', { worker: 'interview-ingestion' });
  analytics = null;
  logger.warn('another outage');

  assert.match(output[0], /^\[.*\] WARN configured$/);
  assert.match(output[1], /^\[.*\] WARN outage$/);
  assert.equal(JSON.parse(output[2]).message, 'recovered');
  assert.equal(JSON.parse(output[2]).worker, 'interview-ingestion');
  assert.equal(JSON.parse(output[3]).message, 'another outage');
});

test('filtered messages do not read settings or write output', (t) => {
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = 'error';
  t.after(() => {
    if (previous === undefined) delete process.env.LOG_LEVEL;
    else process.env.LOG_LEVEL = previous;
  });
  const logger = loadLogger(() => assert.fail('Filtered messages must not read settings'));
  t.mock.method(console, 'log', () => assert.fail('Filtered messages must not write output'));
  t.mock.method(console, 'warn', () => assert.fail('Filtered messages must not write output'));

  logger.debug('filtered');
  logger.info('filtered');
  logger.warn('filtered');
});

test('expired settings do not break scheduler startup or error logging, and policies still fail closed', async (t) => {
  let stored;
  let storageUnavailable = false;
  const settings = load('modules/super-admin/services/platformSettingsService.js', {
    '../models/platformSettings': {
      findOne: () => ({
        setOptions() {
          return this;
        },
        async lean() {
          if (storageUnavailable) throw new Error('Settings storage unavailable');
          return stored;
        }
      })
    },
    './redisCacheService': { getRedisCacheClient: () => null }
  });
  stored = structuredClone(settings.DEFAULT_SETTINGS);
  stored.recruiter.enableRecruiterAccess = false;
  await settings.startSettingsSynchronization();
  settings.stopSettingsSynchronization();
  const logger = loadLogger(settings.getAnalyticsSettingsSync);
  const output = [];
  t.mock.method(console, 'log', (line) => output.push(JSON.parse(line)));
  t.mock.method(console, 'error', (line) => output.push(JSON.parse(line)));
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  t.after(() => settings.stopSettingsSynchronization());
  t.mock.timers.tick(31000);
  storageUnavailable = true;

  assert.throws(() => settings.getRecruiterSettingsSync(), { status: 503 });
  let tick;
  const stopped = t.mock.fn();
  const scheduler = load('modules/interview-prep/services/interviewQuestionIngestionService.js', {
    'node-cron': {
      schedule(_expression, callback) {
        tick = callback;
        return { stop: stopped };
      }
    },
    './logger': logger,
    './interviewJobService': {
      runInterviewJob: async () => {
        throw new Error('Ingestion failed');
      }
    },
    './redisCacheService': {},
    './interviewTopicNormalizer': {},
    './interviewScraperProvider': {},
    './interviewQuestionRepository': {},
    './interviewQuestionQualityService': {}
  });
  t.after(() => scheduler.stopInterviewQuestionIngestionScheduler());

  assert.doesNotThrow(() => scheduler.startInterviewQuestionIngestionScheduler());
  assert.equal(output[0].message, 'interview-ingestion scheduler started');
  await tick();
  assert.equal(output[1].level, 'error');
  assert.equal(output[1].message, 'Ingestion failed');
  await assert.rejects(settings.getSettings(), /Settings storage unavailable/);
  assert.throws(() => settings.getIntegrationSecretsSync(), { status: 503 });
  scheduler.stopInterviewQuestionIngestionScheduler();
  assert.equal(stopped.mock.callCount(), 1);

  // Only a successful authoritative refresh restores policy reads and logging preferences.
  await assert.rejects(settings.getSettings(), /Settings storage unavailable/);
  storageUnavailable = false;
  stored.analytics.enableStructuredLogging = false;
  await settings.getSettings();
  assert.equal(settings.getRecruiterSettingsSync().enableRecruiterAccess, false);
  const recovered = [];
  t.mock.method(console, 'warn', (line) => recovered.push(line));
  logger.warn('settings recovered');
  assert.match(recovered[0], /^\[.*\] WARN settings recovered$/);
});
