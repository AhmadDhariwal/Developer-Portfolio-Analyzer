const DIFFICULTY_SET = new Set(['easy', 'medium', 'hard']);
const STOP_WORDS = new Set(['the', 'a', 'an', 'in', 'on', 'at', 'to', 'for', 'of', 'and', 'or', 'is', 'are', 'was', 'were', 'what', 'why', 'how', 'when', 'where']);

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

const containsUnsafeContent = (text = '') => {
  const lower = String(text || '').toLowerCase();
  return /(weapon build|malware|exploit code|hate speech|self harm|suicide method)/.test(lower);
};

const computeConfidenceScore = ({ sourceType = 'ai', answer = '', question = '' } = {}) => {
  const answerLength = normalizeAnswerText(answer).length;
  const questionLength = normalizeQuestionText(question).length;

  let base = 0.6;
  if (sourceType === 'prebuilt') base = 0.95;
  if (sourceType === 'scraped') base = 0.7;
  if (sourceType === 'user_asked') base = 0.75;

  if (answerLength >= 220) base += 0.08;
  else if (answerLength >= 120) base += 0.04;

  if (questionLength >= 40) base += 0.03;

  return Number(Math.max(0, Math.min(1, base)).toFixed(2));
};

const isQualityQuestionAnswer = ({ question = '', answer = '' } = {}) => {
  const normalizedQuestion = normalizeQuestionText(question);
  const normalizedAnswer = normalizeAnswerText(answer);

  if (!normalizedQuestion || !normalizedAnswer) return false;
  if (normalizedQuestion.length < 12) return false;
  if (normalizedAnswer.length < 40) return false;
  if (containsUnsafeContent(`${normalizedQuestion} ${normalizedAnswer}`)) return false;
  return true;
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
  dedupeQuestions,
  computeJaccardSimilarity
};
