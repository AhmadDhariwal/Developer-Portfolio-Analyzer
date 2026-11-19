const { normalizeTopicInput } = require('./interviewTopicNormalizer');
const { sanitizeCategory, isSupportedCategory } = require('./interviewQuestionQualityService');
const lower = (value) =>
  String(value || '')
    .trim()
    .toLowerCase();
const normalizeFilters = (input = {}) => {
  const difficulty = lower(input.difficulty);
  const source = lower(input.source);
  if (difficulty && !['easy', 'medium', 'hard', 'senior'].includes(difficulty))
    throw Object.assign(new Error('Invalid difficulty.'), { statusCode: 400 });
  if (
    source &&
    !['seed', 'database', 'ai', 'scraped', 'ai_generated', 'verified_seed', 'prebuilt'].includes(source)
  )
    throw Object.assign(new Error('Invalid source.'), { statusCode: 400 });
  if (input.category && !isSupportedCategory(input.category))
    throw Object.assign(new Error('Invalid category.'), { statusCode: 400 });
  return {
    topicKey: normalizeTopicInput(input).topicKey,
    difficulty,
    category: input.category ? sanitizeCategory(input.category) : '',
    source,
    tags: [
      ...new Set(
        (Array.isArray(input.tags) ? input.tags : String(input.tags || '').split(','))
          .map(lower)
          .filter(Boolean)
      )
    ].sort(),
    query: lower(input.query || input.q)
  };
};
// Tags preserve the bank's existing any-tag semantics. Search terms also match any term.
const matchesFilters = (item, filters) => {
  const source = lower(item.sourceType || item.source);
  const allowed =
    filters.source === 'seed'
      ? ['verified_seed', 'prebuilt']
      : filters.source === 'ai'
        ? ['ai', 'ai_generated', 'user_asked']
        : [filters.source];
  const text = lower(`${item.question || ''} ${item.answer || ''}`);
  return (
    Boolean(item.topicKey || item.technology || item.skill) &&
    normalizeTopicInput({ skill: item.topicKey || item.technology || item.skill }).topicKey ===
      filters.topicKey &&
    (!filters.difficulty || lower(item.difficulty) === filters.difficulty) &&
    (!filters.category || lower(item.category) === filters.category) &&
    (!filters.source || filters.source === 'database' || allowed.includes(source)) &&
    (!filters.tags.length || filters.tags.some((tag) => (item.tags || []).map(lower).includes(tag))) &&
    (!filters.query || filters.query.split(/\s+/).some((term) => text.includes(term)))
  );
};
const generationSourcePolicy = (source = '') => ({
  verifiedSource: !source || source === 'database' ? 'seed' : source,
  verified: !['ai', 'ai_generated'].includes(source),
  reusableAI: !source || ['database', 'ai', 'ai_generated'].includes(source),
  generateAI: !source || ['database', 'ai', 'ai_generated'].includes(source)
});
module.exports = { normalizeFilters, matchesFilters, generationSourcePolicy };
