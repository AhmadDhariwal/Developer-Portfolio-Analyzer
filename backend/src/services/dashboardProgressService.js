const { normalizeDashboardActivity } = require('../utils/dashboardActivity');
const { numeric } = require('./scoring/math');
const sprintScore = require('./scoring/sprintProgressScore');

function buildDashboardProgress(
  { analysis, latestCareerSprint, latestSkillGapCache, learningProgress, sourceFreshness, history },
  now,
) {
  const tasks = [];
  const seen = new Set();
  for (const task of latestCareerSprint?.tasks || []) {
    if (!task._id || seen.has(String(task._id)) || (numeric(task.points) || 1) < 0) continue;
    seen.add(String(task._id));
    tasks.push(task);
  }
  const velocity = Array.from({ length: 7 }, (_, index) => {
    const day = new Date(now.getTime() - (6 - index) * 86400000).toISOString().slice(0, 10);
    const completed = tasks.filter(
      (task) =>
        task.isCompleted &&
        task.completedAt &&
        Number.isFinite(new Date(task.completedAt).getTime()) &&
        new Date(task.completedAt).toISOString().slice(0, 10) === day,
    );
    return {
      day,
      completed: completed.length,
      points: completed.reduce((sum, task) => sum + (numeric(task.points) || 1), 0),
    };
  });
  const sources = Object.entries(sourceFreshness).filter(([key]) => key !== 'weekly');
  const skillData = latestSkillGapCache?.analysisData;
  return {
    history,
    sprint: {
      available: Boolean(latestCareerSprint),
      weightedCompletion: sprintScore.calculate(tasks).score,
      velocity,
      undatedCompletions: tasks.filter((task) => task.isCompleted && !task.completedAt).length,
      basis:
        'Latest saved sprint only; completion dates use UTC. Undated completions are excluded from velocity.',
    },
    skills: {
      available: Boolean(latestSkillGapCache),
      proven: Array.isArray(skillData?.provenSkills) ? skillData.provenSkills.length : null,
      claimed: Array.isArray(skillData?.claimedButNotProvenSkills)
        ? skillData.claimedButNotProvenSkills.length
        : null,
      basis: 'Skill Gap evidence classification; coverage is shown in Skill Gap Overview.',
    },
    evidence: {
      totalSources: sources.length,
      available: sources.filter(([, source]) => source.available).length,
      fresh: sources.filter(([, source]) => source.available && source.status === 'fresh').length,
      stale: sources.filter(([, source]) => source.available && source.status === 'stale').length,
      missing: sources.filter(([, source]) => !source.available).length,
    },
    github: {
      available: Boolean(analysis?.updatedAt),
      historyStatus:
        'Legacy repository snapshots do not record username or scoring-rule identity; trends are not inferred.',
      activity: normalizeDashboardActivity(analysis?.contributionActivity),
    },
    completedCourses: (learningProgress || [])
      .filter((row) => row.status === 'completed')
      .slice(0, 5)
      .map((row) => ({
        title: row.course?.title || 'Tracked course',
        completedAt: row.completedAt || null,
      })),
  };
}
module.exports = { buildDashboardProgress };
