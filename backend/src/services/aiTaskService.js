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

const normalizeTask = (task, taskType = 'ai') => ({
  title: String(task?.title || 'Task').trim(),
  description: String(task?.description || '').trim(),
  points: Math.max(1, Math.min(10, Number(task?.points || 3))),
  priority: ['high', 'medium', 'low'].includes(task?.priority) ? task.priority : 'medium',
  category: ['learning', 'project', 'practice'].includes(task?.category) ? task.category : 'learning',
  taskType,
  isCompleted: false,
  startDate: task?.startDate || null,
  endDate: task?.endDate || null
});

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
  const weaknesses = [];
  const totalCommits = (analysis.contributionActivity || []).reduce((sum, item) => sum + Number(item?.count || 0), 0);
  if (totalCommits < 10) weaknesses.push('low_commits');
  if ((analysis.githubScore || 0) < 50) weaknesses.push('poor_readme');
  if ((analysis.readinessScore || 0) < 45) weaknesses.push('no_tests');
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
  providerLabel = 'Rules Engine'
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
  experienceLevel
}) => {
  const [user, signals, recommendationDocs, latestCache, githubAnalysis] = await Promise.all([
    User.findById(userId).select('careerStack experienceLevel').lean(),
    getDeveloperSignals(userId),
    Recommendation.find({ userId }).sort({ createdAt: -1 }).limit(6).lean(),
    AnalysisCache.findOne({ userId }).sort({ updatedAt: -1 }).lean(),
    Analysis.findOne({ userId }).sort({ createdAt: -1 }).lean()
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

  return {
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
    .map((task) => normalizeTask(task, 'ai'));

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
  });

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
  });

  let tasks = buildBalancedPlan(seedTasks, missingSkillTasks, githubTasks, recommendationTasks);
  if (tasks.length < MIN_TASKS) {
    const fallback = getTasksForTechnology(effectiveStack, effectiveExperience).map((task) => normalizeTask(task, 'ai'));
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
      .filter((task) => task.title)
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

const generateTasks = async ({
  userId,
  stack,
  technology,
  experienceLevel,
  sprintStartDate,
  sprintEndDate
}) => {
  const context = await loadPlanningContext({
    userId,
    stack,
    technology,
    experienceLevel
  });

  const tasks = buildDeterministicTaskSet(context);
  return finalizePlan({
    tasks,
    sprintStartDate,
    sprintEndDate,
    signals: context.signals,
    missingSkills: context.missingSkills,
    githubWeakAreas: context.githubWeakAreas,
    focusTechnology: context.focusTechnology,
    experienceLevel: context.effectiveExperience,
    generationMode: 'deterministic',
    providerLabel: 'Rules Engine'
  });
};

const generateAiTasksWithLLM = async ({
  userId,
  stack,
  technology,
  experienceLevel,
  sprintStartDate,
  sprintEndDate
}) => {
  const context = await loadPlanningContext({
    userId,
    stack,
    technology,
    experienceLevel
  });

  const deterministicTasks = buildDeterministicTaskSet(context);
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
    providerLabel: 'Rules Engine'
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

  const aiFallback = {
    tasks: deterministicPlan.tasks.map((task) => ({
      title: task.title,
      description: task.description,
      points: task.points,
      priority: task.priority,
      category: task.category
    })),
    planMeta: {
      summary: deterministicPlan.planMeta.summary,
      confidenceScore: deterministicPlan.planMeta.confidenceScore,
      consistencyScore: deterministicPlan.planMeta.consistencyScore,
      signalsUsed: deterministicPlan.planMeta.signalsUsed
    }
  };

  const aiResult = await aiService.runAIAnalysis(prompt, aiFallback);
  const aiTasks = Array.isArray(aiResult?.tasks) && aiResult.tasks.length
    ? aiResult.tasks
    : deterministicPlan.tasks;
  const usedFallback = aiTasks === deterministicPlan.tasks || !Array.isArray(aiResult?.tasks) || !aiResult.tasks.length;

  return finalizePlan({
    tasks: aiTasks,
    sprintStartDate,
    sprintEndDate,
    signals: context.signals,
    missingSkills: context.missingSkills,
    githubWeakAreas: context.githubWeakAreas,
    focusTechnology: context.focusTechnology,
    experienceLevel: context.effectiveExperience,
    generationMode: usedFallback ? 'deterministic' : 'llm',
    providerLabel: usedFallback ? 'Rules Engine Fallback' : 'LLM Planner',
    summaryOverride: aiResult?.planMeta?.summary || ''
  });
};

module.exports = {
  generateTasks,
  generateAiTasksWithLLM
};
