const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeTopicInput, resolveTopic, listImportantTopics } = require('../services/interviewTopicNormalizer');
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

test('every supported interview topic has exactly 30 top questions and a larger seed pool', () => {
  for (const topic of listImportantTopics()) {
    const records = verifiedSeedCatalog[topic.key] || [];
    assert.equal(records.filter((record) => record.isTopQuestion).length, TOP_QUESTION_COUNT);
    assert.ok(records.length >= MIN_VERIFIED_SEED_COUNT);
  }
});
