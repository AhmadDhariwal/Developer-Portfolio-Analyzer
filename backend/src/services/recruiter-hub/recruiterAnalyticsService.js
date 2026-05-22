const Job = require('../../models/Job');
const RecruiterMatch = require('../../models/RecruiterMatch');
const RecruiterShortlist = require('../../models/RecruiterShortlist');
const AuditLog = require('../../models/auditLog');
const Membership = require('../../models/membership');
const User = require('../../models/user');
const { listRecruiterCandidates, getRecruiterCandidateDetails } = require('./candidateService');
const { getRecruiterScope } = require('../../utils/recruiter-hub/recruiterAccess');
const { bucketByDay, topCounts } = require('../../utils/recruiter-hub/recruiterAnalyticsBuilder');

const average = (values = []) => {
  const numeric = values.map((value) => Number(value || 0)).filter((value) => Number.isFinite(value));
  if (!numeric.length) return 0;
  return Math.round((numeric.reduce((sum, value) => sum + value, 0) / numeric.length) * 10) / 10;
};

const bucketByMonth = (items = [], dateSelector, count = 6) => {
  const now = new Date();
  const months = Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (count - index - 1), 1));
    const key = date.toISOString().slice(0, 7);
    return {
      key,
      label: date.toLocaleString('en-US', { month: 'short' }),
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

const buildScoreDistribution = (candidates = []) => {
  const buckets = [
    { label: '90-100', min: 90, max: 100, count: 0 },
    { label: '80-89', min: 80, max: 89.999, count: 0 },
    { label: '70-79', min: 70, max: 79.999, count: 0 },
    { label: '60-69', min: 60, max: 69.999, count: 0 },
    { label: 'Below 60', min: -Infinity, max: 59.999, count: 0 }
  ];

  candidates.forEach((candidate) => {
    const score = Number(candidate.readinessScore || candidate.score || 0);
    const bucket = buckets.find((entry) => score >= entry.min && score <= entry.max);
    if (bucket) bucket.count += 1;
  });

  return buckets;
};

const buildExperienceDistribution = (candidates = []) => {
  const buckets = [
    { label: '0-2 Years', min: 0, max: 2, count: 0 },
    { label: '2-5 Years', min: 2, max: 5, count: 0 },
    { label: '5-8 Years', min: 5, max: 8, count: 0 },
    { label: '8+ Years', min: 8, max: Infinity, count: 0 }
  ];

  candidates.forEach((candidate) => {
    const years = Number(candidate.yearsOfExperience || 0);
    const bucket = buckets.find((entry) => years >= entry.min && years < entry.max);
    if (bucket) bucket.count += 1;
  });

  return buckets;
};

const buildSupplyVsDemand = (candidates = [], jobs = [], limit = 6) => {
  const supplyCounts = new Map();
  const demandCounts = new Map();

  candidates.forEach((candidate) => {
    (candidate.skills || []).forEach((skill) => {
      const key = String(skill || '').trim();
      if (!key) return;
      supplyCounts.set(key, (supplyCounts.get(key) || 0) + 1);
    });
  });

  jobs.forEach((job) => {
    [...(job.requiredSkills || []), ...(job.preferredSkills || [])].forEach((skill) => {
      const key = String(skill || '').trim();
      if (!key) return;
      demandCounts.set(key, (demandCounts.get(key) || 0) + 1);
    });
  });

  const labels = [...new Set([...demandCounts.keys(), ...supplyCounts.keys()])]
    .sort((left, right) => (demandCounts.get(right) || 0) - (demandCounts.get(left) || 0))
    .slice(0, limit);

  return labels.map((label) => ({
    label,
    supply: Number(supplyCounts.get(label) || 0),
    demand: Number(demandCounts.get(label) || 0)
  }));
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
  }).select('userId').lean();

  const recruiterIds = [...new Set(memberships.map((entry) => String(entry.userId || '')).filter(Boolean))];
  if (!recruiterIds.includes(String(recruiterId))) recruiterIds.push(String(recruiterId));

  return User.countDocuments({
    _id: { $in: recruiterIds },
    organizationId,
    role: 'recruiter',
    isActive: true
  });
};

const listRecruiterAnalytics = async (req) => {
  const scope = await getRecruiterScope(req);
  const { recruiterId, organizationId, teams, teamIds } = scope;
  const [jobs, matches, shortlists, logs, candidatesResponse, teamRecruiters] = await Promise.all([
    Job.find({ recruiterId, organizationId }).lean(),
    RecruiterMatch.find({ recruiterId, organizationId }).lean(),
    RecruiterShortlist.find({ recruiterId, organizationId }).lean(),
    AuditLog.find({ actor: recruiterId, organizationId }).sort({ timestamp: -1 }).limit(500).lean(),
    listRecruiterCandidates({ organizationId, query: { limit: 240, sortBy: 'score-desc' } }),
    countTeamRecruiters({ recruiterId, organizationId, teamIds })
  ]);

  const candidates = candidatesResponse?.candidates || [];
  const allDemandSkills = jobs.flatMap((job) => [...(job.requiredSkills || []), ...(job.preferredSkills || [])]);

  const recentMatches = await Promise.all(
    [...matches]
      .sort((left, right) => new Date(right.updatedAt || right.createdAt || 0).getTime() - new Date(left.updatedAt || left.createdAt || 0).getTime())
      .slice(0, 5)
      .map(async (match) => ({
        _id: String(match._id || ''),
        candidateId: String(match.candidateId || ''),
        jobId: String(match.jobId || ''),
        matchScore: Number(match.matchScore || 0),
        confidenceScore: Number(match.confidenceScore || 0),
        status: String(match.status || 'generated'),
        candidate: await getRecruiterCandidateDetails(match.candidateId, organizationId),
        job: mapJobSummary(jobs.find((job) => String(job._id) === String(match.jobId)) || {}),
        updatedAt: match.updatedAt || match.createdAt
      }))
  );

  const viewed = logs.filter((log) => log.action === 'RECRUITER_CANDIDATE_VIEWED').length;
  const analyzed = logs.filter((log) => log.action === 'RECRUITER_CANDIDATE_ANALYZED').length;
  const successRate = matches.length > 0
    ? Math.round((matches.filter((match) => match.status === 'shortlisted').length / matches.length) * 100)
    : 0;
  const activityScore = Math.min(100, viewed * 3 + analyzed * 5 + jobs.length * 4 + shortlists.length * 4 + matches.length * 2);

  return {
    metrics: {
      totalCandidates: candidates.length,
      avgCandidateScore: average(candidates.map((candidate) => candidate.readinessScore || candidate.score || 0)),
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
      scoreDistribution: buildScoreDistribution(candidates),
      candidatesByStack: topCounts(candidates, (candidate) => candidate.stack, 6),
      jobsPostedTrend: bucketByMonth(jobs, (item) => item.createdAt),
      experienceDistribution: buildExperienceDistribution(candidates),
      topSkillsDemand: topCounts(allDemandSkills, (skill) => skill, 8),
      supplyVsDemand: buildSupplyVsDemand(candidates, jobs),
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
    },
    widgets: {
      recentJobs: [...jobs]
        .sort((left, right) => new Date(right.updatedAt || right.createdAt || 0).getTime() - new Date(left.updatedAt || left.createdAt || 0).getTime())
        .slice(0, 5)
        .map(mapJobSummary),
      recentMatches,
      pendingFollowUps: shortlists
        .filter((entry) => ['shortlisted', 'reviewing', 'contacted'].includes(String(entry.status || '')))
        .sort((left, right) => new Date(right.updatedAt || right.createdAt || 0).getTime() - new Date(left.updatedAt || left.createdAt || 0).getTime())
        .slice(0, 6),
      topCandidates: [...candidates]
        .sort((left, right) => Number(right.readinessScore || right.score || 0) - Number(left.readinessScore || left.score || 0))
        .slice(0, 5)
    }
  };
};

module.exports = {
  listRecruiterAnalytics
};
