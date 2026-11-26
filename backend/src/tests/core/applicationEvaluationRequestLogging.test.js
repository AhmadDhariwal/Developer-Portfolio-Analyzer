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

test('public evaluation routes retain only a validated public job filter', () => {
  for (const originalUrl of [
    '/api/recruiter-hub/shortlists?jobId=0123456789abcdef01234567',
    '/api/recruiter-hub/jobs/public-job',
    '/api/recruiter-hub/shortlists/applications-extra'
  ]) {
    assert.equal(requestLogPath({ originalUrl }), originalUrl);
  }
});

test('public shortlist diagnostics exclude ambiguous, unbounded and private values', () => {
  const pathname = '/api/recruiter-hub/shortlists';
  const jobId = '0123456789abcdef01234567';
  assert.equal(
    requestLogPath({ originalUrl: `${pathname}?%6AobId=${jobId}&token=synthetic-secret` }),
    `${pathname}?jobId=${jobId}`
  );
  for (const query of [
    'jobId=public-job',
    `jobId=${jobId}&%6AobId=${jobId}`,
    `jobId=${jobId}&token=%ZZ`,
    'jobId=' + 'a'.repeat(3000),
    'applicationId=private-application&resume=private-evidence',
    'jobId%5Btoken%5D=synthetic-secret'
  ]) {
    assert.equal(requestLogPath({ originalUrl: `${pathname}?${query}` }), pathname);
  }
});
