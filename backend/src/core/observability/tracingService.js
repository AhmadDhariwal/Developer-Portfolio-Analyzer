const logger = require('./logger');

let sdk = null;

const initTracing = async () => {
  if (String(process.env.OTEL_SDK_DISABLED || '').toLowerCase() === 'true') {
    return;
  }
  try {
    const { NodeSDK } = require('@opentelemetry/sdk-node');
    const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');

    sdk = new NodeSDK({
      serviceName: process.env.OTEL_SERVICE_NAME || 'developer-portfolio-analyzer-api',
      instrumentations: [getNodeAutoInstrumentations()]
    });

    await sdk.start();
    logger.info('OpenTelemetry tracing initialized', {
      serviceName: process.env.OTEL_SERVICE_NAME || 'developer-portfolio-analyzer-api'
    });
  } catch (error) {
    logger.warn('OpenTelemetry tracing disabled', { reason: error.message });
  }
};

const shutdownTracing = async () => {
  if (!sdk) return;
  const active = sdk;
  sdk = null;
  try {
    await active.shutdown();
    logger.info('OpenTelemetry tracing shutdown complete');
  } catch (error) {
    logger.error('OpenTelemetry shutdown failed', { reason: error.message });
  }
};

module.exports = { initTracing, shutdownTracing };
