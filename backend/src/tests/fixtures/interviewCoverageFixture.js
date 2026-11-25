// Deterministic stand-ins for the validated provider/evaluator boundary in
// ownership/concurrency regressions. Coverage decisions have separate tests.
const coverage = require('../../modules/interview-prep/services/interviewAnswerCoverage');
const { projectContext } = require('../../modules/interview-prep/services/interviewProjectContext');
const { normalizeTopicInput } = require('../../modules/interview-prep/services/interviewTopicNormalizer');
const { normalizeQuestionText } = require('../../modules/interview-prep/services/interviewQuestionQualityService');
const certified = (input, answer) => {
  const topicKey = normalizeTopicInput(input).topicKey;
  const plan = coverage.analyzeQuestion({
    question: normalizeQuestionText(input.question),
    topicKey,
    context: projectContext(topicKey)
  });
  return {
    ...answer,
    answerQuality: coverage.attest(plan, answer, { provider: 'deterministic-test-evaluator' })
  };
};
const judgeResult = (prompt) => {
  if (!prompt.startsWith('Independently audit')) return null;
  const data = JSON.parse(prompt.split('\n').at(-1));
  return {
    ok: true,
    provider: 'deterministic-judge',
    model: 'fixture',
    value: {
      requirements: data.request.requirements.map((req) => ({
        id: req.id,
        satisfied: true,
        evidence: data.answer.slice(0, 80),
        reason: 'Deterministic coverage fixture for this otherwise validated orchestration regression.'
      }))
    }
  };
};
module.exports = { certified, judgeResult };
