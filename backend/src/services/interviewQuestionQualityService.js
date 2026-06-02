const DIFFICULTY_SET = new Set(['easy', 'medium', 'hard']);
const STOP_WORDS = new Set(['the', 'a', 'an', 'in', 'on', 'at', 'to', 'for', 'of', 'and', 'or', 'is', 'are', 'was', 'were', 'what', 'why', 'how', 'when', 'where']);
const TOPIC_TOKEN_ALIASES = {
  javascript: ['javascript', 'js', 'ecmascript', 'promise', 'closure', 'prototype', 'event', 'async', 'await'],
  typescript: ['typescript', 'ts', 'type', 'interface', 'generic', 'enum'],
  python: ['python', 'py', 'list', 'dict', 'tuple', 'decorator', 'generator'],
  java: ['java', 'jvm', 'spring', 'class', 'interface'],
  cpp: ['cpp', 'cplusplus', 'pointer', 'reference', 'template', 'stl'],
  angular: ['angular', 'component', 'directive', 'service', 'rxjs', 'module', 'injector'],
  react: ['react', 'jsx', 'component', 'hook', 'state', 'props', 'useeffect', 'usestate'],
  nodejs: ['nodejs', 'node', 'js'],
  expressjs: ['expressjs', 'express', 'node'],
  nextjs: ['nextjs', 'next', 'react'],
  mongodb: ['mongodb', 'mongo'],
  mysql: ['mysql', 'sql'],
  postgresql: ['postgresql', 'postgres'],
  redis: ['redis', 'cache', 'ttl', 'pubsub', 'sorted', 'lua'],
  'rest-apis': ['rest', 'api', 'apis', 'http'],
  graphql: ['graphql', 'resolver', 'schema', 'query', 'mutation'],
  'system-design': ['system', 'design', 'distributed', 'scalability'],
  mern: ['mern', 'mongo', 'express', 'react', 'node'],
  mean: ['mean', 'mongo', 'express', 'angular', 'node'],
  'full-stack-web-development': ['frontend', 'backend', 'api', 'database', 'web']
};
const SOURCE_QUALITY_BASE = {
  prebuilt: 0.94,
  ai: 0.88,
  ai_generated: 0.88,
  user_asked: 0.88,
  scraped: 0.86
};
const GENERIC_ANSWER_PATTERNS = [
  /\bdepends on the situation\b/i,
  /\bit is important to understand\b/i,
  /\bcan be used in many ways\b/i,
  /\bstart with the definition\b/i,
  /\bgenerally speaking\b/i
];
const DIFFICULTY_KEYWORDS = {
  easy: ['define', 'what is', 'basic', 'syntax', 'simple', 'example', 'introduction'],
  medium: ['tradeoff', 'debug', 'pattern', 'practical', 'use case', 'compare', 'handle'],
  hard: ['internals', 'performance', 'architecture', 'scaling', 'edge case', 'distributed', 'optimize']
};

const normalizeWhitespace = (value = '') => String(value || '').replaceAll(/\s+/g, ' ').trim();

const normalizeQuestionText = (value = '') => {
  const normalized = normalizeWhitespace(value);
  if (!normalized) return '';
  return normalized.endsWith('?') ? normalized : `${normalized}?`;
};

const normalizeAnswerText = (value = '') => normalizeWhitespace(value);

const sanitizeDifficulty = (value = '') => {
  const normalized = normalizeWhitespace(value).toLowerCase();
  if (DIFFICULTY_SET.has(normalized)) return normalized;
  return 'medium';
};

const sanitizeTags = (tags = []) => {
  if (!Array.isArray(tags)) return [];
  return [...new Set(tags
    .map((tag) => normalizeWhitespace(tag).toLowerCase())
    .filter(Boolean))];
};

const normalizeComparableText = (value = '') => {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replaceAll(/[^a-z0-9\s]/g, '')
    .replaceAll(/\s+/g, ' ')
    .trim();
};

const tokenize = (value = '') => {
  const comparable = normalizeComparableText(value);
  if (!comparable) return [];
  return comparable
    .split(' ')
    .map((token) => {
      if (token.length > 4 && token.endsWith('s')) {
        return token.slice(0, -1);
      }
      return token;
    })
    .filter((token) => token && !STOP_WORDS.has(token));
};

const computeJaccardSimilarity = (a = '', b = '') => {
  const setA = new Set(tokenize(a));
  const setB = new Set(tokenize(b));
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection += 1;
  }

  const union = new Set([...setA, ...setB]).size;
  if (union === 0) return 0;
  return intersection / union;
};

const getTopicTokens = (topicKey = '') => {
  const normalizedTopic = String(topicKey || '').trim().toLowerCase();
  return [...new Set(TOPIC_TOKEN_ALIASES[normalizedTopic] || tokenize(normalizedTopic))];
};

const containsTopicSignal = ({ topicKey = '', question = '', answer = '', tags = [] } = {}) => {
  const topicTokens = getTopicTokens(topicKey);
  if (!topicTokens.length) return true;
  const combinedTokens = new Set(tokenize(`${question} ${answer} ${(tags || []).join(' ')}`));
  return topicTokens.some((token) => combinedTokens.has(token));
};

const inferDifficultyFromContent = ({ question = '', answer = '' } = {}) => {
  const text = normalizeComparableText(`${question} ${answer}`);
  const scores = Object.entries(DIFFICULTY_KEYWORDS).map(([difficulty, keywords]) => ({
    difficulty,
    score: keywords.reduce((total, keyword) => total + (text.includes(normalizeComparableText(keyword)) ? 1 : 0), 0)
  }));
  scores.sort((left, right) => right.score - left.score);
  return scores[0]?.score > 0 ? scores[0].difficulty : '';
};

const containsUnsafeContent = (text = '') => {
  const lower = String(text || '').toLowerCase();
  return /(weapon build|malware|exploit code|hate speech|self harm|suicide method)/.test(lower);
};

const computeConfidenceScore = ({ sourceType = 'ai', answer = '', question = '' } = {}) => {
  const answerLength = normalizeAnswerText(answer).length;
  const questionLength = normalizeQuestionText(question).length;

  let base = 0.6;
  if (sourceType === 'prebuilt') base = 0.95;
  if (sourceType === 'ai') base = 0.72;
  if (sourceType === 'scraped') base = 0.7;
  if (sourceType === 'ai_generated') base = 0.72;
  if (sourceType === 'user_asked') base = 0.75;

  if (answerLength >= 220) base += 0.08;
  else if (answerLength >= 120) base += 0.04;

  if (questionLength >= 40) base += 0.03;

  return Number(Math.max(0, Math.min(1, base)).toFixed(2));
};

const isQualityQuestionAnswer = ({ question = '', answer = '', topicKey = '' } = {}) => {
  const normalizedQuestion = normalizeQuestionText(question);
  const normalizedAnswer = normalizeAnswerText(answer);

  if (!normalizedQuestion || !normalizedAnswer) return false;
  if (normalizedQuestion.length < 12) return false;
  if (normalizedAnswer.length < 40) return false;
  if (containsUnsafeContent(`${normalizedQuestion} ${normalizedAnswer}`)) return false;
  if (/^start with the definition\b/i.test(normalizedAnswer)) return false;
  if (topicKey) {
    const topicTokens = TOPIC_TOKEN_ALIASES[topicKey] || tokenize(topicKey);
    const combinedTokens = new Set(tokenize(`${normalizedQuestion} ${normalizedAnswer}`));
    if (topicTokens.length && !topicTokens.some((token) => combinedTokens.has(token))) return false;
  }
  return true;
};

const validateInterviewQuestionQuality = ({
  question = '',
  answer = '',
  answerSections = {},
  topicKey = '',
  technology = '',
  difficulty = '',
  expectedDifficulty = '',
  tags = [],
  sourceType = 'ai_generated',
  confidenceScore = 0,
  qualityScore = 0,
  minimumScore = 0.75
} = {}) => {
  const normalizedQuestion = normalizeQuestionText(question);
  const normalizedAnswer = normalizeAnswerText(answer);
  const normalizedTopicKey = String(topicKey || technology || '').trim().toLowerCase();
  const normalizedDifficulty = sanitizeDifficulty(difficulty);
  const reasons = [];
  let score = 1;

  if (!normalizedQuestion || normalizedQuestion.length < 12) {
    reasons.push('question_too_short');
    score -= 0.28;
  }

  if (!normalizedAnswer || normalizedAnswer.length < 80) {
    reasons.push('answer_too_short');
    score -= 0.3;
  }

  if (containsUnsafeContent(`${normalizedQuestion} ${normalizedAnswer}`)) {
    reasons.push('unsafe_content');
    score -= 0.5;
  }

  const safeTags = sanitizeTags(tags);
  if (!containsTopicSignal({ topicKey: normalizedTopicKey, question: normalizedQuestion, answer: normalizedAnswer, tags: safeTags })) {
    reasons.push('topic_mismatch');
    score -= 0.38;
  }

  if (normalizedTopicKey && safeTags.length && !containsTopicSignal({ topicKey: normalizedTopicKey, tags: safeTags })) {
    reasons.push('tags_do_not_match_topic');
    score -= 0.12;
  }

  const questionAnswerOverlap = computeJaccardSimilarity(normalizedQuestion, normalizedAnswer);
  const questionTokens = tokenize(normalizedQuestion);
  if (questionTokens.length >= 3 && questionAnswerOverlap < 0.08) {
    reasons.push('answer_does_not_directly_address_question');
    score -= 0.18;
  }

  if (GENERIC_ANSWER_PATTERNS.some((pattern) => pattern.test(normalizedAnswer))) {
    reasons.push('answer_is_generic');
    score -= 0.16;
  }

  const sourceBase = SOURCE_QUALITY_BASE[String(sourceType || '').toLowerCase()] ?? 0.7;
  if (sourceBase < 0.7) {
    reasons.push('source_quality_low');
    score -= 0.1;
  }

  const numericConfidence = Number(confidenceScore || 0);
  if (numericConfidence > 0 && numericConfidence < 0.72) {
    reasons.push('confidence_below_threshold');
    score -= 0.16;
  }

  const numericQuality = Number(qualityScore || 0);
  if (numericQuality > 0 && numericQuality < 3) {
    reasons.push('quality_score_below_threshold');
    score -= 0.12;
  }

  const requestedDifficulty = String(expectedDifficulty || '').trim().toLowerCase();
  const inferredDifficulty = inferDifficultyFromContent({ question: normalizedQuestion, answer: normalizedAnswer });
  if (requestedDifficulty && DIFFICULTY_SET.has(requestedDifficulty) && normalizedDifficulty !== requestedDifficulty) {
    reasons.push('difficulty_mismatch');
    score -= 0.16;
  } else if (requestedDifficulty && inferredDifficulty && inferredDifficulty !== requestedDifficulty) {
    reasons.push('difficulty_content_mismatch');
    score -= 0.08;
  }

  const hasStructuredSections = answerSections && typeof answerSections === 'object'
    && Boolean(answerSections.summary || answerSections.explanation || answerSections.shortAnswer);
  if (String(sourceType || '').includes('ai') && !hasStructuredSections) {
    reasons.push('missing_structured_answer');
    score -= 0.1;
  }

  const relevanceScore = Number(Math.max(0, Math.min(1, score * sourceBase)).toFixed(2));
  return {
    isValid: relevanceScore >= minimumScore && reasons.length < 3,
    relevanceScore,
    reasons
  };
};

const isNearDuplicate = (question = '', existingQuestions = [], similarityThreshold = 0.65) => {
  const normalized = normalizeComparableText(question);
  if (!normalized) return true;

  for (const existing of existingQuestions) {
    const similarity = computeJaccardSimilarity(normalized, existing);
    if (similarity >= similarityThreshold) {
      return true;
    }
  }

  return false;
};

const dedupeQuestions = ({ questions = [], existingComparableQuestions = [] } = {}) => {
  const unique = [];
  const normalizedSet = new Set(existingComparableQuestions);
  const mutableExisting = [...existingComparableQuestions];

  for (const item of Array.isArray(questions) ? questions : []) {
    const normalizedQuestion = normalizeQuestionText(item.question);
    const comparable = normalizeComparableText(normalizedQuestion);
    if (!comparable) continue;
    if (normalizedSet.has(comparable)) continue;
    if (isNearDuplicate(comparable, mutableExisting)) continue;

    normalizedSet.add(comparable);
    mutableExisting.push(comparable);
    unique.push(item);
  }

  return unique;
};

module.exports = {
  normalizeWhitespace,
  normalizeQuestionText,
  normalizeAnswerText,
  normalizeComparableText,
  sanitizeDifficulty,
  sanitizeTags,
  containsUnsafeContent,
  computeConfidenceScore,
  isQualityQuestionAnswer,
  validateInterviewQuestionQuality,
  inferDifficultyFromContent,
  dedupeQuestions,
  computeJaccardSimilarity
};
