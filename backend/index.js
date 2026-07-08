require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('node:path');
const connectDB = require('./src/config/db');
const { validateEnv } = require('./src/config/env');
const logger = require('./src/utils/logger');
const authroute      = require('./src/routes/auth.routes');
const githubroute    = require('./src/routes/github.routes');
const resumroute     = require('./src/routes/resume.routes');
const analysisroute  = require('./src/routes/analysis.routes');
const dashboardroute = require('./src/routes/dashboard.routes');
const skillgaproute          = require('./src/routes/skillgap.routes');
const recommendationsroute   = require('./src/routes/recommendations.routes');
const profileroute           = require('./src/routes/profile.routes');
const courseroute            = require('./src/routes/courseRoutes');
const jobroute               = require('./src/routes/jobRoutes');
const notificationroute      = require('./src/routes/notification.routes');
const auditroute             = require('./src/routes/audit.routes');
const workflowroute          = require('./src/routes/workflow.routes');
const aiversionsroute        = require('./src/routes/aiversions.routes');
const tenantroute            = require('./src/routes/tenant.routes');
const skillgraphroute        = require('./src/routes/skillgraph.routes');
const integrationsroute      = require('./src/routes/integrations.routes');
const scenarioroute          = require('./src/routes/scenarioSimulator.routes');
const publicProfileroute     = require('./src/routes/publicProfile.routes');
const recruiterroute         = require('./src/routes/recruiter.routes');
const recruiterHubRoute      = require('./src/routes/recruiter-hub/recruiterHubRoutes');
const adminroute             = require('./src/routes/admin.routes');
const adminConsoleroute      = require('./src/routes/adminConsole.routes');
const weeklyReportroute      = require('./src/routes/weeklyReport.routes');
const interviewPreproute     = require('./src/routes/interviewPrep.routes');
const careerSprintroute      = require('./src/routes/careerSprint.routes');
const newsroute              = require('./src/routes/newsRoutes');
const supportroute           = require('./src/routes/support.routes');
const { auditLogMiddleware } = require('./src/middleware/auditLogMiddleware');
const { requestContextMiddleware } = require('./src/middleware/requestContextMiddleware');
const { globalRateLimiter } = require('./src/middleware/securityMiddleware');
const { metricsMiddleware, metricsHandler } = require('./src/services/metricsService');
const { initTracing, shutdownTracing } = require('./src/services/tracingService');
const superAdminRoutes = require('./src/routes/super-admin.routes');
const { startEmailRetryWorker } = require('./src/services/emailRetryQueueService');
const { startIntegrationSyncWorker } = require('./src/services/integrationSyncService');
const { startJobSourceSyncWorker } = require('./src/services/jobSourceSyncService');
const { startWeeklyReportScheduler } = require('./src/services/weeklyReportService');
const { initRedisCache } = require('./src/services/redisCacheService');
const { startInterviewQuestionIngestionScheduler } = require('./src/services/interviewQuestionIngestionService');
const { startInterviewQuestionMaintenanceScheduler } = require('./src/services/interviewQuestionMaintenanceService');
const { getSettingsSnapshotSync, getSettings } = require('./src/services/platformSettingsService');

const env = validateEnv();

// Connect to database
connectDB();

const app = express();
const shouldLogRequests = String(process.env.LOG_REQUESTS || '').toLowerCase() === 'true';
const parseCsv = (value = '') => String(value || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);
const isProduction = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
const configuredFrontendOrigins = parseCsv(process.env.FRONTEND_BASE_URL);
const configuredApiOrigins = parseCsv(process.env.API_BASE_URL || process.env.PUBLIC_API_ORIGIN);
const localDevOrigins = isProduction ? [] : ['http://localhost:*', 'http://127.0.0.1:*'];
const cspConnectSources = [
  "'self'",
  ...configuredFrontendOrigins,
  ...configuredApiOrigins,
  ...parseCsv(process.env.CSP_CONNECT_SRC),
  ...localDevOrigins
];
const cspImageSources = [
  "'self'",
  'data:',
  'https:',
  ...configuredFrontendOrigins,
  ...configuredApiOrigins,
  ...parseCsv(process.env.CSP_IMG_SRC),
  ...localDevOrigins
];

// Middleware
app.use((req, _res, next) => {
  if (req.method === 'POST' && String(req.originalUrl || req.url || '').startsWith('/api/skillgap/skill-gap')) {
    req.skillGapHttpStartedAt = Date.now();
  }
  next();
});
app.use(helmet({
    contentSecurityPolicy: {
        useDefaults: true,
        directives: {
            defaultSrc: ["'self'"],
            connectSrc: [...new Set(cspConnectSources)],
            imgSrc: [...new Set(cspImageSources)],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            frameAncestors: ["'none'"]
        }
    },
    crossOriginEmbedderPolicy: false
}));
app.use(cors());
app.use(globalRateLimiter);
app.use(requestContextMiddleware);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Global maintenance mode (controlled by Super Admin settings).
// Keep auth + super-admin routes accessible so admins can turn it off.
app.use((req, res, next) => {
  try {
    const maintenance = Boolean(getSettingsSnapshotSync()?.general?.maintenanceMode);
    if (!maintenance) return next();

    const path = String(req.path || req.originalUrl || '');
    if (path.startsWith('/api/super-admin')) return next();
    if (path.startsWith('/api/auth')) return next();
    if (path === '/' || path.startsWith('/metrics') || path.startsWith('/uploads')) return next();

    return res.status(503).json({ message: 'Platform is under maintenance. Please try again later.' });
  } catch {
    return next();
  }
});
// Serve uploads with cache control to prevent stale avatar issues
app.use('/uploads', (req, res, next) => {
  // Set cache control headers to allow browser caching but enable revalidation
  res.setHeader('Cache-Control', 'public, max-age=3600, must-revalidate');
  next();
}, express.static(path.join(__dirname, 'uploads')));
app.use(metricsMiddleware);
if (shouldLogRequests) {
    app.use((req, _res, next) => {
        logger.info('request', {
            requestId: req.requestId,
            method: req.method,
            path: req.originalUrl
        });
        next();
    });
}
app.use(auditLogMiddleware);

// Basic route
app.get('/', (req, res) => {
    res.send('DevInsight AI API is running...');
});

app.use('/api/auth',      authroute);
app.use('/api/github',    githubroute);
app.use('/api/resume',    resumroute);
app.use('/api/analysis',        analysisroute);
app.use('/api/dashboard',       dashboardroute);
app.use('/api/super-admin',     superAdminRoutes);
app.use('/api/skillgap',        skillgaproute);
app.use('/api/recommendations', recommendationsroute);
app.use('/api/profile',         profileroute);
app.use('/api/courses',         courseroute);
app.use('/api/jobs',            jobroute);
app.use('/api/notifications',   notificationroute);
app.use('/api/audit-logs',      auditroute);
app.use('/api/workflows',       workflowroute);
app.use('/api/ai-versions',     aiversionsroute);
app.use('/api/tenant',          tenantroute);
app.use('/api/skill-graph',     skillgraphroute);
app.use('/api/integrations',    integrationsroute);
app.use('/api/simulator',       scenarioroute);
app.use('/api/public-profiles', publicProfileroute);
app.use('/api/recruiter',       recruiterroute);
app.use('/api/recruiter-hub',   recruiterHubRoute);
app.use('/api/admin',           adminroute);
app.use('/api/admin-console',   adminConsoleroute);
app.use('/api/weekly-reports',  weeklyReportroute);
app.use('/api/interview-prep',  interviewPreproute);
app.use('/api/career-sprints',  careerSprintroute);
app.use('/api/news',            newsroute);
app.use('/api/support',         supportroute);
app.get('/metrics', metricsHandler);

const PORT = env.PORT || process.env.PORT || 5000;

app.listen(PORT, () => {
    logger.info('server started', { port: PORT });
    initRedisCache();
    startEmailRetryWorker();
    startIntegrationSyncWorker();
    startJobSourceSyncWorker();
    initTracing();
    startWeeklyReportScheduler();
    startInterviewQuestionIngestionScheduler();
    startInterviewQuestionMaintenanceScheduler();
    getSettings().catch((err) => logger.warn('settings warmup failed', { error: err?.message }));

    // Warn if GitHub token is missing (will hit rate limits very quickly)
    const ghToken = process.env.GITHUB_TOKEN;
    if (!ghToken || ghToken === 'your_github_personal_access_token') {
        logger.warn('GITHUB_TOKEN is not configured; authenticated quota unavailable.');
    } else {
        logger.info('GitHub token detected; using authenticated API quota.');
    }

    // ── Jobs Hub source startup validation ──────────────────────────────────
    const { getIntegrationSecretsSync } = require('./src/services/platformSettingsService');
    const integrations = getIntegrationSecretsSync();
    const rapidApiKey = String(process.env.RAPIDAPI_KEY || integrations?.jobsApiKey || '').trim();

    const jsearchConfigured = integrations?.jobsEnabled !== false && Boolean(rapidApiKey && rapidApiKey !== 'your_rapidapi_key');
    const joobleConfigured = Boolean(String(process.env.JOOBLE_API_KEY || '').trim());
    const adzunaConfigured = Boolean(String(process.env.ADZUNA_APP_ID || '').trim() && String(process.env.ADZUNA_APP_KEY || '').trim());

    // ── Jobs Hub cache health startup check ─────────────────────────────────
    const { getCacheHealth } = require('./src/services/jobService');
    getCacheHealth().then((health) => {
      console.log(`[JobsHub] Cache status: ${health.cacheStatus} (${health.totalCachedJobs} jobs)`);
      if (health.cacheStatus === 'LOW') {
        console.warn('[JobsHub] WARNING: Job cache size below recommended threshold (100 jobs).');
      }
    }).catch((err) => {
      console.warn('[JobsHub] Cache health check skipped:', err.message);
    });
});

process.on('SIGTERM', () => {
    shutdownTracing();
});

process.on('SIGINT', () => {
    shutdownTracing();
});
