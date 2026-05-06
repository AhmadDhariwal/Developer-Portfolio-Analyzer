const mongoose = require('mongoose');
const Organization = require('../models/organization');
const User = require('../models/user');
const Team = require('../models/team');
const Membership = require('../models/membership');
const Analysis = require('../models/analysis');
const ResumeAnalysis = require('../models/resumeAnalysis');
const Recommendation = require('../models/recommendation');
const Candidate = require('../models/Candidate');
const Job = require('../models/Job');
const Recruiter = require('../models/Recruiter');
const { registry } = require('../services/metricsService');
const bcrypt = require('bcryptjs');

const parsePage = (q) => ({
  page: Math.max(1, parseInt(q.page, 10) || 1),
  limit: Math.min(100, parseInt(q.limit, 10) || 30)
});

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();
const isTruthy = (value) => String(value || '').toLowerCase() === 'true';
const isFalsy = (value) => String(value || '').toLowerCase() === 'false';

const getMonthlyRange = () => {
  const now = new Date();
  const months = [];
  for (let i = 11; i >= 0; i--) {
    const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const end   = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
    months.push({ start, end, label: start.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }) });
  }
  return months;
};

const countMonthly = async (Model, filter = {}, months) =>
  Promise.all(months.map(m =>
    Model.countDocuments({ ...filter, createdAt: { $gte: m.start, $lt: m.end } }).catch(() => 0)
  ));

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
  const spanDays = Math.max(1, Math.ceil((end.getTime() - effectiveStart.getTime()) / (24 * 60 * 60 * 1000)) + 1);
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
    { $match: { ...match, [field]: { $gte: buckets[0].start, $lte: buckets[buckets.length - 1].end } } },
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
    { $project: { _id: 1, name: 1, email: 1, role: 1, careerStack: 1, score: 1, isActive: 1, organizationId: 1, createdAt: 1, bio: 1, githubUsername: 1, linkedin: 1, website: 1, location: 1, jobTitle: 1 } }
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

  const totalRequests = (requests?.values || []).reduce((sum, row) => sum + Number(row.value || 0), 0);
  const failedRequests = (errors?.values || []).reduce((sum, row) => sum + Number(row.value || 0), 0);
  const avgResponseTime = (() => {
    const sum = (duration?.values || []).find((row) => row.metricName?.endsWith('_sum'))?.value || 0;
    const count = (duration?.values || []).find((row) => row.metricName?.endsWith('_count'))?.value || 0;
    return count > 0 ? Math.round((Number(sum) / Number(count)) * 100) / 100 : 0;
  })();
  const responseBuckets = (duration?.values || []).filter((row) => row.labels?.le);
  const percentile95 = (() => {
    if (!responseBuckets.length) return 0;
    const sorted = responseBuckets
      .map((row) => ({ upper: row.labels.le === '+Inf' ? Number.POSITIVE_INFINITY : Number(row.labels.le), value: Number(row.value || 0) }))
      .sort((a, b) => a.upper - b.upper);
    const threshold = totalRequests * 0.95;
    const match = sorted.find((bucket) => bucket.value >= threshold && Number.isFinite(bucket.upper));
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

// ── GET /metrics ─────────────────────────────────────────────────────────────
const getPlatformMetrics = async (req, res) => {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [totalOrgs, totalAdmins, totalRecruiters, totalDevelopers, totalTeams, totalAnalyses, recentOrgs, recentUsers] = await Promise.all([
      Organization.countDocuments(),
      User.countDocuments({ role: 'admin' }),
      User.countDocuments({ role: 'recruiter' }),
      User.countDocuments({ role: 'developer' }),
      Team.countDocuments(),
      Analysis.countDocuments(),
      Organization.countDocuments({ createdAt: { $gte: thirtyDaysAgo } }),
      User.countDocuments({ createdAt: { $gte: thirtyDaysAgo } })
    ]);

    const [latestOrgs, topDevelopers, activeAdmins] = await Promise.all([
      Organization.find().sort({ createdAt: -1 }).limit(5).populate('ownerId', 'name email').lean(),
      User.find({ role: 'developer' }).sort({ score: -1 }).limit(5).select('name email githubUsername score careerStack').lean(),
      User.find({ role: 'admin', isActive: true }).sort({ createdAt: -1 }).limit(5).select('name email organizationId createdAt').lean()
    ]);

    res.json({
      metrics: { totalOrgs, totalAdmins, totalRecruiters, totalDevelopers, totalTeams, totalAnalyses, recentOrgs, recentUsers },
      latestOrgs,
      topDevelopers,
      activeAdmins
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch platform metrics', error: err?.message });
  }
};

// ── GET /dashboard ────────────────────────────────────────────────────────────
const getDashboard = async (req, res) => {
  try {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sixtyDaysAgo  = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
    const months = getMonthlyRange();

    const [
      totalOrgs, totalAdmins, totalRecruiters, totalDevelopers, totalTeams, totalAnalyses,
      recentOrgs, priorOrgs, recentUsers,
      latestOrgs, topDevelopers, activeAdmins
    ] = await Promise.all([
      Organization.countDocuments(),
      User.countDocuments({ role: 'admin' }),
      User.countDocuments({ role: 'recruiter' }),
      User.countDocuments({ role: 'developer' }),
      Team.countDocuments(),
      Analysis.countDocuments(),
      Organization.countDocuments({ createdAt: { $gte: thirtyDaysAgo } }),
      Organization.countDocuments({ createdAt: { $gte: sixtyDaysAgo, $lt: thirtyDaysAgo } }),
      User.countDocuments({ createdAt: { $gte: thirtyDaysAgo } }),
      Organization.find().sort({ createdAt: -1 }).limit(5).populate('ownerId', 'name email').lean(),
      User.find({ role: 'developer' }).sort({ score: -1 }).limit(5).select('name email githubUsername score careerStack experienceLevel').lean(),
      User.find({ role: 'admin', isActive: true }).sort({ createdAt: -1 }).limit(5).select('name email organizationId createdAt').lean()
    ]);

    const platformGrowth = priorOrgs > 0 ? Math.round(((recentOrgs - priorOrgs) / priorOrgs) * 100) : 0;

    const [orgMonthly, adminMonthly, recruiterMonthly, developerMonthly, analysisMonthly] = await Promise.all([
      countMonthly(Organization, {}, months),
      countMonthly(User, { role: 'admin' }, months),
      countMonthly(User, { role: 'recruiter' }, months),
      countMonthly(User, { role: 'developer' }, months),
      countMonthly(Analysis, {}, months)
    ]);

    // Role distribution for pie chart
    const roleDistribution = [
      { role: 'Admins',     count: totalAdmins },
      { role: 'Recruiters', count: totalRecruiters },
      { role: 'Developers', count: totalDevelopers }
    ];

    // Stack distribution
    const stackDist = await User.aggregate([
      { $match: { role: 'developer', careerStack: { $ne: null, $ne: '' } } },
      { $group: { _id: '$careerStack', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]).catch(() => []);

    // Top orgs by member count
    const topOrgs = await Membership.aggregate([
      { $match: { status: 'active' } },
      { $group: { _id: '$organizationId', memberCount: { $sum: 1 } } },
      { $lookup: { from: 'organizations', localField: '_id', foreignField: '_id', as: 'org' } },
      { $unwind: '$org' },
      { $project: { _id: 0, name: '$org.name', memberCount: 1, isSuspended: '$org.isSuspended' } },
      { $sort: { memberCount: -1 } },
      { $limit: 5 }
    ]).catch(() => []);

    res.json({
      metrics: { totalOrgs, totalAdmins, totalRecruiters, totalDevelopers, totalTeams, totalAnalyses, recentOrgs, recentUsers, platformGrowth },
      latestOrgs,
      topDevelopers,
      activeAdmins,
      charts: {
        monthLabels: months.map(m => m.label),
        userGrowth: { organizations: orgMonthly, admins: adminMonthly, recruiters: recruiterMonthly, developers: developerMonthly },
        analysisGrowth: analysisMonthly,
        roleDistribution,
        stackDistribution: stackDist.map(s => ({ stack: s._id, count: s.count })),
        topOrgs
      }
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch dashboard', error: err?.message });
  }
};

// ── GET /analytics ────────────────────────────────────────────────────────────
const getAnalytics = async (req, res) => {
  try {
    const filters = {
      organizationId: String(req.query.organizationId || '').trim(),
      stack: String(req.query.stack || '').trim(),
      role: String(req.query.role || '').trim(),
      dateFrom: req.query.dateFrom,
      dateTo: req.query.dateTo
    };

    const analyticsWindow = buildAnalyticsWindow(req.query);
    const currentBuckets = buildBuckets(analyticsWindow.start, analyticsWindow.end, analyticsWindow.granularity);
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

    const [analysisAllTimeCount, resumeAllTimeCount, recommendationAllTimeCount, candidateAllTimeCount, jobAllTimeCount] = await Promise.all([
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
      ]).then((rows) => rows[0]?.total || 0).catch(() => 0),
      Candidate.countDocuments({}),
      Job.countDocuments({})
    ]);

    const previousPeriodOrganizationCount = await Organization.countDocuments({
      ...(selectedOrgId ? { _id: selectedOrgId } : {}),
      createdAt: { $gte: analyticsWindow.compareStart, $lte: analyticsWindow.compareEnd }
    });
    const currentPeriodOrganizationCount = await Organization.countDocuments({
      ...(selectedOrgId ? { _id: selectedOrgId } : {}),
      createdAt: { $gte: analyticsWindow.start, $lte: analyticsWindow.end }
    });
    const platformGrowthPct = buildMetricTrend(currentPeriodOrganizationCount, previousPeriodOrganizationCount);

    const [totalOrganizations, orgTotalsByWindow, topOrganizations, teamSummary, topStacks, mostActiveDevelopers, dailyGitHubTrend, monthlyGitHubTrend, dailyResumeTrend, monthlyResumeTrend, dailyRecommendationTrend, monthlyRecommendationTrend, analysisCurrentCount, analysisPreviousCount, resumeCurrentCount, resumePreviousCount, recommendationCurrentCount, recommendationPreviousCount, candidateCurrentCount, candidatePreviousCount, jobCurrentCount, jobPreviousCount, activeRecruiterCount, organizationTotalMembers, jobByOrganization] = await Promise.all([
      selectedOrgId ? Organization.countDocuments({ _id: selectedOrgId }) : Organization.countDocuments({}),
      Organization.countDocuments({
        ...(selectedOrgId ? { _id: selectedOrgId } : {}),
        createdAt: { $gte: analyticsWindow.start, $lte: analyticsWindow.end }
      }),
      Membership.aggregate([
        { $match: { status: 'active', ...(selectedOrgId ? { organizationId: selectedOrgId } : {}) } },
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
        { $match: { ...(selectedOrgId ? { 'user.organizationId': selectedOrgId } : {}), ...(filters.role ? { 'user.role': filters.role } : {}), ...(filters.stack ? { 'user.careerStack': filters.stack } : {}) } },
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
      Analysis.countDocuments({ userId: userIdFilter, createdAt: { $gte: analyticsWindow.start, $lte: analyticsWindow.end } }),
      Analysis.countDocuments({ userId: userIdFilter, createdAt: { $gte: analyticsWindow.compareStart, $lte: analyticsWindow.compareEnd } }),
      ResumeAnalysis.countDocuments({ userId: userIdFilter, createdAt: { $gte: analyticsWindow.start, $lte: analyticsWindow.end } }),
      ResumeAnalysis.countDocuments({ userId: userIdFilter, createdAt: { $gte: analyticsWindow.compareStart, $lte: analyticsWindow.compareEnd } }),
      Recommendation.countDocuments({ userId: userIdFilter, createdAt: { $gte: analyticsWindow.start, $lte: analyticsWindow.end } }),
      Recommendation.countDocuments({ userId: userIdFilter, createdAt: { $gte: analyticsWindow.compareStart, $lte: analyticsWindow.compareEnd } }),
      Candidate.countDocuments({ createdBy: recruiterIdFilter, createdAt: { $gte: analyticsWindow.start, $lte: analyticsWindow.end } }),
      Candidate.countDocuments({ createdBy: recruiterIdFilter, createdAt: { $gte: analyticsWindow.compareStart, $lte: analyticsWindow.compareEnd } }),
      Job.countDocuments({ recruiterId: recruiterIdFilter, createdAt: { $gte: analyticsWindow.start, $lte: analyticsWindow.end } }),
      Job.countDocuments({ recruiterId: recruiterIdFilter, createdAt: { $gte: analyticsWindow.compareStart, $lte: analyticsWindow.compareEnd } }),
      User.countDocuments({ ...userMatch, role: 'recruiter', isActive: true }),
      Membership.aggregate([
        { $match: { status: 'active', ...(selectedOrgId ? { organizationId: selectedOrgId } : {}) } },
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
      ? Math.round(developerUsers.reduce((sum, user) => sum + getProfileCompletion(user), 0) / developerUsers.length)
      : 0;
    const recruiterSuccessJobs = jobByOrganization.reduce((sum, entry) => sum + Number(entry.closedJobs || 0), 0);
    const recruiterTotalJobs = jobByOrganization.reduce((sum, entry) => sum + Number(entry.totalJobs || 0), 0);
    const hiringSuccessPct = recruiterTotalJobs > 0 ? Math.round((recruiterSuccessJobs / recruiterTotalJobs) * 100) : 0;
    const recruiterProductivity = topOrganizations.map((organization) => {
      const jobRow = jobByOrganization.find((row) => String(row._id) === String(organization._id));
      const jobs = Number(jobRow?.totalJobs || 0);
      const openJobs = Number(jobRow?.openJobs || 0);
      return {
        ...organization,
        productivityScore: Math.max(0, Math.round((Number(organization.memberCount || 0) + jobs) / Math.max(Number(organization.adminCount || 1), 1))),
        jobs,
        openJobs
      };
    });

    const organizationGrowthPct = buildMetricTrend(orgTotalsByWindow, previousPeriodOrganizationCount);
    const activeRecruiterGrowth = buildMetricTrend(activeRecruiterCount, 0);
    const developerActivityGrowth = buildMetricTrend(analysisCurrentCount, analysisPreviousCount);
    const resumeGrowthPct = buildMetricTrend(resumeCurrentCount, resumePreviousCount);
    const recommendationGrowthPct = buildMetricTrend(recommendationCurrentCount, recommendationPreviousCount);
    const candidateGrowthPct = buildMetricTrend(candidateCurrentCount, candidatePreviousCount);

    res.json({
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
          matchesGenerated: Math.max(candidateAllTimeCount, recommendationAllTimeCount, jobAllTimeCount),
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
          topStacks: stackLabels.map((label, index) => ({ stack: label, count: stackCounts[index] })),
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
          organizations: await buildTimeSeries(Organization, selectedOrgId ? { _id: selectedOrgId } : {}, currentBuckets),
          admins: await buildTimeSeries(User, { ...userMatch, role: 'admin' }, currentBuckets),
          recruiters: await buildTimeSeries(User, { ...userMatch, role: 'recruiter' }, currentBuckets),
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
          values: [activeRecruiterCount, candidateCurrentCount, Math.max(candidateCurrentCount, recommendationCurrentCount)]
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
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch analytics', error: err?.message });
  }
};

// ── GET /organizations ────────────────────────────────────────────────────────
const getAllOrganizations = async (req, res) => {
  try {
    const { page, limit } = parsePage(req.query);
    const filter = {};
    if (req.query.search) filter.name = { $regex: req.query.search, $options: 'i' };
    if (req.query.suspended === 'true') filter.isSuspended = true;
    if (req.query.suspended === 'false') filter.isSuspended = false;

    const [organizations, total] = await Promise.all([
      Organization.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).populate('ownerId', 'name email').lean(),
      Organization.countDocuments(filter)
    ]);
    res.json({ organizations, total, page, totalPages: Math.ceil(total / limit) || 1 });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch organizations', error: err?.message });
  }
};

const suspendOrganization = async (req, res) => {
  try {
    const org = await Organization.findByIdAndUpdate(req.params.id, { isSuspended: true }, { new: true }).lean();
    if (!org) return res.status(404).json({ message: 'Organization not found.' });
    res.json({ organization: org });
  } catch (err) {
    res.status(500).json({ message: 'Failed to suspend organization', error: err?.message });
  }
};

const activateOrganization = async (req, res) => {
  try {
    const org = await Organization.findByIdAndUpdate(req.params.id, { isSuspended: false }, { new: true }).lean();
    if (!org) return res.status(404).json({ message: 'Organization not found.' });
    res.json({ organization: org });
  } catch (err) {
    res.status(500).json({ message: 'Failed to activate organization', error: err?.message });
  }
};

// ── GET /admins ───────────────────────────────────────────────────────────────
const getAllAdmins = async (req, res) => {
  try {
    const { page, limit } = parsePage(req.query);
    const filter = { role: 'admin' };
    if (req.query.search) filter.$or = [{ name: { $regex: req.query.search, $options: 'i' } }, { email: { $regex: req.query.search, $options: 'i' } }];
    if (req.query.organizationId) filter.organizationId = req.query.organizationId;
    if (isTruthy(req.query.active)) filter.isActive = true;
    if (isFalsy(req.query.active)) filter.isActive = false;

    const [admins, total] = await Promise.all([
      User.find(filter).select('-password').populate('organizationId', 'name').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      User.countDocuments(filter)
    ]);
    res.json({ admins, total, page, totalPages: Math.ceil(total / limit) || 1 });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch admins', error: err?.message });
  }
};

// ── GET /recruiters ───────────────────────────────────────────────────────────
const getAllRecruiters = async (req, res) => {
  try {
    const { page, limit } = parsePage(req.query);
    const filter = { role: 'recruiter' };
    if (req.query.search) filter.$or = [{ name: { $regex: req.query.search, $options: 'i' } }, { email: { $regex: req.query.search, $options: 'i' } }];
    if (isTruthy(req.query.active)) filter.isActive = true;
    if (isFalsy(req.query.active)) filter.isActive = false;
    if (req.query.organizationId) {
      const ids = await Membership.find({ organizationId: req.query.organizationId, status: 'active' }).distinct('userId');
      filter._id = { $in: ids };
    }

    const [recruiters, total] = await Promise.all([
      User.find(filter).select('-password').populate('organizationId', 'name').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      User.countDocuments(filter)
    ]);
    res.json({ recruiters, total, page, totalPages: Math.ceil(total / limit) || 1 });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch recruiters', error: err?.message });
  }
};

// ── GET /developers ───────────────────────────────────────────────────────────
const getAllDevelopers = async (req, res) => {
  try {
    const { page, limit } = parsePage(req.query);
    const filter = { role: 'developer' };
    if (req.query.search) filter.$or = [{ name: { $regex: req.query.search, $options: 'i' } }, { email: { $regex: req.query.search, $options: 'i' } }];
    if (req.query.careerStack) filter.careerStack = req.query.careerStack;
    if (req.query.experienceLevel) filter.experienceLevel = req.query.experienceLevel;
    if (isTruthy(req.query.active)) filter.isActive = true;
    if (isFalsy(req.query.active)) filter.isActive = false;
    if (req.query.organizationId) {
      const ids = await Membership.find({ organizationId: req.query.organizationId, status: 'active' }).distinct('userId');
      filter._id = { $in: ids };
    }

    const [developers, total] = await Promise.all([
      User.find(filter).select('-password').sort({ score: -1, createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      User.countDocuments(filter)
    ]);
    res.json({ developers, total, page, totalPages: Math.ceil(total / limit) || 1 });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch developers', error: err?.message });
  }
};

// ── GET /teams ────────────────────────────────────────────────────────────────
const getAllTeams = async (req, res) => {
  try {
    const { page, limit } = parsePage(req.query);
    const filter = {};
    if (req.query.organizationId) filter.organizationId = req.query.organizationId;
    if (req.query.search) filter.name = { $regex: req.query.search, $options: 'i' };

    const [teams, total] = await Promise.all([
      Team.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).populate('organizationId', 'name').lean(),
      Team.countDocuments(filter)
    ]);
    res.json({ teams, total, page, totalPages: Math.ceil(total / limit) || 1 });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch teams', error: err?.message });
  }
};

// ── PATCH /users/:id/toggle-active ───────────────────────────────────────────
const toggleUserActive = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password').lean();
    if (!user) return res.status(404).json({ message: 'User not found.' });
    if (user.role === 'super_admin') return res.status(403).json({ message: 'Cannot deactivate super admin.' });
    const updated = await User.findByIdAndUpdate(req.params.id, { isActive: !user.isActive }, { new: true }).select('-password').lean();
    res.json({ user: updated });
  } catch (err) {
    res.status(500).json({ message: 'Failed to toggle user status', error: err?.message });
  }
};

// ── GET /users/:id (full details) ──────────────────────────────────────────────
const getUserDetails = async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
      .select('-password')
      .populate('organizationId', 'name isSuspended createdAt')
      .lean();

    if (!user) return res.status(404).json({ message: 'User not found.' });

    const memberships = await Membership.find({ userId: user._id, status: 'active' })
      .populate('organizationId', 'name')
      .populate('teamId', 'name')
      .sort({ updatedAt: -1 })
      .lean();

    return res.json({ user, memberships });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to fetch user details', error: err?.message });
  }
};

// ── POST /users (create admin/recruiter/developer) ─────────────────────────────
const createUser = async (req, res) => {
  try {
    const role = String(req.body.role || '').toLowerCase();
    if (!['admin', 'recruiter', 'developer'].includes(role)) {
      return res.status(400).json({ message: 'Invalid role.' });
    }

    const name = String(req.body.name || '').trim();
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || '');
    const organizationId = req.body.organizationId || null;

    if (!name) return res.status(400).json({ message: 'Name is required.' });
    if (!email) return res.status(400).json({ message: 'Email is required.' });
    if (!password || password.length < 6) return res.status(400).json({ message: 'Password must be at least 6 characters.' });

    const existing = await User.findOne({ email }).select('_id').lean();
    if (existing) return res.status(409).json({ message: 'Email already exists.' });

    const hashed = await bcrypt.hash(password, 10);

    const user = await User.create({
      name,
      email,
      password: hashed,
      role,
      isVerified: true,
      isActive: true,
      organizationId: organizationId || null,
      careerStack: req.body.careerStack || undefined,
      experienceLevel: req.body.experienceLevel || undefined
    });

    // Best-effort membership for org-scoped access and filtering
    if (organizationId) {
      const membershipRole = role === 'admin' ? 'admin' : 'member';
      await Membership.updateOne(
        { organizationId, userId: user._id, teamId: null },
        { $setOnInsert: { organizationId, userId: user._id, teamId: null, role: membershipRole, status: 'active', invitedBy: req.user?._id || null } },
        { upsert: true }
      );
    }

    const created = await User.findById(user._id).select('-password').populate('organizationId', 'name').lean();
    return res.status(201).json({ user: created });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to create user', error: err?.message });
  }
};

// ── PATCH /users/:id (edit user) ───────────────────────────────────────────────
const updateUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password').lean();
    if (!user) return res.status(404).json({ message: 'User not found.' });
    if (user.role === 'super_admin') return res.status(403).json({ message: 'Cannot modify super admin.' });

    const update = {};

    if (req.body.name !== undefined) update.name = String(req.body.name || '').trim();
    if (req.body.email !== undefined) update.email = normalizeEmail(req.body.email);
    if (req.body.phoneNumber !== undefined) update.phoneNumber = String(req.body.phoneNumber || '');
    if (req.body.countryCode !== undefined) update.countryCode = String(req.body.countryCode || '');
    if (req.body.githubUsername !== undefined) update.githubUsername = String(req.body.githubUsername || '');
    if (req.body.linkedin !== undefined) update.linkedin = String(req.body.linkedin || '');
    if (req.body.website !== undefined) update.website = String(req.body.website || '');
    if (req.body.bio !== undefined) update.bio = String(req.body.bio || '');
    if (req.body.location !== undefined) update.location = String(req.body.location || '');
    if (req.body.jobTitle !== undefined) update.jobTitle = String(req.body.jobTitle || '');
    if (req.body.careerStack !== undefined) update.careerStack = req.body.careerStack;
    if (req.body.experienceLevel !== undefined) update.experienceLevel = req.body.experienceLevel;
    if (req.body.isActive !== undefined) update.isActive = Boolean(req.body.isActive);

    if (req.body.role !== undefined) {
      const nextRole = String(req.body.role || '').toLowerCase();
      if (!['admin', 'recruiter', 'developer'].includes(nextRole)) {
        return res.status(400).json({ message: 'Invalid role.' });
      }
      update.role = nextRole;
    }

    const nextOrgId = req.body.organizationId === undefined ? user.organizationId : (req.body.organizationId || null);
    update.organizationId = nextOrgId;

    if (req.body.password) {
      const nextPassword = String(req.body.password);
      if (nextPassword.length < 6) return res.status(400).json({ message: 'Password must be at least 6 characters.' });
      update.password = await bcrypt.hash(nextPassword, 10);
    }

    // Ensure email uniqueness on change
    if (update.email && update.email !== user.email) {
      const existing = await User.findOne({ email: update.email }).select('_id').lean();
      if (existing) return res.status(409).json({ message: 'Email already exists.' });
    }

    const updated = await User.findByIdAndUpdate(req.params.id, update, { new: true })
      .select('-password')
      .populate('organizationId', 'name')
      .lean();

    // Best-effort membership sync if org is set
    if (nextOrgId) {
      const effectiveRole = String(updated.role || user.role);
      const membershipRole = effectiveRole === 'admin' ? 'admin' : 'member';
      await Membership.updateOne(
        { organizationId: nextOrgId, userId: updated._id, teamId: null },
        { $setOnInsert: { organizationId: nextOrgId, userId: updated._id, teamId: null, role: membershipRole, status: 'active', invitedBy: req.user?._id || null } },
        { upsert: true }
      );
    }

    return res.json({ user: updated });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to update user', error: err?.message });
  }
};

module.exports = {
  getPlatformMetrics, getDashboard, getAnalytics,
  getAllOrganizations, suspendOrganization, activateOrganization,
  getAllAdmins, getAllRecruiters, getAllDevelopers, getAllTeams,
  toggleUserActive, getUserDetails, createUser, updateUser
};
