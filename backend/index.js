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

// Connect to database
connectDB();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);

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
