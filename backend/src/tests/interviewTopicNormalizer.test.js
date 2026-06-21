const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeTopicInput, resolveTopic, listImportantTopics, detectTopicsInText } = require('../services/interviewTopicNormalizer');
const { verifiedSeedCatalog, TOP_QUESTION_COUNT, MIN_VERIFIED_SEED_COUNT } = require('../services/interviewQuestionSeedCatalog');

test('normalizeTopicInput resolves known aliases to canonical topic keys', () => {
  const node = normalizeTopicInput({ framework: 'Node JS' });
  assert.equal(node.topicKey, 'nodejs');
  assert.equal(node.topicType, 'framework');

  const cpp = normalizeTopicInput({ language: 'c plus plus' });
  assert.equal(cpp.topicKey, 'cpp');
  assert.equal(cpp.topicType, 'language');
});

test('normalizeTopicInput preserves fallback for unknown topics', () => {
  const result = normalizeTopicInput({ technology: 'Event Mesh' });
  assert.equal(result.topicKey, 'event-mesh');
  assert.equal(result.topicType, 'technology');
});

test('resolveTopic handles stack aliases and important topics list is populated', () => {
  const resolved = resolveTopic('full stack web', 'stack');
  assert.equal(resolved.topicKey, 'full-stack-web-development');

  const topics = listImportantTopics();
  assert.ok(Array.isArray(topics));
  assert.ok(topics.length >= 15);
});

test('detectTopicsInText finds explicit skill mentions without false-matching adjacent names', () => {
  const reactMatches = detectTopicsInText('How does React use keys during reconciliation?');
  assert.ok(reactMatches.some((item) => item.topicKey === 'react'));

  const jsOnly = detectTopicsInText('Explain JavaScript closures and the event loop.');
  assert.ok(jsOnly.some((item) => item.topicKey === 'javascript'));
  assert.ok(!jsOnly.some((item) => item.topicKey === 'java'));
});

test('every supported interview topic has exactly 30 top questions and a larger seed pool', () => {
  for (const topic of listImportantTopics()) {
    const records = verifiedSeedCatalog[topic.key] || [];
    assert.equal(records.filter((record) => record.isTopQuestion).length, TOP_QUESTION_COUNT);
    assert.ok(records.length >= MIN_VERIFIED_SEED_COUNT);
  }
});
