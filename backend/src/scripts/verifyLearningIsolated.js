'use strict';

// Entire child process tree uses a disposable loopback database, never .env Mongo/Redis.
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { startMongo } = require('../tests/fixtures/disposableRequestMongo');

async function main() {
  const runtime = await startMongo({ replicaSet: 'learning-regression', readinessAttempts: 100 });
  const root = path.resolve(__dirname, '../..');
  const reportDir = process.env.LEARNING_VERIFICATION_OUTPUT
    ? path.resolve(process.env.LEARNING_VERIFICATION_OUTPUT)
    : path.join(root, 'verification/courses/defects-2026-11-05');
  fs.mkdirSync(reportDir, { recursive: true });
  try {
    const mode = process.argv[2] || 'courses';
    const files =
      mode === 'full'
        ? fs.readdirSync(path.join(root, 'src/tests')).filter((file) => file.endsWith('.test.js'))
        : fs
            .readdirSync(path.join(root, 'src/tests'))
            .filter(
              (file) =>
                /^(courses|sharedCourseCatalog|skillGapMongo|careerSprintHardening|weeklyReportScheduler)/.test(
                  file,
                ) && file.endsWith('.test.js'),
            );
    const args =
      mode === 'browser' || mode === 'audit'
        ? [
            mode === 'browser'
              ? 'src/scripts/verifyCoursesEndToEnd.js'
              : 'src/scripts/auditCourseCatalog.js',
          ]
        : [
            '--test',
            `--test-concurrency=${process.env.LEARNING_TEST_CONCURRENCY === '1' ? '1' : '2'}`,
            ...files.map((file) => `src/tests/${file}`),
          ];
    const output = fs.createWriteStream(path.join(reportDir, `${mode}.log`));
    const child = spawn(process.execPath, args, {
      cwd: root,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        MONGO_URI: runtime.uri,
        MONGODB_URI: runtime.uri,
        CAREER_SPRINT_ISOLATED_MONGO_URI: runtime.uri.replace(
          /\/integration_live_acceptance\?.*$/,
          '/career_sprint_legacy_test_learning',
        ),
        B2_ACCEPTANCE_MONGO: '',
        PROFILE_ACCEPTANCE_MONGO: '',
        LEARNING_VERIFICATION_MONGO_URI: runtime.uri.replace(
          '/integration_live_acceptance?',
          '/devinsight_learning_isolated?',
        ),
        REDIS_URL: '',
        UPSTASH_REDIS_TOKEN: '',
        YOUTUBE_API_KEY: '',
        COURSES_POOL_STORE_TIMEOUT_MS: '5000',
        LEARNING_BASELINE_REF: 'aae00e2a',
        COURSES_E2E_OUTPUT: path.join(reportDir, 'browser'),
        COURSES_E2E_SCREENSHOTS: path.join(reportDir, 'browser'),
        COURSES_AUDIT_OUTPUT: path.join(reportDir, 'catalog-audit.json'),
      },
    });
    child.stdout.on('data', (chunk) => output.write(chunk));
    child.stderr.on('data', (chunk) => output.write(chunk));
    const code = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', resolve);
    });
    await new Promise((resolve) => output.end(resolve));
    console.log(JSON.stringify({ mode, code, log: path.join(reportDir, `${mode}.log`) }));
    process.exitCode = code || 0;
  } finally {
    const cleanup = await runtime.stop();
    fs.writeFileSync(
      path.join(reportDir, `cleanup-${process.argv[2] || 'courses'}.json`),
      JSON.stringify(cleanup, null, 2) + '\n',
    );
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
