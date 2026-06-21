const test = require('node:test');
const assert = require('node:assert/strict');

const interviewPrepService = require('../services/interviewPrepService');
const questionRepository = require('../repositories/interviewQuestionRepository');
const aiProvider = require('../services/providers/interviewAIProvider');
const { listImportantTopics } = require('../services/interviewTopicNormalizer');
const { buildSeedRecordsForTopic } = require('../services/interviewQuestionSeedCatalog');

test('generateFreshInterviewQuestions falls back to the question bank when AI output fails validation', async () => {
  const topic = listImportantTopics().find((item) => item.key === 'javascript');
  const seedRows = buildSeedRecordsForTopic(topic).filter((record) => record.isTopQuestion);

  const originalFindAiGeneratedByTopic = questionRepository.findAiGeneratedByTopic;
  const originalFetchComparableQuestionsByTopic = questionRepository.fetchComparableQuestionsByTopic;
  const originalFindTopQuestions = questionRepository.findTopQuestions;
  const originalGetSourceMixByTopic = questionRepository.getSourceMixByTopic;
  const originalCountQuestionsByTopicAndSeedVersion = questionRepository.countQuestionsByTopicAndSeedVersion;
  const originalCountQuestionsByTopic = questionRepository.countQuestionsByTopic;
  const originalGenerateStructuredQuestionSet = aiProvider.generateStructuredQuestionSet;

  questionRepository.findAiGeneratedByTopic = async () => [];
  questionRepository.fetchComparableQuestionsByTopic = async () => [];
  questionRepository.findTopQuestions = async () => seedRows.slice(0, 5);
  questionRepository.getSourceMixByTopic = async () => ({ verified_seed: seedRows.length });
  questionRepository.countQuestionsByTopicAndSeedVersion = async () => buildSeedRecordsForTopic(topic).length;
  questionRepository.countQuestionsByTopic = async () => buildSeedRecordsForTopic(topic).length;
  aiProvider.generateStructuredQuestionSet = async () => ([
    {
      question: 'Bad?',
      answer: 'short'
    }
  ]);

  try {
    const payload = await interviewPrepService.generateFreshInterviewQuestions({
      skill: 'javascript',
      limit: 5
    });

    assert.ok(Array.isArray(payload.questions));
    assert.ok(payload.questions.length > 0);
    assert.equal(payload.questions[0].sourceType, 'verified_seed');
  } finally {
    questionRepository.findAiGeneratedByTopic = originalFindAiGeneratedByTopic;
    questionRepository.fetchComparableQuestionsByTopic = originalFetchComparableQuestionsByTopic;
    questionRepository.findTopQuestions = originalFindTopQuestions;
    questionRepository.getSourceMixByTopic = originalGetSourceMixByTopic;
    questionRepository.countQuestionsByTopicAndSeedVersion = originalCountQuestionsByTopicAndSeedVersion;
    questionRepository.countQuestionsByTopic = originalCountQuestionsByTopic;
    aiProvider.generateStructuredQuestionSet = originalGenerateStructuredQuestionSet;
  }
});

test('answerCustomInterviewQuestion rejects explicit skill mismatches before storing', async () => {
  await assert.rejects(
    () => interviewPrepService.answerCustomInterviewQuestion({
      userId: 'user-1',
      skill: 'react',
      question: 'How does Angular change detection differ from zones?'
    }),
    (error) => {
      assert.equal(error.statusCode, 400);
      assert.match(error.message, /does not match the selected skill/i);
      return true;
    }
  );
});
