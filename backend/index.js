require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
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
const weeklyReportroute      = require('./src/routes/weeklyReport.routes');
const interviewPreproute     = require('./src/routes/interviewPrep.routes');
const careerSprintroute      = require('./src/routes/careerSprint.routes');
const { auditLogMiddleware } = require('./src/middleware/auditLogMiddleware');
const { requestContextMiddleware } = require('./src/middleware/requestContextMiddleware');
const { globalRateLimiter } = require('./src/middleware/securityMiddleware');
const { metricsMiddleware, metricsHandler } = require('./src/services/metricsService');
const { initTracing, shutdownTracing } = require('./src/services/tracingService');
const { startEmailRetryWorker } = require('./src/services/emailRetryQueueService');
const { startIntegrationSyncWorker } = require('./src/services/integrationSyncService');
const { startWeeklyReportScheduler } = require('./src/services/weeklyReportService');
const { initRedisCache } = require('./src/services/redisCacheService');
const { startInterviewQuestionIngestionScheduler } = require('./src/services/interviewQuestionIngestionService');

const env = validateEnv();

// Connect to database
connectDB();

const app = express();
const shouldLogRequests = String(process.env.LOG_REQUESTS || '').toLowerCase() === 'true';

// Middleware
app.use(helmet({
    contentSecurityPolicy: {
        useDefaults: true,
        directives: {
            defaultSrc: ["'self'"],
            connectSrc: ["'self'", 'http://localhost:4200', 'http://localhost:3000', 'http://localhost:5000'],
            imgSrc: ["'self'", 'data:', 'https:'],
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
app.use('/uploads', express.static('uploads'));
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
app.use('/api/weekly-reports',  weeklyReportroute);
app.use('/api/interview-prep',  interviewPreproute);
app.use('/api/career-sprints',  careerSprintroute);
app.get('/metrics', metricsHandler);

const PORT = env.PORT || process.env.PORT || 5000;

app.listen(PORT, () => {
    logger.info('server started', { port: PORT });
    initRedisCache();
    startEmailRetryWorker();
    startIntegrationSyncWorker();
    initTracing();
    startWeeklyReportScheduler();
    startInterviewQuestionIngestionScheduler();

    // Warn if GitHub token is missing (will hit rate limits very quickly)
    const ghToken = process.env.GITHUB_TOKEN;
    if (!ghToken || ghToken === 'your_github_personal_access_token') {
        logger.warn('GITHUB_TOKEN is not configured; authenticated quota unavailable.');
    } else {
        logger.info('GitHub token detected; using authenticated API quota.');
    }
});

process.on('SIGTERM', () => {
    shutdownTracing();
});

process.on('SIGINT', () => {
    shutdownTracing();
});
