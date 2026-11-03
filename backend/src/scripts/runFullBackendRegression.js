'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

function findTestFiles(dir) {
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'fixtures' && entry.name !== 'node_modules') {
        results.push(...findTestFiles(fullPath));
      }
    } else if (entry.isFile() && entry.name.endsWith('.test.js')) {
      results.push(path.relative(path.resolve(__dirname, '../..'), fullPath).replace(/\\/g, '/'));
    }
  }
  return results.sort();
}

async function main() {
  const root = path.resolve(__dirname, '../..');
  const testFiles = findTestFiles(path.join(root, 'src/tests'));
  console.log(`Starting regression run across all ${testFiles.length} test files...`);

  const env = {
    ...process.env,
    NODE_ENV: 'test',
    CAREER_SPRINT_ISOLATED_MONGO_URI:
      process.env.CAREER_SPRINT_ISOLATED_MONGO_URI ||
      'mongodb://127.0.0.1:27017/career_sprint_legacy_test_01a14358',
  };

  const args = ['--test', '--test-concurrency=1', ...testFiles];
  const startTime = Date.now();

  const child = spawn(process.execPath, args, {
    cwd: root,
    env,
    stdio: ['inherit', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';

  child.stdout.on('data', (chunk) => {
    const text = chunk.toString();
    stdout += text;
    process.stdout.write(text);
  });

  child.stderr.on('data', (chunk) => {
    const text = chunk.toString();
    stderr += text;
    process.stderr.write(text);
  });

  const exitCode = await new Promise((resolve) => {
    child.on('close', resolve);
    child.on('error', (err) => {
      console.error('Child process error:', err);
      resolve(1);
    });
  });

  const durationMs = Date.now() - startTime;
  console.log(
    `\nRegression run finished in ${(durationMs / 1000).toFixed(1)}s with exit code ${exitCode}`,
  );

  // Parse results from stdout
  const testsMatch = stdout.match(/ℹ tests\s+(\d+)/);
  const passMatch = stdout.match(/ℹ pass\s+(\d+)/);
  const failMatch = stdout.match(/ℹ fail\s+(\d+)/);
  const skippedMatch = stdout.match(/ℹ skipped\s+(\d+)/);
  const cancelledMatch = stdout.match(/ℹ cancelled\s+(\d+)/);

  const summary = {
    timestamp: new Date().toISOString(),
    totalTestFiles: testFiles.length,
    exitCode,
    durationMs,
    counts: {
      tests: testsMatch ? parseInt(testsMatch[1], 10) : null,
      pass: passMatch ? parseInt(passMatch[1], 10) : null,
      fail: failMatch ? parseInt(failMatch[1], 10) : null,
      skipped: skippedMatch ? parseInt(skippedMatch[1], 10) : null,
      cancelled: cancelledMatch ? parseInt(cancelledMatch[1], 10) : null,
    },
  };

  const outDir = path.join(root, 'verification/skillgap/acceptance-2026-11-03/local-final');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, 'final-full-backend-regression.json'),
    JSON.stringify(summary, null, 2) + '\n',
  );
  fs.writeFileSync(path.join(outDir, 'final-full-backend-regression.log'), stdout + '\n' + stderr);

  console.log(
    'Saved regression results to:',
    path.join(outDir, 'final-full-backend-regression.json'),
  );
}

main().catch((err) => {
  console.error('Fatal regression runner error:', err);
  process.exit(1);
});
