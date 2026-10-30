const { Counter, Histogram } = require('prom-client');
const { registry } = require('./metricsService');

const outcomes = new Counter({
  name: 'dpa_portfolio_admission_total',
  help: 'Shared Mongo Portfolio admission outcomes',
  labelNames: ['operation', 'outcome'],
  registers: [registry]
});
const duration = new Histogram({
  name: 'dpa_portfolio_admission_duration_seconds',
  help: 'Mongo Portfolio admission duration, including initialization and retries',
  labelNames: ['operation'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  registers: [registry]
});
const operations = new Set([
  'view',
  'resume',
  'analytics',
  'mutation',
  'upload',
  'contact',
  'contact-recipient'
]);

function record(name, outcome, startedAt) {
  const operation = operations.has(name) ? name : 'other';
  outcomes.inc({ operation, outcome });
  duration.observe({ operation }, Number(process.hrtime.bigint() - startedAt) / 1e9);
}

module.exports = { record };
