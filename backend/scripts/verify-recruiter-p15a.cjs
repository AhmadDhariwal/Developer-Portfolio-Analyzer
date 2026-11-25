// Run after Angular builds and benchmarks, never alongside another Mongo suite.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const tests = [
  'src/tests/core/applicationEvaluationRequestLogging.test.js',
  'src/tests/recruiter/applicationIntegrity.integration.test.js',
  'src/tests/recruiter/applicationShortlists.integration.test.js',
  'src/tests/recruiter/applicationWorkflow.integration.test.js',
  'src/tests/jobs/jobApplications.integration.test.js',
  'src/tests/recruiter/teamSharedJobs.integration.test.js',
  'src/tests/recruiter/teamEvaluations.integration.test.js',
  'src/tests/recruiter/candidateDiscoveryQuery.test.js',
  'src/tests/recruiter/candidateDiscovery.integration.test.js',
  'src/tests/recruiter/candidateAnalytics.integration.test.js',
  'src/tests/recruiter/recruiterHttp.integration.test.js',
  'src/tests/notifications/notificationsProduction.test.js'
];
const output = path.join(root, 'verification/jobs-hub/p1.5a-regressions.json');
const started = Date.now();
const child = spawn(process.execPath, ['--test', '--test-concurrency=1', ...tests], {
  cwd: root,
  windowsHide: true,
  env: {
    ...process.env,
    APPLICATION_WORKFLOW_EVIDENCE_FILE: path.join(
      root,
      'verification/jobs-hub/p1.5a-workflow-regression.json'
    ),
    NOTIFICATION_VERIFICATION_DIRECTORY: path.join(
      root,
      'verification/jobs-hub/p1.5a-notifications'
    )
  },
  stdio: ['ignore', 'pipe', 'pipe']
});
let stdout = '',
  stderr = '';
child.stdout.on('data', (bytes) => {
  stdout += bytes;
  process.stdout.write(bytes);
});
child.stderr.on('data', (bytes) => {
  stderr += bytes;
  process.stderr.write(bytes);
});
child.on('error', (error) => {
  stderr += error.stack;
});
child.on('close', (code) => {
  fs.writeFileSync(
    output,
    JSON.stringify(
      {
        status: code === 0 ? 'passed' : 'failed',
        tests,
        exitCode: code,
        elapsedMs: Date.now() - started,
        sequential: true,
        productionDataUsed: false,
        stdout,
        stderr
      },
      null,
      2
    ) + '\n'
  );
  process.exitCode = code || (code === 0 ? 0 : 1);
});
