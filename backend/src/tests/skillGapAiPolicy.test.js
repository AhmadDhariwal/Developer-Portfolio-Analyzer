'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const manager = require('../services/aiProviderManager');
const admission = require('../services/aiProviderAdmissionService');
test('Skill Gap opt-in policy bounds Gemini attempts and tokens without changing default callers', async (t) => {
  t.mock.method(admission, 'enter', async () => ({}));
  t.mock.method(admission, 'release', async () => {});
  t.mock.method(admission, 'circuit', async () => true);
  t.mock.method(admission, 'record', async () => {});
  const methods = [
    'getProviderState',
    'providerPriority',
    'runProviderRequest',
    'recordFailure',
    'recordSuccess',
    'log'
  ];
  const saved = Object.fromEntries(methods.map((name) => [name, manager[name]]));
  t.after(() => Object.assign(manager, saved));
  const state = {
    enabled: true,
    hasKey: true,
    apiKey: 'synthetic-not-a-real-key',
    models: ['gemini-2.5-flash', 'gemini-2.0-flash']
  };
  manager.getProviderState = () => ({
    settings: { enabled: true },
    states: { gemini: state, openai: { ...state, models: ['gpt-fixture'] } }
  });
  manager.providerPriority = () => ['gemini', 'openai'];
  manager.recordFailure = () => {};
  manager.recordSuccess = () => {};
  manager.log = () => {};
  const calls = [];
  manager.runProviderRequest = async (opts) => {
    calls.push(opts);
    throw Object.assign(Error('synthetic server failure'), { response: { status: 500 } });
  };
  const result = await manager.execute('Synthetic redacted prompt', {
    retries: 0,
    parseJson: JSON.parse,
    timeoutMs: 7000,
    requestPolicy: { allowedProviders: ['gemini'], maxAttempts: 1, maxOutputTokens: 600 }
  });
  assert.equal(result.ok, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].provider, 'gemini');
  assert.equal(calls[0].maxOutputTokens, 600);
  calls.length = 0;
  await manager.execute('Synthetic legacy caller', {
    retries: 0,
    parseJson: JSON.parse,
    timeoutMs: 7000
  });
  assert.ok(calls.length > 1);
  assert.equal(calls[0].maxOutputTokens, undefined);
});
