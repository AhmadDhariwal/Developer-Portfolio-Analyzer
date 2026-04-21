/**
 * AI Task Service
 * Generates 8–9 structured tasks per technology with:
 *   - Rich 2–3 line descriptions
 *   - startDate / endDate based on sprint duration phases
 *   - Priority cascade: goal → profile → resume → github → default
 */

const { getTasksForTechnology, getTaskForMissingSkill, getTaskForGitHubWeakness } = require('../utils/taskTemplates');
const { distributeTaskDates, phaseCategory, startOfDay, addDays } = require('../utils/dateUtils');
const User = require('../models/user');
const AnalysisCache = require('../models/analysisCache');
const Analysis = require('../models/analysis');

const MIN_TASKS = 8;
const MAX_TASKS = 9;

// ── Helpers ───────────────────────────────────────────────────────────────

const dedupe = (tasks) => {
  const seen = new Set();
  return tasks.filter(t => {
    const key = t.title.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const normalizeTask = (t, taskType = 'ai') => ({
  title:       String(t.title || 'Task'),
  description: String(t.description || ''),
  points:      Number(t.points || 3),
  priority:    ['high', 'medium', 'low'].includes(t.priority) ? t.priority : 'medium',
  category:    ['learning', 'project', 'practice'].includes(t.category) ? t.category : 'learning',
  taskType,
  isCompleted: false,
  startDate:   t.startDate || null,
  endDate:     t.endDate   || null,
});

/**
 * Assign startDate / endDate to each task based on sprint duration.
 * Phase logic:
 *   Day 1–30%  → learning tasks
 *   Day 30–70% → building/project tasks
 *   Day 70–100%→ deployment/polish tasks
 */
const assignDates = (tasks, sprintStart, sprintEnd) => {
  if (!sprintStart || !sprintEnd) return tasks;

  const start = startOfDay(new Date(sprintStart));
  const end   = startOfDay(new Date(sprintEnd));
  const slots = distributeTaskDates(start, end, tasks.length);

  return tasks.map((t, i) => ({
    ...t,
    startDate: slots[i]?.startDate || start,
    endDate:   slots[i]?.endDate   || end,
    // Override category based on phase position if not already set meaningfully
    category: t.category || phaseCategory(i / tasks.length),
  }));
};

// ── Priority 1: Sprint goal ───────────────────────────────────────────────

const getTasksFromGoal = (stack, technology, experienceLevel) => {
  const tech = technology || stack;
  if (!tech) return [];
  return getTasksForTechnology(tech, experienceLevel).map(t => normalizeTask(t, 'ai'));
};

// ── Priority 2: User profile ──────────────────────────────────────────────

const getTasksFromProfile = async (userId) => {
  const user = await User.findById(userId).select('careerStack experienceLevel').lean();
  if (!user) return [];
  return getTasksForTechnology(user.careerStack || 'Full Stack', user.experienceLevel || 'Student')
    .map(t => normalizeTask(t, 'ai'));
};

// ── Priority 3: Resume missing skills ────────────────────────────────────

const getTasksFromResume = async (userId) => {
  const cache = await AnalysisCache.findOne({
    userId,
    'analysisData.skillGap.missingSkills': { $exists: true, $not: { $size: 0 } }
  }).sort({ updatedAt: -1 }).lean();

  const missingSkills = cache?.analysisData?.skillGap?.missingSkills || [];
  if (!missingSkills.length) return [];

  return missingSkills.slice(0, 4).map(skill => {
    const name = typeof skill === 'string' ? skill : (skill?.name || skill?.skill || String(skill));
    return normalizeTask(getTaskForMissingSkill(name), 'ai');
  });
};

// ── Priority 4: GitHub weak areas ────────────────────────────────────────

const getTasksFromGitHub = async (userId) => {
  const analysis = await Analysis.findOne({ userId }).lean();
  if (!analysis) return [];

  const tasks = [];
  const activity = analysis.contributionActivity || [];
  const totalCommits = activity.reduce((s, m) => s + (m.count || 0), 0);

  if (totalCommits < 10) {
    const t = getTaskForGitHubWeakness('low_commits');
    if (t) tasks.push(normalizeTask(t, 'ai'));
  }
  if ((analysis.githubScore || 0) < 50) {
    const t = getTaskForGitHubWeakness('poor_readme');
    if (t) tasks.push(normalizeTask(t, 'ai'));
  }
  return tasks;
};

// ── Priority 5: Default ───────────────────────────────────────────────────

const getDefaultTasks = () =>
  getTasksForTechnology('full stack', 'Student').map(t => normalizeTask(t, 'ai'));

// ── Main entry point ──────────────────────────────────────────────────────

/**
 * @param {Object} options
 * @param {string}  options.userId
 * @param {string}  [options.stack]
 * @param {string}  [options.technology]
 * @param {string}  [options.experienceLevel]
 * @param {Date|string} [options.sprintStartDate]
 * @param {Date|string} [options.sprintEndDate]
 */
const generateTasks = async ({ userId, stack, technology, experienceLevel, sprintStartDate, sprintEndDate }) => {
  let tasks = [];

  if (stack || technology) {
    tasks = getTasksFromGoal(stack, technology, experienceLevel);
  }

  if (tasks.length < MIN_TASKS) {
    tasks = dedupe([...tasks, ...await getTasksFromProfile(userId)]);
  }

  if (tasks.length < MAX_TASKS) {
    tasks = dedupe([...tasks, ...await getTasksFromResume(userId)]);
  }

  if (tasks.length < MAX_TASKS) {
    tasks = dedupe([...tasks, ...await getTasksFromGitHub(userId)]);
  }

  if (tasks.length === 0) {
    tasks = getDefaultTasks();
  }

  // Ensure we have at least MIN_TASKS by padding with defaults if needed
  if (tasks.length < MIN_TASKS) {
    const defaults = getDefaultTasks();
    tasks = dedupe([...tasks, ...defaults]).slice(0, MAX_TASKS);
  }

  tasks = tasks.slice(0, MAX_TASKS);

  // Assign sprint-phase dates
  const start = sprintStartDate || new Date();
  const end   = sprintEndDate   || addDays(new Date(), 6);
  tasks = assignDates(tasks, start, end);

  return tasks;
};

module.exports = { generateTasks };
