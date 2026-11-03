'use strict';
const { Counter, Histogram } = require('prom-client');
const { registry } = require('./metricsService');
const outcomes = new Counter({
  name: 'dpa_skillgap_requests_total',
  help: 'Skill Gap outcomes with bounded labels only',
  labelNames: ['mode', 'status'],
  registers: [registry]
});
const duration = new Histogram({
  name: 'dpa_skillgap_request_seconds',
  help: 'End-to-end Skill Gap request duration',
  labelNames: ['mode'],
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 25],
  registers: [registry]
});
const analysis = new Counter({
  name: 'dpa_skillgap_analysis_total',
  help: 'Skill Gap cache and qualitative AI outcomes',
  labelNames: ['cache', 'ai'],
  registers: [registry]
});
const stages = new Histogram({
  name: 'dpa_skillgap_stage_seconds',
  help: 'Bounded Skill Gap source and calculation stages',
  labelNames: ['stage'],
  buckets: [0.005, 0.02, 0.1, 0.5, 1, 3, 7, 15],
  registers: [registry]
});
function completed(data) {
  const cache = [
    'memory_hit',
    'shared_hit',
    'backend_hit',
    'historical_hit',
    'temporary_preview_cache',
    'backend_stored',
    'temporary_no_backend_cache'
  ].includes(data.cache)
    ? data.cache
    : 'other';
  analysis.inc({ cache, ai: data.aiUsed ? 'used' : 'fallback' });
  for (const stage of [
    'resumeFetchMs',
    'githubPeekMs',
    'githubFetchMs',
    'signalAggregationMs',
    'aiResponseMs',
    'deterministicAnalysisMs',
    'cacheLookupMs',
    'cacheWriteMs'
  ]) {
    const ms = data.timings?.[stage];
    if (Number.isFinite(ms) && ms >= 0) stages.observe({ stage }, ms / 1000);
  }
}
function request(res, mode, started) {
  const status = res.statusCode >= 500 ? '5xx' : res.statusCode >= 400 ? '4xx' : '2xx';
  outcomes.inc({ mode, status });
  duration.observe({ mode }, (Date.now() - started) / 1000);
}
module.exports = { completed, request };
