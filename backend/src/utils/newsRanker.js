const STACK_KEYWORDS = {
  Frontend: ['react', 'angular', 'javascript', 'typescript', 'css', 'frontend', 'web performance'],
  Backend: ['node', 'api', 'database', 'backend', 'express', 'microservice', 'postgres'],
  'Full Stack': ['full stack', 'architecture', 'web app', 'api', 'frontend', 'backend'],
  'AI/ML': ['ai', 'machine learning', 'llm', 'prompt', 'deep learning', 'python'],
  'AI / ML': ['ai', 'machine learning', 'llm', 'prompt', 'deep learning', 'python']
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const normalizeCareerStack = (stack = '') => {
  const lower = String(stack).trim().toLowerCase();
  if (lower === 'ai/ml') return 'AI / ML';
  if (lower === 'full stack') return 'Full Stack';
  if (lower === 'frontend') return 'Frontend';
  if (lower === 'backend') return 'Backend';
  return 'Full Stack';
};

const deriveKeywordSet = (context = {}) => {
  const set = new Set();
  const stack = normalizeCareerStack(context.careerStack);
  (STACK_KEYWORDS[stack] || []).forEach((kw) => set.add(String(kw).toLowerCase()));
  (context.githubTechnologies || []).forEach((kw) => set.add(String(kw).toLowerCase()));
  (context.resumeSkills || []).forEach((kw) => set.add(String(kw).toLowerCase()));
  (context.skillGaps || []).forEach((kw) => set.add(String(kw).toLowerCase()));
  return set;
};

const relevanceScore = (item, keywords) => {
  if (!keywords.size) return 0.25;
  const text = `${item.title} ${item.description} ${(item.tags || []).join(' ')}`.toLowerCase();
  let hits = 0;
  keywords.forEach((kw) => {
    if (kw && text.includes(kw)) hits += 1;
  });
  return clamp(hits / Math.min(8, keywords.size), 0, 1);
};

const recencyScore = (publishedAt) => {
  const now = Date.now();
  const ts = new Date(publishedAt).getTime();
  if (Number.isNaN(ts)) return 0.2;
  const ageHours = Math.max(1, (now - ts) / (1000 * 60 * 60));
  return clamp(1 - ageHours / (24 * 7), 0.05, 1);
};

const popularityScore = (popularity = 0) => {
  const bounded = clamp(Number(popularity || 0), 0, 5000);
  return clamp(Math.log10(1 + bounded) / 3.5, 0, 1);
};

const scoreItem = (item, context = {}) => {
  const keywords = deriveKeywordSet(context);
  const relevance = relevanceScore(item, keywords);
  const recency = recencyScore(item.publishedAt);
  const popularity = popularityScore(item.popularity);
  const total = (relevance * 0.5) + (recency * 0.3) + (popularity * 0.2);
  return {
    ...item,
    relevanceScore: Number((relevance * 100).toFixed(2)),
    rankScore: Number((total * 100).toFixed(2))
  };
};

const rankNewsItems = (items = [], context = {}, mode = 'for-you') => {
  const scored = items.map((item) => scoreItem(item, context));
  if (mode === 'trending') {
    return scored.sort((a, b) => (b.popularity || 0) - (a.popularity || 0) || b.rankScore - a.rankScore);
  }
  if (mode === 'latest') {
    return scored.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
  }
  return scored.sort((a, b) => b.rankScore - a.rankScore);
};

module.exports = { rankNewsItems };
