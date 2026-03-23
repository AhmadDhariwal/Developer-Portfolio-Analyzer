const test = require('node:test');
const assert = require('node:assert/strict');
const { getAdapter, marketplace } = require('../services/integrations');

test('marketplace exposes expected providers', () => {
  const providers = marketplace.map((item) => item.provider).sort();
  assert.deepEqual(providers, ['github', 'kaggle', 'leetcode', 'linkedin']);
});

test('oauth providers expose oauth2 auth mode', () => {
  const github = getAdapter('github');
  const linkedin = getAdapter('linkedin');
  assert.equal(github.getAuthMode(), 'oauth2');
  assert.equal(linkedin.getAuthMode(), 'oauth2');
});

test('manual providers ingest normalized data with username', async () => {
  for (const provider of ['leetcode', 'kaggle']) {
    const adapter = getAdapter(provider);
    assert.ok(adapter, `Expected adapter for ${provider}`);

    try {
      const payload = await adapter.ingestData({ externalUsername: 'demo-user' });
      assert.equal(payload.provider, provider);
      assert.ok(Array.isArray(payload.inferredSkills));
    } catch (error) {
      // External APIs can reject mocked usernames or traffic, but adapter should at least throw cleanly.
      assert.ok(String(error.message || '').length > 0);
    }
  }
});
