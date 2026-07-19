const test = require('node:test');
const assert = require('node:assert/strict');
const { getAdapter, marketplace } = require('../services/integrations');

test('marketplace exposes expected providers', () => {
  const providers = marketplace.map((item) => item.provider).sort();
  assert.deepEqual(providers, [
    'certifications',
    'devblogs',
    'github',
    'hackerrank',
    'kaggle',
    'leetcode',
    'linkedin',
    'portfolio',
    'stackoverflow'
  ]);
  providers.forEach((provider) => {
    assert.ok(getAdapter(provider), `Expected adapter for ${provider}`);
  });
});

test('oauth providers expose oauth2 auth mode', () => {
  const github = getAdapter('github');
  const linkedin = getAdapter('linkedin');
  assert.equal(github.getAuthMode(), 'oauth2');
  assert.equal(linkedin.getAuthMode(), 'oauth2');
});

test('portfolio adapter rejects unsafe URL schemes and private targets without network calls', async () => {
  const adapter = getAdapter('portfolio');
  for (const value of [
    'javascript:alert(1)',
    'data:text/html,test',
    'blob:https://example.com/id',
    'http://localhost:3000',
    'http://127.0.0.1',
    'http://10.0.0.1',
    'http://192.168.1.10'
  ]) {
    await assert.rejects(() => adapter.ingestData({ externalUsername: value }), /valid http|public host|private or local/i);
  }
});
