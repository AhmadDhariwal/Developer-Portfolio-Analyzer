// Disposable loopback verification only; never load application credentials.
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn, spawnSync, execFileSync } = require('node:child_process');
const { startMongo } = require('../tests/fixtures/disposableRequestMongo');
const root = path.resolve(__dirname, '../../..');
const base = path.join(
  root,
  process.argv.includes('--hidden-password')
    ? 'backend/verification/jobs-hub/hidden-password-2026-11-08'
    : 'backend/verification/jobs-hub/production-finalization-2026-11-08'
);
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const output = path.join(base, `run-${stamp}`);
fs.mkdirSync(output, { recursive: true });
const env = Object.fromEntries(
  [
    'PATH',
    'SystemRoot',
    'WINDIR',
    'TEMP',
    'TMP',
    'USERPROFILE',
    'APPDATA',
    'LOCALAPPDATA',
    'ProgramFiles'
  ]
    .filter((key) => process.env[key])
    .map((key) => [key, process.env[key]])
);
Object.assign(env, {
  NODE_ENV: 'test',
  NODE_DISABLE_COMPILE_CACHE: '1',
  npm_config_update_notifier: 'false',
  NG_BUILD_MAX_WORKERS: '2',
  NODE_PATH: process.env.NODE_PATH || ''
});
// C: may be full on developer workstations. Keep this run's npm and OS
// temporary files on the same writable drive as its disposable evidence.
const temporary = path.join(output, 'temporary');
fs.mkdirSync(temporary);
Object.assign(env, {
  TEMP: temporary,
  TMP: temporary,
  npm_config_cache: path.join(output, 'npm-cache')
});
// Do not inherit secrets. Explicit empty credentials prevent a downstream dotenv
// loader restoring application credentials; policy defaults remain available.
for (const name of ['.env', '.env.example']) {
  const filename = path.join(root, 'backend', name);
  if (!fs.existsSync(filename)) continue;
  for (const line of fs.readFileSync(filename, 'utf8').split(/\r?\n/)) {
    const key = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/)?.[1];
    if (key && /KEY|SECRET|TOKEN|PASSWORD|PASS$|URI|URL|HOST|BUCKET|EMAIL|TWILIO/.test(key))
      env[key] = '';
  }
}
const results = [];
async function run(label, args, extra = {}, cwd = root) {
  const at = Date.now();
  const log = fs.createWriteStream(path.join(output, `${label}.log`), { flags: 'wx' });
  const child = spawn(process.execPath, args, {
    cwd,
    env: { ...env, ...extra },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  const exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  await new Promise((resolve) => log.end(resolve));
  const result = {
    label,
    command: ['node', ...args],
    cwd,
    exitCode,
    milliseconds: Date.now() - at
  };
  results.push(result);
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(result));
  return exitCode;
}
async function connected(port) {
  return new Promise((resolve) => {
    const socket = net.connect(port, '127.0.0.1');
    const finish = (value) => {
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(1000);
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.once('timeout', () => finish(false));
  });
}
async function main() {
  const httpOnly = process.argv.includes('--http-only');
  const frontendOnly = process.argv.includes('--frontend-only');
  const backendOnly = process.argv.includes('--backend-only');
  console.log('Evidence directory:', output);
  const unitArgs = [
    '--test',
    '--test-reporter=tap',
    'backend/src/tests/jobsHubHardening.test.js',
    'backend/src/tests/jobsHiddenAccess.test.js',
    'backend/src/tests/jobsHubRanking.test.js',
    'backend/src/tests/developerContextService.test.js',
    'backend/src/tests/skillGapConsumerContracts.test.js',
    'backend/src/tests/coursesHardening.test.js'
  ];
  if (!httpOnly && !frontendOnly && (await run('backend-focused', unitArgs))) {
    process.exitCode = 1;
    return;
  }
  if (!frontendOnly) {
    let mongo, redisProcess;
    const redisPort = 27173;
    const redisLog = `/tmp/jobs-final-${process.pid}.log`;
    try {
      if (await connected(redisPort)) throw Error('Disposable Redis port is occupied');
      redisProcess = spawn(
        'wsl',
        [
          '-d',
          'Ubuntu',
          '--',
          'redis-server',
          '--bind',
          '127.0.0.1',
          '--port',
          String(redisPort),
          '--save',
          '',
          '--appendonly',
          'no',
          '--daemonize',
          'no',
          '--logfile',
          redisLog
        ],
        { windowsHide: true, stdio: 'ignore' }
      );
      let launchError;
      redisProcess.once('error', (error) => {
        launchError = error;
      });
      let ready = false;
      for (let attempt = 0; attempt < 100 && !ready; attempt++) {
        if (launchError) throw launchError;
        ready = await connected(redisPort);
        if (!ready) await new Promise((resolve) => setTimeout(resolve, 100));
      }
      if (!ready) throw Error('Disposable Redis readiness failed');
      mongo = await startMongo({ replicaSet: 'jobs-final', temporaryRoot: output });
      await run(
        'real-integrations',
        [
          '--test',
          '--test-concurrency=1',
          '--test-reporter=tap',
          ...(httpOnly
            ? ['backend/src/tests/jobsHubHttp.integration.test.js']
            : [
                'backend/src/tests/jobsHubLocal.integration.test.js',
                'backend/src/tests/jobsHubUpstash.integration.test.js'
              ])
        ],
        { JOBS_TEST_MONGODB_URI: mongo.uri, JOBS_TEST_REDIS_URL: `redis://127.0.0.1:${redisPort}` }
      );
    } finally {
      if (mongo)
        fs.writeFileSync(
          path.join(output, 'mongo-cleanup.json'),
          JSON.stringify(await mongo.stop(), null, 2)
        );
      if (redisProcess) {
        try {
          execFileSync(
            'wsl',
            ['-d', 'Ubuntu', '--', 'redis-cli', '-p', String(redisPort), 'shutdown', 'nosave'],
            { windowsHide: true }
          );
        } finally {
          redisProcess.kill();
        }
        // WSL's Windows port relay can briefly accept TCP after Redis has exited.
        // Verify the Redis process itself rather than mistaking the relay for it.
        const probe = spawnSync(
          'wsl',
          ['-d', 'Ubuntu', '--', 'redis-cli', '-p', String(redisPort), 'ping'],
          { windowsHide: true, encoding: 'utf8' }
        );
        if (probe.status === 0 && probe.stdout.trim() === 'PONG')
          throw Error('Disposable Redis did not stop');
        fs.writeFileSync(
          path.join(output, 'redis.log'),
          execFileSync('wsl', ['-d', 'Ubuntu', '--', 'cat', redisLog], { windowsHide: true })
        );
        execFileSync('wsl', ['-d', 'Ubuntu', '--', 'rm', '--', redisLog], { windowsHide: true });
        fs.writeFileSync(
          path.join(output, 'redis-cleanup.json'),
          JSON.stringify({ stopped: true, deletedOwnedTemporaryLog: redisLog }, null, 2)
        );
      }
    }
  }
  if (httpOnly || backendOnly) {
    if (results.some((entry) => entry.exitCode !== 0)) process.exitCode = 1;
    return;
  }
  const npm = path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
  const frontend = path.join(root, 'frontend');
  const includes = [
    'src/app/shared/services/job.service.spec.ts',
    'src/app/shared/services/job-actions.service.spec.ts',
    'src/app/shared/services/jobs-hidden-access.service.spec.ts',
    'src/app/shared/utils/job-presentation.spec.ts',
    'src/app/pages/jobs/jobs.component.spec.ts',
    'src/app/pages/job-details/job-details.component.spec.ts',
    'src/app/shared/services/jobs-legacy-preservation.spec.ts'
  ];
  const frontendChecks = [
    () =>
      run(
        'angular-focused',
        [
          npm,
          'test',
          '--',
          '--watch=false',
          ...includes.map((file) => `--include=${file}`),
          '--runner-config=scripts/jobs-vitest.config.mjs'
        ],
        {},
        frontend
      ),
    () =>
      run('typescript', [
        'frontend/node_modules/typescript/bin/tsc',
        '--noEmit',
        '-p',
        'frontend/tsconfig.app.json'
      ]),
    () => run('production-build', [npm, 'run', 'build'], {}, frontend)
  ];
  // Avoid worker-startup contention on loaded developer workstations.
  for (const check of frontendChecks) await check();
  if (results.find((entry) => entry.label === 'production-build')?.exitCode === 0) {
    await run('browser', ['frontend/scripts/verify-jobs-ui.cjs'], {
      JOBS_UI_OUTPUT_DIR: path.join(root, 'frontend/verification/jobs-hub', `production-${stamp}`)
    });
  }
  if (results.some((entry) => entry.exitCode !== 0)) process.exitCode = 1;
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
