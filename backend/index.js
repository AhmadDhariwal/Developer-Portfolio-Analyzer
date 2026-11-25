const path = require('node:path');
require('dotenv').config({
  path: path.resolve(__dirname, '.env'),
  quiet: true,
});
const { validateEnv } = require('./src/core/config/env');
const env = validateEnv();
const localApiOnly = process.argv.includes('--api-only');
if (localApiOnly && env.NODE_ENV !== 'development') {
  throw Error('--api-only is available only in development.');
}

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const connectDB = require('./src/core/config/db');
const logger = require('./src/core/observability/logger');
const requestLogPath = require('./src/core/observability/requestLogPath');
const authroute = require('./src/modules/auth/auth.routes');
const githubroute = require('./src/modules/github/github.routes');
const resumroute = require('./src/modules/resume/resume.routes');
const analysisroute = require('./src/modules/workflows/analysis.routes');
const dashboardroute = require('./src/modules/dashboard/dashboard.routes');
const skillgaproute = require('./src/modules/skill-gap/skillgap.routes');
const recommendationsroute = require('./src/modules/recommendations/recommendations.routes');
const profileroute = require('./src/modules/profile/profile.routes');
const courseroute = require('./src/modules/courses/courseRoutes');
const jobroute = require('./src/modules/jobs/jobRoutes');
const notificationroute = require('./src/modules/notifications/notification.routes');
const auditroute = require('./src/modules/admin/routes/audit.routes');
const workflowroute = require('./src/modules/workflows/workflow.routes');
const aiversionsroute = require('./src/modules/super-admin/routes/aiversions.routes');
const tenantroute = require('./src/modules/admin/routes/tenant.routes');
const skillgraphroute = require('./src/modules/skill-gap/skillgraph.routes');
const integrationsroute = require('./src/modules/integrations/integrations.routes');
const scenarioroute = require('./src/modules/scenario-simulator/scenarioSimulator.routes');
const publicProfileroute = require('./src/modules/public-portfolio/publicProfile.routes');
const recruiterroute = require('./src/modules/recruiter/routes/recruiter.routes');
const recruiterHubRoute = require('./src/modules/recruiter/routes/hub/recruiterHubRoutes');
const adminroute = require('./src/modules/admin/routes/admin.routes');
const adminConsoleroute = require('./src/modules/admin/routes/adminConsole.routes');
const weeklyReportroute = require('./src/modules/weekly-reports/weeklyReport.routes');
const interviewPreproute = require('./src/modules/interview-prep/interviewPrep.routes');
const careerSprintroute = require('./src/modules/career-sprint/careerSprint.routes');
const newsroute = require('./src/modules/news/newsRoutes');
const {
  startNewsIngestionScheduler,
  stopNewsIngestionScheduler,
} = require('./src/modules/news/services/newsService');
const supportroute = require('./src/modules/support/support.routes');
const previewroute = require('./src/modules/workflows/preview.routes');
const { auditLogMiddleware } = require('./src/core/middleware/auditLogMiddleware');
const { requestContextMiddleware } = require('./src/core/middleware/requestContextMiddleware');
const { globalRateLimiter } = require('./src/core/middleware/securityMiddleware');
const { metricsMiddleware, metricsHandler } = require('./src/core/observability/metricsService');
const { initTracing, shutdownTracing } = require('./src/core/observability/tracingService');
const superAdminRoutes = require('./src/modules/super-admin/routes/super-admin.routes');
const {
  startEmailRetryWorker,
  stopEmailRetryWorker,
} = require('./src/core/messaging/emailRetryQueueService');
const {
  startIntegrationSyncWorker,
  stopIntegrationSyncWorker,
} = require('./src/modules/integrations/services/integrationSyncService');
const {
  startJobSourceSyncWorker,
  stopJobSourceSyncWorker,
} = require('./src/modules/jobs/services/jobSourceSyncService');
const {
  startWeeklyReportScheduler,
  stopWeeklyReportScheduler,
} = require('./src/modules/weekly-reports/services/weeklyReportService');
const { initRedisCache, closeRedisCache } = require('./src/core/cache/redisCacheService');
const {
  startInterviewQuestionIngestionScheduler,
  stopInterviewQuestionIngestionScheduler,
} = require('./src/modules/interview-prep/services/interviewQuestionIngestionService');
const {
  startInterviewQuestionMaintenanceScheduler,
  stopInterviewQuestionMaintenanceScheduler,
} = require('./src/modules/interview-prep/services/interviewQuestionMaintenanceService');
const {
  getSettingsSnapshotSync,
  getSettings,
  startSettingsSynchronization,
  stopSettingsSynchronization,
} = require('./src/modules/super-admin/services/platformSettingsService');

const app = express();
const shouldLogRequests = String(process.env.LOG_REQUESTS || '').toLowerCase() === 'true';
const parseCsv = (value = '') =>
  String(value || '')
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
  ...localDevOrigins,
];
const cspImageSources = [
  "'self'",
  'data:',
  'https:',
  ...configuredFrontendOrigins,
  ...configuredApiOrigins,
  ...parseCsv(process.env.CSP_IMG_SRC),
  ...localDevOrigins,
];

// Middleware
app.use((req, _res, next) => {
  if (
    req.method === 'POST' &&
    String(req.originalUrl || req.url || '').startsWith('/api/skillgap/skill-gap')
  ) {
    req.skillGapHttpStartedAt = Date.now();
  }
  next();
});
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        connectSrc: [...new Set(cspConnectSources)],
        imgSrc: [...new Set(cspImageSources)],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  }),
);
app.use(cors());
app.use(async (_req, res, next) => {
  try {
    await getSettings();
    return next();
  } catch {
    return res.status(503).json({ message: 'Platform settings are temporarily unavailable.' });
  }
});
app.use(globalRateLimiter);
app.use(requestContextMiddleware);
app.use(
  express.json({
    limit: '100kb',
    verify: require('./src/modules/integrations/middleware/integrationWebhookBody'),
  }),
);
app.use(express.urlencoded({ extended: true, limit: '100kb' }));

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

    return res.status(503).json({
      message: 'Platform is under maintenance. Please try again later.',
    });
  } catch {
    return res.status(503).json({ message: 'Platform settings are temporarily unavailable.' });
  }
});
require('./src/core/storage/b2ObjectStorageService').configuration();
// Serve uploads with cache control to prevent stale avatar issues
app.use(
  '/uploads',
  require('./src/core/middleware/storedImageMiddleware').storedImage,
  require('./src/core/middleware/publicUploadAccess'),
  express.static(require('./src/core/storage/publicImageStorageService').root()),
);
app.use(metricsMiddleware);
if (shouldLogRequests) {
  app.use((req, _res, next) => {
    logger.info('request', {
      requestId: req.requestId,
      method: req.method,
      path: requestLogPath(req),
    });
    next();
  });
}
app.use(auditLogMiddleware);

// Basic route
app.get('/', (req, res) => {
  res.send('DevInsight AI API is running...');
});

app.use('/api/auth', authroute);
app.use('/api/github', githubroute);
app.use('/api/resume', resumroute);
app.use('/api/analysis', analysisroute);
app.use('/api/dashboard', dashboardroute);
app.use('/api/super-admin', superAdminRoutes);
app.use('/api/skillgap', skillgaproute);
app.use('/api/recommendations', recommendationsroute);
app.use('/api/profile', profileroute);
app.use('/api/courses', courseroute);
app.use('/api/jobs', jobroute);
app.use('/api/notifications', notificationroute);
app.use('/api/audit-logs', auditroute);
app.use('/api/workflows', workflowroute);
app.use('/api/ai-versions', aiversionsroute);
app.use('/api/tenant', tenantroute);
app.use('/api/skill-graph', skillgraphroute);
app.use('/api/integrations', integrationsroute);
app.use('/api/simulator', scenarioroute);
app.use('/api/public-profiles', publicProfileroute);
app.use('/api/recruiter', recruiterroute);
app.use('/api/recruiter-hub', recruiterHubRoute);
app.use('/api/admin', adminroute);
app.use('/api/admin-console', adminConsoleroute);
app.use('/api/weekly-reports', weeklyReportroute);
app.use('/api/interview-prep', interviewPreproute);
app.use('/api/career-sprints', careerSprintroute);
app.use('/api/news', newsroute);
app.use('/api/support', supportroute);
app.use('/api/preview', previewroute);
app.get('/metrics', metricsHandler);

app.use((error, _req, res, next) => {
  if (error?.type === 'entity.too.large' || error?.status === 413) {
    return res.status(413).json({
      message: 'Request too large. Please upload a smaller resume or use file upload.',
    });
  }
  return next(error);
});

const PORT = env.PORT || process.env.PORT || 5000;
const REDIS_STARTUP_TIMEOUT_MS = 4000;

const initializeRedisAtStartup = async () => {
  let timer;
  try {
    const redis = await Promise.race([
      initRedisCache({ silent: true }),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(null), REDIS_STARTUP_TIMEOUT_MS);
        timer.unref?.();
      }),
    ]);
    if (redis) {
      console.log('[redis] connected');
    } else {
      console.warn('[redis] connection unavailable; using application fallbacks.');
    }
  } catch (error) {
    console.warn('[redis] initialization error; using application fallbacks:', error?.message);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

let server;
let shutdownPromise;
const workerStops = [];
const startWorker = (start, stop) => {
  if (start() !== null) workerStops.push(stop);
};
const closeResources = async () => {
  await Promise.allSettled([closeRedisCache(), shutdownTracing()]);
  await require('mongoose').disconnect();
};
const startupCancelled = async () => {
  if (!shutdownPromise) return false;
  stopSettingsSynchronization();
  await closeResources();
  return true;
};

const startServer = async () => {
  await connectDB();
  if (await startupCancelled()) return;
  await initializeRedisAtStartup();
  if (await startupCancelled()) return;
  let retention;
  let courses;
  if (!localApiOnly) {
    retention = require('./src/modules/notifications/services/notificationRetentionService');
    if (process.env.COURSES_MAINTENANCE_ENABLED !== 'false') {
      courses = require('./src/modules/courses/services/courseCatalogMaintenanceService');
    }
    await initTracing();
    if (await startupCancelled()) return;
  }
  await startSettingsSynchronization();
  if (await startupCancelled()) return;

  server = app.listen(PORT, localApiOnly ? 'localhost' : undefined, () => {
    logger.info('server started', { port: PORT });
    if (localApiOnly) {
      logger.info('development API-only mode: loopback listener; background workers disabled.');
      return;
    }
    startWorker(retention.start, retention.stop);
    startWorker(startEmailRetryWorker, stopEmailRetryWorker);
    startWorker(startIntegrationSyncWorker, stopIntegrationSyncWorker);
    startWorker(startJobSourceSyncWorker, stopJobSourceSyncWorker);
    startWorker(startNewsIngestionScheduler, stopNewsIngestionScheduler);
    if (courses) startWorker(courses.start, courses.stop);
    if (process.env.WEEKLY_REPORT_PROCESS_ROLE !== 'api')
      startWorker(startWeeklyReportScheduler, stopWeeklyReportScheduler);
    startWorker(startInterviewQuestionIngestionScheduler, stopInterviewQuestionIngestionScheduler);
    startWorker(
      startInterviewQuestionMaintenanceScheduler,
      stopInterviewQuestionMaintenanceScheduler,
    );
    getSettings().catch((err) => logger.warn('settings warmup failed', { error: err?.message }));

    // Warn if GitHub token is missing (will hit rate limits very quickly)
    const ghToken = process.env.GITHUB_TOKEN;
    if (!ghToken || ghToken === 'your_github_personal_access_token') {
      logger.warn('GITHUB_TOKEN is not configured; authenticated quota unavailable.');
    } else {
      logger.info('GitHub token detected; using authenticated API quota.');
    }
    // Jobs Hub cache health startup check
    const { getCacheHealth } = require('./src/modules/jobs/services/jobService');
    getCacheHealth()
      .then((health) => {
        console.log(
          `[JobsHub] Cache status: ${health.cacheStatus} (${health.totalCachedJobs} jobs)`,
        );
        if (health.cacheStatus === 'LOW') {
          console.warn('[JobsHub] WARNING: Job cache size below recommended threshold (100 jobs).');
        }
      })
      .catch((err) => {
        console.warn('[JobsHub] Cache health check skipped:', err.message);
      });
  });
};

startServer().catch(async (error) => {
  logger.error('server startup failed', {
    error: error?.message || 'Unknown startup error',
  });
  process.exitCode = 1;
  await shutdown();
});

const shutdown = () => {
  if (shutdownPromise) return shutdownPromise;
  stopSettingsSynchronization();
  // Shutdown must not refresh policy settings after synchronization/storage stop.
  const deadline = setTimeout(() => {
    console.error(
      'shutdown deadline exceeded; unfinished jobs retain their durable recovery leases',
    );
    server?.closeAllConnections();
    process.exit(1);
  }, 15000);
  deadline.unref();
  shutdownPromise = (async () => {
    const listenerClosed = new Promise((resolve) => {
      if (!server) return resolve();
      server.close(resolve);
      server.closeIdleConnections();
    });
    const drains = workerStops.splice(0).map((stop) => Promise.resolve().then(stop));
    drains.push(require('./src/modules/notifications/services/notificationStreamService').stop());
    const results = await Promise.allSettled([listenerClosed, ...drains]);
    if (results.some((result) => result.status === 'rejected')) {
      console.error('worker drain failed; shutdown deadline remains active');
      process.exitCode = 1;
      return;
    }
    try {
      await closeResources();
    } catch {
      console.error('resource shutdown failed; shutdown deadline remains active');
      process.exitCode = 1;
      return;
    }
    clearTimeout(deadline);
    console.info('server shutdown completed');
  })();
  return shutdownPromise;
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
