const { z } = require('zod');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(5000),
  JWT_SECRET: z.string().min(8),
  JWT_EXPIRES_IN: z.string().default('20h'),
  JWT_ISSUER: z.string().default('devinsight-api'),
  JWT_AUDIENCE: z.string().default('devinsight-web'),
  REDIS_URL: z.string().optional(),
  INTERVIEW_QUESTION_INGEST_CRON: z.string().optional(),
  SECURITY_STRICT_ENV: z.string().optional(),
  OTEL_SERVICE_NAME: z.string().default('developer-portfolio-analyzer-api'),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),
  METRICS_ALERT_LATENCY_MS: z.coerce.number().int().positive().default(1800),
  METRICS_ALERT_ERROR_RATE: z.coerce.number().min(0).max(1).default(0.2),
  NEWS_API_KEY: z.string().optional(),
  GNEWS_API_KEY: z.string().optional()
});

const mask = (value) => {
  if (!value) return '';
  if (value.length <= 6) return '***';
  return `${value.slice(0, 2)}***${value.slice(-2)}`;
};

const validateEnv = () => {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`Environment validation failed: ${issues.join('; ')}`);
  }

  const env = parsed.data;
  const weakSecret = String(env.JWT_SECRET || '').length < 24;
  const strictMode = String(env.SECURITY_STRICT_ENV || '').toLowerCase() === 'true';

  if (weakSecret && strictMode) {
    throw new Error('JWT_SECRET is too weak. Use at least 24 characters in strict mode.');
  }

  if (weakSecret) {
    console.warn('[security] JWT_SECRET appears weak. Use 24+ chars for production hardening.');
  }

  console.log(`[config] env loaded: NODE_ENV=${env.NODE_ENV}, PORT=${env.PORT}, JWT_ISSUER=${env.JWT_ISSUER}, JWT_AUDIENCE=${env.JWT_AUDIENCE}, JWT_SECRET=${mask(env.JWT_SECRET)}`);
  return env;
};

module.exports = { validateEnv };
