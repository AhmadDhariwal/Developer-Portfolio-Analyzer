'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const load = (locks) => {
  const filename = require.resolve('../services/recommendationGenerationService');
  delete require.cache[filename];
  const original = Module._load;
  Module._load = function (request, parent, isMain) {
    if (parent?.filename === filename && request === './redisCacheService') return locks;
    return original.call(this, request, parent, isMain);
  };
  try {
    return require(filename);
  } finally {
    Module._load = original;
  }
};

for (const state of [true, false, null])
  test(`optional AI lease: ${state}`, async () => {
    let calls = 0;
    let releases = 0;
    let lockToken;
    const service = load({
      acquireCacheLock: async (key, token, ttl) => {
        assert.match(key, /^recommendations:enrichment-lock:owner:hash$/);
        assert.equal(ttl, 60);
        lockToken = token;
        return state;
      },
      releaseCacheLock: async (key, token) => {
        assert.equal(token, lockToken);
        releases++;
      },
    });
    const output = await service.enrich({
      aiService: {
        runAIAnalysis: async (prompt, fallback, retries, options) => {
          calls++;
          assert.equal(retries, 0);
          assert.equal(options.returnMeta, true);
          assert.equal(options.timeoutMs, 7000);
          return { ok: true, value: { learningActions: [] } };
        },
      },
      prompt: 'Bounded fixture',
      signalHash: 'hash',
      identity: 'owner',
      enabled: true,
    });
    assert.equal(calls, state === false ? 0 : 1);
    assert.equal(releases, state === true ? 1 : 0);
    assert.equal(output.ok, state !== false);
  });

test('passive reads skip locks and AI; provider exceptions release the lease and fall back', async () => {
  let acquired = 0;
  let released = 0;
  const service = load({
    acquireCacheLock: async () => {
      acquired++;
      return true;
    },
    releaseCacheLock: async () => {
      released++;
    },
  });
  const args = {
    aiService: {
      runAIAnalysis: async () => {
        throw new Error('Provider offline');
      },
    },
    identity: 'owner',
    signalHash: 'hash',
    prompt: 'fixture',
  };
  assert.equal((await service.enrich({ ...args, enabled: false })).ok, false);
  assert.equal(acquired, 0);
  assert.equal((await service.enrich({ ...args, enabled: true })).ok, false);
  assert.equal(released, 1);
});

test('Redis acquisition/release failures preserve bounded deterministic fallback and correct provider counts', async () => {
  let calls = 0;
  const service = load({
    acquireCacheLock: async () => {
      throw Error('Redis unavailable');
    },
    releaseCacheLock: async () => {
      throw Error('Redis unavailable');
    },
  });
  const args = {
    enabled: true,
    identity: 'owner',
    signalHash: 'hash',
    prompt: 'Synthetic evidence',
    aiService: {
      runAIAnalysis: async () => {
        calls++;
        throw Error('Provider timeout');
      },
    },
  };
  const result = await service.enrich(args);
  assert.equal(calls, 1);
  assert.equal(result.ok, false);
  assert.equal(result.aiCalled, true);
  const abort = new AbortController();
  abort.abort();
  assert.equal((await service.enrich({ ...args, governance: { signal: abort.signal } })).ok, false);
  assert.equal(calls, 1);
});

test('Mongo AI budget exhaustion makes no provider call and leaves deterministic actions available', async (t) => {
  const controls = require('../services/recommendationGovernanceService');
  const original = { consume: controls.consume, transaction: controls.transaction };
  t.after(() => Object.assign(controls, original));
  controls.transaction = async () => {};
  controls.consume = async () => {
    throw controls.failure(429);
  };
  const service = load({
    acquireCacheLock: async () => true,
    releaseCacheLock: async () => {
      throw Error('Redis release unavailable');
    },
  });
  const result = await service.enrich({
    enabled: true,
    identity: 'owner',
    signalHash: 'hash',
    prompt: 'Synthetic evidence',
    governance: { owner: 'owner', ip: 'fixture', signal: new AbortController().signal },
    aiService: { runAIAnalysis: async () => assert.fail('No paid work after budget exhaustion') },
  });
  assert.equal(result.ok, false);
  assert.equal(result.aiCalled, false);
});
