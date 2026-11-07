'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const mongoose = require('mongoose');
const State = require('../models/integrationGovernanceState');
const admission = require('../services/sprintAiAdmissionService');
const exec = promisify(execFile);

test('shared Sprint AI admission enforces approved quotas and concurrency with safe expiry/fallback', async (t) => {
  const uri = process.env.CAREER_SPRINT_ISOLATED_MONGO_URI;
  assert.match(uri || '', /^mongodb:\/\/127\.0\.0\.1:\d+\/career_sprint_legacy_test_[a-z0-9_]+$/);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  const ownedKeys = new Set();
  const reserve = async (owner) => {
    const reservation = await admission.acquire(owner);
    if (reservation) {
      reservation.keys.forEach((key) => ownedKeys.add(key));
      ownedKeys.add(reservation.rateKey);
    }
    return reservation;
  };
  const owner = () => new mongoose.Types.ObjectId().toString();
  t.after(async () => {
    await State.deleteMany({ _id: { $in: [...ownedKeys] } });
    await mongoose.disconnect();
  });

  await t.test('five attempts per hour; release never refunds consumed quota', async () => {
    const user = owner();
    let last;
    for (let index = 0; index < 5; index++) {
      last = await reserve(user);
      assert.ok(last);
      await admission.release(last);
    }
    assert.equal(await reserve(user), null);
    assert.equal((await State.findById(last.rateKey).lean()).count, 5);
  });

  await t.test(
    'the next fixed hourly window has its own budget without rewriting the previous count',
    async (child) => {
      let clock = Date.now();
      child.mock.method(Date, 'now', () => clock);
      const user = owner();
      const before = await reserve(user);
      assert.ok(before);
      await admission.release(before);
      clock += admission.WINDOW_MS;
      const after = await reserve(user);
      assert.ok(after);
      assert.notEqual(after.rateKey, before.rateKey);
      assert.equal((await State.findById(before.rateKey).lean()).count, 1);
      assert.equal((await State.findById(after.rateKey).lean()).count, 1);
      await admission.release(after);
    }
  );

  await t.test('one active request per owner and denied concurrent requests consume no quota', async () => {
    const user = owner();
    const results = await Promise.all(Array.from({ length: 12 }, () => reserve(user)));
    const admitted = results.filter(Boolean);
    assert.equal(admitted.length, 1);
    assert.equal((await State.findById(admitted[0].rateKey).lean()).count, 1);
    await admission.release(admitted[0]);
    const next = await reserve(user);
    assert.ok(next);
    await admission.release(next);
  });

  await t.test('eight active requests globally; other owners cannot exceed the provider-wide bound', async () => {
    const active = [];
    for (let index = 0; index < 8; index++) {
      const reservation = await reserve(owner());
      assert.ok(reservation);
      active.push(reservation);
    }
    assert.equal(await reserve(owner()), null);
    await admission.release(active.pop());
    const replacement = await reserve(owner());
    assert.ok(replacement);
    await admission.release(replacement);
    for (const reservation of active) await admission.release(reservation);
  });

  await t.test('expired crash leases admit new work and old-token cleanup cannot release its replacement', async () => {
    const user = owner();
    const crashed = await reserve(user);
    assert.ok(crashed);
    await State.updateMany(
      { _id: { $in: crashed.keys } },
      { $set: { leases: [{ token: crashed.token, until: new Date(0) }] } }
    );
    const replacement = await reserve(user);
    assert.ok(replacement);
    await admission.release(crashed);
    const row = await State.findById(replacement.keys[1]).lean();
    assert.equal(row.leases.length, 1);
    assert.equal(row.leases[0].token, replacement.token);
    assert.equal((await State.findById(replacement.rateKey).lean()).count, 2);
    await admission.release(replacement);
  });

  await t.test(
    'a separate process observes the same owner lease rather than an independent worker budget',
    async () => {
      const user = owner();
      const active = await reserve(user);
      assert.ok(active);
      const code = `
      const mongoose = require('mongoose');
      (async () => {
        await mongoose.connect(process.argv[1], { serverSelectionTimeoutMS: 5000 });
        const admission = require('./src/services/sprintAiAdmissionService');
        const reservation = await admission.acquire(process.argv[2]);
        console.log(JSON.stringify({ admitted: Boolean(reservation) }));
        await admission.release(reservation);
        await mongoose.disconnect();
      })().catch(() => { process.exitCode = 1; });
    `;
      const result = await exec(process.execPath, ['-e', code, uri, user], {
        cwd: require('node:path').resolve(__dirname, '../..'),
        windowsHide: true,
        timeout: 15000
      });
      assert.deepEqual(JSON.parse(result.stdout.trim()), { admitted: false });
      await admission.release(active);
    }
  );

  await t.test('governance failure denies optional AI and lease cleanup remains safe', async (child) => {
    child.mock.method(State.collection, 'findOne', async () => {
      throw Error('Store unavailable');
    });
    assert.equal(await reserve(owner()), null);
    await admission.release({ keys: ['unused'], token: 'unused' });
  });
});
