require('dotenv').config();
const express = require('express');
const cors = require('cors');
const connectDB = require('./src/config/db');
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
const { auditLogMiddleware } = require('./src/middleware/auditLogMiddleware');
const { startEmailRetryWorker } = require('./src/services/emailRetryQueueService');

// Connect to database
connectDB();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static('uploads'));
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

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    startEmailRetryWorker();

    // Warn if GitHub token is missing (will hit rate limits very quickly)
    const ghToken = process.env.GITHUB_TOKEN;
    if (!ghToken || ghToken === 'your_github_personal_access_token') {
        console.warn('\n⚠️  WARNING: GITHUB_TOKEN is not set in .env');
        console.warn('   Anonymous GitHub API calls are limited to 60 requests/hour.');
        console.warn('   Create a token at https://github.com/settings/tokens and add it to backend/.env\n');
    } else {
        console.log('✅  GitHub token detected — using authenticated API (5000 req/hour)');
    }
});
