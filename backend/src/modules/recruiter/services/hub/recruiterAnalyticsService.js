const Job = require('../../models/Job');
const RecruiterMatch = require('../../models/RecruiterMatch');
const RecruiterShortlist = require('../../models/RecruiterShortlist');
const AuditLog = require('../../../admin/models/auditLog');
const Membership = require('../../../admin/models/membership');
const User = require('../../../auth/models/user');
const { getRecruiterCandidatesByIds } = require('./candidateService');
const { readCandidateAnalytics } = require('./candidateAnalyticsService');
const { CARD_POOL_LIMIT } = require('../../utils/hub/candidateAnalyticsPipeline');
const { getRecruiterScope } = require('../../utils/hub/recruiterAccess');
const { bucketByDay, topCounts } = require('../../utils/hub/recruiterAnalyticsBuilder');
const { getRecruiterSummary } = require('./recruiterSummaryCache');

const bucketByMonth = (items = [], dateSelector, count = 6) => {
  const now = new Date();
  const months = Array.from({ length: count }, (_, index) => {
    const date = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (count - index - 1), 1)
    );
    const key = date.toISOString().slice(0, 7);
    return {
      key,
      label: date.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }),
      count: 0
    };
  });

  const map = new Map(months.map((entry) => [entry.key, entry]));
  items.forEach((item) => {
    const date = new Date(dateSelector(item));
    if (Number.isNaN(date.getTime())) return;
    const key = date.toISOString().slice(0, 7);
    const bucket = map.get(key);
    if (bucket) bucket.count += 1;
  });

  return months.map((entry) => ({ label: entry.label, count: entry.count }));
};

const mapJobSummary = (job = {}) => ({
  _id: String(job._id || ''),
  title: String(job.title || ''),
  stack: String(job.stack || ''),
  status: String(job.status || ''),
  location: String(job.location || ''),
  employmentType: String(job.employmentType || ''),
  requiredSkills: Array.isArray(job.requiredSkills) ? job.requiredSkills : [],
  preferredSkills: Array.isArray(job.preferredSkills) ? job.preferredSkills : [],
  updatedAt: job.updatedAt,
  createdAt: job.createdAt
});

const countTeamRecruiters = async ({ recruiterId, organizationId, teamIds = [] }) => {
  if (!teamIds.length) {
    return User.countDocuments({ organizationId, role: 'recruiter', isActive: true });
  }

  const memberships = await Membership.find({
    organizationId,
    teamId: { $in: teamIds },
    status: 'active'
  })
    .select('userId')
    .lean();

  const recruiterIds = [
    ...new Set(memberships.map((entry) => String(entry.userId || '')).filter(Boolean))
  ];
  if (!recruiterIds.includes(String(recruiterId))) recruiterIds.push(String(recruiterId));

  return User.countDocuments({
    _id: { $in: recruiterIds },
    organizationId,
    role: 'recruiter',
    isActive: true
  });
};

const listRecruiterAnalytics = async (req, scope) => {
  scope ??= await getRecruiterScope(req);
  const { recruiterId, organizationId, sessionRevision, teams, teamIds } = scope;
  const [jobs, matches, shortlists, logs, teamRecruiters] = await Promise.all([
    Job.find({ recruiterId, organizationId }).lean(),
    RecruiterMatch.find({ recruiterId, organizationId })
      .select('candidateId jobId matchScore confidenceScore status breakdown updatedAt createdAt')
      .lean(),
    RecruiterShortlist.find({ recruiterId, organizationId }).lean(),
    AuditLog.find({ actor: recruiterId, organizationId })
      .select('action method route statusCode timestamp')
      .sort({ timestamp: -1 })
      .limit(500)
      .lean(),
    countTeamRecruiters({ recruiterId, organizationId, teamIds })
  ]);

  const { candidates, ...population } = await readCandidateAnalytics({
    organizationId,
    recruiterId,
    sessionRevision,
    jobs
  });
  const totalCandidates = population.total;
  const allDemandSkills = jobs.flatMap((job) => [
    ...(job.requiredSkills || []),
    ...(job.preferredSkills || [])
  ]);

  const byRecent = (left, right) =>
    new Date(right.updatedAt || right.createdAt || 0) -
    new Date(left.updatedAt || left.createdAt || 0);
  const jobById = new Map(jobs.map((job) => [String(job._id), mapJobSummary(job)]));
  const recentMatchRows = [...matches].sort(byRecent).slice(0, 5);
  const followUpRows = shortlists
    .filter((entry) => ['shortlisted', 'reviewing', 'contacted'].includes(entry.status))
    .sort(byRecent)
    .slice(0, 6);
  const visible = await getRecruiterCandidatesByIds(
    [...recentMatchRows, ...followUpRows].map((item) => item.candidateId),
    organizationId
  );
  const recentMatches = recentMatchRows
    .filter((match) => visible.get(String(match.candidateId)) && jobById.has(String(match.jobId)))
    .map((match) => ({
      _id: String(match._id || ''),
      candidateId: String(match.candidateId || ''),
      jobId: String(match.jobId || ''),
      matchScore: Number(match.matchScore || 0),
      confidenceScore: Number(match.confidenceScore || 0),
      status: String(match.status || 'generated'),
      candidate: visible.get(String(match.candidateId)),
      job: jobById.get(String(match.jobId)),
      updatedAt: match.updatedAt || match.createdAt
    }));

  const viewed = logs.filter((log) => log.action === 'RECRUITER_CANDIDATE_VIEWED').length;
  const analyzed = logs.filter((log) => log.action === 'RECRUITER_CANDIDATE_ANALYZED').length;
  const successRate =
    matches.length > 0
      ? Math.round(
          (matches.filter((match) => match.status === 'shortlisted').length / matches.length) * 100
        )
      : 0;
  const activityScore = Math.min(
    100,
    viewed * 3 + analyzed * 5 + jobs.length * 4 + shortlists.length * 4 + matches.length * 2
  );

  const summary = await getRecruiterSummary(
    {
      recruiterId,
      organizationId,
      teamIds,
      revision: [
        jobs,
        matches,
        shortlists.length,
        logs,
        totalCandidates,
        teamRecruiters,
        'complete-population-v1',
        population
      ]
    },
    () => ({
      metrics: {
        totalCandidates,
        avgCandidateScore: population.avgCandidateScore,
        openJobs: jobs.filter((job) => job.status === 'open').length,
        draftJobs: jobs.filter((job) => job.status === 'draft').length,
        closedJobs: jobs.filter((job) => job.status === 'closed').length,
        teamRecruiters,
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
        scoreDistribution: population.scoreDistribution,
        candidatesByStack: population.candidatesByStack,
        jobsPostedTrend: bucketByMonth(jobs, (item) => item.createdAt),
        experienceDistribution: population.experienceDistribution,
        topSkillsDemand: topCounts(allDemandSkills, (skill) => skill, 8),
        supplyVsDemand: population.supplyVsDemand,
        candidateActivityTrend: bucketByDay(
          logs.filter((log) => /CANDIDATE_VIEWED|CANDIDATE_ANALYZED/.test(String(log.action))),
          (log) => log.timestamp
        ),
        matchGenerationTrend: bucketByDay(matches, (item) => item.createdAt),
        weeklyRecruiterActivity: bucketByDay(logs, (log) => log.timestamp),
        aiUsageGraph: bucketByDay(
          logs.filter((log) => /ANALYZED|MATCH/.test(String(log.action))),
          (log) => log.timestamp
        ),
        jobPerformanceChart: jobs.map((job) => ({
          label: job.title,
          status: job.status,
          updatedAt: job.updatedAt
        })),
        skillDemandChart: topCounts(
          jobs.flatMap((job) => job.requiredSkills || []),
          (skill) => skill
        )
      }
    })
  );

  return {
    ...summary,
    meta: {
      candidatePopulation: {
        mode: 'exact',
        total: totalCandidates,
        metrics: [
          'totalCandidates',
          'avgCandidateScore',
          'scoreDistribution',
          'candidatesByStack',
          'experienceDistribution',
          'supplyVsDemand'
        ]
      },
      topCandidates: {
        mode: 'bounded',
        poolLimit: CARD_POOL_LIMIT,
        poolSize: candidates.length,
        returned: Math.min(5, candidates.length),
        selection:
          'First 240 discovery score-desc cards, then analytics score descending within that pool; not a population ranking.'
      },
      activity: {
        mode: 'bounded',
        limit: 500,
        returned: logs.length,
        metrics: [
          'candidatesViewed',
          'candidatesAnalyzed',
          'recruiterActivityScore',
          'candidateActivityTrend',
          'weeklyRecruiterActivity',
          'aiUsageGraph'
        ]
      }
    },
    highlights: {
      mostMatchedSkills: topCounts(
        matches.flatMap((match) => match.breakdown?.matchedSkills || []),
        (skill) => skill
      ),
      mostActiveJobs: topCounts(jobs, (job) => job.title),
      recentActivity: logs.slice(0, 10)
    },
    widgets: {
      recentJobs: [...jobs]
        .sort(
          (left, right) =>
            new Date(right.updatedAt || right.createdAt || 0).getTime() -
            new Date(left.updatedAt || left.createdAt || 0).getTime()
        )
        .slice(0, 5)
        .map(mapJobSummary),
      recentMatches,
      pendingFollowUps: followUpRows
        .filter(
          (entry) =>
            visible.get(String(entry.candidateId)) &&
            (!entry.jobId || jobById.has(String(entry.jobId)))
        )
        .map((entry) => ({
          ...entry,
          candidate: visible.get(String(entry.candidateId)),
          job: entry.jobId ? jobById.get(String(entry.jobId)) : null
        })),
      topCandidates: [...candidates]
        .sort(
          (left, right) =>
            Number(right.readinessScore || right.score || 0) -
            Number(left.readinessScore || left.score || 0)
        )
        .slice(0, 5)
    }
  };
};

module.exports = {
  listRecruiterAnalytics
};
