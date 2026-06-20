const test = require('node:test');
const assert = require('node:assert/strict');
const { getQuestionBank } = require('../services/interviewPrepService');
const questionRepository = require('../repositories/interviewQuestionRepository');
const { listImportantTopics } = require('../services/interviewTopicNormalizer');
const {
  TOP_QUESTION_COUNT,
  MIN_TOP_QUALITY_SCORE,
  MIN_APPROVED_QUALITY_SCORE,
  REQUIRED_ANSWER_SECTION_KEYS,
  verifiedSeedCatalog,
  getSeedCatalogValidationReport,
  validateInterviewSeedCatalog,
  validateSeedCatalog,
  validateSeedQuestionRecord,
  buildSeedRecordsForTopic
} = require('../services/interviewQuestionSeedCatalog');

const isCompleteSection = (value) => (
  Array.isArray(value)
    ? value.length > 0 && value.every((item) => String(item || '').trim())
    : Boolean(String(value || '').trim())
);

test('every supported topic has exactly 30 ranked top seed questions', () => {
  for (const topic of listImportantTopics()) {
    const records = verifiedSeedCatalog[topic.key] || [];
    const topRecords = records.filter((record) => record.isTopQuestion);
    assert.equal(topRecords.length, TOP_QUESTION_COUNT, topic.key);

    const ranks = topRecords.map((record) => record.rank).sort((left, right) => left - right);
    assert.deepEqual(ranks, Array.from({ length: TOP_QUESTION_COUNT }, (_item, index) => index + 1), topic.key);
    assert.ok(topRecords.every((record) => record.qualityScore >= MIN_TOP_QUALITY_SCORE), topic.key);
  }
});

test('all approved seed questions use valid production schema values', () => {
  for (const topic of listImportantTopics()) {
    for (const record of verifiedSeedCatalog[topic.key] || []) {
      assert.deepEqual(validateSeedQuestionRecord(record, topic), [], record.id);
      assert.ok(record.qualityScore >= MIN_APPROVED_QUALITY_SCORE, record.id);
      assert.ok(record.tags.length >= 3, record.id);
      for (const key of REQUIRED_ANSWER_SECTION_KEYS) {
        assert.ok(isCompleteSection(record.answerSections[key]), `${record.id}:${key}`);
      }
    }
  }
});

test('seed catalog validation report is clean and rank buckets match the production ranking contract', () => {
  const report = getSeedCatalogValidationReport();
  assert.equal(report.isValid, true);
  assert.deepEqual(report.failures, []);
  assert.equal(report.duplicateWarnings, 0);
  assert.equal(validateInterviewSeedCatalog(), true);

  const expectedCategoriesByRank = [
    [1, 10, new Set(['core-concepts'])],
    [11, 20, new Set(['practical-implementation'])],
    [21, 25, new Set(['debugging', 'performance', 'security', 'testing', 'real-world-scenarios'])],
    [26, 30, new Set(['architecture', 'system-design'])]
  ];

  for (const topic of listImportantTopics()) {
    const topRecords = (verifiedSeedCatalog[topic.key] || []).filter((record) => record.isTopQuestion);
    for (const [from, to, categories] of expectedCategoriesByRank) {
      for (const record of topRecords.filter((item) => item.rank >= from && item.rank <= to)) {
        assert.ok(categories.has(record.category), `${record.id}:${record.rank}:${record.category}`);
      }
    }
  }
});

test('invalid seed catalog data fails loudly', () => {
  const [topic] = listImportantTopics();
  const brokenCatalog = {
    [topic.key]: (verifiedSeedCatalog[topic.key] || []).map((record) => ({ ...record }))
  };
  brokenCatalog[topic.key][0] = {
    ...brokenCatalog[topic.key][0],
    category: 'conceptual',
    qualityScore: 10
  };

  assert.throws(
    () => validateSeedCatalog(brokenCatalog, [topic]),
    /Invalid interview question seed catalog/
  );
});

test('duplicate and near-duplicate seed questions are rejected', () => {
  const [topic] = listImportantTopics();
  const records = (verifiedSeedCatalog[topic.key] || []).map((record) => ({ ...record }));
  records[1] = {
    ...records[1],
    id: `${topic.key}-duplicate-test`,
    question: records[0].question,
    rank: 2
  };

  assert.throws(
    () => validateSeedCatalog({ [topic.key]: records }, [topic]),
    /duplicate question text|near duplicate question/
  );
});

test('buildSeedRecordsForTopic maps ranked seed metadata into database records', () => {
  const [topic] = listImportantTopics();
  const records = buildSeedRecordsForTopic(topic);
  assert.equal(records.filter((record) => record.isTopQuestion).length, TOP_QUESTION_COUNT);
  assert.equal(records[0].rank, 1);
  assert.equal(records[0].sourceType, 'verified_seed');
  assert.equal(records[0].reviewStatus, 'approved');
  assert.ok(records[0].rankScore > 0);
});

test('getQuestionBank returns top questions in rank order', async () => {
  const topic = listImportantTopics().find((item) => item.key === 'javascript');
  const originalFindTopQuestions = questionRepository.findTopQuestions;
  const originalGetSourceMixByTopic = questionRepository.getSourceMixByTopic;
  const originalCountQuestionsByTopicAndSeedVersion = questionRepository.countQuestionsByTopicAndSeedVersion;
  const originalCountQuestionsByTopic = questionRepository.countQuestionsByTopic;

  const seedRows = buildSeedRecordsForTopic(topic).filter((record) => record.isTopQuestion);
  questionRepository.findTopQuestions = async () => [...seedRows].reverse();
  questionRepository.getSourceMixByTopic = async () => ({ verified_seed: seedRows.length });
  questionRepository.countQuestionsByTopicAndSeedVersion = async () => buildSeedRecordsForTopic(topic).length;
  questionRepository.countQuestionsByTopic = async () => buildSeedRecordsForTopic(topic).length;

  try {
    const payload = await getQuestionBank({
      skill: topic.key,
      block: 'top',
      page: 1,
      limit: TOP_QUESTION_COUNT
    });
    assert.deepEqual(
      payload.questions.map((record) => record.rank),
      Array.from({ length: TOP_QUESTION_COUNT }, (_item, index) => index + 1)
    );
  } finally {
    questionRepository.findTopQuestions = originalFindTopQuestions;
    questionRepository.getSourceMixByTopic = originalGetSourceMixByTopic;
    questionRepository.countQuestionsByTopicAndSeedVersion = originalCountQuestionsByTopicAndSeedVersion;
    questionRepository.countQuestionsByTopic = originalCountQuestionsByTopic;
  }
});
