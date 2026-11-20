const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createClient } = require('redis');
const { startMongo } = require('../tests/fixtures/disposableRequestMongo');

async function main() {
  if (process.env.P02_REDIS_DISPOSABLE !== 'true')
    throw Error('Explicit disposable Redis acknowledgement required.');
  const mode = process.argv.includes('--broad')
    ? 'broad'
    : process.argv.includes('--regressions')
      ? 'regressions'
      : process.argv.includes('--acceptance')
        ? 'acceptance'
        : 'focused';
  const label = process.argv.find((arg) => arg.startsWith('--label='))?.slice(8) || mode;
  if (!/^[a-z0-9-]{1,40}$/.test(label)) throw Error('Invalid evidence label.');
  const root = path.resolve(__dirname, '../../');
  const output = path.join(root, 'verification/architecture', `infrastructure-p02-${label}.tap`);
  if (fs.existsSync(output)) throw Error('Evidence already exists. Use a new label.');
  const redisUrl = 'redis://127.0.0.1:27392';
  const probe = createClient({
    url: redisUrl,
    socket: { connectTimeout: 3000, reconnectStrategy: false }
  });
  probe.on('error', () => {});
  try {
    await probe.connect();
    await probe.ping();
  } finally {
    if (probe.isOpen) await probe.disconnect();
  }
  const mongo = await startMongo({ port: 27139 });
  const testsRoot = path.join(root, 'src/tests');
  const files = fs
    .readdirSync(testsRoot, { recursive: true })
    .filter((file) => file.endsWith('.test.js'))
    .map((file) => `src/tests/${file.replaceAll('\\', '/')}`)
    .sort();
  const focusedCore =
    /\/(apiShutdown|infrastructureWorkers|boundedCaches|workerLifecycle|platformSettingsWorkers|redisConnectionProbe|aiProviderPlatform)\.test\.js$/;
  const selected =
    mode === 'broad'
      ? files
      : mode === 'regressions'
        ? files.filter((file) =>
            /\/(githubFreshnessMongo\.integration|interviewPrepFinalization\.integration|notificationsProduction|recommendationsPerformance)\.test\.js$/.test(
              file
            )
          )
        : mode === 'acceptance'
          ? files.filter(
              (file) =>
                focusedCore.test(file) ||
                /\/(profileAccountSecurity|recommendationsPerformance|weeklyReportScheduler)\.test\.js$/.test(
                  file
                )
            )
          : files.filter(
              (file) =>
                /\/(github|recommendations|interview-prep|recruiter|admin)\//.test(file) ||
                focusedCore.test(file) ||
                /\/(profileAccountSecurity|profileSettingsProduction|weeklyReportScheduler)\.test\.js$/.test(
                  file
                )
            );
  const env = {
    ...process.env,
    P02_BASELINE: 'false',
    SETTINGS_TEST_REDIS_URL: redisUrl,
    MONGODB_URI: mongo.uri,
    MONGO_URI: mongo.uri,
    REDIS_URL: redisUrl,
    UPSTASH_REDIS_TOKEN: '',
    INTERVIEW_TEST_MONGO_URI: mongo.uri,
    RECRUITER_TEST_REDIS_URL: redisUrl,
    RECRUITER_TEST_REDIS_DISPOSABLE: 'true',
    CAREER_SPRINT_ISOLATED_MONGO_URI: mongo.uri.replace(
      /integration_live_acceptance.*/,
      'career_sprint_legacy_test_p02'
    ),
    PROFILE_ACCEPTANCE_MONGO: mongo.uri
  };
  const startedAt = Date.now();
  const fd = fs.openSync(output, 'wx');
  let code;
  let cleanup;
  try {
    console.log(
      JSON.stringify({ mode, files: selected.length, evidence: output, testConcurrency: 1 })
    );
    const child = spawn(
      process.execPath,
      ['--test', '--test-concurrency=1', '--test-reporter=tap', ...selected],
      {
        cwd: root,
        env,
        windowsHide: true,
        stdio: ['ignore', fd, fd]
      }
    );
    code = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', resolve);
    });
  } finally {
    fs.closeSync(fd);
    cleanup = await mongo.stop();
  }
  const tap = fs.readFileSync(output, 'utf8');
  const metric = (name) => Number(tap.match(new RegExp(`^# ${name} (\\d+)$`, 'm'))?.[1] || 0);
  const summary = {
    mode,
    exitCode: code,
    durationMs: Date.now() - startedAt,
    tests: metric('tests'),
    passed: metric('pass'),
    failed: metric('fail'),
    skipped: metric('skipped'),
    failures: tap.split(/\r?\n/).filter((line) => /^\s*not ok /.test(line)),
    prerequisiteSkips: tap.split(/\r?\n/).filter((line) => /# SKIP/.test(line)),
    testFiles: selected,
    cleanup
  };
  fs.writeFileSync(output.replace(/\.tap$/, '.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify(summary));
  process.exitCode = code || 0;
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
