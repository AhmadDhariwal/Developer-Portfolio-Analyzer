const finite = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
const weights = { github: 30, resume: 25, sprint: 20, interview: 15, skillCoverage: 10 };
function assess({ analysis, resume, graph, sprint, interviewPresent, scores }) {
  const present = {
    github: Boolean(analysis && finite(analysis.githubScore)),
    resume: Boolean(resume && ['atsScore', 'keywordDensity', 'formatScore', 'contentQuality'].every((key) => finite(resume[key]))),
    sprint: Boolean(sprint && Array.isArray(sprint.tasks) && sprint.tasks.length),
    interview: Boolean(interviewPresent),
    skillCoverage: Boolean(graph && Array.isArray(graph.nodes) && graph.nodes.length),
  };
  const inputs = Object.fromEntries(Object.keys(weights).map((key) => [key, {
    available: present[key], value: present[key] ? scores[key] : null, weight: weights[key],
    reason: present[key] ? (scores[key] === 0 ? 'Measured zero' : 'Saved evidence') : key === 'sprint' && sprint ? 'No tasks to assess' : 'Missing evidence',
  }]));
  return { scoreAvailable: Object.values(present).every(Boolean), inputs,
    coverageWeight: Object.entries(present).reduce((sum, [key, exists]) => sum + (exists ? weights[key] : 0), 0) };
}
const adjacent = (report, previousWeek) => Boolean(report && new Date(report.weekStartDate).getTime() === previousWeek.start.getTime() && new Date(report.weekEndDate).getTime() === previousWeek.end.getTime());
function activity(repositories = [], start, end) {
  const inWindow = (date) => date && new Date(date) >= start && new Date(date) <= end;
  return { repositoriesTracked: repositories.length,
    activeRepositories: repositories.filter((repo) => inWindow(repo.lastUpdated)).length,
    commits: repositories.reduce((sum, repo) => sum + (finite(repo.commits) ? Number(repo.commits) : 0), 0),
    // Repository counters are lifetime snapshots; monthly activity cannot resolve a week.
    weeklyCommitSignal: null,
    stars: repositories.reduce((sum, repo) => sum + Number(repo.stars || 0), 0),
    forks: repositories.reduce((sum, repo) => sum + Number(repo.forks || 0), 0),
  };
}
module.exports = { assess, adjacent, activity, finite, weights };
