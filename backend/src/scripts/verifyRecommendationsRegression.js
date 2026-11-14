'use strict';
// Reusable serial regression runner: isolate database fixtures and retain compact evidence.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const mongoose = require('mongoose');
const root = path.resolve(__dirname, '../../..');
const cfg =
  require('dotenv').config({ path: path.join(root, 'backend/.env'), quiet: true }).parsed || {};
const source = process.env.MONGODB_URI || cfg.MONGODB_URI || process.env.MONGO_URI || cfg.MONGO_URI;
if (!source) throw new Error('Configured MongoDB is required; database tests are not skipped.');
const database = `devinsight_rec_verify_${crypto.randomBytes(6).toString('hex')}`;
const start = source.indexOf('://') + 3,
  slash = source.indexOf('/', start),
  queryAt = source.indexOf('?');
const hostEnd = slash < 0 ? (queryAt < 0 ? source.length : queryAt) : slash;
const originalDb = slash < 0 ? '' : source.slice(slash + 1, queryAt < 0 ? source.length : queryAt);
const query = new URLSearchParams(queryAt < 0 ? '' : source.slice(queryAt + 1));
if (source.slice(start, hostEnd).includes('@') && originalDb && !query.has('authSource'))
  query.set('authSource', originalDb);
const testUri = `${source.slice(0, hostEnd)}/${database}${query.size ? '?' + query : ''}`;
const focused = process.argv.includes('--focused');
const suiteFiles = fs
  .readdirSync(path.join(root, 'backend/src/tests'))
  .filter((name) => name.endsWith('.test.js') && (!focused || /^recommendation/.test(name)))
  .map((name) => path.join('backend/src/tests', name));
const run = spawnSync(
  process.execPath,
  ['--test', '--test-concurrency=1', '--test-reporter=tap', ...suiteFiles],
  {
    cwd: root,
    env: { ...process.env, ...cfg, MONGODB_URI: testUri, MONGO_URI: testUri },
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  },
);
const stdout = run.stdout || '';
const results = {
  focused,
  exitCode: run.status,
  concurrency: 1,
  database,
  suiteFiles,
  summary: {},
  failures: [],
  cleanup: {},
};
for (const key of [
  'tests',
  'suites',
  'pass',
  'fail',
  'cancelled',
  'skipped',
  'todo',
  'duration_ms',
]) {
  const found = stdout.match(new RegExp(`^# ${key} (.+)$`, 'm'));
  if (found) results.summary[key] = Number(found[1]);
}
const lines = stdout.split('\n');
for (let i = 0; i < lines.length; i++)
  if (/^not ok/.test(lines[i])) results.failures.push(lines.slice(i, i + 24).join('\n'));
(async () => {
  try {
    await mongoose.connect(source, { dbName: database, serverSelectionTimeoutMS: 5000 });
    if (
      mongoose.connection.name !== database ||
      !/^devinsight_rec_verify_[a-f0-9]{12}$/.test(database)
    )
      throw new Error('Verification database ownership mismatch');
    await mongoose.connection.dropDatabase();
    results.cleanup.ownedDatabaseRemoved = true;
  } finally {
    await mongoose.disconnect();
    const target = path.join(
      root,
      'frontend/verification/recommendations',
      focused ? 'final-focused-backend-tests.json' : 'final-backend-tests.json',
    );
    if (fs.existsSync(target)) {
      const previous = JSON.parse(fs.readFileSync(target, 'utf8'));
      results.priorRuns = [
        ...(previous.priorRuns || []),
        {
          summary: previous.summary || {
            tests: previous.tests,
            pass: previous.pass,
            fail: previous.fail,
          },
          failures: previous.failures,
          concurrency: previous.concurrency || 'default',
        },
      ];
    }
    fs.writeFileSync(target, JSON.stringify(results, null, 2) + '\n');
    console.log(JSON.stringify(results));
    process.exitCode = run.status || (run.error ? 1 : 0);
  }
})().catch((error) => {
  console.error(error.name);
  process.exitCode = 1;
});
