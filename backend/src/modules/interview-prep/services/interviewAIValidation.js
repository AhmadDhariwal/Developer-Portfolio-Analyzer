const { normalizeTopicInput } = require('./interviewTopicNormalizer');
const {
  DIFFICULTY_SET,
  isSupportedCategory,
  sanitizeCategory,
  validateInterviewQuestionQuality
} = require('./interviewQuestionQualityService');

const SYSTEM_DESIGN_FIELDS = {
  problemDefinition: 'Problem definition',
  functionalRequirements: 'Functional requirements',
  nonFunctionalRequirements: 'Non-functional requirements',
  highLevelArchitecture: 'High-level architecture',
  components: 'Components and responsibilities',
  databaseDesign: 'Database design',
  apiDesign: 'API design',
  dataFlow: 'Data flow',
  caching: 'Caching',
  scalability: 'Scalability',
  loadBalancing: 'Load balancing',
  reliability: 'Reliability',
  security: 'Security',
  tradeOffs: 'Trade-offs',
  bottlenecks: 'Potential bottlenecks'
};
const isSystemDesignQuestion = (question, topicKey) =>
  topicKey === 'system-design' || /\b(system design|architect(?:ure)?|design (?:a|an|the))\b/i.test(question);

const validText = (value, max = 12000) =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= max;

const hasValidAnswerSchema = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const answer = value.answerSections || value.answer || value;
  if (!answer || typeof answer !== 'object' || Array.isArray(answer)) return false;
  const strings = ['shortAnswer', 'explanation', 'example', 'realWorldUseCase', 'interviewTip'];
  const lists = ['keyPoints', 'commonMistakes'];
  return (
    strings.every((key) => validText(answer[key])) &&
    lists.every(
      (key) =>
        Array.isArray(answer[key]) &&
        answer[key].length >= (key === 'keyPoints' ? 3 : 2) &&
        answer[key].length <= 10 &&
        answer[key].every((item) => validText(item, 2000))
    ) &&
    JSON.stringify(answer).length <= 48000
  );
};

const hasValidSystemDesign = (answer) =>
  validText(answer?.scopeNote, 2000) &&
  Object.keys(SYSTEM_DESIGN_FIELDS).every((key) => validText(answer?.systemDesign?.[key], 4000));

// Metadata is necessary but cannot make an architecture problem a beginner question.
// Use the question's required task, not incidental advanced terms in an explanatory answer.
const fitsDifficultyRubric = (question, difficulty) => {
  const advancedTask =
    /\b(design|architect|optimize|debug|implement)\b.*\b(distributed|multi.region|consensus|shard|scal(?:e|ing|ability)|fault.toleran|high.availability)\b/i;
  const seniorTask =
    /\b(architect|design|evaluate|decide|lead|plan|trade.?offs?|scalability|reliability|security|migration)\b/i;
  const elementaryTask = /^(?:what (?:is|are)|define)\b/i;
  const appliedTask =
    /\b(compare|debug|implement|scenario|trade.?offs?|in practice|under load|edge cases?|performance|reliability|security)\b/i;
  if (difficulty === 'easy' && advancedTask.test(question)) return false;
  if (
    ['medium', 'hard', 'senior'].includes(difficulty) &&
    elementaryTask.test(question) &&
    !appliedTask.test(question)
  )
    return false;
  if (difficulty === 'senior' && !seniorTask.test(question)) return false;
  return true;
};

const validateGeneratedQuestion = (item, filters) => {
  if (!item || !validText(item.question, 500) || !validText(item.answer, 48000)) return false;
  if (!hasValidAnswerSchema(item) || !DIFFICULTY_SET.has(item.difficulty)) return false;
  if (filters.difficulty && item.difficulty !== filters.difficulty) return false;
  const topics = [item.topicKey, item.technology].filter(Boolean);
  if (
    !topics.length ||
    topics.some((value) => normalizeTopicInput({ skill: value }).topicKey !== filters.topicKey)
  )
    return false;
  if (!isSupportedCategory(item.category)) return false;
  if (filters.category && sanitizeCategory(item.category) !== filters.category) return false;
  if (!Array.isArray(item.tags) || item.tags.length > 20 || !item.tags.every((tag) => validText(tag, 80)))
    return false;
  if (!fitsDifficultyRubric(item.question, filters.difficulty || item.difficulty)) return false;
  const quality = validateInterviewQuestionQuality({
    ...item,
    sourceType: 'ai_generated',
    expectedDifficulty: filters.difficulty
  });
  return quality.isValid;
};

module.exports = {
  SYSTEM_DESIGN_FIELDS,
  isSystemDesignQuestion,
  hasValidAnswerSchema,
  hasValidSystemDesign,
  fitsDifficultyRubric,
  validateGeneratedQuestion
};
