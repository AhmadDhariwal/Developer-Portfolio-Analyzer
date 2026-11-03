'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { fork, spawnSync } = require('node:child_process');

test(
  'real preview-cache fallback preserves owner isolation but requires shared routing for multiple processes',
  { timeout: 30000 },
  async (t) => {
    const env = Object.fromEntries(
      ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE']
        .filter((key) => process.env[key])
        .map((key) => [key, process.env[key]])
    );
    env.NODE_ENV = 'test';
    const start = () =>
      new Promise((resolve, reject) => {
        const child = fork(path.join(__dirname, 'fixtures/skillGapPreviewCacheWorker.js'), [], {
          env,
          stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
          windowsHide: true
        });
        t.after(() => child.kill());
        child.once('error', reject);
        child.once('message', () => resolve(child));
      });
    const [left, right] = await Promise.all([start(), start()]);
    let id = 0;
    const call = (child, message) =>
      new Promise((resolve, reject) => {
        const request = ++id;
        const timer = setTimeout(() => reject(Error('cache probe timeout')), 5000);
        child.once('message', (result) => {
          clearTimeout(timer);
          result.error ? reject(Error(result.error)) : resolve(result.value);
        });
        child.send({ ...message, id: request });
      });
    const created = await call(left, { kind: 'create' });
    const same = await call(left, {
      kind: 'resolve',
      value: created,
      scope: 'account:synthetic-owner'
    });
    assert.equal(same.resumeInsights.analyzed, true);
    assert.equal(
      (await call(left, { kind: 'resolve', value: created, scope: 'account:foreign-owner' }))
        .status,
      400
    );
    const other = await call(right, {
      kind: 'resolve',
      value: created,
      scope: 'account:synthetic-owner'
    });
    assert.equal(other.status, 400);
    const report = {
      status: 'BLOCKED',
      sameWorker: 'PASS',
      foreignOwnerRejected: true,
      otherWorkerStatus: other.status,
      reason:
        'Without a shared cache, temporary resume references are process-local. Fleet routing/shared-cache acceptance requires the deployment topology.'
    };
    fs.writeFileSync(
      path.resolve(
        __dirname,
        '../../verification/skillgap/acceptance-2026-11-03/temporary-pdf-routing.json'
      ),
      JSON.stringify(report, null, 2) + '\n'
    );
  }
);

test('visual comparison refuses missing screenshots instead of passing zero comparisons', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skillgap-parity-negative-'));
  const before = path.join(root, 'before'),
    after = path.join(root, 'after');
  fs.mkdirSync(before);
  fs.mkdirSync(after);
  try {
    for (const directory of [before, after])
      fs.writeFileSync(path.join(directory, 'results.json'), JSON.stringify({ layouts: [] }));
    const result = spawnSync(
      'python',
      [path.resolve(__dirname, '../../../frontend/scripts/compare-skill-gap-parity.py')],
      {
        env: { ...process.env, SKILL_GAP_BASELINE: before, SKILL_GAP_CANDIDATE: after },
        encoding: 'utf8',
        windowsHide: true
      }
    );
    assert.notEqual(result.status, 0);
    assert.ok(result.stderr.includes('Thirty retained baseline screenshots are required'));
  } finally {
    for (const directory of [before, after]) {
      fs.unlinkSync(path.join(directory, 'results.json'));
      fs.rmdirSync(directory);
    }
    fs.rmdirSync(root);
  }
});
