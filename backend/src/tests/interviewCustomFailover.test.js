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
    if (controls.admissionFails)
      throw Object.assign(new Error('fixture'), { aiReason: 'coordination_unavailable' });
    return {};
  });
  t.mock.method(admission, 'release', async () => {});
  t.mock.method(admission, 'circuit', async () => true);
  t.mock.method(admission, 'record', async () => {});
  return controls;
};

for (const reason of ['timeout', '429', '500', 'billing', 'invalid'])
  test(`Custom Q&A fails over after ${reason}`, async (t) => {
    isolate(t);
    const calls = [];
    t.mock.method(manager, 'runProviderRequest', async ({ provider }) => {
      calls.push(provider);
      if (calls.length === 1) {
        if (reason === 'timeout') throw Object.assign(new Error('timeout'), { aiReason: 'timeout' });
        if (reason === 'invalid')
          throw Object.assign(new Error('invalid'), { aiReason: 'incomplete_output' });
        throw Object.assign(new Error('fixture'), {
          response: {
            status: reason === 'billing' ? 400 : Number(reason),
            data: {
              error: {
                message:
                  reason === 'billing' ? 'Your credit balance is too low. Purchase credits.' : 'failure'
              }
            }
          }
        });
      }
      return { answer: 'valid' };
    });
    const outcome = await manager.execute('fixture', { requestPolicy: config.customQAPolicy() });
    assert.equal(outcome.ok, true);
    assert.deepEqual(calls, ['groq', 'gemini']);
  });
test('Custom policy skips circuits and missing credentials without consuming actual attempts', async (t) => {
  isolate(t, ['groq', 'gemini', 'anthropic']);
  t.mock.method(admission, 'circuit', async (identity) => !identity.includes('impossible'));
  let circuits = 0;
  t.mock.method(admission, 'circuit', async () => ++circuits > 1);
  const calls = [];
  t.mock.method(manager, 'runProviderRequest', async ({ provider }) => {
    calls.push(provider);
    return { answer: 'valid' };
  });
  const result = await manager.execute('fixture', {
    requestPolicy: { ...config.customQAPolicy(), maxAttempts: 1 }
  });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, ['gemini']);
});
test('Groq succeeds immediately and unrelated operations retain global ordering', async (t) => {
  isolate(t);
  const calls = [];
  t.mock.method(manager, 'runProviderRequest', async ({ provider }) => {
    calls.push(provider);
    return { ok: true };
  });
  await manager.execute('fixture', { requestPolicy: config.customQAPolicy() });
  await manager.execute('other');
  assert.deepEqual(calls, ['groq', 'gemini']);
});
test('billing classification, safe failure feedback and configurable policy', () => {
  assert.equal(
    manager.classify({
      response: {
        status: 400,
        data: { error: { message: 'Your credit balance is too low. Please purchase credits.' } }
      }
    }),
    'billing'
  );
  assert.equal(manager.classify({ response: { status: 400 } }), 'invalid_request');
  const service = require('../services/interviewPrepService');
  assert.match(service.buildAiFailurePayload({ reasonCode: 'ai_provider_timeout' }).message, /too long/);
  const old = process.env.INTERVIEW_CUSTOM_PROVIDER_PRIORITY;
  process.env.INTERVIEW_CUSTOM_PROVIDER_PRIORITY = 'gemini,groq,groq,unknown';
  assert.deepEqual(config.customQAPolicy().providerPriority, ['gemini', 'groq']);
  if (old === undefined) delete process.env.INTERVIEW_CUSTOM_PROVIDER_PRIORITY;
  else process.env.INTERVIEW_CUSTOM_PROVIDER_PRIORITY = old;
});
test('expired deadline starts no further provider and admission is balanced', async (t) => {
  isolate(t);
  let released = 0;
  t.mock.method(admission, 'release', async () => released++);
  let calls = 0;
  t.mock.method(manager, 'runProviderRequest', async () => {
    calls++;
    await new Promise((r) => setTimeout(r, 30));
    return {};
  });
  const outcome = await manager.execute('fixture', { timeoutMs: 10, requestPolicy: config.customQAPolicy() });
  assert.equal(outcome.ok, false);
  assert.equal(calls, 1);
  assert.ok(released >= 1);
});

test('a configured Gemini-first policy can time out and fall back to Groq', async (t) => {
  isolate(t);
  const calls = [];
  t.mock.method(manager, 'runProviderRequest', async ({ provider }) => {
    calls.push(provider);
    if (provider === 'gemini') throw Object.assign(new Error('fixture'), { aiReason: 'timeout' });
    return { ok: true };
  });
  assert.equal(
    (
      await manager.execute('fixture', {
        requestPolicy: { ...config.customQAPolicy(), providerPriority: ['gemini', 'groq'] }
      })
    ).ok,
    true
  );
  assert.deepEqual(calls, ['gemini', 'groq']);
});
test('OpenAI open circuit is skipped immediately before healthy Groq', async (t) => {
  isolate(t);
  let checks = 0;
  t.mock.method(admission, 'circuit', async () => ++checks > 1);
  const calls = [];
  t.mock.method(manager, 'runProviderRequest', async ({ provider }) => {
    calls.push(provider);
    return { ok: true };
  });
  assert.equal(
    (
      await manager.execute('fixture', {
        requestPolicy: { ...config.customQAPolicy(), providerPriority: ['openai', 'groq'], maxAttempts: 1 }
      })
    ).ok,
    true
  );
  assert.deepEqual(calls, ['groq']);
});
test('custom persistence forwards the remaining operation budget while retaining the owner', async (t) => {
  const Session = require('../models/interviewPrepSession');
  const sessions = require('../services/interviewSessionService');
  let observed;
  t.mock.method(Session, 'insertMany', async (records, options) => {
    observed = { records, options };
    return records;
  });
  const record = { userId: 'owner', kind: 'custom', questions: [] };
  assert.equal((await sessions.create(record, { deadlineAt: Date.now() + 1500 })).userId, 'owner');
  assert.ok(observed.options.timeoutMS > 0 && observed.options.timeoutMS <= 1500);
  assert.equal(observed.records.length, 1);
});
