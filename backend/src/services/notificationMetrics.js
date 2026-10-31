const { Counter, Gauge, Histogram } = require('prom-client');
const { registry } = require('./metricsService');

const outcomes = new Counter({
  name: 'dpa_notification_operations_total',
  help: 'Notification operations by bounded operation and outcome',
  labelNames: ['operation', 'outcome'],
  registers: [registry]
});
const connections = new Gauge({
  name: 'dpa_notification_stream_connections',
  help: 'Active notification streams in this worker',
  registers: [registry]
});
const duration = new Histogram({
  name: 'dpa_notification_operation_seconds',
  help: 'Notification persistence and reconciliation duration',
  labelNames: ['operation'],
  registers: [registry]
});
const deliveryLag = new Histogram({
  name: 'dpa_notification_delivery_lag_seconds',
  help: 'Durable revision change to server stream write lag; not network acknowledgement',
  buckets: [0.01, 0.1, 0.5, 1, 5, 15, 30, 60],
  registers: [registry]
});
const backlog = new Gauge({
  name: 'dpa_notification_email_backlog',
  help: 'Observed shared email backlog; aggregate with max across workers, not sum',
  labelNames: ['kind', 'state'],
  registers: [registry]
});
async function recordBacklog(kind, Model) {
  const [pending, unresolved] = await Promise.all([
    Model.countDocuments({ 'emailDelivery.status': { $in: ['pending', 'retrying'] } }).maxTimeMS(
      2000
    ),
    Model.countDocuments({ 'emailDelivery.status': { $in: ['uncertain', 'failed'] } }).maxTimeMS(
      2000
    )
  ]);
  backlog.set({ kind, state: 'pending' }, pending);
  backlog.set({ kind, state: 'unresolved' }, unresolved);
}
module.exports = { outcomes, connections, duration, deliveryLag, recordBacklog };
