const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeTopicInput, resolveTopic, listImportantTopics } = require('../services/interviewTopicNormalizer');

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
