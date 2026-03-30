const aiService = require('./aiservice');
const InterviewPrepSession = require('../models/interviewPrepSession');
const InterviewQuestionBank = require('../models/interviewQuestionBank');
const { getInterviewPrepPrompt, getInterviewQuestionGenerationPrompt } = require('../prompts/interviewPrepPrompt');
const {
  CACHE_TTL_SECONDS,
  getCacheJson,
  setCacheJson,
  invalidateInterviewPrepCache
} = require('./redisCacheService');

const DEFAULT_PAGE_LIMIT = 20;
const MIN_GENERATE_RESULTS = 10;

const sanitizeSkill = (value = '') => String(value || '').trim().toLowerCase();

const sanitizeDifficulty = (value = '') => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'easy' || normalized === 'medium' || normalized === 'hard') {
    return normalized;
  }
  return 'medium';
};

const sanitizeTags = (tags = []) => {
  if (!Array.isArray(tags)) return [];
  return [...new Set(tags.map((tag) => String(tag || '').trim().toLowerCase()).filter(Boolean))];
};

const normalizeQuestionText = (value = '') => String(value || '').replace(/\s+/g, ' ').trim();

const normalizeQuestions = (questions = []) => {
  const safe = Array.isArray(questions) ? questions : [];
  return safe.map((q, idx) => {
    const question = normalizeQuestionText(q.question || q.title || `Question ${idx + 1}`);
    const answer = normalizeQuestionText(q.answer || q.sampleAnswer || 'Provide a structured response with key points.');
    return {
      question,
      answer,
      difficulty: sanitizeDifficulty(q.difficulty),
      tags: sanitizeTags(q.tags)
    };
  }).filter((item) => item.question && item.answer);
};

const makeQuestionsCacheKey = ({ skill, page, limit, difficulty = '', tags = '' }) => {
  return `interview:questions:skill=${sanitizeSkill(skill)}:page=${page}:limit=${limit}:difficulty=${String(difficulty || '').toLowerCase()}:tags=${String(tags || '').toLowerCase()}`;
};

const makeSearchCacheKey = ({ q, page, limit, skill = '', difficulty = '', tags = '' }) => {
  return `interview:search:q=${encodeURIComponent(String(q || '').trim().toLowerCase())}:skill=${sanitizeSkill(skill)}:difficulty=${String(difficulty || '').toLowerCase()}:tags=${String(tags || '').toLowerCase()}:page=${page}:limit=${limit}`;
};

const normalizePagination = ({ page = 1, limit = DEFAULT_PAGE_LIMIT }) => {
  const parsedPage = Number.isFinite(Number(page)) ? Number(page) : 1;
  const parsedLimit = Number.isFinite(Number(limit)) ? Number(limit) : DEFAULT_PAGE_LIMIT;
  return {
    page: Math.max(1, Math.floor(parsedPage)),
    limit: Math.min(50, Math.max(1, Math.floor(parsedLimit)))
  };
};

const buildQuestionFilters = ({ skill, difficulty = '', tags = '' }) => {
  const filter = { skill: sanitizeSkill(skill) };
  const normalizedDifficulty = sanitizeDifficulty(difficulty);
  if (difficulty) {
    filter.difficulty = normalizedDifficulty;
  }
  if (tags) {
    const tagList = String(tags)
      .split(',')
      .map((tag) => tag.trim().toLowerCase())
      .filter(Boolean);

    if (tagList.length > 0) {
      filter.tags = { $in: tagList };
    }
  }
  return filter;
};

const getQuestionBank = async ({ skill, page = 1, limit = DEFAULT_PAGE_LIMIT, difficulty = '', tags = '' }) => {
  const { page: normalizedPage, limit: normalizedLimit } = normalizePagination({ page, limit });
  const cacheKey = makeQuestionsCacheKey({
    skill,
    page: normalizedPage,
    limit: normalizedLimit,
    difficulty,
    tags
  });

  const cached = await getCacheJson(cacheKey);
  if (cached) {
    return { ...cached, fromCache: true };
  }

  const filter = buildQuestionFilters({ skill, difficulty, tags });
  const skip = (normalizedPage - 1) * normalizedLimit;
  const [questions, total] = await Promise.all([
    InterviewQuestionBank.find(filter)
      .sort({ popularity: -1, createdAt: -1 })
      .skip(skip)
      .limit(normalizedLimit)
      .lean(),
    InterviewQuestionBank.countDocuments(filter)
  ]);

  const payload = {
    questions,
    total,
    page: normalizedPage,
    limit: normalizedLimit,
    totalPages: Math.max(1, Math.ceil(total / normalizedLimit)),
    fromCache: false
  };

  await setCacheJson(cacheKey, payload, CACHE_TTL_SECONDS);
  return payload;
};

const searchQuestionBank = async ({ q, skill = '', difficulty = '', tags = '', page = 1, limit = DEFAULT_PAGE_LIMIT }) => {
  const query = String(q || '').trim();
  if (!query) {
    return {
      questions: [],
      total: 0,
      page: 1,
      limit,
      totalPages: 1,
      fromCache: false
    };
  }

  const { page: normalizedPage, limit: normalizedLimit } = normalizePagination({ page, limit });
  const cacheKey = makeSearchCacheKey({
    q: query,
    page: normalizedPage,
    limit: normalizedLimit,
    skill,
    difficulty,
    tags
  });
  const cached = await getCacheJson(cacheKey);
  if (cached) {
    return { ...cached, fromCache: true };
  }

  const skip = (normalizedPage - 1) * normalizedLimit;
  const filter = {
    $text: { $search: query }
  };
  const normalizedSkill = sanitizeSkill(skill);
  if (normalizedSkill) {
    filter.skill = normalizedSkill;
  }
  if (difficulty) {
    filter.difficulty = sanitizeDifficulty(difficulty);
  }
  if (tags) {
    const tagList = String(tags)
      .split(',')
      .map((tag) => tag.trim().toLowerCase())
      .filter(Boolean);
    if (tagList.length > 0) {
      filter.tags = { $in: tagList };
    }
  }

  const [questions, total] = await Promise.all([
    InterviewQuestionBank.find(filter, { score: { $meta: 'textScore' } })
      .sort({ score: { $meta: 'textScore' }, popularity: -1, createdAt: -1 })
      .skip(skip)
      .limit(normalizedLimit)
      .lean(),
    InterviewQuestionBank.countDocuments(filter)
  ]);

  const payload = {
    questions,
    total,
    page: normalizedPage,
    limit: normalizedLimit,
    totalPages: Math.max(1, Math.ceil(total / normalizedLimit)),
    fromCache: false
  };

  await setCacheJson(cacheKey, payload, CACHE_TTL_SECONDS);
  return payload;
};

const generateQuestionsFromAI = async ({ skill, query = '', count = MIN_GENERATE_RESULTS }) => {
  const prompt = getInterviewQuestionGenerationPrompt({ skill, query, count });
  const fallback = {
    questions: [
      {
        question: `Explain a core ${skill} concept and where it is used in production systems.`,
        answer: 'Define the concept, describe tradeoffs, and provide one practical implementation example.',
        difficulty: 'medium',
        tags: [skill]
      }
    ]
  };

  const result = await aiService.runAIAnalysis(prompt, fallback);
  return normalizeQuestions(result.questions);
};

const saveUniqueQuestions = async ({ skill, questions, source = 'ai', popularity = 10 }) => {
  const normalizedSkill = sanitizeSkill(skill);
  if (!normalizedSkill || !Array.isArray(questions) || questions.length === 0) {
    return [];
  }

  const existing = await InterviewQuestionBank.find({
    skill: normalizedSkill,
    question: { $in: questions.map((item) => item.question) }
  }).select('question').lean();

  const existingSet = new Set(existing.map((item) => normalizeQuestionText(item.question).toLowerCase()));
  const uniqueToInsert = [];
  const insertedQuestionSet = new Set();

  for (const item of questions) {
    const normalizedQuestion = normalizeQuestionText(item.question).toLowerCase();
    if (!normalizedQuestion || existingSet.has(normalizedQuestion) || insertedQuestionSet.has(normalizedQuestion)) {
      continue;
    }
    insertedQuestionSet.add(normalizedQuestion);
    uniqueToInsert.push({
      skill: normalizedSkill,
      question: normalizeQuestionText(item.question),
      answer: normalizeQuestionText(item.answer),
      difficulty: sanitizeDifficulty(item.difficulty),
      tags: sanitizeTags(item.tags),
      source,
      popularity
    });
  }

  if (uniqueToInsert.length === 0) {
    return [];
  }

  const inserted = await InterviewQuestionBank.insertMany(uniqueToInsert, { ordered: false });
  await invalidateInterviewPrepCache();
  return inserted.map((item) => item.toObject());
};

const generateHybridInterviewQuestions = async ({ skill, query = '', page = 1, limit = DEFAULT_PAGE_LIMIT }) => {
  const normalizedSkill = sanitizeSkill(skill);
  if (!normalizedSkill) {
    throw new Error('Skill is required.');
  }

  const baseResult = query
    ? await searchQuestionBank({ q: query, skill: normalizedSkill, page, limit })
    : await getQuestionBank({ skill: normalizedSkill, page, limit });

  const dbQuestions = baseResult.questions || [];
  if (dbQuestions.length >= MIN_GENERATE_RESULTS) {
    return {
      ...baseResult,
      source: 'db',
      aiGeneratedCount: 0
    };
  }

  const needed = Math.max(0, MIN_GENERATE_RESULTS - dbQuestions.length);
  if (needed === 0) {
    return {
      ...baseResult,
      source: 'db',
      aiGeneratedCount: 0
    };
  }

  const aiQuestions = await generateQuestionsFromAI({
    skill: normalizedSkill,
    query,
    count: needed
  });

  const insertedQuestions = await saveUniqueQuestions({
    skill: normalizedSkill,
    questions: aiQuestions,
    source: 'ai',
    popularity: 10
  });

  const reloaded = query
    ? await searchQuestionBank({ q: query, skill: normalizedSkill, page, limit })
    : await getQuestionBank({ skill: normalizedSkill, page, limit });

  return {
    ...reloaded,
    source: insertedQuestions.length > 0 ? 'db+ai' : 'db',
    aiGeneratedCount: insertedQuestions.length
  };
};

const generateInterviewPrep = async ({ userId, careerStack, experienceLevel, skillGaps = [] }) => {
  const prompt = getInterviewPrepPrompt({ careerStack, experienceLevel, skillGaps });
  const fallback = {
    questions: [
      {
        question: 'Describe a time you debugged a complex issue in your codebase.',
        answer: 'Highlight the context, root cause analysis, and the final fix along with lessons learned.',
        difficulty: 'Medium',
        tags: ['Behavioral']
      },
      {
        question: 'Explain how you would design a scalable API for a high-traffic application.',
        answer: 'Discuss REST/GraphQL decisions, caching, rate limiting, and database scaling.',
        difficulty: 'Hard',
        tags: ['System Design']
      }
    ]
  };

  const result = await aiService.runAIAnalysis(prompt, fallback);
  const questions = normalizeQuestions(result.questions);

  const session = await InterviewPrepSession.create({
    userId,
    careerStack,
    experienceLevel,
    skillGaps,
    questions
  });

  return session;
};

const generateInterviewPrepSessionFromBank = async ({ userId, skill, query = '', careerStack = '', experienceLevel = '' }) => {
  const generated = await generateHybridInterviewQuestions({ skill, query, page: 1, limit: DEFAULT_PAGE_LIMIT });

  const session = await InterviewPrepSession.create({
    userId,
    careerStack,
    experienceLevel,
    skillGaps: [skill],
    questions: generated.questions.map((item) => ({
      question: item.question,
      answer: item.answer,
      difficulty: item.difficulty,
      tags: item.tags
    }))
  });

  return {
    ...generated,
    sessionId: session._id
  };
};

const listInterviewPrepHistory = async (userId, limit = 5) => {
  return InterviewPrepSession.find({ userId }).sort({ createdAt: -1 }).limit(limit).lean();
};

module.exports = {
  DEFAULT_PAGE_LIMIT,
  MIN_GENERATE_RESULTS,
  sanitizeSkill,
  normalizeQuestions,
  getQuestionBank,
  searchQuestionBank,
  saveUniqueQuestions,
  generateHybridInterviewQuestions,
  generateInterviewPrepSessionFromBank,
  generateInterviewPrep,
  listInterviewPrepHistory,
  invalidateInterviewPrepCache
};
