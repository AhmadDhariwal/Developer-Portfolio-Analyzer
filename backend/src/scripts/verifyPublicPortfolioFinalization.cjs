// Local, disposable verification. Never connects to the configured application database.
const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { startMongo } = require('../tests/fixtures/disposableRequestMongo');
const root = path.resolve(__dirname, '../../..');
const indexFollowup = process.argv.includes('--index-followup');
const output = path.join(
  root,
  'backend/verification/public-portfolio/production-finalization-2026-11-08',
  ...(indexFollowup ? [`index-approval-${new Date().toISOString().replace(/[:.]/g, '-')}`] : [])
);
const results = [];
const integrationOnly = process.argv.includes('--integration-only');
const queryOnly = process.argv.includes('--query-only') || indexFollowup;
const securityOnly = process.argv.includes('--security-only');
const prefix = securityOnly
  ? 'security-final-'
  : queryOnly
    ? 'query-final-'
    : integrationOnly
      ? 'integration-retry-'
      : '';
const fixtureEnvironment = Object.fromEntries(
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
    .filter((name) => process.env[name])
    .map((name) => [name, process.env[name]])
);
// Empty entries prevent dotenv's non-overriding loader from restoring real credentials.
for (const name of ['.env', '.env.example']) {
  const filename = path.join(root, 'backend', name);
  if (!fs.existsSync(filename)) continue;
  for (const line of fs.readFileSync(filename, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (match) fixtureEnvironment[match[1]] = '';
  }
}
async function run(label, args, env = {}, cwd = root) {
  const started = Date.now();
  const log = fs.createWriteStream(path.join(output, `${prefix}${label}.log`));
  const child = spawn(process.execPath, args, {
    cwd,
    env: { ...fixtureEnvironment, ...env },
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
    command: [process.execPath, ...args],
    exitCode,
    milliseconds: Date.now() - started
  };
  results.push(result);
  fs.writeFileSync(
    path.join(output, `${prefix}final-results.json`),
    JSON.stringify(results, null, 2)
  );
  console.log(JSON.stringify(result));
  return exitCode;
}
async function main() {
  fs.mkdirSync(output, { recursive: true });
  if (securityOnly) {
    process.exitCode = await run(
      'storage-contracts',
      [
        '--test',
        '--test-reporter=tap',
        'backend/src/tests/b2Storage.test.js',
        'backend/src/tests/storageSecurityFinal.test.js'
      ],
      {
        B2_ACCEPTANCE_MONGO: '',
        STORAGE_SECURITY_MONGO: '',
        NODE_ENV: 'test',
        PORT: '5000',
        UPSTASH_REDIS_PORT: '6379',
        METRICS_ALERT_LATENCY_MS: '1800'
      }
    );
    return;
  }
  const redisPort = '27172';
  let mongo;
  let redisStarted = false;
  let redisProcess;
  try {
    // A failed connection check means nothing is listening before our fixture starts.
    const net = require('node:net');
    await new Promise((resolve, reject) => {
      const socket = net.connect(Number(redisPort), '127.0.0.1');
      socket.once('connect', () => {
        socket.destroy();
        reject(new Error('Fixture Redis port is occupied'));
      });
      socket.once('error', resolve);
    });
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
        redisPort,
        '--save',
        '',
        '--appendonly',
        'no',
        '--daemonize',
        'no',
        '--pidfile',
        '/tmp/portfolio-final-27172.pid',
        '--logfile',
        '/tmp/portfolio-final-27172.log'
      ],
      { windowsHide: true, stdio: 'ignore' }
    );
    redisStarted = true;
    let launchError;
    redisProcess.once('error', (error) => {
      launchError = error;
    });
    let ready = false;
    for (let attempt = 0; attempt < 20 && !ready; attempt++) {
      if (launchError) throw launchError;
      ready = await new Promise((resolve) => {
        const socket = net.connect(Number(redisPort), '127.0.0.1');
        const finish = (value) => {
          socket.destroy();
          resolve(value);
        };
        socket.setTimeout(1000);
        socket.once('connect', () => finish(true));
        socket.once('error', () => finish(false));
        socket.once('timeout', () => finish(false));
      });
      if (!ready) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!ready) throw new Error('Disposable Redis did not become ready on loopback');
    mongo = await startMongo({ replicaSet: 'portfolio-final', temporaryRoot: output });
    const env = {
      MONGODB_URI: mongo.uri,
      MONGO_URI: mongo.uri,
      REDIS_URL: `redis://127.0.0.1:${redisPort}`,
      JWT_SECRET: 'disposable-portfolio-test-secret',
      JWT_ISSUER: 'devinsight',
      JWT_AUDIENCE: 'devinsight-client'
    };
    if (!queryOnly || indexFollowup)
      await run(
        'portfolio-integration',
        ['--test', '--test-reporter=tap', 'backend/src/tests/publicPortfolio.integration.test.js'],
        env
      );
    if (integrationOnly || queryOnly)
      await run(
        'query-audit',
        [
          'backend/src/scripts/auditPublicPortfolioQueries.cjs',
          path.join(output, queryOnly ? 'final-query-measurements.json' : 'query-measurements.json')
        ],
        env
      );
    if (indexFollowup)
      await run(
        'index-hardening',
        ['--test', '--test-reporter=tap', 'backend/src/tests/publicPortfolioHardening.test.js'],
        env
      );
    if (!integrationOnly && !queryOnly)
      await run(
        'backend-final',
        [
          '--test',
          '--test-reporter=tap',
          'backend/src/tests/publicPortfolioHardening.test.js',
          'backend/src/tests/skillGapConsumerContracts.test.js',
          'backend/src/tests/developerContextService.test.js'
        ],
        env
      );
    if (!integrationOnly && !queryOnly)
      await run(
        'production-build',
        ['node_modules/@angular/cli/bin/ng.js', 'build'],
        {},
        path.join(root, 'frontend')
      );
  } finally {
    if (mongo) {
      const cleanup = await mongo.stop();
      if (indexFollowup)
        fs.writeFileSync(path.join(output, 'mongo-cleanup.json'), JSON.stringify(cleanup, null, 2));
      console.log('Mongo fixture cleanup:', JSON.stringify(cleanup));
    }
    if (redisStarted) {
      try {
        execFileSync(
          'wsl',
          ['-d', 'Ubuntu', '--', 'redis-cli', '-p', redisPort, 'shutdown', 'nosave'],
          { windowsHide: true }
        );
      } finally {
        redisProcess?.kill();
      }
    }
  }
  if (results.some((result) => result.exitCode !== 0)) process.exitCode = 1;
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
