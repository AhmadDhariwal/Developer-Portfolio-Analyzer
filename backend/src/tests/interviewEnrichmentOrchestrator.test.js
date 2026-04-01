const test = require('node:test');
const assert = require('node:assert/strict');
const { createInterviewEnrichmentOrchestrator } = require('../services/interviewEnrichmentOrchestrator');

const topic = {
  topicKey: 'javascript',
  topicType: 'language',
  skill: 'javascript',
  topicDimensions: {
    stack: [],
    technology: [],
    language: ['javascript'],
    framework: []
  }
};

test('orchestrator skips provider calls when pool already satisfies target', async () => {
  let aiCalls = 0;
  let scrapeCalls = 0;

  const orchestrator = createInterviewEnrichmentOrchestrator({
    aiProvider: {
      generateQuestionsFromAI: async () => {
        aiCalls += 1;
        return [];
      }
    },
    scraperProvider: {
      scrapeQuestionsForTopic: async () => {
        scrapeCalls += 1;
        return [];
      }
    },
    questionRepository: {
      upsertQuestions: async () => ({ insertedCount: 0 })
    }
  });

  const existing = Array.from({ length: 25 }).map((_, i) => ({ normalizedQuestion: `q-${i}` }));
  const result = await orchestrator.enrichTopicQuestionPool({
    topic,
    existingQuestions: existing,
    requestedCount: 20
  });

  assert.equal(result.attempted, false);
  assert.equal(aiCalls, 0);
  assert.equal(scrapeCalls, 0);
});

test('orchestrator uses AI first and persists enriched records', async () => {
  const saved = [];

  const orchestrator = createInterviewEnrichmentOrchestrator({
    aiProvider: {
      generateQuestionsFromAI: async () => ([
        {
          question: 'Explain the event loop in JavaScript',
          answer: 'The event loop manages asynchronous callbacks by coordinating call stack and task queues.',
          difficulty: 'medium',
          tags: ['javascript', 'async']
        }
      ])
    },
    scraperProvider: {
      scrapeQuestionsForTopic: async () => []
    },
    questionRepository: {
      upsertQuestions: async (records) => {
        saved.push(...records);
        return { insertedCount: records.length };
      }
    }
  });

  const result = await orchestrator.enrichTopicQuestionPool({
    topic,
    existingQuestions: [],
    requestedCount: 1,
    initiatedBy: 'test'
  });

  assert.equal(result.aiAdded, 1);
  assert.equal(result.scrapedAdded, 0);
  assert.equal(result.insertedCount, 1);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].sourceType, 'ai');
});

test('orchestrator falls back to scrape when AI is insufficient', async () => {
  const orchestrator = createInterviewEnrichmentOrchestrator({
    aiProvider: {
      generateQuestionsFromAI: async () => ([
        {
          question: 'What is JavaScript?',
          answer: 'A language for web development and server-side applications with Node.js.',
          difficulty: 'easy',
          tags: ['javascript']
        }
      ])
    },
    scraperProvider: {
      scrapeQuestionsForTopic: async () => ([
        {
          question: 'How does garbage collection work in JavaScript engines?',
          answer: 'Modern engines use mark-and-sweep style algorithms with optimization techniques to reclaim unused memory and reduce pause time.',
          difficulty: 'medium',
          tags: ['javascript', 'memory']
        }
      ])
    },
    questionRepository: {
      upsertQuestions: async (records) => ({ insertedCount: records.length })
    }
  });

  const result = await orchestrator.enrichTopicQuestionPool({
    topic,
    existingQuestions: [],
    requestedCount: 2,
    initiatedBy: 'test'
  });

  assert.equal(result.aiAdded, 1);
  assert.equal(result.scrapedAdded, 1);
  assert.equal(result.partial, false);
});
