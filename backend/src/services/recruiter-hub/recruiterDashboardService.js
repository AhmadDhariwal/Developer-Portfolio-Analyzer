const { listRecruiterAnalytics } = require('./recruiterAnalyticsService');
const { listRecruiterActivities } = require('./recruiterActivityService');
const { listRecruiterCandidates } = require('./candidateService');
const { listRecruiterJobs } = require('./recruiterJobService');
const { listShortlists } = require('./shortlistService');
const { listRecruiterMatches } = require('./matchService');
const { getRecruiterScope } = require('../../utils/recruiter-hub/recruiterAccess');

const getRecruiterDashboard = async (req) => {
  const scope = await getRecruiterScope(req);
  const [analytics, activities, candidatesResponse, jobs, shortlists, matches] = await Promise.all([
    listRecruiterAnalytics(req),
    listRecruiterActivities({ recruiterId: scope.recruiterId, organizationId: scope.organizationId, query: { limit: 12 } }),
    listRecruiterCandidates({ organizationId: scope.organizationId, query: { limit: 20 } }),
    listRecruiterJobs({ recruiterId: scope.recruiterId, organizationId: scope.organizationId }),
    listShortlists({ recruiterId: scope.recruiterId, organizationId: scope.organizationId }),
    listRecruiterMatches({ recruiterId: scope.recruiterId, organizationId: scope.organizationId, query: {} })
  ]);

  const topMatchedCandidates = [...matches]
    .sort((left, right) => Number(right.matchScore || 0) - Number(left.matchScore || 0))
    .slice(0, 5);
  const suggestedCandidates = (candidatesResponse.candidates || [])
    .filter((candidate) => !shortlists.some((entry) => String(entry.candidateId) === String(candidate.userId || candidate.id)))
    .slice(0, 5);

  return {
    metrics: analytics.metrics,
    charts: analytics.charts,
    widgets: {
      assignedTeams: scope.teams,
      topMatchedCandidates,
      recentActivity: activities.logs.slice(0, 8),
      pendingFollowUps: shortlists.filter((entry) => ['shortlisted', 'reviewing'].includes(String(entry.status || ''))).slice(0, 6),
      suggestedCandidates,
      aiInsights: analytics.highlights.mostMatchedSkills.slice(0, 5).map((item) => `Skill demand is strongest for ${item.label}.`)
    },
    jobs
  };
};

module.exports = {
  getRecruiterDashboard
};
