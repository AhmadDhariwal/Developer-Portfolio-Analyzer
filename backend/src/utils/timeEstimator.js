/**
 * Estimates effort in weeks for skills and projects.
 * Used to detect overloaded plans and apply penalties.
 */

const SKILL_EFFORT = {
  // Easy (0.5 weeks)
  html: 0.5, css: 0.5, markdown: 0.3, git: 0.5, tailwind: 0.5, sass: 0.5,
  // Medium (1–1.5 weeks)
  javascript: 1.5, react: 1.5, vue: 1.5, angular: 2.0,
  'node.js': 1.5, node: 1.5, express: 1.0, python: 1.5,
  mongodb: 1.0, postgresql: 1.0, sql: 1.0, redis: 0.8,
  docker: 1.0, graphql: 1.0, typescript: 1.0,
  // Hard (2–3 weeks)
  kubernetes: 2.5, terraform: 2.0, aws: 2.0, azure: 2.0, gcp: 2.0,
  'machine learning': 3.0, 'deep learning': 3.0, pytorch: 2.5, tensorflow: 2.5,
  'system design': 2.0, microservices: 2.0, golang: 2.0, java: 2.0,
  mlops: 2.5, nlp: 2.5, 'computer vision': 2.5,
  default: 1.0
};

/**
 * Estimate total effort in weeks for a list of skills.
 */
const estimateSkillsEffort = (skills = []) => {
  return skills.reduce((total, skill) => {
    const key = String(skill || '').toLowerCase().trim();
    return total + (SKILL_EFFORT[key] ?? SKILL_EFFORT.default);
  }, 0);
};

/**
 * Estimate total effort in weeks for a list of projects.
 * Projects already have a `weeks` field — we use that directly.
 */
const estimateProjectsEffort = (projects = []) => {
  return projects.reduce((total, p) => total + Number(p.weeks || 3), 0);
};

/**
 * Calculate overload penalty.
 * Returns a penalty score (0 = no penalty, higher = more penalty).
 * Also returns a human-readable warning string.
 */
const calcOverloadPenalty = (skillsEffort, projectsEffort, durationWeeks) => {
  const capacity = durationWeeks * 0.8; // 80% utilization is realistic
  const totalEffort = skillsEffort + projectsEffort;
  const overloadRatio = totalEffort / Math.max(1, capacity);

  if (overloadRatio <= 1.0) {
    return { penalty: 0, warning: null, overloadRatio };
  }
  if (overloadRatio <= 1.3) {
    return {
      penalty: Math.round((overloadRatio - 1.0) * 10),
      warning: 'Your plan is slightly ambitious for the given timeframe.',
      overloadRatio
    };
  }
  if (overloadRatio <= 1.7) {
    return {
      penalty: Math.round((overloadRatio - 1.0) * 14),
      warning: 'This plan is overloaded — consider reducing skills or extending the timeline.',
      overloadRatio
    };
  }
  return {
    penalty: Math.round(Math.min(20, (overloadRatio - 1.0) * 18)),
    warning: 'This plan is too aggressive. Scores will be significantly reduced.',
    overloadRatio
  };
};

module.exports = { estimateSkillsEffort, estimateProjectsEffort, calcOverloadPenalty, SKILL_EFFORT };
