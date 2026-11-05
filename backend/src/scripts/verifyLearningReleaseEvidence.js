'use strict';

// Local release evidence only: preserves the index and never reads runtime secrets.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../../..');
const output = path.join(root, 'backend/verification/courses/release-2026-11-05');
fs.mkdirSync(output, { recursive: true });
const git = (args, encoding = 'utf8') => {
  const result = spawnSync('git', args, { cwd: root, encoding, maxBuffer: 32 * 1024 * 1024 });
  if (result.status !== 0)
    throw Error(`Git evidence failed: ${result.error?.code || result.status}`);
  return result.stdout;
};
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const write = (name, value) =>
  fs.writeFileSync(path.join(output, name), JSON.stringify(value, null, 2) + '\n');
const read = (name) =>
  fs.existsSync(path.join(output, name)) ? fs.readFileSync(path.join(output, name), 'utf8') : '';
const sourceFiles = () =>
  [
    ...new Set(
      git([
        'ls-files',
        '--cached',
        '--others',
        '--exclude-standard',
        '--',
        'backend/src',
        'frontend/src',
        'frontend/scripts',
        'backend/scripts',
        'AGENTS.md',
        'backend/.env.example',
        'backend/package.json',
        'backend/package-lock.json',
        'frontend/package.json',
        'frontend/package-lock.json',
      ])
        .split(/\r?\n/)
        .filter(Boolean),
    ),
  ].filter((file) => fs.existsSync(path.join(root, file)));
const snapshot = () => ({
  at: new Date().toISOString(),
  branch: git(['branch', '--show-current']).trim(),
  head: git(['rev-parse', 'HEAD']).trim(),
  target: 'not applicable',
  indexSha256: hash(git(['ls-files', '--stage', '-z'], null)),
  files: sourceFiles().map((file) => ({
    path: file,
    sha256: hash(fs.readFileSync(path.join(root, file))),
  })),
  unstaged: git(['diff', '--name-only']).trim().split(/\r?\n/).filter(Boolean),
  staged: git(['diff', '--cached', '--name-only']).trim().split(/\r?\n/).filter(Boolean),
  status: git(['status', '--porcelain=v1', '--untracked-files=all']).split(/\r?\n/).filter(Boolean),
});
if (process.argv.includes('--baseline')) {
  if (fs.existsSync(path.join(output, 'baseline.json')))
    throw Error('Baseline already exists; preserve it.');
  write('baseline.json', snapshot());
  const files = [
    ...new Set([
      ...git(['diff', 'HEAD', '--name-only']).split(/\r?\n/),
      ...git(['ls-files', '--others', '--exclude-standard']).split(/\r?\n/),
    ]),
  ];
  const retained = [];
  for (const file of files.filter(
    (file) =>
      file.startsWith('backend/verification/') &&
      !file.startsWith('backend/verification/courses/release-2026-11-05/') &&
      fs.existsSync(path.join(root, file)),
  )) {
    const destination = path.join(output, 'before', file);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(root, file), destination);
    retained.push({ path: file, sha256: hash(fs.readFileSync(destination)) });
  }
  write('preserved-evidence.json', retained);
  console.log(JSON.stringify({ baseline: true, retained: retained.length }));
} else {
  const baseline = JSON.parse(read('baseline.json'));
  const final = snapshot();
  const before = new Map(baseline.files.map((file) => [file.path, file.sha256]));
  const sourceChanges = final.files.filter((file) => before.get(file.path) !== file.sha256);
  const counts = (text) =>
    Object.fromEntries(
      [...text.matchAll(/(?:ℹ )?(tests|pass|fail|cancelled|skipped)\s+(\d+)\s*$/gm)].map(
        (match) => [match[1], Number(match[2])],
      ),
    );
  const full = read('full.log');
  write('final-source.json', final);
  write('summary.json', {
    at: final.at,
    branch: final.branch,
    head: final.head,
    indexPreserved: baseline.indexSha256 === final.indexSha256,
    sourceChanges,
    full: counts(full),
    failures: full.split(/\r?\n/).filter((line) => /^✖ /.test(line)),
    skips: full.split(/\r?\n/).filter((line) => /# SKIP|^﹣/.test(line)),
    crossModule: counts(read('cross-module.log')),
    frontend: read('frontend.log').match(/Tests\s+(\d+) passed/)?.[1] || null,
    originalInfrastructure:
      'No production database, credentials or external provider enrollment used',
  });
  console.log(
    JSON.stringify({
      full: counts(full),
      sourceChanges: sourceChanges.map((file) => file.path),
      indexPreserved: baseline.indexSha256 === final.indexSha256,
    }),
  );
}
