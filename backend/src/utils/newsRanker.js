const STACK_KEYWORDS = {
  Frontend: ['react', 'angular', 'javascript', 'typescript', 'css', 'frontend', 'web performance'],
  Backend: ['node', 'api', 'database', 'backend', 'express', 'microservice', 'postgres'],
  'Full Stack': ['full stack', 'architecture', 'web app', 'api', 'frontend', 'backend'],
  'AI/ML': ['ai', 'machine learning', 'llm', 'prompt', 'deep learning', 'python'],
  'AI / ML': ['ai', 'machine learning', 'llm', 'prompt', 'deep learning', 'python']
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const SKILL_ALIASES = {
  'c sharp': 'c#',
  csharp: 'c#',
  'c plus plus': 'c++',
  cpp: 'c++',
  dotnet: '.net',
  'dot net': '.net',
  nodejs: 'node.js',
  nextjs: 'next.js'
};

const normalizeSkill = (value = '') => {
  const normalized = String(value).trim().toLowerCase().replace(/\s+/g, ' ');
  return SKILL_ALIASES[normalized] || normalized;
};

const escapeRegExp = (value = '') => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const skillAppearsInText = (text = '', skill = '') => {
  const normalizedSkill = normalizeSkill(skill);
  if (!normalizedSkill) return false;
  const aliases = Object.entries(SKILL_ALIASES)
    .filter(([, canonical]) => canonical === normalizedSkill)
    .map(([alias]) => alias);
  const candidates = [...new Set([normalizedSkill, ...aliases])];
  return candidates.some((candidate) => new RegExp(`(^|[^a-z0-9])${escapeRegExp(candidate)}(?=$|[^a-z0-9])`, 'i').test(text));
};

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
  String(context.targetRole || '').split(/[^a-z0-9+#.]+/i).forEach((kw) => {
    if (kw && kw.length > 1) set.add(String(kw).toLowerCase());
  });
  (context.githubTechnologies || []).forEach((kw) => set.add(String(kw).toLowerCase()));
  (context.resumeSkills || []).forEach((kw) => set.add(String(kw).toLowerCase()));
  (context.knownSkills || []).forEach((kw) => set.add(String(kw).toLowerCase()));
  (context.skillGaps || []).forEach((kw) => set.add(String(kw).toLowerCase()));
  (context.jobDemandSkills || []).forEach((kw) => set.add(String(kw).toLowerCase()));
  (context.recommendationTechnologies || []).forEach((kw) => set.add(String(kw).toLowerCase()));
  String(context.activeLearningFocus || '').split(/[^a-z0-9+#.]+/i).forEach((kw) => {
    if (kw && kw.length > 1) set.add(String(kw).toLowerCase());
  });
  return set;
};

const findMatches = (item, values = [], limit = 4) => {
  const text = `${item.title} ${item.description} ${(item.tags || []).join(' ')}`.toLowerCase();
  const seen = new Set();
  const matches = [];
  values.forEach((value) => {
    const label = String(value?.name || value?.skill || value || '').trim();
    const key = normalizeSkill(label);
    if (!key || seen.has(key) || !skillAppearsInText(text, key)) return;
    seen.add(key);
    matches.push(label);
  });
  return matches.slice(0, limit);
};

const buildRelevanceMetadata = (item, context = {}) => {
  const relatedSkills = findMatches(item, [
    ...(context.knownSkills || []),
    ...(context.githubTechnologies || []),
    ...(context.resumeSkills || []),
    ...(context.recommendationTechnologies || [])
  ], 5);
  const relatedGaps = findMatches(item, context.skillGaps || [], 4);
  const demandTags = findMatches(item, context.jobDemandSkills || [], 4);
  const goalMatches = findMatches(item, [context.targetRole, context.careerStack, context.activeLearningFocus], 3);
  const reasons = [];

  if (relatedSkills.length) reasons.push(`Matches your proven skills: ${relatedSkills.slice(0, 3).join(', ')}`);
  if (relatedGaps.length) reasons.push(`Supports current growth gaps: ${relatedGaps.slice(0, 3).join(', ')}`);
  if (demandTags.length) reasons.push(`Connects to job-market demand: ${demandTags.slice(0, 3).join(', ')}`);
  if (goalMatches.length) reasons.push(`Aligned with ${goalMatches[0]}`);
  if (!reasons.length && item.category === context.careerStack) reasons.push(`Aligned with your ${context.careerStack} track`);

  return {
    relevanceReasons: reasons.slice(0, 3),
    relatedSkills,
    relatedSkillGaps: relatedGaps,
    relatedCareerGoals: goalMatches,
    demandTags
  };
};

const relevanceScore = (item, keywords) => {
  if (!keywords.size) return 0.25;
  const text = `${item.title} ${item.description} ${(item.tags || []).join(' ')}`.toLowerCase();
  let hits = 0;
  keywords.forEach((kw) => {
    if (kw && skillAppearsInText(text, kw)) hits += 1;
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
    rankScore: Number((total * 100).toFixed(2)),
    ...buildRelevanceMetadata(item, context)
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
