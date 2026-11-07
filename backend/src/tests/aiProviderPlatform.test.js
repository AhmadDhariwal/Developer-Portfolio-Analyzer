const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const manager = require('../services/aiProviderManager');
const admission = require('../services/aiProviderAdmissionService');
const config = require('../config/aiProviders');
const ai = require('../services/aiservice');
const { updateText } = require('../scripts/configureSharedAiEnvironment');

const isolate = (t, providers = config.PRODUCTION_ORDER) => {
  const controls = { admissionFails: false };
  const states = Object.fromEntries(
    providers.map((provider) => [
      provider,
      {
        enabled: true,
        hasKey: true,
        apiKey: 'synthetic-not-a-credential',
        models: [
          {
            gemini: 'gemini-fixture',
            openai: 'gpt-fixture',
            groq: 'openai/gpt-oss-fixture',
            xai: 'grok-fixture',
            anthropic: 'claude-fixture'
          }[provider]
        ]
      }
    ])
  );
  t.mock.method(manager, 'getProviderState', () => ({ settings: { enabled: true }, states }));
  t.mock.method(manager, 'log', () => {});
  t.mock.method(manager, 'recordFailure', () => {});
  t.mock.method(manager, 'recordSuccess', () => {});
  t.mock.method(admission, 'enter', async () => {
    if (controls.admissionFails) throw Object.assign(new Error('fixture'), { aiReason: 'coordination_unavailable' });
    return {};
  });
  t.mock.method(admission, 'release', async () => {});
  t.mock.method(admission, 'circuit', async () => true);
  t.mock.method(admission, 'record', async () => {});
  return controls;
};
test('the approved five-provider order is fixed in every environment', (t) => {
  const before = { ...process.env };
  t.after(() => {
    process.env = before;
  });
  process.env.AI_PROVIDER_PRIORITY = 'openrouter,groq,openai';
  process.env.NODE_ENV = 'production';
  process.env.AI_ENABLE_GROQ_DEV = 'true';
  assert.deepEqual(manager.providerPriority(), ['gemini', 'openai', 'groq', 'anthropic', 'xai']);
  assert.equal(manager.normalizeProvider('openrouter'), '');
  assert.equal(manager.normalizeProvider('groq'), 'groq');
  assert.deepEqual(Object.keys(config.PROVIDERS), config.PRODUCTION_ORDER);
  assert.equal(manager.normalizeProvider('Grok'), 'xai');
  process.env.NODE_ENV = 'development';
  assert.deepEqual(manager.providerPriority(), config.PRODUCTION_ORDER);
  process.env.AI_ENABLE_GROQ_DEV = 'false';
  assert.deepEqual(manager.providerPriority(), config.PRODUCTION_ORDER);
});
test('missing keys skip, configured model lists do not silently substitute defaults, environment updater preserves values', (t) => {
  const before = { ...process.env };
  t.after(() => {
    process.env = before;
  });
  for (const name of Object.keys(config.ENV_DEFAULTS)) delete process.env[name];
  const state = manager.getProviderState();
  assert.equal(
    Object.values(state.states).some((entry) => entry.enabled),
    false
  );
  process.env.OPENAI_MODEL = 'gpt-custom-fixture';
  assert.deepEqual(manager.providerModels('openai'), ['gpt-custom-fixture']);
  const initial =
    'OPENAI_API_KEY=synthetic-preserved\r\nOPENAI_MODEL=gpt-fixture\r\nGEMINI_API_KEY=synthetic-other\r\nGEMINI_MODEL=gemini-fixture\r\nAI_PROVIDER_PRIORITY=groq\r\nUNRELATED=yes\r\n';
  const updated = updateText(initial);
  assert.ok(updated.next.includes('OPENAI_API_KEY=synthetic-preserved\r\n'));
  assert.ok(updated.next.includes('GEMINI_MODEL=gemini-fixture\r\n'));
  assert.ok(updated.next.includes('XAI_API_KEY=\r\n'));
  assert.equal(updateText(updated.next).next, updated.next);
});
test('environment consolidation removes obsolete providers, rejects conflicts and preserves unrelated entries', () => {
  const input =
    'GROQ_API_KEY=gsk_synthetic_preserved\nOPENROUTER_API_KEY=obsolete\nAI_ENABLE_GROQ_DEV=true\nOPENAI_MODEL=gpt-fixture\nOPENAI_MODEL=gpt-fixture\nUNRELATED=first\nUNRELATED=last\n';
  const { next } = updateText(input);
  assert.ok(!/^(?:OPENROUTER_|AI_ENABLE_GROQ_DEV)/m.test(next));
  assert.ok(next.includes('GROQ_API_KEY=gsk_synthetic_preserved\n'));
  assert.equal(next.match(/^OPENAI_MODEL=/gm).length, 1);
  assert.ok(next.includes('UNRELATED=first\nUNRELATED=last\n'));
  assert.equal(updateText(next).next, next);
  assert.throws(
    () => updateText('OPENAI_MODEL=gpt-one\nOPENAI_MODEL=gpt-two\n'),
    /Conflicting duplicate AI variable: OPENAI_MODEL/
  );
});

test('transient failures visit Gemini, OpenAI, Groq, Claude then xAI exactly once', async (t) => {
  isolate(t);
  const calls = [];
  t.mock.method(manager, 'runProviderRequest', async ({ provider }) => {
    calls.push(provider);
    if (provider !== 'xai') throw Object.assign(new Error('synthetic unavailable'), { response: { status: 503 } });
    return { ok: true };
  });
  const result = await manager.execute('Synthetic fixture', { timeoutMs: 1000 });
  assert.equal(result.ok, true);
  assert.equal(result.provider, 'xai');
  assert.deepEqual(calls, config.PRODUCTION_ORDER);
});
test('invalid requests and safety refusals are terminal across every adapter', async (t) => {
  assert.equal(
    manager.classify({ response: { status: 429, data: { error: { code: 'content_blocked' } } } }),
    'safety_refusal'
  );
  for (const status of [400, 403, 413, 422])
    await t.test(String(status), async (subtest) => {
      isolate(subtest);
      let calls = 0;
      subtest.mock.method(manager, 'runProviderRequest', async () => {
        calls++;
        throw Object.assign(new Error('synthetic invalid request'), { response: { status } });
      });
      assert.equal((await manager.execute('fixture')).reason, 'invalid_request');
      assert.equal(calls, 1);
    });
  for (const [provider, data] of [
    ['openai', { choices: [{ message: { refusal: 'refused' }, finish_reason: 'stop' }] }],
    ['groq', { choices: [{ message: { refusal: 'refused' }, finish_reason: 'stop' }] }],
    ['xai', { choices: [{ message: { content: '' }, finish_reason: 'content_filter' }] }],
    ['anthropic', { stop_reason: 'refusal', content: [] }]
  ])
    await t.test(provider, async (subtest) => {
      isolate(subtest);
      subtest.mock.method(axios, 'post', async () => ({ data }));
      await assert.rejects(
        manager.runProviderRequest({
          provider,
          apiKey: 'synthetic',
          modelName: 'fixture',
          prompt: 'fixture',
          parseJson: JSON.parse,
          timeoutMs: 500
        }),
        { aiReason: 'safety_refusal' }
      );
    });
});
test('authentication, 429 and malformed JSON fail over without same-provider retry', async (t) => {
  assert.equal(
    manager.classify(Object.assign(new Error('API key not valid. Please pass a valid API key.'), { status: 400 })),
    'configuration'
  );
  for (const scenario of ['401', '429', 'malformed'])
    await t.test(scenario, async (subtest) => {
      isolate(subtest);
      const calls = [];
      subtest.mock.method(manager, 'runProviderRequest', async ({ provider }) => {
        calls.push(provider);
        if (provider === 'gemini') {
          if (scenario === 'malformed') throw new SyntaxError('fixture malformed');
          throw Object.assign(new Error('fixture'), {
            response: { status: Number(scenario), headers: { 'retry-after': '3' } }
          });
        }
        return { ok: true };
      });
      assert.equal((await manager.execute('fixture')).provider, 'openai');
      assert.deepEqual(calls, ['gemini', 'openai']);
    });
});
test('one total deadline aborts even an uncooperative adapter and never multiplies by provider count', async (t) => {
  isolate(t);
  let signal;
  let calls = 0;
  t.mock.method(manager, 'runProviderRequest', (input) => {
    calls++;
    signal = input.signal;
    return new Promise(() => {});
  });
  const started = performance.now();
  const result = await manager.execute('fixture', { timeoutMs: 60 });
  assert.equal(result.reason, 'timeout');
  assert.equal(calls, 1);
  assert.equal(signal.aborted, true);
  assert.ok(performance.now() - started < 250);
});
test('external cancellation is terminal, and successful requests keep their signal live', async (t) => {
  isolate(t);
  const controller = new AbortController();
  let signal;
  let success = false;
  t.mock.method(manager, 'runProviderRequest', (input) => {
    signal = input.signal;
    if (success) return Promise.resolve({ ok: true });
    controller.abort();
    return new Promise(() => {});
  });
  assert.equal((await manager.execute('fixture', { signal: controller.signal })).reason, 'cancelled');
  assert.equal(signal.aborted, true);
  success = true;
  assert.equal((await manager.execute('fixture')).ok, true);
  assert.equal(signal.aborted, false);
});
test('module allowed-provider and total-attempt budgets remain authoritative', async (t) => {
  isolate(t);
  const calls = [];
  t.mock.method(manager, 'runProviderRequest', async ({ provider }) => {
    calls.push(provider);
    throw Object.assign(new Error('fixture'), { response: { status: 503 } });
  });
  await manager.execute('fixture', {
    timeoutMs: 6200,
    requestPolicy: { allowedProviders: ['gemini'], maxAttempts: 1 }
  });
  assert.deepEqual(calls, ['gemini']);
  calls.length = 0;
  await manager.execute('fixture', { requestPolicy: { maxAttempts: 1 } });
  assert.deepEqual(calls, ['gemini']);
});
test('one-provider retries are bounded to two attempts and coordination failure never calls a provider', async (t) => {
  const controls = isolate(t, ['gemini']);
  let calls = 0;
  t.mock.method(manager, 'runProviderRequest', async () => {
    calls++;
    throw Object.assign(new Error('fixture'), { response: { status: 503 } });
  });
  await manager.execute('fixture', { retries: 200, timeoutMs: 1000 });
  assert.equal(calls, 2);
  controls.admissionFails = true;
  calls = 0;
  assert.equal((await manager.execute('fixture')).reason, 'coordination_unavailable');
  assert.equal(calls, 0);
});
test('adapters normalize JSON and preserve provider token caps', async (t) => {
  const requests = [];
  t.mock.method(axios, 'post', async (url, body) => {
    requests.push({ url, body });
    return {
      data: url.includes('anthropic')
        ? { stop_reason: 'end_turn', content: [{ text: '{"ok":true}' }] }
        : { choices: [{ finish_reason: 'stop', message: { content: '{"ok":true}' } }] }
    };
  });
  for (const provider of ['openai', 'xai', 'anthropic', 'groq']) {
    assert.deepEqual(
      await manager.runProviderRequest({
        provider,
        prompt: 'fixture',
        apiKey: 'synthetic',
        modelName: provider === 'openai' ? 'gpt-6-fixture' : provider === 'groq' ? 'openai/gpt-oss-120b' : 'fixture',
        parseJson: JSON.parse,
        timeoutMs: 500,
        maxOutputTokens: 600
      }),
      { ok: true }
    );
  }
  assert.equal(requests[0].body.max_completion_tokens, 600);
  assert.equal(requests[0].body.max_tokens, undefined);
  assert.equal(requests[1].url, 'https://api.x.ai/v1/chat/completions');
  assert.equal(requests[2].body.max_tokens, 600);
  assert.equal(requests[3].url, 'https://api.groq.com/openai/v1/chat/completions');
  assert.equal(requests[3].body.max_completion_tokens, 600);
  assert.equal(requests[3].body.temperature, undefined);
  assert.equal(requests[3].body.reasoning_effort, 'low');
});
test('Gemini safety metadata stops before text extraction', async (t) => {
  t.mock.method(
    global,
    'fetch',
    async () =>
      new Response(JSON.stringify({ promptFeedback: { blockReason: 'SAFETY' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
  );
  await assert.rejects(
    manager.runGemini({
      prompt: 'fixture',
      apiKey: 'synthetic',
      modelName: 'gemini-fixture',
      parseJson: JSON.parse,
      timeoutMs: 500
    }),
    { aiReason: 'safety_refusal' }
  );
});
test('cache retains JSON/provenance, partitions restrictive policies and honours cancellation before hits', async (t) => {
  const stored = new Map();
  let calls = 0;
  t.mock.method(ai, 'getSharedCache', async (key) => stored.get(key) ?? null);
  t.mock.method(ai, 'setSharedCache', async (key, value) => {
    stored.set(key, value);
  });
  t.mock.method(manager, 'getStatus', () => ({ enabledProviders: ['gemini'] }));
  t.mock.method(manager, 'execute', async () => {
    calls++;
    return { ok: true, parsed: { ok: true }, provider: 'gemini', model: 'gemini-fixture' };
  });
  const first = await ai.runAIAnalysis('fixture', {}, 0, { returnMeta: true });
  const cached = await ai.runAIAnalysis('fixture', {}, 0, { returnMeta: true });
  assert.equal(first.provider, cached.provider);
  assert.equal(calls, 1);
  assert.equal(cached.reason, 'cache_hit');
  await ai.runAIAnalysis('fixture', {}, 0, { requestPolicy: { allowedProviders: ['gemini'] } });
  assert.equal(calls, 2);
  const controller = new AbortController();
  controller.abort();
  assert.equal(
    (await ai.runAIAnalysis('fixture', {}, 0, { signal: controller.signal, returnMeta: true })).reason,
    'cancelled'
  );
});
test('the facade deadline covers a stalled cache lookup without later provider work', async (t) => {
  let calls = 0;
  t.mock.method(ai, 'getSharedCache', () => new Promise(() => {}));
  t.mock.method(manager, 'execute', async () => {
    calls++;
    return { ok: true, parsed: {} };
  });
  const started = performance.now();
  assert.equal(
    (await ai.runAIAnalysis('stalled cache fixture', {}, 0, { timeoutMs: 50, returnMeta: true })).reason,
    'timeout'
  );
  assert.equal(calls, 0);
  assert.ok(performance.now() - started < 250);
});
