const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const Cache = require('../../core/cache/boundedMemoryCache');

test('LRU eviction retains source deadlines and isolates distinct owners', async () => {
  assert.throws(() => new Cache(0), RangeError);
  const cache = new Cache(2);
  const deadline = Date.now() + 40;
  cache.set('owner-a', { expiresAt: deadline, revision: 'a' });
  cache.set('owner-b', { expiresAt: Date.now() + 10000, revision: 'b' });
  assert.equal(cache.get('owner-a').revision, 'a');
  cache.set('owner-c', { expiresAt: Date.now() + 10000, revision: 'c' });
  assert.equal(cache.get('owner-b'), undefined);
  assert.equal(cache.get('owner-a').expiresAt, deadline);
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(cache.get('owner-a'), undefined);
  assert.equal(cache.get('owner-c').revision, 'c');
});

test('an unusable source TTL cannot create an immortal AI fallback entry', () => {
  const ai = require('../../core/ai/aiservice');
  for (const ttl of [0, -1, NaN, undefined]) {
    ai.memorySet('invalid-ttl', { marker: true }, ttl);
    assert.equal(ai.memoryGet('invalid-ttl'), null);
  }
});

test('Recommendations result cache is bounded and expires no later than its source', async () => {
  const filename = require.resolve('../../modules/recommendations/services/recommendationService');
  const unit = new Module(filename, module);
  unit.filename = filename;
  unit.paths = Module._nodeModulePaths(path.dirname(filename));
  // Expose private operations for this regression without adding production setters.
  unit._compile(
    fs.readFileSync(filename, 'utf8') +
      '\nmodule.exports.cacheProbe = { writeRecommendationMemory, readRecommendationMemory };',
    filename
  );
  const { cacheProbe, getRecommendationMemoryCacheSize } = unit.exports;
  for (let index = 0; index < 1000; index++)
    cacheProbe.writeRecommendationMemory(`owner-${index}`, {
      analysisData: { owner: index },
      expiresAt: Date.now() + 60000
    });
  assert.equal(getRecommendationMemoryCacheSize(), 256);
  assert.equal(cacheProbe.readRecommendationMemory('owner-0'), null);
  cacheProbe.writeRecommendationMemory('short-redis-source', {
    analysisData: { owner: 'short' },
    expiresAt: Date.now() + 40
  });
  assert.equal(
    cacheProbe.readRecommendationMemory('short-redis-source').analysisData.owner,
    'short'
  );
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(cacheProbe.readRecommendationMemory('short-redis-source'), null);
});
