const { normalizeDashboardActivity } = require('../utils/dashboardActivity');
const { numeric } = require('../../../core/scoring/math');
const sprintScore = require('../../../core/scoring/sprintProgressScore');

function buildDashboardProgress(
  { analysis, latestCareerSprint, latestSkillGapCache, learningProgress, sourceFreshness, history },
  now,
) {
  const tasks = [];
  const seen = new Set();
  for (const task of latestCareerSprint?.tasks || []) {
    if (!task._id || seen.has(String(task._id)) || (numeric(task.points) ?? 1) < 0) continue;
    seen.add(String(task._id));
    tasks.push(task);
  }
  const start = latestCareerSprint?.sprintStartDate || latestCareerSprint?.weekStartDate;
  const end = latestCareerSprint?.sprintEndDate || latestCareerSprint?.weekEndDate;
  const completions = tasks.filter((task) => task.isCompleted);
  const dated = completions.flatMap((task) => {
    if (!task.completedAt) return [];
    const at = new Date(task.completedAt);
    if (!Number.isFinite(at.getTime()) || at > now) return [];
    if ((start && at < new Date(start)) || (end && at > new Date(end))) return [];
    return [{ day: at.toISOString().slice(0, 10), points: numeric(task.points) ?? 1 }];
  });
  const velocity = latestCareerSprint
    ? Array.from({ length: 7 }, (_, index) => {
        const day = new Date(now.getTime() - (6 - index) * 86400000).toISOString().slice(0, 10);
        const completed = dated.filter((task) => task.day === day);
        return {
          day,
          completed: completed.length,
          points: completed.reduce((sum, task) => sum + task.points, 0),
        };
      })
    : [];
  const sources = Object.entries(sourceFreshness).filter(([key]) => key !== 'weekly');
  const skillData = latestSkillGapCache?.analysisData;
  const activity = normalizeDashboardActivity(analysis?.contributionActivity);
  const repositoryCount = analysis?.githubSignals?.username
    ? numeric(analysis.githubStats?.repos)
    : null;
  const repositories = analysis?.githubSignals?.repositories || [];
  const repositoryEvidence = repositories
    .flatMap((repo) => {
      if (!repo?.name) return [];
      const commits = Number.isSafeInteger(repo.commits) && repo.commits >= 0 ? repo.commits : null;
      const pushedAt = new Date(repo.pushedAt || NaN);
      const date =
        Number.isFinite(pushedAt.getTime()) && pushedAt <= now ? pushedAt.toISOString() : null;
      return commits !== null || date ? [{ name: repo.name, commits, pushedAt: date }] : [];
    })
    .sort((a, b) => (b.pushedAt || '').localeCompare(a.pushedAt || ''));
  return {
    history,
    sprint: {
      available: Boolean(latestCareerSprint),
      weightedCompletion: sprintScore.calculate(tasks).score,
      velocity,
      undatedCompletions: completions.filter(
        (task) => !task.completedAt || !Number.isFinite(new Date(task.completedAt).getTime()),
      ).length,
      basis: 'Active sprint completions over the last seven UTC days.',
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
      historyStatus: activity.length
        ? 'Dated authored commits available for sampled repositories.'
        : repositoryCount !== null || repositoryEvidence.length
          ? 'Partial history. Saved repository evidence is available.'
          : 'No saved repository history.',
      activity,
      repositoryCount,
      repositoryEvidence: repositoryEvidence.slice(0, 4),
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
