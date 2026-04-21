/**
 * AI Task Service
 * Generates structured task lists using a priority-based data cascade:
 *   1. Sprint goal (stack + technology) — if provided
 *   2. User profile (careerStack + experienceLevel + skills)
 *   3. Resume missing skills
 *   4. GitHub weak areas
 *   5. Default beginner templates
 *
 * Template-based first — no heavy AI API required.
 * Designed to be extended with LLM calls later without changing the interface.
 */

const { getTasksForTechnology, getTaskForMissingSkill, getTaskForGitHubWeakness } = require('../utils/taskTemplates');
const User = require('../models/user');
const AnalysisCache = require('../models/analysisCache');
const Analysis = require('../models/analysis');

const MAX_TASKS = 8;

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
});

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
  const stack = user.careerStack || 'Full Stack';
  const level = user.experienceLevel || 'Student';
  return getTasksForTechnology(stack, level).map(t => normalizeTask(t, 'ai'));
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
  const stats = analysis.githubStats || {};

  if ((stats.repos || 0) > 0) {
    // Low commit activity relative to repos
    const activity = analysis.contributionActivity || [];
    const totalCommits = activity.reduce((s, m) => s + (m.count || 0), 0);
    if (totalCommits < 10) {
      const t = getTaskForGitHubWeakness('low_commits');
      if (t) tasks.push(normalizeTask(t, 'ai'));
    }
  }

  // Low GitHub score suggests code quality issues
  if ((analysis.githubScore || 0) < 50) {
    const t = getTaskForGitHubWeakness('poor_readme');
    if (t) tasks.push(normalizeTask(t, 'ai'));
  }

  return tasks;
};

// ── Priority 5: Default beginner templates ────────────────────────────────

const getDefaultTasks = () => {
  return getTasksForTechnology('full stack', 'Student').map(t => normalizeTask(t, 'ai'));
};

// ── Main entry point ──────────────────────────────────────────────────────

/**
 * Generate AI tasks using the priority cascade.
 *
 * @param {Object} options
 * @param {string} options.userId
 * @param {string} [options.stack]       - Sprint goal: career stack
 * @param {string} [options.technology]  - Sprint goal: specific technology
 * @param {string} [options.experienceLevel]
 * @returns {Promise<Array>} Normalized task list (max MAX_TASKS)
 */
const generateTasks = async ({ userId, stack, technology, experienceLevel }) => {
  let tasks = [];

  // Priority 1: Sprint goal
  if (stack || technology) {
    tasks = getTasksFromGoal(stack, technology, experienceLevel);
  }

  // Priority 2: User profile (if goal not provided or yielded nothing)
  if (tasks.length < 3) {
    const profileTasks = await getTasksFromProfile(userId);
    tasks = dedupe([...tasks, ...profileTasks]);
  }

  // Priority 3: Resume missing skills
  if (tasks.length < MAX_TASKS) {
    const resumeTasks = await getTasksFromResume(userId);
    tasks = dedupe([...tasks, ...resumeTasks]);
  }

  // Priority 4: GitHub weak areas
  if (tasks.length < MAX_TASKS) {
    const githubTasks = await getTasksFromGitHub(userId);
    tasks = dedupe([...tasks, ...githubTasks]);
  }

  // Priority 5: Default fallback
  if (tasks.length === 0) {
    tasks = getDefaultTasks();
  }

  return tasks.slice(0, MAX_TASKS);
};

module.exports = { generateTasks };
