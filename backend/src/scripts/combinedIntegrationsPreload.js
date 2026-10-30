'use strict';
// Acceptance-only preload: actual application routes and integration controls are unchanged.
for (const [modulePath, name] of [
  ['../services/emailRetryQueueService', 'startEmailRetryWorker'],
  ['../services/jobSourceSyncService', 'startJobSourceSyncWorker'],
  ['../services/newsService', 'startNewsIngestionScheduler'],
  ['../services/weeklyReportService', 'startWeeklyReportScheduler'],
  ['../services/interviewQuestionIngestionService', 'startInterviewQuestionIngestionScheduler'],
  ['../services/interviewQuestionMaintenanceService', 'startInterviewQuestionMaintenanceScheduler']
])
  require(modulePath)[name] = () => {};
const axios = require('axios');
require('mongoose').connection.on('connected', async () => {
  const user = await require('../models/user')
    .findOne({ email: 'combined-acceptance@invalid.test' })
    .select('+password')
    .lean();
  process.send?.({
    kind: 'fixture',
    present: Boolean(user),
    passwordMatches:
      Boolean(user?.password) &&
      (await require('bcryptjs').compare('Disposable-Acceptance-2026!', user.password))
  });
});
axios.interceptors.request.use((config) => {
  if (String(config.url).startsWith('https://'))
    process.send?.({ kind: 'externalRequest', host: new URL(config.url).hostname });
  return config;
});
const http = require('node:http');
const emit = http.Server.prototype.emit;
http.Server.prototype.emit = function (event, ...args) {
  if (event === 'request') {
    const [req, res] = args;
    if (
      String(req.url).startsWith('/api/integrations') ||
      String(req.url).startsWith('/api/auth/login')
    )
      res.once('finish', () =>
        process.send?.({
          kind: 'api',
          method: req.method,
          path: String(req.url).split('?')[0],
          status: res.statusCode
        })
      );
  }
  return emit.call(this, event, ...args);
};
