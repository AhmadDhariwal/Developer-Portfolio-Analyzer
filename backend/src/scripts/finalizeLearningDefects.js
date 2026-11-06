'use strict';

// Read-only Git inspection and explicit-path local verification; never stages or commits.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../../..');
const output = path.join(root, 'backend/verification/courses/defects-2026-11-05');
fs.mkdirSync(output, { recursive: true });
const read = (name) => {
  const file = path.join(output, name);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
};
const git = (args) => {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0)
    throw Error(`Git inspection failed: ${result.error?.code || result.status}`);
  return result.stdout;
};
const counts = (text) =>
  Object.fromEntries(
    [...text.matchAll(/(?:ℹ )?(tests|pass|fail|cancelled|skipped)\s+(\d+)\s*$/gm)].map((match) => [
      match[1],
      Number(match[2]),
    ]),
  );
const json = (name) => {
  try {
    return JSON.parse(read(name));
  } catch {
    return null;
  }
};
const full = read('full.log');
const summary = {
  checkedAt: new Date().toISOString(),
  branch: git(['branch', '--show-current']).trim(),
  sourceCommit: git(['rev-parse', 'HEAD']).trim(),
  authorizedBranch: 'fix/learning-hub-p1 (explicit user confirmation)',
  prTarget: 'not applicable',
  full: {
    status: Object.hasOwn(counts(full), 'fail')
      ? counts(full).fail === 0
        ? 'PASS'
        : 'FAIL'
      : 'BLOCKED: no terminal test summary (interrupted or still running)',
    counts: counts(full),
    failures: full.split(/\r?\n/).filter((line) => /^✖ /.test(line)),
    lastLines: full.split(/\r?\n/).slice(-8),
  },
  focused: counts(read('courses.log')),
  crossModuleRecovery: counts(read('cross-module-recovery.log')),
  frontend: read('frontend.log').match(/Tests\s+(\d+) passed/)?.[1] || null,
  browser: json('browser/end-to-end.json')?.status || null,
  fixture: json('fixture/browser-results.json')?.status || null,
  network: json('mongo-network.json'),
  originalLiveSession:
    'BLOCKED: Computer Use could not verify the existing browser URL; no further interaction with that session',
};
// Keep the large query plans/network trace in their original artifact, not duplicated here.
if (summary.network)
  summary.network = {
    externalCalls: summary.network.externalCalls,
    baselineRef: summary.network.baselineRef,
    warmApi: summary.network.warmApi,
    warmService: summary.network.warmService,
    admissionRetries: summary.network.network.filter((row) => row.admissionAttempt > 0).length,
  };
fs.writeFileSync(
  path.join(output, 'acceptance-summary.json'),
  JSON.stringify(summary, null, 2) + '\n',
);

const changed = git(['diff', 'HEAD', '--name-only']).trim().split(/\r?\n/).filter(Boolean);
const added = git(['ls-files', '--others', '--exclude-standard'])
  .trim()
  .split(/\r?\n/)
  .filter(Boolean);
const sources = [...new Set([...changed, ...added])].filter(
  (file) =>
    /^(backend\/(src|scripts)\/|frontend\/(src|scripts)\/)/.test(file) &&
    /\.(js|cjs|mjs|ts|html|scss)$/.test(file),
);
const checks = [];
if (process.argv.includes('--checks')) {
  const run = (name, command, args) => {
    const result = spawnSync(command, args, {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
    });
    checks.push({
      name,
      exitCode: result.status,
      error: result.error?.code || null,
      output: `${result.stdout || ''}${result.stderr || ''}`.trim(),
    });
  };
  const formatter = 'frontend/node_modules/prettier/bin/prettier.cjs';
  const paths = [...sources, 'backend/verification/courses/LEARNING-HUB-PRODUCTION-FINAL.md'];
  run('Prettier write', process.execPath, [
    formatter,
    '--write',
    '--single-quote',
    '--print-width',
    '100',
    ...paths,
  ]);
  run('Prettier check', process.execPath, [
    formatter,
    '--check',
    '--single-quote',
    '--print-width',
    '100',
    ...paths,
  ]);
  for (const file of sources.filter((file) => file.startsWith('backend/') && file.endsWith('.js')))
    run(`Syntax ${file}`, process.execPath, ['--check', file]);
  run('App TypeScript', process.execPath, [
    'frontend/node_modules/typescript/bin/tsc',
    '--noEmit',
    '-p',
    'frontend/tsconfig.app.json',
  ]);
  run('Working-tree whitespace', 'git', ['diff', '--check']);
  run('Index whitespace', 'git', ['diff', '--cached', '--check']);
  fs.writeFileSync(
    path.join(output, 'final-checks.json'),
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        sources,
        checks,
        index: 'Externally staged work preserved; no staging/unstaging/commit performed',
      },
      null,
      2,
    ) + '\n',
  );
}

// Regressions can rewrite tracked historical reports. Preserve both exact versions,
// leaving externally staged working/index files untouched.
const history = [];
for (const file of changed.filter(
  (file) =>
    file.startsWith('backend/verification/') &&
    (!file.startsWith('backend/verification/courses/') ||
      file === 'backend/verification/courses/shared-catalog-2026-11-05.json'),
)) {
  const original = spawnSync('git', ['show', `HEAD:${file}`], {
    cwd: root,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (original.status !== 0) continue;
  const before = path.join(output, 'historical-before', file);
  const after = path.join(output, 'regression-artifacts', file);
  fs.mkdirSync(path.dirname(before), { recursive: true });
  fs.mkdirSync(path.dirname(after), { recursive: true });
  fs.writeFileSync(before, original.stdout);
  fs.copyFileSync(path.join(root, file), after);
  history.push({
    path: file,
    before: path.relative(root, before).replaceAll('\\', '/'),
    after: path.relative(root, after).replaceAll('\\', '/'),
  });
}
fs.writeFileSync(
  path.join(output, 'historical-reports.json'),
  JSON.stringify(history, null, 2) + '\n',
);
const inventory = path.join(output, 'change-inventory.json');
if (!fs.existsSync(inventory)) fs.writeFileSync(inventory, '{}\n');
const entries = git(['status', '--porcelain=v1', '-z', '--untracked-files=all'])
  .split('\0')
  .filter(Boolean);
const files = entries.map((entry) => ({
  status: entry.slice(0, 2),
  path: entry.slice(3),
  absolutePath: path.resolve(root, entry.slice(3)).replaceAll('\\', '/'),
}));
fs.writeFileSync(
  inventory,
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      files,
      deletedTrackedFiles: [],
      movedFiles: [],
      cleanup:
        'No source, user work, historical evidence or fixtures deleted. Disposable Mongo fixtures retain exact-scope cleanup results.',
    },
    null,
    2,
  ) + '\n',
);
console.log(
  JSON.stringify({
    full: summary.full.counts,
    fullTail: summary.full.lastLines,
    focused: summary.focused,
    frontend: summary.frontend,
    network: summary.network,
    checks: checks.length,
    failedChecks: checks.filter((check) => check.exitCode !== 0).map((check) => check.name),
    inventoryFiles: files.length,
  }),
);
