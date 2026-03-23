const client = require('prom-client');
const logger = require('../utils/logger');

const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry, prefix: 'dpa_' });

const httpRequestDurationMs = new client.Histogram({
  name: 'dpa_http_request_duration_ms',
  help: 'HTTP request duration in ms',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [25, 50, 100, 250, 500, 1000, 2000, 5000]
});

const httpRequestsTotal = new client.Counter({
  name: 'dpa_http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status_code']
});

const httpErrorsTotal = new client.Counter({
  name: 'dpa_http_errors_total',
  help: 'Total HTTP error responses',
  labelNames: ['method', 'route', 'status_code']
});

registry.registerMetric(httpRequestDurationMs);
registry.registerMetric(httpRequestsTotal);
registry.registerMetric(httpErrorsTotal);

const alertWindow = [];

const trimWindow = (now) => {
  const WINDOW_MS = 60 * 1000;
  while (alertWindow.length && now - alertWindow[0].ts > WINDOW_MS) {
    alertWindow.shift();
  }
};

const evaluateAlerts = ({ method, route, statusCode, durationMs }) => {
  const now = Date.now();
  alertWindow.push({ ts: now, statusCode, durationMs });
  trimWindow(now);

  const latencyThreshold = Number(process.env.METRICS_ALERT_LATENCY_MS || 1800);
  const errorRateThreshold = Number(process.env.METRICS_ALERT_ERROR_RATE || 0.2);

  if (durationMs >= latencyThreshold) {
    logger.warn('latency alert threshold breached', {
      alertType: 'latency',
      method,
      route,
      statusCode,
      durationMs,
      thresholdMs: latencyThreshold
    });
  }

  const sampleSize = alertWindow.length;
  if (sampleSize < 10) return;

  const errors = alertWindow.filter((item) => Number(item.statusCode) >= 500).length;
  const errorRate = errors / sampleSize;

  if (errorRate >= errorRateThreshold) {
    logger.error('error-rate alert threshold breached', {
      alertType: 'error_rate',
      sampleSize,
      errors,
      errorRate: Number(errorRate.toFixed(3)),
      threshold: errorRateThreshold
    });
  }
};

const normalizeRoute = (req) => {
  if (req?.route?.path) return req.route.path;
  const path = String(req?.baseUrl || '') + String(req?.path || '');
  return path || 'unknown_route';
};

const metricsMiddleware = (req, res, next) => {
  const start = process.hrtime.bigint();

  res.on('finish', () => {
    const end = process.hrtime.bigint();
    const durationMs = Number(end - start) / 1_000_000;
    const method = req.method;
    const route = normalizeRoute(req);
    const statusCode = String(res.statusCode);

    const labels = { method, route, status_code: statusCode };
    httpRequestDurationMs.observe(labels, durationMs);
    httpRequestsTotal.inc(labels, 1);

    if (res.statusCode >= 500) {
      httpErrorsTotal.inc(labels, 1);
    }

    evaluateAlerts({ method, route, statusCode: res.statusCode, durationMs });
  });

  next();
};

const metricsHandler = async (_req, res) => {
  res.set('Content-Type', registry.contentType);
  res.end(await registry.metrics());
};

module.exports = { metricsMiddleware, metricsHandler };
