'use strict';

const client = require('prom-client');
const { registry } = require('./metricsService');
const events = new client.Counter({
  name: 'dpa_scenario_events_total',
  help: 'Bounded Scenario operation outcomes',
  labelNames: ['operation', 'status', 'version'],
  registers: [registry],
});
const latency = new client.Histogram({
  name: 'dpa_scenario_source_duration_ms',
  help: 'Scenario source read latency',
  labelNames: ['source', 'status'],
  buckets: [10, 50, 100, 250, 750, 2000],
  registers: [registry],
});
const source = (name, status, duration) => latency.observe({ source: name, status }, duration);
const event = (operation, status, version = 'none') => events.inc({ operation, status, version });
module.exports = { source, event };
