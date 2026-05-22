const { listRecruiterAnalytics } = require('./recruiterAnalyticsService');
const { listRecruiterActivities } = require('./recruiterActivityService');
const { getRecruiterScope } = require('../../utils/recruiter-hub/recruiterAccess');

const getRecruiterDashboard = async (req) => {
  const scope = await getRecruiterScope(req);
  const [analytics, activities] = await Promise.all([
    listRecruiterAnalytics(req),
    listRecruiterActivities({ recruiterId: scope.recruiterId, organizationId: scope.organizationId, query: { limit: 12 } })
  ]);

  return {
    metrics: analytics.metrics,
    charts: analytics.charts,
    widgets: {
      assignedTeams: scope.teams,
      recentActivity: activities.logs.slice(0, 8),
      topCandidates: analytics.widgets?.topCandidates || [],
      recentJobs: analytics.widgets?.recentJobs || [],
      recentMatches: analytics.widgets?.recentMatches || [],
      pendingFollowUps: analytics.widgets?.pendingFollowUps || [],
      aiInsights: (analytics.charts?.topSkillsDemand || []).slice(0, 5).map((item) => `Skill demand is strongest for ${item.label}.`)
    },
    profile: {
      recruiterId: scope.recruiterId,
      organizationId: scope.organizationId,
      name: req.user?.name || 'Recruiter',
      teams: scope.teams
    }
  };
};

module.exports = {
  getRecruiterDashboard
};
