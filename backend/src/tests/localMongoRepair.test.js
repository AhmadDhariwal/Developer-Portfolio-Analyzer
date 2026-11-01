'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { storageConfiguration, copyDatabase } = require('../scripts/repairLocalMongoService');

test('storage relocation preserves replica set, loopback binding and all non-path settings', () => {
  const original =
    'storage:\n  dbPath: C:\\Mongo\\data\nsystemLog:\n  destination: file\n  path: C:\\Mongo\\log\\mongod.log\n  logAppend: true\nnet:\n  bindIp: 127.0.0.1\n  port: 27017\nreplication:\n  replSetName: rs0\n';
  const actual = storageConfiguration(original, 'D:\\Local\\data', 'D:\\Local\\log\\mongod.log');
  const yaml = require('yaml');
  const before = yaml.parse(original),
    after = yaml.parse(actual);
  before.storage.dbPath = 'D:\\Local\\data';
  before.systemLog.path = 'D:\\Local\\log\\mongod.log';
  assert.deepEqual(after, before);
  assert.throws(
    () => storageConfiguration(original + 'other:\n  path: C:\\other\n', 'D:\\data', 'D:\\log'),
    /Ambiguous/
  );
});

test('offline copy verifies bytes, is resumable, refuses overwrites and preserves the source', () => {
  const parent = path.resolve(__dirname, '../../verification/database');
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, 'repair-unit-'));
  const source = path.join(root, 'source'),
    target = path.join(root, 'target');
  fs.mkdirSync(path.join(source, 'journal'), { recursive: true });
  const originals = [path.join(source, 'WiredTiger'), path.join(source, 'journal', 'journal.0001')];
  fs.writeFileSync(originals[0], 'existing-database-metadata');
  fs.writeFileSync(originals[1], Buffer.from([0, 12, 255, 3]));
  try {
    const manifest = copyDatabase(source, target);
    assert.equal(manifest.length, 2);
    assert.deepEqual(copyDatabase(source, target), manifest);
    fs.writeFileSync(path.join(target, 'WiredTiger'), 'unrelated-existing-data');
    assert.throws(() => copyDatabase(source, target), /different data/);
    assert.equal(fs.readFileSync(originals[0], 'utf8'), 'existing-database-metadata');
    assert.throws(() => copyDatabase(source, path.join(source, 'nested')), /separate directories/);
  } finally {
    // Exact task-created fixture paths only; no recursive deletion.
    for (const base of [target, source]) {
      for (const relative of ['WiredTiger', path.join('journal', 'journal.0001')]) {
        const file = path.join(base, relative);
        if (fs.existsSync(file)) fs.unlinkSync(file);
      }
      if (fs.existsSync(path.join(base, 'journal'))) fs.rmdirSync(path.join(base, 'journal'));
      if (fs.existsSync(base)) fs.rmdirSync(base);
    }
    fs.rmdirSync(root);
  }
});
