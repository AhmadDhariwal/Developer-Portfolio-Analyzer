// P1.6C.2 verification coordinator; source baseline and exact task inventory.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const output = path.join(root, 'frontend/verification/admin/p1.6c.2');
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const git = (...args) => execFileSync('git', args, { cwd: root, maxBuffer: 64 * 1024 * 1024 });
const save = (name, value) =>
  fs.writeFileSync(path.join(output, name), JSON.stringify(value, null, 2) + '\n');
function snapshot() {
  const files = {};
  function walk(relative) {
    for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
      const file = path.join(relative, entry.name).replaceAll('\\', '/');
      if (file.startsWith('frontend/verification/admin/p1.6c.2')) continue;
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile()) files[file] = hash(fs.readFileSync(path.join(root, file)));
    }
  }
  for (const folder of [
    'frontend/src',
    'backend/src',
    'frontend/verification/admin',
    'backend/verification/admin'
  ])
    walk(folder);
  return files;
}
if (process.argv.includes('--format')) {
  const before = JSON.parse(fs.readFileSync(path.join(output, 'baseline.json')));
  const after = snapshot();
  const frontend = Object.keys(after).filter(
    (file) =>
      file.startsWith('frontend/src/') &&
      /\.(?:ts|html|scss)$/.test(file) &&
      before.files[file] !== after[file]
  );
  const prettier = path.join(root, 'frontend/node_modules/prettier/bin/prettier.cjs');
  const backend = [
    'backend/scripts/verify-organization-control-center.cjs',
    'backend/scripts/smoke-organization-control-center.cjs'
  ];
  const checks = [];
  for (const [files, options] of [
    [frontend, ['--config', 'frontend/.prettierrc']],
    [backend, ['--single-quote', '--print-width', '100', '--trailing-comma', 'none']]
  ]) {
    for (const mode of ['--write', '--check']) {
      const args = [prettier, ...options, mode, ...files];
      const text = execFileSync(process.execPath, args, {
        cwd: root,
        maxBuffer: 8 * 1024 * 1024
      }).toString();
      checks.push({ args, exitCode: 0, output: text });
    }
  }
  save('formatting.json', { frontend, backend, checks });
  console.log(
    JSON.stringify({
      formattedFrontendFiles: frontend.length,
      formattedBackendScripts: backend.length
    })
  );
} else if (process.argv.includes('--baseline')) {
  const destination = path.join(output, 'baseline.json');
  if (fs.existsSync(destination)) throw Error('Baseline already exists.');
  save('baseline.json', {
    branch: git('branch', '--show-current').toString().trim(),
    head: git('rev-parse', 'HEAD').toString().trim(),
    prTarget: 'not applicable',
    status: git('status', '--short').toString(),
    index: hash(git('diff', '--cached', '--binary')),
    files: snapshot()
  });
  console.log('Baseline saved.');
} else if (process.argv.includes('--inventory')) {
  const before = JSON.parse(fs.readFileSync(path.join(output, 'baseline.json')));
  const after = snapshot();
  const changed = Object.keys(before.files).filter((file) => before.files[file] !== after[file]);
  const created = Object.keys(after).filter((file) => !Object.hasOwn(before.files, file));
  save('file-inventory.json', {
    changed,
    created,
    moved: [],
    deleted: changed.filter((file) => !Object.hasOwn(after, file)),
    indexUnchanged: hash(git('diff', '--cached', '--binary')) === before.index,
    protectedBackendSourceUnchanged: changed.every((file) => !file.startsWith('backend/src/')),
    historicalEvidenceUnchanged: changed.every((file) => !file.includes('/verification/')),
    allPathsRelativeTo: root
  });
  console.log(JSON.stringify({ changed: changed.length, created: created.length }));
} else throw Error('Use --baseline, --inventory or --format.');
