'use strict';

// Explicit issue selection; never loads .env or connects to an existing database.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { startMongo } = require('../tests/fixtures/disposableRequestMongo');

const cases = {
  github: ['github/githubFreshnessMongo.integration.test.js'],
  notifications: ['notifications/notificationsProduction.test.js'],
  'notifications-recovery': ['notifications/notificationsProduction.test.js'],
  interview: ['interview-prep/interviewPrepFinalization.integration.test.js'],
  recommendations: ['recommendations/recommendationsPerformance.test.js'],
  courses: ['courses/coursesMongo.integration.test.js'],
  resume: ['resume/resumeProduction.test.js', 'resume/resumeProductionMongo.test.js'],
  'resume-mongo': ['resume/resumeProductionMongo.test.js']
};

async function main() {
  const issue = process.argv[2];
  if (!Object.hasOwn(cases, issue))
    throw Error(`Select one issue: ${Object.keys(cases).join(', ')}`);
  const backend = path.resolve(__dirname, '../..');
  const label = process.argv[3] || issue;
  if (!/^[a-z0-9-]{1,60}$/.test(label)) throw Error('Invalid evidence label.');
  const output = path.join(backend, 'verification/p0.5a', label);
  const tapPath = path.join(output, 'results.tap');
  if (fs.existsSync(tapPath)) throw Error(`Preserve existing evidence: ${tapPath}`);
  fs.mkdirSync(output, { recursive: true });
  const runtime = ['interview', 'courses'].includes(issue)
    ? await startMongo({ replicaSet: `p05a-${issue}`, temporaryRoot: output })
    : null;
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    TEMP: output,
    TMP: output,
    REDIS_ENABLED: 'false',
    REDIS_URL: '',
    UPSTASH_REDIS_REST_URL: '',
    UPSTASH_REDIS_REST_TOKEN: '',
    NOTIFICATION_VERIFICATION_DIRECTORY: output,
    RESUME_VERIFICATION_DIRECTORY: output,
    ...(runtime && {
      MONGODB_URI: runtime.uri,
      MONGO_URI: runtime.uri,
      INTERVIEW_TEST_MONGO_URI: runtime.uri
    })
  };
  const fd = fs.openSync(tapPath, 'wx');
  let exitCode;
  let cleanup;
  try {
    const child = spawn(
      process.execPath,
      [
        '--test',
        '--test-concurrency=1',
        '--test-reporter=tap',
        ...(issue === 'notifications-recovery'
          ? [
              '--test-skip-pattern=rollback never|database deduplication|preferences gate|two processes deliver|HTTP ownership|Help creation|organization/team|short-lived|idempotency survives|Profile preference writes|weekly email|account deletion|indexes support'
            ]
          : []),
        ...cases[issue].map((file) => `src/tests/${file}`)
      ],
      { cwd: backend, env, windowsHide: true, stdio: ['ignore', fd, fd] }
    );
    exitCode = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', resolve);
    });
  } finally {
    fs.closeSync(fd);
    cleanup = await runtime?.stop();
  }
  const tap = fs.readFileSync(tapPath, 'utf8');
  const summary = {
    issue,
    exitCode,
    testFiles: cases[issue],
    productionDataUsed: false,
    counts: tap
      .split(/\r?\n/)
      .filter((line) => /^# (tests|pass|fail|skipped|duration_ms) /.test(line)),
    failures: tap.split(/\r?\n/).filter((line) => /^\s*not ok /.test(line)),
    cleanup: cleanup || 'Suite-owned disposable Mongo cleanup; see TAP and suite evidence'
  };
  fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify(summary));
  process.exitCode = Number.isInteger(exitCode) ? exitCode : 1;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
