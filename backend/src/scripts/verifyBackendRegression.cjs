const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');
const { once } = require('node:events');
const { startMongo } = require('../tests/fixtures/disposableRequestMongo');

async function main() {
  const root = path.resolve(__dirname, '../../..');
  const evidence = path.join(root, 'backend/verification/interview-prep');
  const finalOnly = process.argv.includes('--final');
  const run = JSON.parse(fs.readFileSync(path.join(evidence, 'production-regression-run.json')));
  const baseline = path.join(run.owned, 'release1');
  if (!path.resolve(baseline).startsWith(path.resolve(run.owned) + path.sep)) throw Error('Invalid baseline location');
  if (!fs.existsSync(baseline)) {
    fs.cpSync(run.snapshot, baseline, {
      recursive: true,
      filter: (name) => !name.split(path.sep).includes('node_modules')
    });
    const archive = execFileSync(
      'git',
      ['archive', 'release1', 'backend/src', 'backend/scripts', 'backend/.env.example', 'frontend/scripts'],
      {
        cwd: root,
        maxBuffer: 64 * 1024 * 1024
      }
    );
    execFileSync('tar', ['-xf', '-', '-C', baseline], { input: archive });
    for (const app of ['backend', 'frontend'])
      fs.symlinkSync(path.join(root, app, 'node_modules'), path.join(baseline, app, 'node_modules'), 'junction');
  }
  const output = path.join(evidence, 'isolated');
  fs.mkdirSync(output, { recursive: true });
  const mongo = await startMongo({ replicaSet: 'regression-audit', temporaryRoot: run.owned });
  const uri = new URL(mongo.uri);
  const python =
    'C:/Program Files/WindowsApps/OpenAI.CodexPrimaryRuntime.v26-1105-1297-0_26.1105.1297.0_x64__3k8sg7r9htsxt/dependencies/python/python.exe';
  const env = { ...process.env };
  for (const key of Object.keys(env))
    if (/KEY|TOKEN|SECRET|PASSWORD|MONGO.*URI|REDIS.*URL|UPSTASH/i.test(key)) env[key] = '';
  Object.assign(env, {
    REDIS_URL: 'redis://127.0.0.1:1',
    JWT_SECRET: 'disposable-regression-fixture-signing-key',
    RESUME_FIXTURE_PYTHON: python,
    PATH: path.dirname(python) + path.delimiter + process.env.PATH,
    GIT_DIR: path.join(root, '.git')
  });
  const results = [];
  const save = () =>
    fs.writeFileSync(
      path.join(evidence, finalOnly ? 'final-results.json' : 'isolated-results.json'),
      JSON.stringify(
        {
          baseline,
          candidate: run.snapshot,
          prerequisites: 'Disposable Mongo replica set; Redis unavailable; bundled Python; credentials cleared',
          results
        },
        null,
        2
      ) + '\n'
    );
  async function execute(label, cwd, args, executable = process.execPath) {
    const stdout = fs.createWriteStream(path.join(output, label + '.tap'), { flags: 'wx' });
    const stderr = fs.createWriteStream(path.join(output, label + '.stderr.txt'), { flags: 'wx' });
    const finished = Promise.all([once(stdout, 'finish'), once(stderr, 'finish')]);
    const database = 'audit_' + crypto.randomUUID().replaceAll('-', '').slice(0, 16);
    const childEnv = {
      ...env,
      GIT_WORK_TREE: cwd,
      MONGODB_URI: `${uri.origin}/${database}${uri.search}`,
      MONGO_URI: `${uri.origin}/${database}${uri.search}`,
      INTERVIEW_TEST_MONGO_URI: mongo.uri,
      CAREER_SPRINT_ISOLATED_MONGO_URI: `${uri.origin}/career_sprint_legacy_test_${database}`
    };
    // URL.origin is null for mongodb URLs; construct the loopback origin explicitly.
    for (const key of ['MONGODB_URI', 'MONGO_URI', 'CAREER_SPRINT_ISOLATED_MONGO_URI'])
      childEnv[key] = childEnv[key].replace(/^null/, `mongodb://${uri.host}`);
    const started = Date.now();
    const child = spawn(executable, args, { cwd, env: childEnv, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.pipe(stdout);
    child.stderr.pipe(stderr);
    const [exitCode, signal] = await once(child, 'exit');
    const item = { label, cwd, command: [executable, ...args], exitCode, signal, milliseconds: Date.now() - started };
    results.push(item);
    save();
    await finished;
    console.log(JSON.stringify(item));
  }
  const inventory = JSON.parse(fs.readFileSync(path.join(evidence, 'production-regression-inventory.json')));
  const files = [
    ...new Set(
      inventory.records.filter((r) => r.kind === 'failure' && !r.file?.includes('publicPortfolio')).map((r) => r.file)
    )
  ].filter(Boolean);
  try {
    if (finalOnly) {
      await execute('production-regression-final', run.snapshot, [
        '--test',
        '--test-reporter=tap',
        '--test-concurrency=2',
        'backend/src/tests/**/*.test.js'
      ]);
    } else {
      for (const file of files) {
        for (const [label, cwd] of [
          ['candidate', run.snapshot],
          ['release1', baseline]
        ]) {
          await execute(`${label}-${path.basename(file, '.js')}`, cwd, ['--test', '--test-reporter=tap', file]);
        }
      }
      for (const [label, cwd] of [
        ['candidate', run.snapshot],
        ['release1', baseline]
      ]) {
        await execute(`${label}-generate-pdf-fixtures`, cwd, ['backend/scripts/generate-resume-fixtures.js']);
        await execute(`${label}-pdf-fixtures-after`, cwd, [
          '--test',
          '--test-reporter=tap',
          'backend/src/tests/resumeProduction.test.js',
          'backend/src/tests/resumeProductionMongo.test.js'
        ]);
      }
    }
  } finally {
    const cleanup = await mongo.stop();
    results.push({ label: 'disposable-mongo-cleanup', ...cleanup });
    save();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
