const test = require('node:test');
const assert = require('node:assert/strict');
const requestLogPath = require('../../core/observability/requestLogPath');

test('application evaluation, evidence and mutation routes redact private identifiers and queries', () => {
  for (const path of [
    '/api/recruiter-hub/jobs/job-secret/applications/application-secret',
    '/api/recruiter-hub/jobs/job-secret/applications/application-secret/shortlist',
    '/api/recruiter-hub/jobs/job-secret/applications/application-secret/resume',
    '/api/recruiter-hub/shortlists/applications',
    '/API/recruiter-hub/shortlists/applications/evaluation-secret/'
  ]) {
    assert.equal(
      requestLogPath({ originalUrl: path + '?search=private-name' }),
      '/api/recruiter-hub/private-application-evaluation'
    );
  }
});

test('public evaluation routes retain their existing log representation', () => {
  for (const originalUrl of [
    '/api/recruiter-hub/shortlists?jobId=public-job',
    '/api/recruiter-hub/jobs/public-job',
    '/api/recruiter-hub/shortlists/applications-extra'
  ]) {
    assert.equal(requestLogPath({ originalUrl }), originalUrl);
  }
});
