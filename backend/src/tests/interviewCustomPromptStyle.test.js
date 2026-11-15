const test = require('node:test');
const assert = require('node:assert/strict');
const { validateInterviewQuestionQuality } = require('../services/interviewQuestionQualityService');
const { createInterviewEnrichmentOrchestrator } = require('../services/interviewEnrichmentOrchestrator');
const { normalizeTopicInput } = require('../services/interviewTopicNormalizer');
const provider = require('../services/providers/interviewAIProvider');
const question = 'tell me the full flow of the rag like how tha rag works and what is its purpose';
const answerSections = {
  shortAnswer:
    'RAG combines retrieval of relevant documents with language-model generation to ground an answer.',
  explanation:
    'Retrieval-augmented generation first indexes source documents into searchable chunks. At query time a retriever finds relevant passages, optionally reranks them, and includes them as context in a language-model prompt. The model generates an answer grounded in those retrieved passages. Retrieval quality, source freshness and source attribution affect reliability; RAG does not guarantee factual correctness.',
  keyPoints: ['Index source chunks', 'Retrieve relevant passages', 'Generate an answer with source context'],
  example:
    'A support question retrieves relevant product documentation passages before the language model drafts an answer.',
  realWorldUseCase:
    'A support assistant can answer using current documentation without retraining the language model.',
  commonMistakes: ['Assuming retrieval guarantees correctness', 'Using unrelated chunks as context'],
  interviewTip: 'Trace indexing, retrieval, context assembly and answer generation separately.'
};
const row = {
  question,
  topicKey: 'rag',
  tags: ['rag'],
  difficulty: 'medium',
  category: 'core-concepts',
  sourceType: 'ai_generated',
  confidenceScore: 0.94,
  qualityScore: 94,
  answerSections,
  answer: provider.toStructuredAnswerText(answerSections)
};
test('the exact user RAG wording is a valid custom prompt while bank question rules remain strict', () => {
  assert.equal(validateInterviewQuestionQuality(row).isValid, false);
  assert.equal(validateInterviewQuestionQuality({ ...row, questionMode: 'custom' }).isValid, true);
});
test('private storage approval uses custom prompt semantics consistently', () => {
  const orchestrator = createInterviewEnrichmentOrchestrator({});
  const args = { item: row, topic: normalizeTopicInput({ skill: 'rag' }), sourceType: 'ai_generated' };
  assert.equal(
    orchestrator.toStorableRecord({ ...args, sourceMeta: { mode: 'custom-question' } }).isApproved,
    true
  );
  assert.equal(
    orchestrator.toStorableRecord({ ...args, sourceMeta: { mode: 'practice-set' } }).isApproved,
    false
  );
});
test('custom prompt handling still rejects unsafe and empty answers', () => {
  assert.equal(
    validateInterviewQuestionQuality({ ...row, questionMode: 'custom', answer: 'malware exploit code' })
      .isValid,
    false
  );
  assert.equal(
    validateInterviewQuestionQuality({ ...row, questionMode: 'custom', answer: '' }).isValid,
    false
  );
});

test('mixed output/timeouts/billing failures do not become a misleading billing-only result', async (t) => {
  const manager = require('../services/aiProviderManager');
  const admission = require('../services/aiProviderAdmissionService');
  t.mock.method(manager, 'getProviderState', () => ({
    settings: { enabled: true },
    states: { groq: { enabled: true }, gemini: { enabled: true } }
  }));
  for (const method of ['enter', 'release']) t.mock.method(admission, method, async () => ({}));
  t.mock.method(
    manager,
    'tryProvider',
    async (name, _prompt, _retry, _parse, _timeout, _model, _signal, budget) => {
      budget.remaining--;
      return { ok: false, failover: true, reason: name === 'groq' ? 'incomplete_output' : 'billing' };
    }
  );
  const result = await manager.execute('fixture', {
    requestPolicy: { providerPriority: ['groq', 'gemini'], maxAttempts: 2, operation: 'interview-custom-qa' }
  });
  assert.equal(result.reason, 'mixed_provider_failure');
});
