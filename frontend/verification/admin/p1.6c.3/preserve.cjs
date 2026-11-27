const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '../../../..');
const qaDir = __dirname;
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const git = (...args) => execFileSync('git', args, { cwd: root, maxBuffer: 64 * 1024 * 1024 });

const P16C11_FILES = [
  'backend/src/modules/admin/controllers/recruiterController.js',
  'backend/src/modules/admin/controllers/tenantcontroller.js',
  'backend/src/modules/admin/services/invitationAcceptanceService.js',
  'backend/src/modules/admin/services/organizationGovernanceService.js',
  'backend/src/tests/admin/invitationAuthorityRevocation.integration.test.js',
];

function snapshotFiles() {
  const files = {};
  function walk(relative) {
    const abs = path.join(root, relative);
    if (!fs.existsSync(abs)) return;
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const rel = path.posix.join(relative, entry.name);
      if (rel === 'frontend/verification/admin/p1.6c.3') continue;
      if (entry.isDirectory()) walk(rel);
      else if (entry.isFile()) files[rel] = hash(fs.readFileSync(path.join(root, rel)));
    }
  }
  for (const folder of [
    'frontend/src',
    'backend/src',
    'backend/scripts',
    'frontend/verification',
    'backend/verification',
  ]) {
    walk(folder);
  }
  return files;
}

if (process.argv.includes('--baseline')) {
  const files = snapshotFiles();
  const payload = {
    capturedAt: new Date().toISOString(),
    branch: git('branch', '--show-current').toString().trim(),
    head: git('rev-parse', 'HEAD').toString().trim(),
    previousReportedHead: '46d626fcefd54282eae09ec292db7f93508864cd',
    headParent: git('rev-parse', 'HEAD~1').toString().trim(),
    status: git('status', '--short').toString(),
    workingDiffHash: hash(git('diff', '--binary')),
    cachedDiffHash: hash(git('diff', '--cached', '--binary')),
    p16c11Hashes: P16C11_FILES.map((file) => ({ file, sha256: files[file] })),
    backendSrcDiffSinceParent: git('diff', 'HEAD~1..HEAD', '--stat', '--', 'backend/src')
      .toString()
      .trim(),
    fileCount: Object.keys(files).length,
    files,
  };
  fs.writeFileSync(path.join(qaDir, 'baseline.json'), JSON.stringify(payload, null, 2) + '\n');
  console.log(
    JSON.stringify({
      branch: payload.branch,
      head: payload.head,
      fileCount: payload.fileCount,
      p16c11Hashes: payload.p16c11Hashes,
    }),
  );
} else if (process.argv.includes('--verify')) {
  const before = JSON.parse(fs.readFileSync(path.join(qaDir, 'baseline.json'), 'utf8'));
  const after = snapshotFiles();
  const modified = Object.keys(before.files).filter((f) => before.files[f] !== after[f]);
  const deleted = Object.keys(before.files).filter((f) => !Object.hasOwn(after, f));
  const addedOutsideQa = Object.keys(after).filter((f) => !Object.hasOwn(before.files, f));
  const preservation = {
    verifiedAt: new Date().toISOString(),
    branchUnchanged: git('branch', '--show-current').toString().trim() === before.branch,
    headUnchanged: git('rev-parse', 'HEAD').toString().trim() === before.head,
    workingDiffUnchanged: hash(git('diff', '--binary')) === before.workingDiffHash,
    cachedDiffUnchanged: hash(git('diff', '--cached', '--binary')) === before.cachedDiffHash,
    baselineFileCount: before.fileCount,
    currentFileCount: Object.keys(after).length,
    modifiedOutsideQa: modified,
    deletedOutsideQa: deleted,
    addedOutsideQa,
    allSourceAndHistoryPreserved:
      modified.length === 0 && deleted.length === 0 && addedOutsideQa.length === 0,
  };
  fs.writeFileSync(
    path.join(qaDir, 'file-preservation.json'),
    JSON.stringify(preservation, null, 2) + '\n',
  );
  const qaFiles = [];
  function walkQa(dir, prefix = 'frontend/verification/admin/p1.6c.3') {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      const rel = path.posix.join(prefix, entry.name);
      if (entry.isDirectory()) walkQa(abs, rel);
      else if (entry.isFile()) qaFiles.push({ relativePath: rel, absolutePath: abs });
    }
  }
  walkQa(qaDir);
  fs.writeFileSync(
    path.join(qaDir, 'qa-file-inventory.json'),
    JSON.stringify({ qaFileCount: qaFiles.length, files: qaFiles }, null, 2) + '\n',
  );
  console.log(JSON.stringify(preservation));
} else {
  throw new Error('Use --baseline or --verify');
}

