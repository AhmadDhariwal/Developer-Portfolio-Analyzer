/**
 * Super Admin Analytics Service
 * Platform-wide windowing, time-series aggregation, metric registry, and analytics builders.
 */

const mongoose = require('mongoose');
const Organization = require('../../admin/models/organization');
const User = require('../../auth/models/user');
const Job = require('../../recruiter/models/Job');
const Membership = require('../../admin/models/membership');
const Team = require('../../admin/models/team');
const Analysis = require('../../skill-gap/models/analysis');
const ResumeAnalysis = require('../../resume/models/resumeAnalysis');
const Recommendation = require('../../recommendations/models/recommendation');
const AuditLog = require('../../admin/models/auditLog');
const { CANDIDATE_ANALYZED } = require('../../recruiter/services/hub/recruiterReportingService');
const { registry } = require('../../../core/observability/metricsService');

const getMonthlyRange = () => {
  const now = new Date();
  const months = [];
  for (let i = 11; i >= 0; i--) {
    const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
    months.push({
      start,
      end,
      label: start.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
    });
  }
  return months;
};

const countMonthly = async (Model, filter = {}, months) =>
  Promise.all(
    months.map((m) =>
      Model.countDocuments({ ...filter, createdAt: { $gte: m.start, $lt: m.end } }).catch(() => 0)
    )
  );

const toObjectId = (value) => {
  try {
    return value ? new mongoose.Types.ObjectId(String(value)) : null;
  } catch {
    return null;
  }
};

const parseDate = (value, fallback = null) => {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date;
};

const buildAnalyticsWindow = (query = {}) => {
  const end = parseDate(query.dateTo, new Date());
  const start = parseDate(query.dateFrom, null);
  const defaultStart = new Date(end.getTime() - 29 * 24 * 60 * 60 * 1000);
  const effectiveStart = start || defaultStart;
  const spanDays = Math.max(
    1,
    Math.ceil((end.getTime() - effectiveStart.getTime()) / (24 * 60 * 60 * 1000)) + 1
  );
  const granularity = spanDays <= 62 ? 'day' : 'month';
  const compareEnd = new Date(effectiveStart.getTime() - 24 * 60 * 60 * 1000);
  const compareStart = new Date(compareEnd.getTime() - (spanDays - 1) * 24 * 60 * 60 * 1000);

  return {
    start: effectiveStart,
    end,
    compareStart,
    compareEnd,
    spanDays,
    granularity
  };
};

const buildBuckets = (start, end, granularity) => {
  const buckets = [];
  const cursor = new Date(start);

  if (granularity === 'month') {
    cursor.setDate(1);
    while (cursor <= end) {
      const bucketStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
      const bucketEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
      buckets.push({
        key: bucketStart.toISOString().slice(0, 7),
        label: bucketStart.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
        start: bucketStart,
        end: bucketEnd
      });
      cursor.setMonth(cursor.getMonth() + 1);
    }
    return buckets;
  }

  while (cursor <= end) {
    const bucketStart = new Date(cursor);
    bucketStart.setHours(0, 0, 0, 0);
    const bucketEnd = new Date(bucketStart);
    bucketEnd.setDate(bucketEnd.getDate() + 1);
    buckets.push({
      key: bucketStart.toISOString().slice(0, 10),
      label: bucketStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      start: bucketStart,
      end: bucketEnd
    });
    cursor.setDate(cursor.getDate() + 1);
  }

  return buckets;
};

const buildDateMatch = (field, start, end) => ({
  [field]: { $gte: start, $lte: end }
});

const buildUserScopeMatch = (filters = {}) => {
  const match = {};
  const organizationId = toObjectId(filters.organizationId);
  if (organizationId) match.organizationId = organizationId;
  if (filters.role) match.role = filters.role;
  if (filters.stack && filters.role !== 'admin' && filters.role !== 'recruiter') {
    match.careerStack = filters.stack;
  } else if (filters.stack && !filters.role) {
    match.careerStack = filters.stack;
  }
  return match;
};

const buildUserMatchExpr = (filters = {}) => {
  const clauses = [];
  const organizationId = toObjectId(filters.organizationId);
  if (organizationId) clauses.push({ $eq: ['$organizationId', organizationId] });
  if (filters.role) clauses.push({ $eq: ['$role', filters.role] });
  if (filters.stack) clauses.push({ $eq: ['$careerStack', filters.stack] });
  return clauses;
};

const buildTimeSeries = async (Model, match, buckets, field = 'createdAt') => {
  if (!buckets.length) return [];
  const result = await Model.aggregate([
    {
      $match: {
        ...match,
        [field]: { $gte: buckets[0].start, $lte: buckets[buckets.length - 1].end }
      }
    },
    {
      $group: {
        _id: {
          $dateToString: {
            format: buckets[0].key.length === 7 ? '%Y-%m' : '%Y-%m-%d',
            date: `$${field}`
          }
        },
        count: { $sum: 1 }
      }
    }
  ]).catch(() => []);

  const counts = new Map(result.map((entry) => [entry._id, entry.count]));
  return buckets.map((bucket) => counts.get(bucket.key) || 0);
};

const collectUserIds = async (filters = {}) => {
  const match = buildUserScopeMatch(filters);
  const users = await User.aggregate([
    { $match: match },
    {
      $project: {
        _id: 1,
        name: 1,
        email: 1,
        role: 1,
        careerStack: 1,
        score: 1,
        isActive: 1,
        organizationId: 1,
        createdAt: 1,
        bio: 1,
        githubUsername: 1,
        linkedin: 1,
        website: 1,
        location: 1,
        jobTitle: 1
      }
    }
  ]).catch(() => []);

  return { users, userIds: users.map((user) => user._id) };
};

const getProfileCompletion = (user) => {
  const fields = [
    user?.name,
    user?.email,
    user?.bio,
    user?.githubUsername,
    user?.linkedin,
    user?.website,
    user?.location,
    user?.jobTitle,
    user?.careerStack,
    user?.experienceLevel
  ];
  const completed = fields.filter((value) => String(value || '').trim().length > 0).length;
  return Math.round((completed / fields.length) * 100);
};

const buildMetricTrend = (current, previous) => {
  if (!previous) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / Math.max(previous, 1)) * 100);
};

const getMetricRegistrySnapshot = async () => {
  const metrics = await registry.getMetricsAsJSON().catch(() => []);
  const metricMap = new Map(metrics.map((metric) => [metric.name, metric]));

  const requests = metricMap.get('dpa_http_requests_total');
  const errors = metricMap.get('dpa_http_errors_total');
  const duration = metricMap.get('dpa_http_request_duration_ms');

  const totalRequests = (requests?.values || []).reduce(
    (sum, row) => sum + Number(row.value || 0),
    0
  );
  const failedRequests = (errors?.values || []).reduce(
    (sum, row) => sum + Number(row.value || 0),
    0
  );
  const avgResponseTime = (() => {
    const sum =
      (duration?.values || []).find((row) => row.metricName?.endsWith('_sum'))?.value || 0;
    const count =
      (duration?.values || []).find((row) => row.metricName?.endsWith('_count'))?.value || 0;
    return count > 0 ? Math.round((Number(sum) / Number(count)) * 100) / 100 : 0;
  })();
  const responseBuckets = (duration?.values || []).filter((row) => row.labels?.le);
  const percentile95 = (() => {
    if (!responseBuckets.length) return 0;
    const sorted = responseBuckets
      .map((row) => ({
        upper: row.labels.le === '+Inf' ? Number.POSITIVE_INFINITY : Number(row.labels.le),
        value: Number(row.value || 0)
      }))
      .sort((a, b) => a.upper - b.upper);
    const threshold = totalRequests * 0.95;
    const match = sorted.find(
      (bucket) => bucket.value >= threshold && Number.isFinite(bucket.upper)
    );
    return match ? Math.round(match.upper) : 0;
  })();

  return {
    totalRequests,
    failedRequests,
    errorRate: totalRequests > 0 ? Math.round((failedRequests / totalRequests) * 1000) / 10 : 0,
    avgResponseTime,
    p95ResponseTime: percentile95
  };
};

const mapRecentOrganization = (org) => ({
  id: org._id,
  title: org.name,
  meta: org.ownerId?.name || org.ownerId?.email || 'No owner assigned',
  status: org.isSuspended ? 'Suspended' : 'Active',
  createdAt: org.createdAt,
  tone: org.isSuspended ? 'red' : 'green'
});

const mapRecentInvite = (invite) => ({
  id: invite._id,
  title: invite.email,
  meta: `${invite.organizationId?.name || 'Organization'} - ${invite.role || 'member'}`,
  status: invite.status || 'pending',
  createdAt: invite.createdAt,
  tone: invite.status === 'accepted' ? 'green' : invite.status === 'revoked' ? 'red' : 'blue'
});

const mapRecentDeveloper = (user) => ({
  id: user._id,
  title: user.name,
  meta: `${user.careerStack || 'Unspecified stack'} - ${user.experienceLevel || 'Developer'}`,
  status: user.isActive === false ? 'Inactive' : 'Active',
  createdAt: user.createdAt,
  tone: user.isActive === false ? 'red' : 'green'
});

const mapRecentAnalysis = (analysis) => ({
  id: analysis._id,
  title: analysis.userId?.name || 'AI analysis generated',
  meta: `${analysis.userId?.careerStack || 'Unknown stack'} - Score ${Number(analysis.githubScore || analysis.readinessScore || 0)}`,
  status: 'Generated',
  createdAt: analysis.createdAt,
  tone: 'indigo'
});

const getPlatformAnalyticsData = async (query = {}) => {
  const filters = {
    organizationId: String(query.organizationId || '').trim(),
    stack: String(query.stack || '').trim(),
    role: String(query.role || '').trim(),
    dateFrom: query.dateFrom,
    dateTo: query.dateTo
  };

  const analyticsWindow = buildAnalyticsWindow(query);
  const currentBuckets = buildBuckets(
    analyticsWindow.start,
    analyticsWindow.end,
    analyticsWindow.granularity
  );
  const monthlyBuckets = buildBuckets(
    new Date(analyticsWindow.end.getFullYear(), analyticsWindow.end.getMonth() - 11, 1),
    analyticsWindow.end,
    'month'
  );
  const selectedOrgId = toObjectId(filters.organizationId);
  const userMatch = buildUserScopeMatch(filters);
  const { users: scopedUsers, userIds } = await collectUserIds(filters);
  const activeScopedUsers = scopedUsers.filter((user) => user.isActive !== false);
  const developerUsers = scopedUsers.filter((user) => user.role === 'developer');
  const recruiterUsers = scopedUsers.filter((user) => user.role === 'recruiter');
  const adminUsers = scopedUsers.filter((user) => ['admin', 'super_admin'].includes(user.role));
  const recruiterIds = recruiterUsers.map((user) => user._id);
  const developerIds = developerUsers.map((user) => user._id);
  const userIdFilter = userIds.length ? { $in: userIds } : { $in: [] };
  const recruiterIdFilter = recruiterIds.length ? { $in: recruiterIds } : { $in: [] };
  const developerIdFilter = developerIds.length ? { $in: developerIds } : { $in: [] };
  const healthSnapshot = await getMetricRegistrySnapshot();

  const [
    analysisAllTimeCount,
    resumeAllTimeCount,
    recommendationAllTimeCount,
    candidateAllTimeCount,
    jobAllTimeCount
  ] = await Promise.all([
    Analysis.countDocuments({ userId: userIdFilter }),
    ResumeAnalysis.countDocuments({ userId: userIdFilter }),
    Analysis.aggregate([
      { $match: { userId: userIdFilter } },
      {
        $project: {
          recommendationCount: {
            $size: {
              $ifNull: ['$recommendations', []]
            }
          }
        }
      },
      { $group: { _id: null, total: { $sum: '$recommendationCount' } } }
    ])
      .then((rows) => rows[0]?.total || 0)
      .catch(() => 0),
    AuditLog.countDocuments({
      action: CANDIDATE_ANALYZED,
      ...(selectedOrgId && { organizationId: selectedOrgId })
    }),
    Job.countDocuments(selectedOrgId ? { organizationId: selectedOrgId } : {})
  ]);

  const previousPeriodOrganizationCount = await Organization.countDocuments({
    ...(selectedOrgId ? { _id: selectedOrgId } : {}),
    createdAt: { $gte: analyticsWindow.compareStart, $lte: analyticsWindow.compareEnd }
  });
  const currentPeriodOrganizationCount = await Organization.countDocuments({
    ...(selectedOrgId ? { _id: selectedOrgId } : {}),
    createdAt: { $gte: analyticsWindow.start, $lte: analyticsWindow.end }
  });
  const platformGrowthPct = buildMetricTrend(
    currentPeriodOrganizationCount,
    previousPeriodOrganizationCount
  );

  const [
    totalOrganizations,
    orgTotalsByWindow,
    topOrganizations,
    teamSummary,
    topStacks,
    mostActiveDevelopers,
    dailyGitHubTrend,
    monthlyGitHubTrend,
    dailyResumeTrend,
    monthlyResumeTrend,
    dailyRecommendationTrend,
    monthlyRecommendationTrend,
    analysisCurrentCount,
    analysisPreviousCount,
    resumeCurrentCount,
    resumePreviousCount,
    recommendationCurrentCount,
    recommendationPreviousCount,
    candidateCurrentCount,
    candidatePreviousCount,
    jobCurrentCount,
    jobPreviousCount,
    activeRecruiterCount,
    organizationTotalMembers,
    jobByOrganization
  ] = await Promise.all([
    selectedOrgId
      ? Organization.countDocuments({ _id: selectedOrgId })
      : Organization.countDocuments({}),
    Organization.countDocuments({
      ...(selectedOrgId ? { _id: selectedOrgId } : {}),
      createdAt: { $gte: analyticsWindow.start, $lte: analyticsWindow.end }
    }),
    Membership.aggregate([
      {
        $match: { status: 'active', ...(selectedOrgId ? { organizationId: selectedOrgId } : {}) }
      },
      {
        $group: {
          _id: '$organizationId',
          memberCount: { $sum: 1 },
          adminCount: { $sum: { $cond: [{ $eq: ['$role', 'admin'] }, 1, 0] } },
          teamCount: { $sum: { $cond: [{ $ne: ['$teamId', null] }, 1, 0] } }
        }
      },
      {
        $lookup: {
          from: 'organizations',
          localField: '_id',
          foreignField: '_id',
          as: 'organization'
        }
      },
      { $unwind: '$organization' },
      { $sort: { memberCount: -1 } },
      { $limit: 5 },
      {
        $project: {
          _id: 1,
          name: '$organization.name',
          isSuspended: '$organization.isSuspended',
          createdAt: '$organization.createdAt',
          memberCount: 1,
          adminCount: 1,
          teamCount: 1
        }
      }
    ]).catch(() => []),
    Team.aggregate([
      { $match: selectedOrgId ? { organizationId: selectedOrgId } : {} },
      { $group: { _id: null, totalTeams: { $sum: 1 } } }
    ]).catch(() => []),
    User.aggregate([
      { $match: { ...userMatch, role: 'developer' } },
      {
        $group: {
          _id: '$careerStack',
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1 } },
      { $limit: 5 }
    ]).catch(() => []),
    Analysis.aggregate([
      {
        $lookup: {
          from: 'users',
          localField: 'userId',
          foreignField: '_id',
          as: 'user'
        }
      },
      { $unwind: '$user' },
      {
        $match: {
          ...(selectedOrgId ? { 'user.organizationId': selectedOrgId } : {}),
          ...(filters.role ? { 'user.role': filters.role } : {}),
          ...(filters.stack ? { 'user.careerStack': filters.stack } : {})
        }
      },
      { $sort: { githubScore: -1, readinessScore: -1, createdAt: -1 } },
      { $limit: 5 },
      {
        $project: {
          _id: 1,
          name: '$user.name',
          email: '$user.email',
          careerStack: '$user.careerStack',
          githubScore: 1,
          readinessScore: 1,
          score: '$user.score',
          createdAt: 1
        }
      }
    ]).catch(() => []),
    buildTimeSeries(Analysis, { userId: userIdFilter }, currentBuckets),
    buildTimeSeries(Analysis, { userId: userIdFilter }, monthlyBuckets),
    buildTimeSeries(ResumeAnalysis, { userId: userIdFilter }, currentBuckets),
    buildTimeSeries(ResumeAnalysis, { userId: userIdFilter }, monthlyBuckets),
    buildTimeSeries(Recommendation, { userId: userIdFilter }, currentBuckets),
    buildTimeSeries(Recommendation, { userId: userIdFilter }, monthlyBuckets),
    Analysis.countDocuments({
      userId: userIdFilter,
      createdAt: { $gte: analyticsWindow.start, $lte: analyticsWindow.end }
    }),
    Analysis.countDocuments({
      userId: userIdFilter,
      createdAt: { $gte: analyticsWindow.compareStart, $lte: analyticsWindow.compareEnd }
    }),
    ResumeAnalysis.countDocuments({
      userId: userIdFilter,
      createdAt: { $gte: analyticsWindow.start, $lte: analyticsWindow.end }
    }),
    ResumeAnalysis.countDocuments({
      userId: userIdFilter,
      createdAt: { $gte: analyticsWindow.compareStart, $lte: analyticsWindow.compareEnd }
    }),
    Recommendation.countDocuments({
      userId: userIdFilter,
      createdAt: { $gte: analyticsWindow.start, $lte: analyticsWindow.end }
    }),
    Recommendation.countDocuments({
      userId: userIdFilter,
      createdAt: { $gte: analyticsWindow.compareStart, $lte: analyticsWindow.compareEnd }
    }),
    AuditLog.countDocuments({
      action: CANDIDATE_ANALYZED,
      actor: recruiterIdFilter,
      ...(selectedOrgId && { organizationId: selectedOrgId }),
      timestamp: { $gte: analyticsWindow.start, $lte: analyticsWindow.end }
    }),
    AuditLog.countDocuments({
      action: CANDIDATE_ANALYZED,
      actor: recruiterIdFilter,
      ...(selectedOrgId && { organizationId: selectedOrgId }),
      timestamp: { $gte: analyticsWindow.compareStart, $lte: analyticsWindow.compareEnd }
    }),
    Job.countDocuments({
      recruiterId: recruiterIdFilter,
      ...(selectedOrgId && { organizationId: selectedOrgId }),
      createdAt: { $gte: analyticsWindow.start, $lte: analyticsWindow.end }
    }),
    Job.countDocuments({
      recruiterId: recruiterIdFilter,
      ...(selectedOrgId && { organizationId: selectedOrgId }),
      createdAt: { $gte: analyticsWindow.compareStart, $lte: analyticsWindow.compareEnd }
    }),
    User.countDocuments({ ...userMatch, role: 'recruiter', isActive: true }),
    Membership.aggregate([
      {
        $match: { status: 'active', ...(selectedOrgId ? { organizationId: selectedOrgId } : {}) }
      },
      { $group: { _id: '$organizationId', memberCount: { $sum: 1 } } }
    ]).catch(() => []),
    Job.aggregate([
      { $match: { ...(selectedOrgId ? { organizationId: selectedOrgId } : {}) } },
      {
        $group: {
          _id: '$organizationId',
          totalJobs: { $sum: 1 },
          openJobs: { $sum: { $cond: [{ $eq: ['$status', 'open'] }, 1, 0] } },
          closedJobs: { $sum: { $cond: [{ $eq: ['$status', 'closed'] }, 1, 0] } }
        }
      }
    ]).catch(() => [])
  ]);

  const totalAdmins = adminUsers.length;
  const totalRecruiters = recruiterUsers.length;
  const totalDevelopers = developerUsers.length;
  const activeUsers = activeScopedUsers.length;
  const activeAdmins = adminUsers.filter((user) => user.isActive !== false).length;
  const topDevelopers = mostActiveDevelopers.map((entry) => ({
    ...entry,
    profileCompletion: getProfileCompletion(entry)
  }));
  const stackLabels = topStacks.map((entry) => entry._id || 'Unspecified');
  const stackCounts = topStacks.map((entry) => entry.count || 0);
  const profileCompletionAvg = developerUsers.length
    ? Math.round(
        developerUsers.reduce((sum, user) => sum + getProfileCompletion(user), 0) /
          developerUsers.length
      )
    : 0;
  const recruiterSuccessJobs = jobByOrganization.reduce(
    (sum, entry) => sum + Number(entry.closedJobs || 0),
    0
  );
  const recruiterTotalJobs = jobByOrganization.reduce(
    (sum, entry) => sum + Number(entry.totalJobs || 0),
    0
  );
  const hiringSuccessPct =
    recruiterTotalJobs > 0 ? Math.round((recruiterSuccessJobs / recruiterTotalJobs) * 100) : 0;
  const recruiterProductivity = topOrganizations.map((organization) => {
    const jobRow = jobByOrganization.find((row) => String(row._id) === String(organization._id));
    const jobs = Number(jobRow?.totalJobs || 0);
    const openJobs = Number(jobRow?.openJobs || 0);
    return {
      ...organization,
      productivityScore: Math.max(
        0,
        Math.round(
          (Number(organization.memberCount || 0) + jobs) /
            Math.max(Number(organization.adminCount || 1), 1)
        )
      ),
      jobs,
      openJobs
    };
  });

  const organizationGrowthPct = buildMetricTrend(
    orgTotalsByWindow,
    previousPeriodOrganizationCount
  );
  const activeRecruiterGrowth = buildMetricTrend(activeRecruiterCount, 0);
  const developerActivityGrowth = buildMetricTrend(analysisCurrentCount, analysisPreviousCount);
  const resumeGrowthPct = buildMetricTrend(resumeCurrentCount, resumePreviousCount);
  const recommendationGrowthPct = buildMetricTrend(
    recommendationCurrentCount,
    recommendationPreviousCount
  );
  const candidateGrowthPct = buildMetricTrend(candidateCurrentCount, candidatePreviousCount);

  return {
    filters,
    summary: {
      platformOverview: {
        totalOrganizations,
        totalAdmins,
        totalRecruiters,
        totalDevelopers,
        activeUsers,
        platformGrowthPct,
        organizationGrowthPct
      },
      aiUsage: {
        githubAnalyses: analysisAllTimeCount,
        resumeAnalyses: resumeAllTimeCount,
        recommendationsGenerated: recommendationAllTimeCount,
        githubTrendPct: developerActivityGrowth,
        resumeTrendPct: resumeGrowthPct,
        recommendationTrendPct: recommendationGrowthPct
      },
      recruiterPerformance: {
        activeRecruiters: activeRecruiterCount,
        candidatesAnalyzed: candidateAllTimeCount,
        matchesGenerated: Math.max(
          candidateAllTimeCount,
          recommendationAllTimeCount,
          jobAllTimeCount
        ),
        hiringSuccessPct,
        trendPct: candidateGrowthPct
      },
      organizationPerformance: {
        topOrganizations: recruiterProductivity,
        recruiterProductivity,
        teamActivity: teamSummary[0]?.totalTeams || 0,
        organizationGrowthPct
      },
      developerInsights: {
        topStacks: stackLabels.map((label, index) => ({
          stack: label,
          count: stackCounts[index]
        })),
        mostActiveDevelopers: topDevelopers,
        profileCompletionPct: profileCompletionAvg,
        githubActivityTrendPct: developerActivityGrowth
      },
      systemHealth: {
        avgResponseTimeMs: healthSnapshot.avgResponseTime,
        p95ResponseTimeMs: healthSnapshot.p95ResponseTime,
        serverUptimeHours: Math.round((process.uptime() / 60 / 60) * 10) / 10,
        failedRequests: healthSnapshot.failedRequests,
        errorRatePct: healthSnapshot.errorRate,
        totalRequests: healthSnapshot.totalRequests
      }
    },
    trends: {
      platformGrowthPct,
      organizationGrowthPct,
      aiUsage: developerActivityGrowth,
      recruiterPerformance: candidateGrowthPct,
      developerActivity: developerActivityGrowth
    },
    comparisons: {
      platformOverview: {
        current: currentPeriodOrganizationCount,
        previous: previousPeriodOrganizationCount,
        deltaPct: platformGrowthPct
      },
      aiUsage: {
        current: analysisCurrentCount,
        previous: analysisPreviousCount,
        deltaPct: developerActivityGrowth
      },
      resumeUsage: {
        current: resumeCurrentCount,
        previous: resumePreviousCount,
        deltaPct: resumeGrowthPct
      },
      recommendations: {
        current: recommendationCurrentCount,
        previous: recommendationPreviousCount,
        deltaPct: recommendationGrowthPct
      },
      recruiterPerformance: {
        current: candidateCurrentCount,
        previous: candidatePreviousCount,
        deltaPct: candidateGrowthPct
      }
    },
    charts: {
      platformGrowth: {
        labels: currentBuckets.map((bucket) => bucket.label),
        organizations: await buildTimeSeries(
          Organization,
          selectedOrgId ? { _id: selectedOrgId } : {},
          currentBuckets
        ),
        admins: await buildTimeSeries(User, { ...userMatch, role: 'admin' }, currentBuckets),
        recruiters: await buildTimeSeries(
          User,
          { ...userMatch, role: 'recruiter' },
          currentBuckets
        ),
        developers: await buildTimeSeries(User, { ...userMatch, role: 'developer' }, currentBuckets)
      },
      aiUsageDaily: {
        labels: currentBuckets.map((bucket) => bucket.label),
        githubAnalyses: dailyGitHubTrend,
        resumeAnalyses: dailyResumeTrend,
        recommendations: dailyRecommendationTrend
      },
      aiUsageMonthly: {
        labels: monthlyBuckets.map((bucket) => bucket.label),
        githubAnalyses: monthlyGitHubTrend,
        resumeAnalyses: monthlyResumeTrend,
        recommendations: monthlyRecommendationTrend
      },
      recruiterPerformance: {
        labels: ['Active recruiters', 'Candidates analyzed', 'Matches generated'],
        values: [
          activeRecruiterCount,
          candidateCurrentCount,
          Math.max(candidateCurrentCount, recommendationCurrentCount)
        ]
      },
      organizationPerformance: {
        labels: recruiterProductivity.map((org) => org.name),
        memberCounts: recruiterProductivity.map((org) => org.memberCount || 0),
        productivityScores: recruiterProductivity.map((org) => org.productivityScore || 0)
      },
      developerInsights: {
        labels: stackLabels,
        stackCounts,
        profileCompletion: profileCompletionAvg,
        activityScores: topDevelopers.map((developer) => Number(developer.githubScore || 0))
      },
      systemHealth: {
        labels: ['Avg response', 'P95 response', 'Failed requests', 'Error rate'],
        values: [
          healthSnapshot.avgResponseTime,
          healthSnapshot.p95ResponseTime,
          healthSnapshot.failedRequests,
          healthSnapshot.errorRate
        ]
      }
    }
  };
};

module.exports = {
  getMonthlyRange,
  countMonthly,
  toObjectId,
  parseDate,
  buildAnalyticsWindow,
  buildBuckets,
  buildDateMatch,
  buildUserScopeMatch,
  buildUserMatchExpr,
  buildTimeSeries,
  collectUserIds,
  getProfileCompletion,
  buildMetricTrend,
  getMetricRegistrySnapshot,
  mapRecentOrganization,
  mapRecentInvite,
  mapRecentDeveloper,
  mapRecentAnalysis,
  getPlatformAnalyticsData
};
