'use strict';
const { numeric, round, safeDivide } = require('./math');
const { createScoreResult } = require('./result');
const RULE_VERSION = 'sprint-progress-v1';

const calculate = (tasks = [], options = {}) => {
  const seen = new Set();
  const warnings = [];
  let totalPoints = 0;
  let completedPoints = 0;
  let taskCount = 0;
  for (const task of Array.isArray(tasks) ? tasks : []) {
    if (!task || typeof task !== 'object') { warnings.push('invalid_task'); continue; }
    const id = task._id == null ? null : String(task._id);
    if (id && seen.has(id)) { warnings.push('duplicate_task'); continue; }
    if (id) seen.add(id);
    // Existing legacy task rule: absent/zero points use one point.
    const points = numeric(task.points) || 1;
    if (points < 0) { warnings.push('invalid_task_points'); continue; }
    totalPoints += points;
    if (task.isCompleted) completedPoints += points;
    taskCount += 1;
  }
  const ratio = safeDivide(completedPoints, totalPoints);
  return createScoreResult({ score: ratio === null ? null : round(ratio * 100),
    breakdown: { completion: { value: ratio === null ? null : ratio * 100, weight: 1, contribution: ratio === null ? null : ratio * 100, available: ratio !== null } },
    warnings, evidence: { sources: options.sources, inputs: { totalPoints, completedPoints }, facts: { taskCount } },
    ruleVersion: RULE_VERSION, calculatedAt: options.calculatedAt });
};
module.exports = { RULE_VERSION, calculate };
