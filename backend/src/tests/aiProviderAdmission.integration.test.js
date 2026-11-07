const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { randomUUID } = require('node:crypto');
const { fork } = require('node:child_process');
const path = require('node:path');
const State = require('../models/aiProviderAdmission');
const admission = require('../services/aiProviderAdmissionService');

test('Shared AI admission on isolated real MongoDB', { skip: !process.env.AI_TEST_MONGO_URI }, async (t) => {
  const database = `codex_ai_provider_${randomUUID().replaceAll('-', '')}`;
  await mongoose.connect(process.env.AI_TEST_MONGO_URI, { dbName: database, serverSelectionTimeoutMS: 3000 });
  await State.createIndexes();
  t.after(async () => {
    await mongoose.disconnect();
  });
  await t.test('atomic quota reservations cannot oversubscribe', async () => {
    const outcomes = await Promise.allSettled(
      Array.from({ length: 20 }, () => admission.reserve('fixture-quota', 3, 600000, Date.now() + 3000))
    );
    assert.equal(outcomes.filter((item) => item.status === 'fulfilled').length, 3);
    assert.ok(
      outcomes.filter((item) => item.status === 'rejected').every((item) => item.reason.aiReason === 'local_quota')
    );
  });
  await t.test('two independent workers share one global concurrency limit', async () => {
    const previous = process.env.AI_GLOBAL_MAX_CONCURRENCY;
    process.env.AI_GLOBAL_MAX_CONCURRENCY = '1';
    const held = await admission.enter('global', Date.now() + 2000, 60000);
    try {
      const outcomes = await Promise.all(
        Array.from(
          { length: 2 },
          () =>
            new Promise((resolve, reject) => {
              const child = fork(path.join(__dirname, 'fixtures/aiProviderAdmissionWorker.js'), [], {
                env: { ...process.env, AI_TEST_DATABASE: database },
                stdio: ['ignore', 'ignore', 'ignore', 'ipc']
              });
              let result;
              child.on('message', (value) => {
                result = value;
              });
              child.on('error', reject);
              child.on('exit', (code) => (code === 0 ? resolve(result) : reject(new Error('Worker failed'))));
            })
        )
      );
      assert.ok(outcomes.every((result) => !result.admitted && result.reason === 'concurrency_limit'));
    } finally {
      await admission.release(held);
      if (previous === undefined) delete process.env.AI_GLOBAL_MAX_CONCURRENCY;
      else process.env.AI_GLOBAL_MAX_CONCURRENCY = previous;
    }
    const recovered = await admission.enter('global', Date.now() + 2000, 5000);
    assert.ok(recovered);
    await admission.release(recovered);
  });
  await t.test('lease expiration recovers, and an expired owner cannot release its successor', async () => {
    const previous = await admission.acquire('fixture-expiry', 1, Date.now() + 1000, 5);
    await new Promise((resolve) => setTimeout(resolve, 15));
    const next = await admission.acquire('fixture-expiry', 1, Date.now() + 1000, 1000);
    await admission.release(previous);
    assert.equal((await State.findById(next.id)).token, next.token);
    await admission.release(next);
  });
  await t.test(
    'configuration failures open a shared circuit until credentials change; transient circuits recover',
    async () => {
      const before = process.env.AI_AUTH_COOLDOWN_MS;
      process.env.AI_AUTH_COOLDOWN_MS = '1000';
      try {
        const identity = admission.fingerprint('gemini', 'synthetic-fixture', 'gemini-fixture');
        await admission.record(identity, false, { configuration: true }, Date.now() + 1000);
        assert.equal(await admission.circuit(identity, Date.now() + 1000), false);
        assert.equal(
          await admission.circuit(
            admission.fingerprint('gemini', 'changed-fixture', 'gemini-fixture'),
            Date.now() + 1000
          ),
          true
        );
        await State.updateOne({ _id: `circuit:${identity}` }, { $set: { openUntil: new Date(Date.now() - 1) } });
        assert.equal(await admission.circuit(identity, Date.now() + 1000), true);
        for (let i = 0; i < 3; i++) await admission.record(identity, false, { cooldownMs: 1000 }, Date.now() + 1000);
        assert.equal(await admission.circuit(identity, Date.now() + 1000), false);
        await State.updateOne({ _id: `circuit:${identity}` }, { $set: { openUntil: new Date(Date.now() - 1) } });
        assert.equal(await admission.circuit(identity, Date.now() + 1000), true);
        await admission.record(identity, true, {}, Date.now() + 1000);
        assert.equal((await State.findById(`circuit:${identity}`)).count, 0);
      } finally {
        if (before === undefined) delete process.env.AI_AUTH_COOLDOWN_MS;
        else process.env.AI_AUTH_COOLDOWN_MS = before;
      }
    }
  );
});
