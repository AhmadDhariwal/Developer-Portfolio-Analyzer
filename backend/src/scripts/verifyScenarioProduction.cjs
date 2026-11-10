'use strict';
// Scoped local verification only. Never load application credentials or live data.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '../../..');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const output = path.join(
  root,
  'backend/verification/scenario-simulator/production-finalization-2026-11-09',
  `run-${stamp}`,
);
fs.mkdirSync(output, { recursive: true });
const temporary = path.join(output, 'temporary');
fs.mkdirSync(temporary);
const env = Object.fromEntries(
  [
    'PATH',
    'SystemRoot',
    'WINDIR',
    'USERPROFILE',
    'APPDATA',
    'LOCALAPPDATA',
    'ProgramFiles',
    'NODE_PATH',
    'SCENARIO_CHROMIUM_PATH',
  ]
    .filter((key) => process.env[key])
    .map((key) => [key, process.env[key]]),
);
Object.assign(env, {
  NODE_ENV: 'test',
  TEMP: temporary,
  TMP: temporary,
  NODE_DISABLE_COMPILE_CACHE: '1',
  npm_config_cache: path.join(output, 'npm-cache'),
  npm_config_update_notifier: 'false',
  NG_BUILD_MAX_WORKERS: '2',
  SCENARIO_TEST_MONGOD: 'C:\\Program Files\\MongoDB\\Server\\8.2\\bin\\mongod.exe',
  SCENARIO_TEST_REDIS_SERVER: '/usr/bin/redis-server',
});
for (const name of ['.env', '.env.example']) {
  const file = path.join(root, 'backend', name);
  if (!fs.existsSync(file)) continue;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const key = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/)?.[1];
    if (key && /KEY|SECRET|TOKEN|PASSWORD|URI|URL|HOST|BUCKET|EMAIL/.test(key)) env[key] = '';
  }
}
const results = [];
async function run(label, args, cwd = root, extra = {}) {
  const started = Date.now();
  const log = fs.createWriteStream(path.join(output, `${label}.log`), { flags: 'wx' });
  const child = spawn(process.execPath, args, {
    cwd,
    env: { ...env, ...extra },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  const exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  await new Promise((resolve) => log.end(resolve));
  const entry = {
    label,
    command: ['node', ...args],
    cwd,
    exitCode,
    milliseconds: Date.now() - started,
  };
  results.push(entry);
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(entry));
  if (exitCode) process.exitCode = 1;
  return exitCode;
}
async function main() {
  console.log('Evidence directory:', output);
  if (process.argv.includes('--backend') || process.argv.includes('--mongo')) {
    if (
      !process.argv.includes('--mongo') &&
      (await run('backend-focused', [
        '--test',
        '--test-reporter=tap',
        ...[
          'scenarioPlanningScore',
          'scenarioLegacyParity',
          'scenarioSimulatorService',
          'scenarioSimulatorCharacterization',
          'scenarioSimulatorContext',
          'scenarioSimulatorReliability',
          'scenarioProductionContracts',
          'skillGapConsumerContracts',
        ].map((name) => `backend/src/tests/${name}.test.js`),
      ]))
    )
      return;
    await run('mongo-and-workers', [
      '--test',
      '--test-concurrency=1',
      '--test-reporter=tap',
      'backend/src/tests/scenarioSimulatorMongo.integration.test.js',
      'backend/src/tests/scenarioSimulatorWorkers.integration.test.js',
      'backend/src/tests/scenarioSprintExport.test.js',
      'backend/src/tests/scenarioMigration.integration.test.js',
    ]);
  } else if (process.argv.includes('--smoke')) {
    await run('http-redis-fault-contracts', [
      'backend/src/scripts/verifyScenarioP3.js',
      '--smoke',
      `--evidence-name=production-final-2026-11-09-smoke${process.argv.includes('--recovery') ? '-recovery' : ''}.json`,
    ]);
  } else if (process.argv.includes('--load')) {
    const profile = process.argv.includes('--profile');
    await run('two-worker-burst', [
      'backend/src/scripts/verifyScenarioP3.js',
      '--focused',
      '--transport=direct',
      ...(profile ? ['--profile'] : ['--lock-gate']),
      '--burst-only',
      `--label=production-final-${profile ? 'profile' : '20261109'}`,
      `--evidence-name=production-final-2026-11-09-${profile ? 'profile' : 'focused'}.json`,
    ]);
  } else if (process.argv.includes('--frontend')) {
    const npm = path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
    const frontend = path.join(root, 'frontend');
    if (
      await run(
        'angular-focused',
        [
          npm,
          'test',
          '--',
          '--watch=false',
          '--include=src/app/pages/scenario-simulator/**/*.spec.ts',
          '--include=src/app/shared/services/scenario-simulator.service.spec.ts',
          '--runner-config=scripts/scenario-vitest.config.mjs',
        ],
        frontend,
      )
    )
      return;
    if (
      await run('typescript', [
        'frontend/node_modules/typescript/bin/tsc',
        '--noEmit',
        '-p',
        'frontend/tsconfig.app.json',
      ])
    )
      return;
    if (await run('production-build', [npm, 'run', 'build'], frontend)) return;
    await run(
      'browser',
      ['frontend/scripts/verify-scenario-decomposition-ui.cjs', 'production-final-20261109'],
      root,
      {
        SCENARIO_UI_OUTPUT_DIR: path.join(
          root,
          'frontend/verification/scenario-simulator/production-finalization-2026-11-09',
        ),
      },
    );
  } else throw Error('Choose --backend, --frontend or --load.');
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
