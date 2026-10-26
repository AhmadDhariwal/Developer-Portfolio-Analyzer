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
    await assert.rejects(
      () => adapter.ingestData({ externalUsername: value }),
      /valid http|public host|private or local/i
    );
  }
});

test('portfolio rejects IPv6, mapped addresses, CGNAT and rebinding at connection lookup', async () => {
  const adapter = getAdapter('portfolio');
  for (const value of [
    'http://[::1]',
    'http://[::ffff:127.0.0.1]',
    'http://100.64.0.1',
    'http://0x7f000001',
    'http://169.254.169.254'
  ])
    await assert.rejects(adapter.validatePublicUrl(value));
  const axios = require('axios');
  const governance = require('../services/integrationGovernanceService');
  const dns = require('node:dns').promises;
  const original = { get: axios.get, request: governance.request, lookup: dns.lookup };
  try {
    governance.request = async (_provider, operation) => operation({});
    dns.lookup = async () => [{ address: '127.0.0.1', family: 4 }];
    axios.get = async (_url, controls) =>
      new Promise((resolve, reject) =>
        controls.lookup('rebound.invalid', {}, (error) => {
          assert.ok(error);
          reject(error);
        })
      );
    await assert.rejects(adapter.scanPortfolio('https://rebound.invalid'), /request failed/);
  } finally {
    axios.get = original.get;
    governance.request = original.request;
    dns.lookup = original.lookup;
  }
});

test('provider registry rejects inherited properties and non-string inputs', () => {
  for (const value of ['constructor', '__proto__', 'toString', {}, ['github'], null])
    assert.equal(getAdapter(value), null);
});
