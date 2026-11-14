// Disposable release verification. Never connects to application Mongo/Redis or AI.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');
const { once } = require('node:events');
const { startMongo } = require('../tests/fixtures/disposableRequestMongo');
const { inventory } = require('./reconcileBackendTap.cjs');

async function main() {
  const root = path.resolve(__dirname, '../../..');
  const output = path.join(root, 'backend/verification/interview-prep/release-finalization');
  const full = process.argv.includes('--full');
  const concurrency = process.argv.includes('--two-workers') ? 2 : 1;
  const label = process.argv.includes('--resume')
    ? 'resume-fixtures-confirmed'
    : process.argv.includes('--release')
      ? 'release-regression'
      : process.argv.includes('--legacy')
        ? 'legacy-fixture-confirmed'
        : process.argv.includes('--portfolio')
          ? 'portfolio-confirmed'
          : full
            ? 'full-regression'
            : process.argv.includes('--confirmed')
              ? 'focused-confirmed'
              : 'focused-infrastructure';
  const metadataFile = path.join(output, label + '.json');
  if (fs.existsSync(metadataFile)) throw Error('Refusing to overwrite retained evidence');
  const owned = fs.mkdtempSync(path.join(os.tmpdir(), 'backend-release-final-'));
  const snapshot = path.join(owned, 'source');
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\0')
    .filter(Boolean);
  const hashes = {};
  for (const name of files) {
    if (
      !/^(backend\/|frontend\/|AGENTS.md|package.json)/.test(name) ||
      /\/release-finalization\/|\/node_modules\/|\.env$/.test(name)
    )
      continue;
    const source = path.join(root, name);
    if (!fs.existsSync(source) || !fs.statSync(source).isFile()) continue;
    const bytes = fs.readFileSync(source);
    hashes[name] = crypto.createHash('sha256').update(bytes).digest('hex');
    const target = path.join(snapshot, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes);
  }
  // Tests also require generated PDF assets that may not yet be tracked.
  const fixtures = path.join(root, 'backend/src/tests/fixtures/resume');
  if (fs.existsSync(fixtures))
    fs.cpSync(fixtures, path.join(snapshot, 'backend/src/tests/fixtures/resume'), { recursive: true });
  // A fixture directory/expected.json alone is not readiness; PDFs must exist.
  for (const name of [
    'standard',
    'layout-shift',
    'columns',
    'empty',
    'page-limit',
    'scanned',
    'encrypted',
    'corrupt'
  ]) {
    const asset = path.join(snapshot, 'backend/src/tests/fixtures/resume', name + '.pdf');
    if (!fs.existsSync(asset) || fs.statSync(asset).size === 0)
      throw Error(`Generate missing synthetic PDF fixture before verification: ${name}.pdf`);
    hashes[`backend/src/tests/fixtures/resume/${name}.pdf`] = crypto
      .createHash('sha256')
      .update(fs.readFileSync(asset))
      .digest('hex');
  }
  fs.mkdirSync(path.join(snapshot, 'backend/verification/tech-news/runtime-audit'), { recursive: true });
  for (const app of ['backend', 'frontend']) {
    fs.mkdirSync(path.join(snapshot, app), { recursive: true });
    fs.symlinkSync(path.join(root, app, 'node_modules'), path.join(snapshot, app, 'node_modules'), 'junction');
  }
  const text = fs.readFileSync(path.join(root, 'backend/.env'), 'utf8');
  fs.writeFileSync(
    path.join(snapshot, 'backend/.env'),
    text.replace(/^(\s*([A-Z][A-Z0-9_]*)\s*=).*$/gm, (line, prefix, key) =>
      /KEY|TOKEN|SECRET|PASSWORD|URI|URL|HOST|USERNAME|EMAIL/i.test(key) ? prefix : line
    )
  );
  const metadata = {
    label,
    snapshot,
    startedAt: new Date().toISOString(),
    node: process.version,
    source: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    sourceHashes: hashes,
    conditions: [
      `Test file concurrency ${concurrency}; test assertions unchanged`,
      'Disposable loopback Mongo replicas and Redis 7 Lua',
      'No application endpoints, provider credentials or production data',
      'Live News providers disabled; separate external gate'
    ],
    results: [],
    cleanup: []
  };
  const save = () => fs.writeFileSync(metadataFile, JSON.stringify(metadata, null, 2) + '\n');
  save();
  const mongos = [];
  try {
    for (const options of [
      { replicaSet: 'release-final' },
      { port: 27139, replicaSet: 'profileAcceptance' },
      { port: 27140, replicaSet: 'b2Acceptance' },
      { port: 27141, replicaSet: 'profileB2Security' }
    ]) {
      mongos.push(await startMongo(options));
      metadata.servers = mongos.map(({ pid, directory }) => ({ pid, directory }));
      save();
    }
    const env = { ...process.env };
    for (const key of Object.keys(env))
      if (/KEY|TOKEN|SECRET|PASSWORD|MONGO.*URI|REDIS.*URL|UPSTASH/i.test(key)) env[key] = '';
    const uri = new URL(mongos[0].uri);
    const mongo = `mongodb://${uri.host}`;
    const python =
      'C:/Program Files/WindowsApps/OpenAI.CodexPrimaryRuntime.v26-1105-1297-0_26.1105.1297.0_x64__3k8sg7r9htsxt/dependencies/python/python.exe';
    Object.assign(env, {
      MONGODB_URI: mongo + '/release_default' + uri.search,
      MONGO_URI: mongo + '/release_default' + uri.search,
      AI_TEST_MONGO_URI: mongos[0].uri,
      INTERVIEW_TEST_MONGO_URI: mongos[0].uri,
      CAREER_SPRINT_ISOLATED_MONGO_URI: mongo + '/career_sprint_legacy_test_final',
      NEWS_TEST_MONGODB_URI: mongos[0].uri,
      JOBS_TEST_MONGODB_URI: mongos[0].uri,
      PROFILE_ACCEPTANCE_MONGO: mongos[1].uri,
      B2_ACCEPTANCE_MONGO: mongos[2].uri,
      STORAGE_SECURITY_MONGO: 'mongodb://127.0.0.1:27141/?replicaSet=profileB2Security',
      REDIS_URL: 'redis://127.0.0.1:27169',
      NEWS_TEST_REDIS_URL: 'redis://127.0.0.1:27169',
      JOBS_TEST_REDIS_URL: 'redis://127.0.0.1:27169',
      NEWS_TEST_LIVE_PROVIDERS: 'false',
      JWT_SECRET: 'disposable-release-fixture-secret',
      RESUME_FIXTURE_PYTHON: python,
      PATH: path.dirname(python) + path.delimiter + process.env.PATH,
      GIT_DIR: path.join(root, '.git'),
      GIT_WORK_TREE: snapshot
    });
    require('node:assert/strict').match(
      env.CAREER_SPRINT_ISOLATED_MONGO_URI,
      /^mongodb:\/\/127\.0\.0\.1:\d+\/career_sprint_legacy_test_[a-z0-9_]+$/
    );
    const previous = JSON.parse(
      fs.readFileSync(path.join(root, 'backend/verification/interview-prep/production-regression-final-inventory.json'))
    );
    const focused = [
      ...new Set(
        previous.records.filter((r) => r.kind === 'skip' && !r.file.includes('newsLiveSearch')).map((r) => r.file)
      ),
      'backend/src/tests/publicPortfolio.integration.test.js',
      'backend/src/tests/aiProviderAdmission.integration.test.js'
    ];
    const args = [
      '--test',
      '--test-reporter=tap',
      `--test-concurrency=${concurrency}`,
      ...(process.argv.includes('--resume')
        ? ['backend/src/tests/resumeProduction.test.js', 'backend/src/tests/resumeProductionMongo.test.js']
        : process.argv.includes('--legacy')
          ? ['backend/src/tests/careerSprintLegacy.integration.test.js']
          : full
            ? ['backend/src/tests/**/*.test.js']
            : process.argv.includes('--portfolio')
              ? ['backend/src/tests/publicPortfolio.integration.test.js']
              : focused)
    ];
    const stdout = fs.createWriteStream(path.join(output, label + '.tap'), { flags: 'wx' });
    const stderr = fs.createWriteStream(path.join(output, label + '.stderr.txt'), { flags: 'wx' });
    const finished = Promise.all([once(stdout, 'finish'), once(stderr, 'finish')]);
    const started = Date.now();
    const child = spawn(process.execPath, args, {
      cwd: snapshot,
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    child.stdout.pipe(stdout);
    child.stderr.pipe(stderr);
    const [exitCode, signal] = await once(child, 'exit');
    await finished;
    metadata.results.push({ command: ['node', ...args], exitCode, signal, milliseconds: Date.now() - started });
    const tap = fs.readFileSync(path.join(output, label + '.tap'), 'utf8');
    const parsed = inventory(tap);
    fs.writeFileSync(path.join(output, label + '-inventory.json'), JSON.stringify(parsed, null, 2) + '\n');
    metadata.counts = parsed.counts;
    metadata.tapSha256 = crypto.createHash('sha256').update(tap).digest('hex');
    process.exitCode = exitCode || 0;
  } finally {
    metadata.servers = mongos.map(({ pid, directory }) => ({ pid, directory }));
    for (const server of mongos.reverse()) {
      try {
        metadata.cleanup.push(await server.stop());
      } catch (error) {
        metadata.cleanup.push({ pid: server.pid, error: error.message });
        process.exitCode = 1;
      }
      save();
    }
    metadata.finishedAt = new Date().toISOString();
    save();
  }
  console.log(JSON.stringify({ counts: metadata.counts, results: metadata.results, cleanup: metadata.cleanup }));
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
