/**
 * Career Sprint planning service.
 * Supports both deterministic planning and LLM-enhanced planning with
 * deterministic fallback.
 */

const User = require('../models/user');
const Recommendation = require('../models/recommendation');
const AnalysisCache = require('../models/analysisCache');
const Analysis = require('../models/analysis');
const aiService = require('./aiservice');
const { getDeveloperSignals } = require('./developerSignalService');
const { getCareerSprintPrompt } = require('../prompts/careerSprintPrompt');
const {
  getTasksForTechnology,
  getTaskForMissingSkill,
  getTaskForGitHubWeakness
} = require('../utils/taskTemplates');
const { distributeTaskDates, phaseCategory, startOfDay, addDays } = require('../utils/dateUtils');

const MIN_TASKS = 6;
const MAX_TASKS = 8;
const CAREER_SPRINT_PLAN_VERSION = 'plan_v2';
const PLANNING_CACHE_TTL_MS = Math.max(1_000, Number(process.env.CAREER_SPRINT_PLANNING_CACHE_TTL_MS) || 120_000);
const PLANNING_CACHE_MAX_SIZE = Math.max(10, Number(process.env.CAREER_SPRINT_PLANNING_CACHE_MAX_SIZE) || 300);
const PLAN_RESULT_CACHE_TTL_MS = Math.max(1_000, Number(process.env.CAREER_SPRINT_PLAN_RESULT_CACHE_TTL_MS) || 120_000);
const PLAN_REDIS_BUDGET_MS = Math.max(20, Number(process.env.CAREER_SPRINT_PLAN_REDIS_BUDGET_MS) || 120);
const PLAN_REDIS_TTL_SECONDS = Math.max(30, Number(process.env.CAREER_SPRINT_PLAN_REDIS_TTL_SECONDS) || 120);
const AI_TIMEOUT_MS = Math.max(2_000, Math.min(5_000, Number(process.env.CAREER_SPRINT_AI_TIMEOUT_MS) || 4_500));
const STAGE_TIMINGS_ENABLED = process.env.CAREER_SPRINT_STAGE_TIMINGS === '1'
  || process.env.NODE_ENV !== 'production';
const PLAN_REDIS_NAMESPACE = 'career_sprint:plan';

const planningContextCache = new Map();
const planningContextInflight = new Map();
const planResultCache = new Map();
const generationInflight = new Map();
const planRuntimeCounters = {
  pipelineExecutions: 0,
  memoryHits: 0,
  redisHits: 0,
  mongoHits: 0,
  signalCalls: 0,
  aiCalls: 0,
  redisWrites: 0
};

const EMPTY_STAGE_TIMINGS = Object.freeze({
  cache: 0,
  Redis: 0,
  Mongo: 0,
  'external provider': 0,
  AI: 0,
  'deterministic processing': 0,
  validation: 0,
  persistence: 0
});

const boundedSet = (cache, key, value) => {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > PLANNING_CACHE_MAX_SIZE) cache.delete(cache.keys().next().value);
};

const cloneCached = (value) => {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch {
      // fall through
    }
  }
  return JSON.parse(JSON.stringify(value));
};

const withBudget = async (promise, budgetMs, fallback = null) => {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(fallback), budgetMs);
        timer.unref?.();
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const createStageTimer = () => {
  const startedAt = process.hrtime.bigint();
  const stages = { ...EMPTY_STAGE_TIMINGS };
  return {
    async measure(name, work) {
      const stageStartedAt = process.hrtime.bigint();
      const value = await work();
      const elapsed = Number(process.hrtime.bigint() - stageStartedAt) / 1e6;
      stages[name] = Number(((Number(stages[name]) || 0) + elapsed).toFixed(4));
      return value;
    },
    attach(result) {
      if (!STAGE_TIMINGS_ENABLED || !result || typeof result !== 'object') return result;
      const total = Number(process.hrtime.bigint() - startedAt) / 1e6;
      return {
        ...result,
        cacheMetadata: {
          ...(result.cacheMetadata || {}),
          stageTimingsMs: { ...stages, total: Number(total.toFixed(4)) },
          requestCounters: { ...planRuntimeCounters }
        }
      };
    }
  };
};

const planningKey = ({ userId, stack, technology, experienceLevel }) => JSON.stringify([
  CAREER_SPRINT_PLAN_VERSION,
  String(userId || ''),
  String(stack || '').trim().toLowerCase(),
  String(technology || '').trim().toLowerCase(),
  String(experienceLevel || '').trim().toLowerCase()
]);

const generationKey = (mode, input) => JSON.stringify([
  CAREER_SPRINT_PLAN_VERSION,
  mode,
  planningKey(input),
  String(input.sprintStartDate || ''),
  String(input.sprintEndDate || '')
]);

const planResultIdentity = (mode, input) => `${CAREER_SPRINT_PLAN_VERSION}:${mode}:${planningKey(input)}:${String(input.sprintStartDate || '')}:${String(input.sprintEndDate || '')}`;

const isPersistablePlan = (value) => Boolean(
  value
  && Array.isArray(value.tasks)
  && value.tasks.length >= MIN_TASKS
  && value.planMeta
  && Number.isFinite(Number(value.planMeta.confidenceScore))
);

const readPlanMemory = (key) => {
  const entry = planResultCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    planResultCache.delete(key);
    return null;
  }
  planResultCache.delete(key);
  planResultCache.set(key, entry);
  return entry.value;
};

const writePlanMemory = (key, value) => {
  if (!isPersistablePlan(value)) return;
  const cacheable = cloneCached(value);
  if (cacheable?.cacheMetadata) delete cacheable.cacheMetadata;
  boundedSet(planResultCache, key, { value: cacheable, expiresAt: Date.now() + PLAN_RESULT_CACHE_TTL_MS });
};

const persistPlanAsync = (key, value) => {
  if (!isPersistablePlan(value)) return;
  const cacheable = cloneCached(value);
  if (cacheable?.cacheMetadata) delete cacheable.cacheMetadata;
  setImmediate(() => {
    planRuntimeCounters.redisWrites += 1;
    aiService.setSharedCache(key, cacheable, PLAN_REDIS_TTL_SECONDS, PLAN_REDIS_NAMESPACE).catch(() => {});
  });
};

const dedupeGeneration = (key, factory, forceRefresh) => {
  if (!forceRefresh && generationInflight.has(key)) return generationInflight.get(key);
  const request = Promise.resolve().then(factory).finally(() => {
    if (generationInflight.get(key) === request) generationInflight.delete(key);
  });
  if (!forceRefresh) generationInflight.set(key, request);
  return request;
};

const uniqStrings = (values = [], limit = 8) => {
  const seen = new Set();
  const result = [];
  for (const value of Array.isArray(values) ? values : []) {
    const safeValue = String(value || '').trim();
    const key = safeValue.toLowerCase();
    if (!safeValue || seen.has(key)) continue;
    seen.add(key);
    result.push(safeValue);
    if (result.length >= limit) break;
  }
  return result;
};

const clamp = (value, min = 0, max = 100) => {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return min;
  return Math.max(min, Math.min(max, Math.round(numeric)));
};

const dedupe = (tasks = []) => {
  const seen = new Set();
  return tasks.filter((task) => {
    const key = String(task?.title || '').trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const UNSAFE_TASK_TEXT = /[{}\[\]<>]|<\/?[a-z]|lorem ipsum|as an ai\b|language model\b|i cannot\b|not sure\b|\bn\/a\b|todo\b|placeholder|sample text|test task|depends on the situation|it is important to|generally speaking|leverage synerg|cutting-edge|stop winging it/i;

const normalizeTask = (task, taskType = 'ai') => {
  const title = String(task?.title || '').trim().replace(/\s+/g, ' ');
  if (!title) return null;
  return {
    title: title.slice(0, 120),
    description: String(task?.description || '').trim().slice(0, 1000),
    points: Math.max(1, Math.min(10, Number.isFinite(Number(task?.points)) ? Number(task.points) : 3)),
    priority: ['high', 'medium', 'low'].includes(task?.priority) ? task.priority : 'medium',
    category: ['learning', 'project', 'practice'].includes(task?.category) ? task.category : 'learning',
    taskType,
    isCompleted: false,
    startDate: task?.startDate || null,
    endDate: task?.endDate || null
  };
};

const assignDeterministicScoring = (tasks = []) =>
  (Array.isArray(tasks) ? tasks : []).map((task, index) => ({
    ...task,
    points: task.category === 'project' ? 5 : task.category === 'practice' ? 4 : 3,
    priority: index < 2 ? 'high' : index < 5 ? 'medium' : 'low'
  }));

const isUsableTaskText = (value, { min = 8, max = 500 } = {}) => {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length < min || text.length > max) return false;
  if (UNSAFE_TASK_TEXT.test(text)) return false;
  if ((text.match(/[!?.]/g) || []).length > 8) return false;
  return true;
};

const hasAiTaskFactPollution = (aiResult = {}) => {
  if (!aiResult || typeof aiResult !== 'object' || Array.isArray(aiResult)) return true;
  if (aiResult.__fallback === true) return true;
  return typeof aiResult.xpPoints === 'number'
    || typeof aiResult.level === 'number'
    || typeof aiResult.confidenceScore === 'number'
    || typeof aiResult.consistencyScore === 'number'
    || typeof aiResult.progressPercent === 'number'
    || typeof aiResult.readinessScore === 'number'
    || typeof aiResult.streak === 'number'
    || Array.isArray(aiResult.roadmap)
    || Array.isArray(aiResult.yourSkills)
    || Array.isArray(aiResult.missingSkills);
};

const isTaskGrounded = (task, anchors = []) => {
  const blob = `${task?.title || ''} ${task?.description || ''}`.toLowerCase();
  if (!blob.trim()) return false;
  if (!anchors.length) return true;
  return anchors.some((anchor) => {
    const token = String(anchor || '').trim().toLowerCase();
    return token.length >= 2 && blob.includes(token);
  });
};

const validateAiTaskPlan = (aiResult, context = {}) => {
  if (hasAiTaskFactPollution(aiResult)) {
    return { ok: false, reason: 'pollution', tasks: [] };
  }

  const rawTasks = Array.isArray(aiResult?.tasks) ? aiResult.tasks : [];
  if (rawTasks.length < MIN_TASKS || rawTasks.length > MAX_TASKS + 2) {
    return { ok: false, reason: 'count', tasks: [] };
  }

  const cleaned = [];
  const seen = new Set();
  for (const task of rawTasks) {
    const title = String(task?.title || '').replace(/\s+/g, ' ').trim();
    const description = String(task?.description || '').replace(/\s+/g, ' ').trim();
    const category = String(task?.category || '').trim().toLowerCase();
    if (!isUsableTaskText(title, { min: 8, max: 120 })) continue;
    if (!isUsableTaskText(description, { min: 24, max: 500 })) continue;
    if (!['learning', 'project', 'practice'].includes(category)) continue;
    const key = title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push({ title, description, category });
  }

  if (cleaned.length < MIN_TASKS) {
    return { ok: false, reason: 'quality', tasks: [] };
  }

  const categories = new Set(cleaned.map((task) => task.category));
  if (categories.size < 2) {
    return { ok: false, reason: 'unbalanced', tasks: [] };
  }

  const anchors = uniqStrings([
    context.focusTechnology,
    context.effectiveStack,
    context.effectiveExperience,
    ...(context.missingSkills || []),
    ...(context.recommendationTechnologies || []),
    ...(context.githubWeakAreas || [])
  ], 16);

  if (anchors.length) {
    const groundedCount = cleaned.filter((task) => isTaskGrounded(task, anchors)).length;
    if (groundedCount < 2) {
      return { ok: false, reason: 'ungrounded', tasks: [] };
    }
  }

  return { ok: true, reason: 'ok', tasks: assignDeterministicScoring(cleaned).slice(0, MAX_TASKS) };
};

const enhanceDescription = (task, contextLabel, rationale) => {
  const base = String(task?.description || '').trim();
  return [
    base,
    contextLabel ? `Why now: ${contextLabel}.` : '',
    rationale ? `Execution note: ${rationale}.` : ''
  ].filter(Boolean).join(' ');
};

const classifyGithubWeaknesses = (analysis) => {
  if (!analysis) return [];
  const repoCount = Number(analysis.githubStats?.repos || 0);
  const weaknesses = [];
  const totalCommits = (analysis.contributionActivity || []).reduce((sum, item) => sum + Number(item?.count || 0), 0);

  // Only flag low commits when the user actually has repositories to commit to
  if (repoCount > 0 && totalCommits < 10) weaknesses.push('low_commits');

  // Only flag README/test issues when the user has at least 1 repository
  if (repoCount > 0) {
    if ((analysis.githubScore || 0) < 50) weaknesses.push('poor_readme');
    if ((analysis.readinessScore || 0) < 45) weaknesses.push('no_tests');
  }

  return weaknesses;
};

const assignDates = (tasks, sprintStart, sprintEnd) => {
  if (!sprintStart || !sprintEnd || !tasks.length) return tasks;
  const start = startOfDay(new Date(sprintStart));
  const end = startOfDay(new Date(sprintEnd));
  const slots = distributeTaskDates(start, end, tasks.length);
  return tasks.map((task, index) => ({
    ...task,
    startDate: slots[index]?.startDate || start,
    endDate: slots[index]?.endDate || end,
    category: task.category || phaseCategory(index / Math.max(tasks.length, 1))
  }));
};

const buildBalancedPlan = (seedTasks, missingSkillTasks, githubTasks, recommendationTasks) => {
  const learning = dedupe([...seedTasks.filter((task) => task.category === 'learning'), ...missingSkillTasks]);
  const project = dedupe([...seedTasks.filter((task) => task.category === 'project'), ...recommendationTasks]);
  const practice = dedupe([...seedTasks.filter((task) => task.category === 'practice'), ...githubTasks]);
  const plan = [];
  const buckets = [learning, project, practice];

  while (plan.length < MAX_TASKS && buckets.some((bucket) => bucket.length)) {
    for (const bucket of buckets) {
      const next = bucket.shift();
      if (next) plan.push(next);
      if (plan.length >= MAX_TASKS) break;
    }
  }

  return dedupe(plan).slice(0, MAX_TASKS);
};

const buildTaskPlanMeta = ({
  signals,
  missingSkills,
  weakAreas,
  focusTechnology,
  experienceLevel,
  tasks,
  generationMode = 'deterministic',
    providerLabel = 'Deterministic Plan'
  }) => {
  const confidenceScore = Math.max(
    40,
    Math.min(
      95,
      Math.round(
        42 +
          (tasks.length >= 6 ? 16 : 8) +
          ((signals?.careerSprintSignal?.consistencyScore || 0) * 0.18) +
          ((signals?.weeklyReportSignal?.weeklyProgressScore || 0) * 0.14) +
          (focusTechnology ? 8 : 0) +
          (missingSkills.length ? 6 : 0)
      )
    )
  );

  return {
    summary: `${generationMode === 'llm' ? 'Generated an AI-enhanced' : 'Generated a balanced'} ${experienceLevel || 'developer'} sprint plan focused on ${focusTechnology || 'your current career goals'}.`,
    confidenceScore,
    consistencyScore: Number(signals?.careerSprintSignal?.consistencyScore || 0),
    signalsUsed: uniqStrings([
      focusTechnology,
      ...(missingSkills || []),
      ...(weakAreas || []),
      ...(signals?.integrationSignal?.usedProviders || [])
    ], 8),
    generationMode,
    providerLabel
  };
};

const loadPlanningContext = async ({
  userId,
  stack,
  technology,
  experienceLevel,
  forceRefresh = false,
  timer = null
}) => {
  const key = planningKey({ userId, stack, technology, experienceLevel });
  const cached = planningContextCache.get(key);
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) return cached.value;
  if (!forceRefresh && planningContextInflight.has(key)) return planningContextInflight.get(key);

  const measure = async (name, work) => (timer ? timer.measure(name, work) : work());

  const request = (async () => {
    planRuntimeCounters.mongoHits += 1;
    planRuntimeCounters.signalCalls += 1;
    const [user, signals, recommendationDocs, latestCache, githubAnalysis] = await Promise.all([
      measure('Mongo', () => User.findById(userId).select('careerStack experienceLevel').lean()),
      measure('external provider', () => getDeveloperSignals(userId)),
      measure('Mongo', () => Recommendation.find({ userId }).sort({ createdAt: -1 }).limit(6).select('techStack isNewTech').lean()),
      measure('Mongo', () => AnalysisCache.findOne({ userId }).sort({ updatedAt: -1 }).select('analysisData.skillGap.missingSkills').lean()),
      measure('Mongo', () => Analysis.findOne({ userId }).sort({ createdAt: -1 }).select('githubStats contributionActivity githubScore readinessScore').lean())
    ]);

    const effectiveStack = stack || user?.careerStack || 'Full Stack';
    const effectiveExperience = experienceLevel || user?.experienceLevel || 'Student';
    const focusTechnology = technology || signals?.careerSprintSignal?.activeLearningFocus || effectiveStack;
    const missingSkills = uniqStrings([
      ...(latestCache?.analysisData?.skillGap?.missingSkills || []).map((item) => (typeof item === 'string' ? item : item?.name || item?.skill)),
      ...(signals?.weeklyReportSignal?.repeatedWeakAreas || [])
    ], 4);
    const githubWeakAreas = classifyGithubWeaknesses(githubAnalysis);
    const recommendationTechnologies = uniqStrings(
      recommendationDocs.flatMap((item) => [...(item.techStack || []), ...(item.isNewTech || [])]),
      4
    );

    const context = {
      user,
      signals,
      githubAnalysis,
      effectiveStack,
      effectiveExperience,
      focusTechnology,
      missingSkills,
      githubWeakAreas,
      recommendationTechnologies
    };
    boundedSet(planningContextCache, key, { value: context, expiresAt: Date.now() + PLANNING_CACHE_TTL_MS });
    return context;
  })().finally(() => {
    if (planningContextInflight.get(key) === request) planningContextInflight.delete(key);
  });

  if (!forceRefresh) planningContextInflight.set(key, request);
  return request;
};

const buildDeterministicTaskSet = ({
  effectiveStack,
  effectiveExperience,
  focusTechnology,
  missingSkills,
  githubWeakAreas,
  recommendationTechnologies
}) => {
  const seedTasks = getTasksForTechnology(focusTechnology || effectiveStack, effectiveExperience)
    .map((task) => normalizeTask(task, 'ai'))
    .filter(Boolean);

  const missingSkillTasks = missingSkills.map((skill) => {
    const task = getTaskForMissingSkill(skill);
    return normalizeTask({
      ...task,
      description: enhanceDescription(
        task,
        `${skill} appears in your latest skill gap and weekly weak areas`,
        'Use this task to close a concrete capability gap before the next sprint review'
      )
    }, 'ai');
  }).filter(Boolean);

  const githubTasks = githubWeakAreas.map((weakness) => {
    const task = getTaskForGitHubWeakness(weakness);
    return task
      ? normalizeTask({
          ...task,
          description: enhanceDescription(
            task,
            'GitHub activity signals show this area needs attention',
            'Treat this as polish work that improves public proof and execution discipline'
          )
        }, 'ai')
      : null;
  }).filter(Boolean);

  const recommendationTasks = recommendationTechnologies.slice(0, 2).map((technologyName) => {
    const candidates = getTasksForTechnology(technologyName, effectiveExperience);
    const template = candidates.find((task) => task.category === 'project') || candidates[0];
    return normalizeTask({
      ...template,
      title: template?.title || `Build with ${technologyName}`,
      description: enhanceDescription(
        template || {},
        `${technologyName} is part of your recommendation signal`,
        'Use this project-oriented task to convert recommendation signals into visible execution'
      ),
      category: 'project'
    }, 'ai');
  }).filter(Boolean);

  let tasks = buildBalancedPlan(seedTasks, missingSkillTasks, githubTasks, recommendationTasks);
  if (tasks.length < MIN_TASKS) {
    const fallback = getTasksForTechnology(effectiveStack, effectiveExperience)
      .map((task) => normalizeTask(task, 'ai'))
      .filter(Boolean);
    tasks = dedupe([...tasks, ...fallback]).slice(0, MAX_TASKS);
  }

  return tasks.map((task, index) => ({
    ...task,
    description: enhanceDescription(
      task,
      index < 3 ? 'Front-load fundamentals and confidence-building work' : index < 6 ? 'Move into execution and build work' : 'Close with polish and consistency tasks',
      'Keep the task outcome measurable by the end of its timeline window'
    )
  }));
};

const finalizePlan = ({
  tasks,
  sprintStartDate,
  sprintEndDate,
  signals,
  missingSkills,
  githubWeakAreas,
  focusTechnology,
  experienceLevel,
  generationMode,
  providerLabel,
  summaryOverride = ''
}) => {
  const normalizedTasks = dedupe(
    (Array.isArray(tasks) ? tasks : [])
      .map((task) => normalizeTask(task, 'ai'))
      .filter(Boolean)
  ).slice(0, MAX_TASKS);

  const scheduledTasks = assignDates(
    normalizedTasks,
    sprintStartDate || new Date(),
    sprintEndDate || addDays(new Date(), 6)
  );

  const planMeta = buildTaskPlanMeta({
    signals,
    missingSkills,
    weakAreas: githubWeakAreas,
    focusTechnology,
    experienceLevel,
    tasks: scheduledTasks,
    generationMode,
    providerLabel
  });

  if (summaryOverride) {
    planMeta.summary = String(summaryOverride).trim();
  }

  return {
    tasks: scheduledTasks,
    planMeta
  };
};

const generateTasks = async (input) => dedupeGeneration(generationKey('deterministic', input), async () => {
  const timer = createStageTimer();
  const {
    userId,
    stack,
    technology,
    experienceLevel,
    sprintStartDate,
    sprintEndDate,
    forceRefresh = false
  } = input;
  const identity = planResultIdentity('deterministic', input);

  if (!forceRefresh) {
    const memoryHit = await timer.measure('cache', async () => readPlanMemory(identity));
    if (memoryHit) {
      planRuntimeCounters.memoryHits += 1;
      return timer.attach(cloneCached(memoryHit));
    }
    const redisHit = await timer.measure('Redis', () => withBudget(
      aiService.getSharedCache(identity, PLAN_REDIS_NAMESPACE),
      PLAN_REDIS_BUDGET_MS,
      null
    ));
    if (isPersistablePlan(redisHit)) {
      planRuntimeCounters.redisHits += 1;
      writePlanMemory(identity, redisHit);
      return timer.attach(cloneCached(redisHit));
    }
  }

  planRuntimeCounters.pipelineExecutions += 1;
  const context = await loadPlanningContext({
    userId,
    stack,
    technology,
    experienceLevel,
    forceRefresh,
    timer
  });

  const tasks = await timer.measure('deterministic processing', async () => buildDeterministicTaskSet(context));
  const result = await timer.measure('validation', async () => finalizePlan({
    tasks,
    sprintStartDate,
    sprintEndDate,
    signals: context.signals,
    missingSkills: context.missingSkills,
    githubWeakAreas: context.githubWeakAreas,
    focusTechnology: context.focusTechnology,
    experienceLevel: context.effectiveExperience,
    generationMode: 'deterministic',
    providerLabel: 'Deterministic Plan'
  }));

  if (isPersistablePlan(result)) {
    writePlanMemory(identity, result);
    persistPlanAsync(identity, result);
  }

  return timer.attach(result);
}, Boolean(input.forceRefresh));

const generateAiTasksWithLLM = async (input) => dedupeGeneration(generationKey('llm', input), async () => {
  const timer = createStageTimer();
  const {
    userId,
    stack,
    technology,
    experienceLevel,
    sprintStartDate,
    sprintEndDate,
    forceRefresh = false
  } = input;
  const identity = planResultIdentity('llm', input);

  if (!forceRefresh) {
    const memoryHit = await timer.measure('cache', async () => readPlanMemory(identity));
    if (memoryHit) {
      planRuntimeCounters.memoryHits += 1;
      return timer.attach(cloneCached(memoryHit));
    }
    const redisHit = await timer.measure('Redis', () => withBudget(
      aiService.getSharedCache(identity, PLAN_REDIS_NAMESPACE),
      PLAN_REDIS_BUDGET_MS,
      null
    ));
    if (isPersistablePlan(redisHit)) {
      planRuntimeCounters.redisHits += 1;
      writePlanMemory(identity, redisHit);
      return timer.attach(cloneCached(redisHit));
    }
  }

  planRuntimeCounters.pipelineExecutions += 1;
  const context = await loadPlanningContext({
    userId,
    stack,
    technology,
    experienceLevel,
    forceRefresh,
    timer
  });

  const deterministicTasks = await timer.measure('deterministic processing', async () => buildDeterministicTaskSet(context));
  const deterministicPlan = finalizePlan({
    tasks: deterministicTasks,
    sprintStartDate,
    sprintEndDate,
    signals: context.signals,
    missingSkills: context.missingSkills,
    githubWeakAreas: context.githubWeakAreas,
    focusTechnology: context.focusTechnology,
    experienceLevel: context.effectiveExperience,
    generationMode: 'deterministic',
    providerLabel: 'Deterministic Plan'
  });

  const sprintWindow = `${startOfDay(new Date(sprintStartDate || new Date())).toISOString().slice(0, 10)} to ${startOfDay(new Date(sprintEndDate || addDays(new Date(), 6))).toISOString().slice(0, 10)}`;
  const prompt = getCareerSprintPrompt({
    careerStack: context.effectiveStack,
    experienceLevel: context.effectiveExperience,
    focusTechnology: context.focusTechnology,
    sprintWindow,
    missingSkills: context.missingSkills,
    githubWeakAreas: context.githubWeakAreas,
    recommendationTechnologies: context.recommendationTechnologies,
    developerSignals: context.signals,
    baselineTasks: deterministicPlan.tasks
  });

  const aiFallback = { __fallback: true, tasks: [] };
  planRuntimeCounters.aiCalls += 1;
  const aiMeta = await timer.measure('AI', () => aiService.runAIAnalysis(prompt, aiFallback, 0, {
    returnMeta: true,
    timeoutMs: AI_TIMEOUT_MS
  }));
  const validated = await timer.measure('validation', async () => validateAiTaskPlan(aiMeta?.value, context));
  const usedFallback = !aiMeta?.ok || !validated.ok || aiMeta?.value?.__fallback === true;
  const aiTasks = usedFallback ? deterministicPlan.tasks : validated.tasks;

  const result = finalizePlan({
    tasks: aiTasks,
    sprintStartDate,
    sprintEndDate,
    signals: context.signals,
    missingSkills: context.missingSkills,
    githubWeakAreas: context.githubWeakAreas,
    focusTechnology: context.focusTechnology,
    experienceLevel: context.effectiveExperience,
    generationMode: usedFallback ? 'deterministic' : 'llm',
    providerLabel: usedFallback ? 'Deterministic Plan' : 'AI-Assisted Plan',
    summaryOverride: ''
  });

  // Only persist validated successful plans (including deterministic fallback results that are complete).
  if (isPersistablePlan(result)) {
    writePlanMemory(identity, result);
    persistPlanAsync(identity, result);
  }

  return timer.attach(result);
}, Boolean(input.forceRefresh));

const clearCareerSprintPlanCaches = () => {
  planningContextCache.clear();
  planningContextInflight.clear();
  planResultCache.clear();
  generationInflight.clear();
};

const getCareerSprintPlanRuntimeCounters = () => ({ ...planRuntimeCounters });
const resetCareerSprintPlanRuntimeCounters = () => {
  Object.keys(planRuntimeCounters).forEach((key) => {
    planRuntimeCounters[key] = 0;
  });
};

module.exports = {
  generateTasks,
  generateAiTasksWithLLM,
  validateAiTaskPlan,
  hasAiTaskFactPollution,
  isUsableTaskText,
  assignDeterministicScoring,
  clearCareerSprintPlanCaches,
  getCareerSprintPlanRuntimeCounters,
  resetCareerSprintPlanRuntimeCounters,
  CAREER_SPRINT_PLAN_VERSION,
  AI_TIMEOUT_MS,
  PLAN_REDIS_BUDGET_MS
};
