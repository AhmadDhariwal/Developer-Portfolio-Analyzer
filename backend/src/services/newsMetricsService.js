const client = require('prom-client');
const { registry } = require('./metricsService');
const metric = (name, Type, help, labelNames = []) =>
  registry.getSingleMetric(name) || new Type({ name, help, labelNames, registers: [registry] });
module.exports = {
  ingestion: metric('dpa_news_ingestion_total', client.Counter, 'Accepted catalog records by outcome', [
    'outcome'
  ]),
  queries: metric('dpa_news_catalog_reads_total', client.Counter, 'Public catalog reads by cache tier', [
    'tier'
  ]),
  admission: metric(
    'dpa_news_provider_admissions_total',
    client.Counter,
    'Provider reservations and denials',
    ['provider', 'reason']
  ),
  queueDelay: metric('dpa_news_queue_delay_ms', client.Histogram, 'Discovery queue delay before processing'),
  size: metric(
    'dpa_news_catalog_articles',
    client.Gauge,
    'Eligible catalog size at latest coverage evaluation'
  ),
  coverage: metric('dpa_news_topic_articles', client.Gauge, 'Recent article coverage by reviewed taxonomy', [
    'topic'
  ])
};
