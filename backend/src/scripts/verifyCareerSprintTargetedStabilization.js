'use strict';

// Two explicit, bounded phases only; no configured database or external provider is used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { startMongo } = require('../tests/fixtures/disposableRequestMongo');
const phase = process.argv[2];
assert.ok(['diagnostic', 'confirmation'].includes(phase), 'Choose diagnostic or confirmation.');
const backend = path.resolve(__dirname, '../..');
const output = path.join(
  backend,
  'verification/career-sprint/production-finalization-2026-11-07/targeted-stabilization'
);
fs.mkdirSync(output, { recursive: true });
assert.ok(!fs.existsSync(path.join(output, `${phase}.json`)), 'This phase already ran; do not repeat it.');
const result = { phase, checks: [], productionDataUsed: false, externalProvidersUsed: false };

const run = (name, args, env = {}) =>
  new Promise((resolve, reject) => {
    const log = path.join(output, `${phase}-${name}.tap`);
    const stream = fs.createWriteStream(log, { flags: 'wx' });
    const child = spawn(process.execPath, ['--test', '--test-concurrency=1', '--test-reporter=tap', ...args], {
      cwd: backend,
      windowsHide: true,
      env: {
        ...process.env,
        REDIS_URL: '',
        UPSTASH_REDIS_TOKEN: '',
        GROQ_API_KEY: '',
        OPENAI_API_KEY: '',
        GEMINI_API_KEY: '',
        ANTHROPIC_API_KEY: '',
        OPENROUTER_API_KEY: '',
        ...env
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    child.stdout.pipe(stream, { end: false });
    child.stderr.pipe(stream, { end: false });
    child.once('error', reject);
    child.once('close', (code) =>
      stream.end(() => {
        const text = fs.readFileSync(log, 'utf8');
        const check = {
          name,
          code,
          log: path.relative(backend, log),
          summary: text.match(/^# (?:tests|pass|fail|skipped|duration_ms).*$/gm)
        };
        result.checks.push(check);
        console.log(JSON.stringify(check));
        resolve();
      })
    );
  });

const files = (directory) =>
  fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.resolve(directory, entry.name);
    assert.ok(target.startsWith(output + path.sep) && !entry.isSymbolicLink());
    return entry.isDirectory() ? files(target) : [target];
  });

async function main() {
  await run('sprint', [
    '--test-name-pattern=^database-validated memory serialization stays under 50ms p95 and skips optional signals$',
    'src/tests/careerSprintPerformance.test.js'
  ]);
  const temporaryRoot = path.join(output, 'runtime');
  fs.mkdirSync(temporaryRoot, { recursive: true });
  const runtime = await startMongo({ replicaSet: 'sprint-targeted', temporaryRoot });
  try {
    // Node includes descendants of a matching parent. Explicitly exclude the six
    // unrelated children so only the two affected assertions and their fixture run.
    await run(
      'courses',
      [
        '--test-name-pattern=^Learning Hub real Mongo/JWT:',
        '--test-skip-pattern=^(current version and|memory, Redis and|legacy, temporary,|selected unanalyzed resume,|progress CRUD is|JWT HTTP endpoints)',
        'src/tests/coursesMongo.integration.test.js'
      ],
      { MONGODB_URI: runtime.uri, MONGO_URI: runtime.uri }
    );
  } finally {
    result.temporaryFilesBeforeTeardown = files(temporaryRoot);
    result.cleanup = await runtime.stop();
    assert.deepEqual(fs.readdirSync(temporaryRoot), []);
    fs.rmdirSync(temporaryRoot); // Verified empty task-owned directory, never recursive removal.
  }
}

main()
  .catch((error) => {
    result.error = error.message;
    process.exitCode = 1;
  })
  .finally(() => {
    fs.writeFileSync(path.join(output, `${phase}.json`), JSON.stringify(result, null, 2) + '\n');
    if (result.checks.some((check) => check.code !== 0)) process.exitCode = 1;
  });
