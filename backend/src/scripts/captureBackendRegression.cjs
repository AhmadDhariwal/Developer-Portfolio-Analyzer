const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');
const { once } = require('node:events');
const { MongoClient } = require('mongodb');

// Capture one run in an isolated source copy. Never edit checkout reports or use
// application credentials. Keep the snapshot and database as audit evidence.
async function main() {
  const root = path.resolve(__dirname, '../../..');
  const evidence = path.join(root, 'backend/verification/interview-prep');
  const tap = path.join(evidence, 'production-regression.tap');
  if (fs.existsSync(tap)) throw new Error('Refusing to overwrite retained TAP evidence');
  const owned = fs.mkdtempSync(path.join(os.tmpdir(), 'backend-regression-audit-'));
  const snapshot = path.join(owned, 'source');
  const data = path.join(owned, 'mongo');
  fs.mkdirSync(snapshot);
  fs.mkdirSync(data);
  const names = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\0')
    .filter(Boolean);
  const added = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z', 'backend/src'], {
    cwd: root,
    encoding: 'utf8'
  })
    .split('\0')
    .filter(Boolean);
  const hashes = {};
  for (const name of [...new Set([...names, ...added])]) {
    if (
      /\.env$/.test(name) ||
      name.includes('/node_modules/') ||
      !/^(backend\/|frontend\/|AGENTS.md|package.json)/.test(name)
    )
      continue;
    const from = path.join(root, name);
    if (!fs.existsSync(from) || !fs.statSync(from).isFile()) continue;
    const bytes = fs.readFileSync(from);
    hashes[name] = crypto.createHash('sha256').update(bytes).digest('hex');
    const to = path.join(snapshot, name);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.writeFileSync(to, bytes);
  }
  for (const app of ['backend', 'frontend']) {
    fs.symlinkSync(path.join(root, app, 'node_modules'), path.join(snapshot, app, 'node_modules'), 'junction');
  }
  const envFile = fs.readFileSync(path.join(root, 'backend/.env'), 'utf8');
  fs.writeFileSync(
    path.join(snapshot, 'backend/.env'),
    envFile.replace(/^(\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=).*$/gm, (line, prefix, key) =>
      /KEY|TOKEN|SECRET|PASSWORD|URI|URL|HOST|USERNAME|EMAIL/i.test(key) ? `${prefix}` : line
    )
  );
  const binary = 'C:/Program Files/MongoDB/Server/8.2/bin/mongod.exe';
  const port = 27167;
  const mongo = spawn(
    binary,
    [
      '--bind_ip',
      '127.0.0.1',
      '--port',
      String(port),
      '--dbpath',
      data,
      '--logpath',
      path.join(owned, 'mongod.log'),
      '--wiredTigerCacheSizeGB',
      '0.25'
    ],
    {
      windowsHide: true,
      stdio: 'ignore'
    }
  );
  let launchError;
  mongo.on('error', (error) => {
    launchError = error;
  });
  const uri = `mongodb://127.0.0.1:${port}`;
  const metadata = {
    startedAt: new Date().toISOString(),
    source: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    base: execFileSync('git', ['rev-parse', 'release1'], { cwd: root, encoding: 'utf8' }).trim(),
    initialStatus: execFileSync('git', ['status', '--short'], { cwd: root, encoding: 'utf8' }),
    owned,
    snapshot,
    command: 'node --test --test-reporter=tap backend/src/tests/**/*.test.js',
    cwd: snapshot,
    node: process.version,
    sourceHashes: hashes,
    conditions: [
      'Source snapshot includes current uncommitted backend work',
      'Source .env unchanged; snapshot .env has credential/endpoint values blanked',
      'Disposable loopback Mongo on original Interview port 27167',
      'Redis points to unavailable loopback port 1; live Redis acceptance BLOCKED',
      'Provider credentials blank; live provider acceptance BLOCKED',
      'Additional opt-in integration variables remain unset as in recovered command',
      'Historical reports copied; generated modifications remain in snapshot'
    ]
  };
  const save = () =>
    fs.writeFileSync(path.join(evidence, 'production-regression-run.json'), JSON.stringify(metadata, null, 2) + '\n');
  save();
  try {
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      if (launchError) throw launchError;
      if (mongo.exitCode !== null) throw new Error('Task Mongo exited: port may already be occupied');
      const client = new MongoClient(uri, { serverSelectionTimeoutMS: 300 });
      try {
        await client.connect();
        ready = true;
      } catch {
      } finally {
        await client.close();
      }
      if (ready) break;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    if (!ready) throw new Error('Disposable Mongo did not become ready');
    const env = { ...process.env };
    for (const key of Object.keys(env)) {
      if (/KEY|TOKEN|SECRET|PASSWORD|MONGO.*URI|REDIS.*URL|UPSTASH/i.test(key)) env[key] = '';
    }
    Object.assign(env, {
      INTERVIEW_TEST_MONGO_URI: uri,
      MONGODB_URI: `${uri}/audit_default`,
      MONGO_URI: `${uri}/audit_default`,
      REDIS_URL: 'redis://127.0.0.1:1',
      JWT_SECRET: 'disposable-regression-fixture-signing-key',
      GIT_DIR: path.join(root, '.git'),
      GIT_WORK_TREE: snapshot
    });
    const stdout = fs.createWriteStream(tap, { flags: 'wx' });
    const stderr = fs.createWriteStream(path.join(evidence, 'production-regression.stderr.txt'), { flags: 'wx' });
    const outputFinished = Promise.all([once(stdout, 'finish'), once(stderr, 'finish')]);
    const test = spawn(process.execPath, ['--test', '--test-reporter=tap', 'backend/src/tests/**/*.test.js'], {
      cwd: snapshot,
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    test.stdout.pipe(stdout);
    test.stderr.pipe(stderr);
    const [exitCode, signal] = await once(test, 'exit');
    metadata.exitCode = exitCode;
    metadata.signal = signal;
    save();
    await outputFinished;
    metadata.completedAt = new Date().toISOString();
    metadata.counts = Object.fromEntries(
      [
        ...fs
          .readFileSync(tap, 'utf8')
          .matchAll(/^# (tests|suites|pass|fail|cancelled|skipped|todo|duration_ms) (.+)$/gm)
      ].map((m) => [m[1], Number(m[2])])
    );
    metadata.tapSha256 = crypto.createHash('sha256').update(fs.readFileSync(tap)).digest('hex');
    console.log(JSON.stringify({ exitCode, counts: metadata.counts, owned }));
  } catch (error) {
    metadata.captureError = error.message;
    throw error;
  } finally {
    if (mongo.pid && mongo.exitCode === null) {
      const stopped = once(mongo, 'exit');
      mongo.kill();
      await stopped;
    }
    metadata.mongoStopped = true;
    save();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
