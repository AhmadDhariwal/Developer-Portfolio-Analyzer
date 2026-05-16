const Job = require('../../models/Job');
const RecruiterMatch = require('../../models/RecruiterMatch');
const RecruiterShortlist = require('../../models/RecruiterShortlist');
const AuditLog = require('../../models/auditLog');
const { getRecruiterScope } = require('../../utils/recruiter-hub/recruiterAccess');
const { bucketByDay, topCounts } = require('../../utils/recruiter-hub/recruiterAnalyticsBuilder');

const listRecruiterAnalytics = async (req) => {
  const { recruiterId, organizationId, teams } = await getRecruiterScope(req);
  const [jobs, matches, shortlists, logs] = await Promise.all([
    Job.find({ recruiterId, organizationId }).lean(),
    RecruiterMatch.find({ recruiterId, organizationId }).lean(),
    RecruiterShortlist.find({ recruiterId, organizationId }).lean(),
    AuditLog.find({ actor: recruiterId, organizationId }).sort({ timestamp: -1 }).limit(500).lean()
  ]);

  const viewed = logs.filter((log) => log.action === 'RECRUITER_CANDIDATE_VIEWED').length;
  const analyzed = logs.filter((log) => log.action === 'RECRUITER_CANDIDATE_ANALYZED').length;
  const aiUsage = logs.filter((log) => /match|analyz/i.test(String(log.action || ''))).length;
  const successRate = matches.length > 0
    ? Math.round((matches.filter((match) => match.status === 'shortlisted').length / matches.length) * 100)
    : 0;
  const activityScore = Math.min(100, viewed * 3 + analyzed * 5 + jobs.length * 4 + shortlists.length * 4 + matches.length * 2);

  return {
    metrics: {
      assignedTeams: teams.length,
      candidatesViewed: viewed,
      candidatesAnalyzed: analyzed,
      activeJobs: jobs.filter((job) => job.status === 'open').length,
      matchesGenerated: matches.length,
      shortlistedCandidates: shortlists.length,
      recruiterActivityScore: activityScore,
      successRate
    },
    charts: {
      candidateActivityTrend: bucketByDay(logs.filter((log) => /CANDIDATE_VIEWED|CANDIDATE_ANALYZED/.test(String(log.action))), (log) => log.timestamp),
      matchGenerationTrend: bucketByDay(matches, (item) => item.createdAt),
      weeklyRecruiterActivity: bucketByDay(logs, (log) => log.timestamp),
      aiUsageGraph: bucketByDay(logs.filter((log) => /ANALYZED|MATCH/.test(String(log.action))), (log) => log.timestamp),
      jobPerformanceChart: jobs.map((job) => ({
        label: job.title,
        status: job.status,
        updatedAt: job.updatedAt
      })),
      skillDemandChart: topCounts(jobs.flatMap((job) => job.requiredSkills || []), (skill) => skill)
    },
    highlights: {
      mostMatchedSkills: topCounts(matches.flatMap((match) => Object.keys(match.breakdown || {})), (skill) => skill),
      mostActiveJobs: topCounts(jobs, (job) => job.title),
      recentActivity: logs.slice(0, 10)
    }
  };
};

module.exports = {
  listRecruiterAnalytics
};
