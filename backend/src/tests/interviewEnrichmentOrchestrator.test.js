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
          answer: 'The JavaScript event loop coordinates the call stack, microtask queue, and macrotask queue so asynchronous callbacks run after synchronous code completes. In browsers and Node.js, this explains why Promise callbacks run before timers and why blocking the stack delays async work.',
          answerSections: {
            summary: 'The JavaScript event loop schedules async callbacks around the call stack and task queues.',
            explanation: 'Promises, timers, and I/O callbacks are ordered by JavaScript runtime queues.'
          },
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
          answer: 'JavaScript is a programming language used for browser interactivity and server-side applications with Node.js. It supports functions, objects, promises, and event-driven asynchronous programming, which are common interview fundamentals.',
          answerSections: {
            summary: 'JavaScript is a language for browser and Node.js application logic.',
            explanation: 'Core JavaScript concepts include objects, functions, promises, and asynchronous event handling.'
          },
          difficulty: 'easy',
          tags: ['javascript']
        }
      ])
    },
    scraperProvider: {
      scrapeQuestionsForTopic: async () => ([
        {
          question: 'How does garbage collection work in JavaScript engines?',
          answer: 'JavaScript engines such as V8 use tracing garbage collectors, commonly mark-and-sweep with generational optimizations, to find unreachable objects and reclaim memory. This matters in interviews because lingering references, closures, and global caches can keep objects alive and create memory leaks.',
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
