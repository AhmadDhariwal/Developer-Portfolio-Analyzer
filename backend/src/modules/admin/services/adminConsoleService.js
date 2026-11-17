/**
 * Admin Console Service
 * Organization-scoped team hydration, performance aggregation, and cache helpers.
 */

const User = require('../../auth/models/user');
const Team = require('../models/team');
const Membership = require('../models/membership');
const Invitation = require('../models/invitation');
const AuditLog = require('../models/auditLog');
const Job = require('../../recruiter/models/Job');
const Candidate = require('../../recruiter/models/Candidate');

// ── helpers ───────────────────────────────────────────────────────────────
const clamp = (v, min = 0, max = 100) => Math.max(min, Math.min(max, Number(v || 0)));
const DEFAULT_DASHBOARD_DATE_RANGE = 30;
const ALLOWED_DASHBOARD_DATE_RANGES = [7, 14, 30, 60, 90];
const DEFAULT_JOB_STATUSES = ['open', 'draft', 'closed'];
const PERFORMANCE_CACHE_TTL_MS = 5 * 60 * 1000;
const performanceCache = new Map();

const buildPerformanceComparison = (current = 0, previous = 0) => {
  const safeCurrent = Number(current || 0);
  const safePrevious = Number(previous || 0);
  const delta = safeCurrent - safePrevious;
  return {
    current: safeCurrent,
    previous: safePrevious,
    delta,
    deltaPct: safePrevious > 0
      ? Math.round((delta / safePrevious) * 100)
      : (safeCurrent > 0 ? 100 : 0)
  };
};

const buildPerformanceCacheKey = ({ orgId, days, selectedTeamId, selectedRecruiterId, selectedStack, selectedJobStatus }) => {
  return JSON.stringify({
    orgId: String(orgId || ''),
    days: Number(days || DEFAULT_DASHBOARD_DATE_RANGE),
    teamId: String(selectedTeamId || ''),
    recruiterId: String(selectedRecruiterId || ''),
    stack: String(selectedStack || ''),
    jobStatus: String(selectedJobStatus || '')
  });
};

const readPerformanceCache = (key) => {
  const cached = performanceCache.get(key);
  if (!cached) return null;
  if ((Date.now() - cached.createdAt) > PERFORMANCE_CACHE_TTL_MS) {
    performanceCache.delete(key);
    return null;
  }
  return cached.payload;
};

const writePerformanceCache = (key, payload) => {
  performanceCache.set(key, {
    createdAt: Date.now(),
    payload
  });
};

const isWithinWindow = (value, start, end = null) => {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return date >= start && (!end || date < end);
};

const pushLimited = (map, key, value, limit = 5) => {
  if (!key) return;
  const current = map.get(key) || [];
  if (current.length < limit) {
    current.push(value);
    map.set(key, current);
  }
};

const normalizeDashboardConfig = (value = {}) => {
  const preferredDateRangeDays = Number.parseInt(String(value?.preferredDateRangeDays || DEFAULT_DASHBOARD_DATE_RANGE), 10);

  return {
    preferredDateRangeDays: ALLOWED_DASHBOARD_DATE_RANGES.includes(preferredDateRangeDays)
      ? preferredDateRangeDays
      : DEFAULT_DASHBOARD_DATE_RANGE,
    defaultTeamId: value?.defaultTeamId ? String(value.defaultTeamId) : '',
    showKpiCards: value?.showKpiCards !== false,
    showTeamAnalytics: value?.showTeamAnalytics !== false,
    showRecruiterPerformance: value?.showRecruiterPerformance !== false,
    showJobTrends: value?.showJobTrends !== false,
    showActivityFeed: value?.showActivityFeed !== false
  };
};

const validate = (req, res) => {
  const errors = validationResult(req);
  if (errors.isEmpty()) return null;
  return res.status(400).json({
    message: 'Validation failed.',
    errors: errors.array().map((error) => ({ field: error.path, message: error.msg }))
  });
};

const buildTeamMember = (membership) => {
  const user = membership.userId;
  if (!user?._id) return null;

  // Membership role controls team permissions (admin/member),
  // but for recruiter accounts we want to surface their account role in UI.
  const displayRole = user.role === 'recruiter' ? 'recruiter' : membership.role;

  return {
    _id: user._id,
    name: user.name,
    email: user.email,
    role: displayRole,
    isActive: user.isActive !== false
  };
};

const loadTeamMembers = async (organizationId, teamIds = []) => {
  if (!organizationId || teamIds.length === 0) {
    return new Map();
  }

  const memberships = await Membership.find({
    organizationId,
    teamId: { $in: teamIds },
    status: 'active'
  })
    .populate('userId', 'name email role isActive')
    .lean();

  return memberships.reduce((map, membership) => {
    const teamId = String(membership.teamId || '');
    const member = buildTeamMember(membership);
    if (!teamId || !member) {
      return map;
    }

    const current = map.get(teamId) || [];
    if (!current.some((item) => String(item._id) === String(member._id))) {
      current.push(member);
      map.set(teamId, current);
    }

    return map;
  }, new Map());
};

const hydrateTeams = async (organizationId, teams = []) => {
  const membersByTeam = await loadTeamMembers(organizationId, teams.map((team) => team._id));

  return teams.map((team) => {
    const members = membersByTeam.get(String(team._id)) || [];
    return {
      ...team,
      isActive: team.isActive !== false,
      members,
      memberCount: members.length
    };
  });
};

const normalizeRecruiterIds = (value) => {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item || '').trim()).filter(Boolean))];
};

const loadOrgRecruiters = async (organizationId, recruiterIds = []) => {
  if (recruiterIds.length === 0) {
    return [];
  }

  const recruiters = await User.find({
    _id: { $in: recruiterIds },
    organizationId,
    role: 'recruiter'
  })
    .select('_id')
    .lean();

  if (recruiters.length !== recruiterIds.length) {
    const error = new Error('One or more recruiters were not found in this organization.');
    error.status = 404;
    throw error;
  }

  return recruiters;
};

const upsertRecruiterTeamMemberships = async ({ organizationId, teamId, recruiterIds = [], invitedBy }) => {
  const recruiters = await loadOrgRecruiters(organizationId, recruiterIds);

  for (const recruiter of recruiters) {
    const existingMembership = await Membership.findOne({
      organizationId,
      userId: recruiter._id,
      status: 'active',
      teamId: { $ne: null }
    })
      .populate('teamId', 'name')
      .lean();

    if (existingMembership && String(existingMembership.teamId?._id || existingMembership.teamId) !== String(teamId)) {
      const assignedName = existingMembership.teamId?.name || 'another team';
      const error = new Error(`Recruiter is already assigned to ${assignedName}.`);
      error.status = 409;
      throw error;
    }

    await Membership.findOneAndUpdate(
      {
        organizationId,
        teamId,
        userId: recruiter._id
      },
      {
        $set: {
          role: 'member',
          status: 'active',
          invitedBy,
          joinedAt: new Date()
        }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }
};

const getConsolePerformanceData = async (orgId, query = {}) => {
  const days = Math.min(90, Math.max(7, Number.parseInt(String(query.days || String(DEFAULT_DASHBOARD_DATE_RANGE)), 10)));
  const now = new Date();
  const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const previousSince = new Date(since.getTime() - days * 24 * 60 * 60 * 1000);
  const selectedTeamId = String(query.teamId || '').trim();
  const selectedRecruiterId = String(query.recruiterId || '').trim();
  const selectedStack = String(query.stack || '').trim();
  const rawJobStatus = String(query.jobStatus || '').trim().toLowerCase();
  const selectedJobStatus = DEFAULT_JOB_STATUSES.includes(rawJobStatus) ? rawJobStatus : '';

  const cacheKey = buildPerformanceCacheKey({
    orgId,
    days,
    selectedTeamId,
    selectedRecruiterId,
    selectedStack,
    selectedJobStatus
  });
  const cached = readPerformanceCache(cacheKey);
  if (cached) {
    return cached;
  }

  const [recruiters, teams, memberships] = await Promise.all([
    User.find({ role: 'recruiter', organizationId: orgId }).select('_id name email isActive createdAt').lean(),
    Team.find({ organizationId: orgId }).select('_id name isActive createdAt').lean(),
    Membership.find({ organizationId: orgId, status: 'active', teamId: { $ne: null } }).select('userId teamId').lean()
  ]);

  const membersByTeam = memberships.reduce((map, membership) => {
    const teamId = String(membership.teamId || '');
    if (!teamId) return map;
    const current = map.get(teamId) || [];
    current.push(String(membership.userId || ''));
    map.set(teamId, current.filter(Boolean));
    return map;
  }, new Map());

  const teamByRecruiter = new Map();
  memberships.forEach((membership) => {
    teamByRecruiter.set(String(membership.userId || ''), String(membership.teamId || ''));
  });

  const recruiterById = recruiters.reduce((map, recruiter) => {
    map.set(String(recruiter._id), recruiter);
    return map;
  }, new Map());

  const allRecruiterIds = recruiters.map((recruiter) => String(recruiter._id));
  let teamScopedRecruiterIds = [...allRecruiterIds];
  if (selectedTeamId) {
    teamScopedRecruiterIds = (membersByTeam.get(selectedTeamId) || []).filter((id) => allRecruiterIds.includes(id));
  }

  let scopedRecruiterIds = [...teamScopedRecruiterIds];
  if (selectedRecruiterId) {
    scopedRecruiterIds = scopedRecruiterIds.filter((id) => id === selectedRecruiterId);
  }

  const scopedRecruiterSet = new Set(scopedRecruiterIds);
  const availableRecruiterSet = new Set(teamScopedRecruiterIds);
  const scopedRecruiters = recruiters.filter((recruiter) => scopedRecruiterSet.has(String(recruiter._id)));
  const availableRecruiters = recruiters.filter((recruiter) => availableRecruiterSet.has(String(recruiter._id)));
  const scopedRecruiterObjectIds = scopedRecruiters.map((recruiter) => recruiter._id);

  const jobMatch = { organizationId: orgId, recruiterId: { $in: scopedRecruiterObjectIds } };
  if (selectedStack) jobMatch.stack = selectedStack;
  if (selectedJobStatus) jobMatch.status = selectedJobStatus;

  const candidateMatch = { createdBy: { $in: scopedRecruiterObjectIds } };
  if (selectedStack) candidateMatch.stack = selectedStack;

  const invitationMatch = {
    organizationId: orgId,
    createdAt: { $gte: previousSince },
    invitedBy: { $in: scopedRecruiterObjectIds }
  };
  if (selectedTeamId) {
    invitationMatch.teamId = selectedTeamId;
  }

  const recentActivityMatch = {
    organizationId: orgId,
    actor: { $in: scopedRecruiterObjectIds },
    timestamp: { $gte: since }
  };
  if (selectedTeamId) {
    recentActivityMatch.teamId = selectedTeamId;
  }

  const [
    allJobs,
    candidateWindow,
    invitationWindow,
    detailedActivityLogs,
    allTimeAnalysisUsage,
    periodAnalysisUsage,
    jobStacks,
    candidateStacks
  ] = await Promise.all([
    Job.find(jobMatch)
      .select('_id recruiterId teamId title role status createdAt updatedAt stack')
      .sort({ createdAt: -1 })
      .lean(),
    Candidate.find({ ...candidateMatch, createdAt: { $gte: previousSince } })
      .select('createdBy fullName createdAt stack githubScore resumeScore growthPotentialScore skillGaps aiInsight')
      .sort({ createdAt: -1 })
      .lean(),
    Invitation.find(invitationMatch)
      .select('status createdAt invitedBy teamId')
      .lean(),
    AuditLog.find(recentActivityMatch)
      .sort({ timestamp: -1 })
      .limit(120)
      .select('_id actor teamId action method route statusCode timestamp')
      .lean(),
    AuditLog.aggregate([
      {
        $match: {
          organizationId: orgId,
          actor: { $in: scopedRecruiterObjectIds },
          route: { $regex: /\/api\/recruiter\/(match|ai-rank)/ }
        }
      },
      {
        $group: {
          _id: '$actor',
          count: { $sum: 1 }
        }
      }
    ]),
    AuditLog.aggregate([
      {
        $match: {
          organizationId: orgId,
          actor: { $in: scopedRecruiterObjectIds },
          route: { $regex: /\/api\/recruiter\/(match|ai-rank)/ },
          timestamp: { $gte: previousSince }
        }
      },
      {
        $project: {
          actor: 1,
          timestamp: 1,
          isMatch: { $regexMatch: { input: '$route', regex: /\/api\/recruiter\/match/ } },
          isAiRank: { $regexMatch: { input: '$route', regex: /\/api\/recruiter\/ai-rank/ } }
        }
      },
      {
        $group: {
          _id: '$actor',
          currentCount: { $sum: { $cond: [{ $gte: ['$timestamp', since] }, 1, 0] } },
          previousCount: {
            $sum: {
              $cond: [
                { $and: [{ $gte: ['$timestamp', previousSince] }, { $lt: ['$timestamp', since] }] },
                1,
                0
              ]
            }
          },
          currentMatchCalls: {
            $sum: {
              $cond: [{ $and: ['$isMatch', { $gte: ['$timestamp', since] }] }, 1, 0]
            }
          },
          previousMatchCalls: {
            $sum: {
              $cond: [
                { $and: ['$isMatch', { $gte: ['$timestamp', previousSince] }, { $lt: ['$timestamp', since] }] },
                1,
                0
              ]
            }
          },
          currentAiRankCalls: {
            $sum: {
              $cond: [{ $and: ['$isAiRank', { $gte: ['$timestamp', since] }] }, 1, 0]
            }
          },
          previousAiRankCalls: {
            $sum: {
              $cond: [
                { $and: ['$isAiRank', { $gte: ['$timestamp', previousSince] }, { $lt: ['$timestamp', since] }] },
                1,
                0
              ]
            }
          }
        }
      }
    ]),
    Job.distinct('stack', { organizationId: orgId, recruiterId: { $in: teamScopedRecruiterIds } }),
    Candidate.distinct('stack', { createdBy: { $in: teamScopedRecruiterIds } })
  ]);

  const recentCandidates = candidateWindow.filter((candidate) => isWithinWindow(candidate.createdAt, since));
  const previousCandidates = candidateWindow.filter((candidate) => isWithinWindow(candidate.createdAt, previousSince, since));
  const currentInvitations = invitationWindow.filter((invitation) => isWithinWindow(invitation.createdAt, since));
  const previousInvitations = invitationWindow.filter((invitation) => isWithinWindow(invitation.createdAt, previousSince, since));

  const jobsByRecruiter = new Map();
  const recentJobsByRecruiter = new Map();
  const previousJobsByRecruiter = new Map();
  const lastJobAtByRecruiter = new Map();
  const openJobsByRecruiter = new Map();
  const draftJobsByRecruiter = new Map();
  const closedJobsByRecruiter = new Map();
  const recentJobsListByRecruiter = new Map();
  const recentJobsListByTeam = new Map();
  const jobsByTeam = new Map();
  const currentJobsByTeam = new Map();
  const previousJobsByTeam = new Map();

  allJobs.forEach((job) => {
    const recruiterId = String(job.recruiterId || '');
    if (!recruiterId) return;

    const teamId = String(job.teamId || teamByRecruiter.get(recruiterId) || '');
    const createdAt = job.createdAt ? new Date(job.createdAt) : null;

    jobsByRecruiter.set(recruiterId, (jobsByRecruiter.get(recruiterId) || 0) + 1);
    if (teamId) {
      jobsByTeam.set(teamId, (jobsByTeam.get(teamId) || 0) + 1);
    }

    if (createdAt && (!lastJobAtByRecruiter.get(recruiterId) || createdAt > lastJobAtByRecruiter.get(recruiterId))) {
      lastJobAtByRecruiter.set(recruiterId, createdAt);
    }

    if (isWithinWindow(job.createdAt, since)) {
      recentJobsByRecruiter.set(recruiterId, (recentJobsByRecruiter.get(recruiterId) || 0) + 1);
      if (teamId) {
        currentJobsByTeam.set(teamId, (currentJobsByTeam.get(teamId) || 0) + 1);
      }
    }

    if (isWithinWindow(job.createdAt, previousSince, since)) {
      previousJobsByRecruiter.set(recruiterId, (previousJobsByRecruiter.get(recruiterId) || 0) + 1);
      if (teamId) {
        previousJobsByTeam.set(teamId, (previousJobsByTeam.get(teamId) || 0) + 1);
      }
    }

    if (job.status === 'open') openJobsByRecruiter.set(recruiterId, (openJobsByRecruiter.get(recruiterId) || 0) + 1);
    if (job.status === 'draft') draftJobsByRecruiter.set(recruiterId, (draftJobsByRecruiter.get(recruiterId) || 0) + 1);
    if (job.status === 'closed') closedJobsByRecruiter.set(recruiterId, (closedJobsByRecruiter.get(recruiterId) || 0) + 1);

    const jobSummary = {
      _id: job._id,
      title: String(job.title || job.role || 'Untitled role').trim() || 'Untitled role',
      status: String(job.status || 'open'),
      stack: String(job.stack || 'Other').trim() || 'Other',
      createdAt: job.createdAt,
      updatedAt: job.updatedAt || job.createdAt
    };

    if (isWithinWindow(job.createdAt, since)) {
      pushLimited(recentJobsListByRecruiter, recruiterId, jobSummary);
      pushLimited(recentJobsListByTeam, teamId, jobSummary);
    }
  });

  const allTimeAnalysesByRecruiter = new Map();
  allTimeAnalysisUsage.forEach((item) => {
    allTimeAnalysesByRecruiter.set(String(item._id || ''), Number(item.count || 0));
  });

  const recentAnalysesByRecruiter = new Map();
  const previousAnalysesByRecruiter = new Map();
  const matchCallsByRecruiter = new Map();
  const previousMatchCallsByRecruiter = new Map();
  const aiRankCallsByRecruiter = new Map();
  const previousAiRankCallsByRecruiter = new Map();

  periodAnalysisUsage.forEach((item) => {
    const recruiterId = String(item._id || '');
    recentAnalysesByRecruiter.set(recruiterId, Number(item.currentCount || 0));
    previousAnalysesByRecruiter.set(recruiterId, Number(item.previousCount || 0));
    matchCallsByRecruiter.set(recruiterId, Number(item.currentMatchCalls || 0));
    previousMatchCallsByRecruiter.set(recruiterId, Number(item.previousMatchCalls || 0));
    aiRankCallsByRecruiter.set(recruiterId, Number(item.currentAiRankCalls || 0));
    previousAiRankCallsByRecruiter.set(recruiterId, Number(item.previousAiRankCalls || 0));
  });

  const lastActivityAtByRecruiter = new Map();
  const recentActivityByRecruiter = new Map();
  const recentActivityByTeam = new Map();
  const aiActivityLogs = [];

  detailedActivityLogs.forEach((log) => {
    const recruiterId = String(log.actor || '');
    if (!recruiterId) return;

    const recruiter = recruiterById.get(recruiterId);
    const route = String(log.route || '');
    const activityItem = {
      _id: log._id,
      action: String(log.action || route || 'Activity').trim() || 'Activity',
      method: String(log.method || '').trim(),
      route,
      statusCode: Number(log.statusCode || 0),
      timestamp: log.timestamp,
      actorName: recruiter?.name || recruiter?.email || 'Recruiter'
    };

    const timestamp = log.timestamp ? new Date(log.timestamp) : null;
    if (timestamp && (!lastActivityAtByRecruiter.get(recruiterId) || timestamp > lastActivityAtByRecruiter.get(recruiterId))) {
      lastActivityAtByRecruiter.set(recruiterId, timestamp);
    }

    pushLimited(recentActivityByRecruiter, recruiterId, activityItem);
    pushLimited(recentActivityByTeam, String(log.teamId || teamByRecruiter.get(recruiterId) || ''), activityItem);

    if (/\/api\/recruiter\/(match|ai-rank)/.test(route)) {
      aiActivityLogs.push(activityItem);
    }
  });

  const candidatesByRecruiter = new Map();
  const previousCandidatesByRecruiter = new Map();
  const aiEnhancedCandidatesByRecruiter = new Map();
  const previousAiEnhancedCandidatesByRecruiter = new Map();
  const lastCandidateAtByRecruiter = new Map();
  const recentCandidatesByRecruiter = new Map();
  const recentCandidatesByTeam = new Map();
  const candidatesByTeam = new Map();
  const previousCandidatesByTeam = new Map();
  const skillGapCounts = new Map();
  const portfolioQualitySum = { github: 0, resume: 0, growth: 0, count: 0 };

  candidateWindow.forEach((candidate) => {
    const recruiterId = String(candidate.createdBy || '');
    if (!recruiterId) return;

    const teamId = String(teamByRecruiter.get(recruiterId) || '');
    const createdAt = candidate.createdAt ? new Date(candidate.createdAt) : null;
    const aiSummary = String(candidate.aiInsight?.summary || '').trim();
    const aiStrengths = Array.isArray(candidate.aiInsight?.strengths) ? candidate.aiInsight.strengths : [];
    const aiUsed = aiSummary.length > 0 || aiStrengths.length > 0;

    if (createdAt && (!lastCandidateAtByRecruiter.get(recruiterId) || createdAt > lastCandidateAtByRecruiter.get(recruiterId))) {
      lastCandidateAtByRecruiter.set(recruiterId, createdAt);
    }

    if (isWithinWindow(candidate.createdAt, since)) {
      candidatesByRecruiter.set(recruiterId, (candidatesByRecruiter.get(recruiterId) || 0) + 1);
      if (teamId) {
        candidatesByTeam.set(teamId, (candidatesByTeam.get(teamId) || 0) + 1);
      }

      if (aiUsed) {
        aiEnhancedCandidatesByRecruiter.set(recruiterId, (aiEnhancedCandidatesByRecruiter.get(recruiterId) || 0) + 1);
      }

      const candidateSummary = {
        fullName: String(candidate.fullName || 'Candidate').trim() || 'Candidate',
        stack: String(candidate.stack || 'Other').trim() || 'Other',
        createdAt: candidate.createdAt
      };
      pushLimited(recentCandidatesByRecruiter, recruiterId, candidateSummary);
      pushLimited(recentCandidatesByTeam, teamId, candidateSummary);

      const gaps = Array.isArray(candidate.skillGaps) ? candidate.skillGaps : [];
      gaps.forEach((gap) => {
        const skill = String(gap || '').trim();
        if (!skill) return;
        skillGapCounts.set(skill, (skillGapCounts.get(skill) || 0) + 1);
      });

      const githubScore = Number(candidate.githubScore || 0);
      const resumeScore = Number(candidate.resumeScore || 0);
      const growthScore = Number(candidate.growthPotentialScore || 0);
      portfolioQualitySum.github += Number.isFinite(githubScore) ? githubScore : 0;
      portfolioQualitySum.resume += Number.isFinite(resumeScore) ? resumeScore : 0;
      portfolioQualitySum.growth += Number.isFinite(growthScore) ? growthScore : 0;
      portfolioQualitySum.count += 1;
    }

    if (isWithinWindow(candidate.createdAt, previousSince, since)) {
      previousCandidatesByRecruiter.set(recruiterId, (previousCandidatesByRecruiter.get(recruiterId) || 0) + 1);
      if (teamId) {
        previousCandidatesByTeam.set(teamId, (previousCandidatesByTeam.get(teamId) || 0) + 1);
      }
      if (aiUsed) {
        previousAiEnhancedCandidatesByRecruiter.set(recruiterId, (previousAiEnhancedCandidatesByRecruiter.get(recruiterId) || 0) + 1);
      }
    }
  });

  const recruiterMetrics = scopedRecruiters.map((recruiter) => {
    const recruiterId = String(recruiter._id);
    const totalJobs = jobsByRecruiter.get(recruiterId) || 0;
    const recentJobs = recentJobsByRecruiter.get(recruiterId) || 0;
    const closedJobs = closedJobsByRecruiter.get(recruiterId) || 0;
    const matchCalls = matchCallsByRecruiter.get(recruiterId) || 0;
    const aiRankCalls = aiRankCallsByRecruiter.get(recruiterId) || 0;
    const totalAnalyses = recentAnalysesByRecruiter.get(recruiterId) || 0;
    const candidatesAnalyzed = candidatesByRecruiter.get(recruiterId) || 0;
    const aiEnhancedCandidates = aiEnhancedCandidatesByRecruiter.get(recruiterId) || 0;
    const matchesGenerated = matchCalls;
    const hiringSuccessRate = totalJobs > 0 ? Math.round((closedJobs / totalJobs) * 100) : 0;
    const aiUsage = totalAnalyses;
    const lastActiveAt = lastActivityAtByRecruiter.get(recruiterId) || lastCandidateAtByRecruiter.get(recruiterId) || lastJobAtByRecruiter.get(recruiterId) || null;
    const activityScore = clamp(recentJobs * 14 + matchCalls * 6 + aiRankCalls * 10 + candidatesAnalyzed * 4 + (recruiter.isActive !== false ? 10 : 0), 0, 100);

    return {
      _id: recruiter._id,
      name: recruiter.name,
      email: recruiter.email,
      isActive: recruiter.isActive !== false,
      teamId: teamByRecruiter.get(recruiterId) || null,
      totalJobs,
      recentJobs,
      totalAnalyses,
      githubAnalyses: 0,
      resumeAnalyses: 0,
      hiringSuccessRate,
      matchesGenerated,
      shortlists: matchesGenerated,
      aiUsage,
      activityScore,
      lastActiveAt,
      candidatesAnalyzed,
      aiRankCalls,
      matchCalls,
      aiEnhancedCandidates,
      openJobs: openJobsByRecruiter.get(recruiterId) || 0,
      draftJobs: draftJobsByRecruiter.get(recruiterId) || 0,
      closedJobs,
      recentJobsList: recentJobsListByRecruiter.get(recruiterId) || [],
      recentCandidates: recentCandidatesByRecruiter.get(recruiterId) || [],
      recentActivity: recentActivityByRecruiter.get(recruiterId) || [],
      score: clamp(totalJobs * 8 + recentJobs * 8 + totalAnalyses * 3 + hiringSuccessRate * 0.5, 0, 100),
      joinedAt: recruiter.createdAt
    };
  }).sort((a, b) => b.score - a.score);

  let scopedTeamIds = selectedTeamId
    ? [selectedTeamId]
    : [...new Set(scopedRecruiterIds.map((recruiterId) => String(teamByRecruiter.get(recruiterId) || '')).filter(Boolean))];

  if (!selectedTeamId && !selectedRecruiterId) {
    scopedTeamIds = teams.map((team) => String(team._id));
  }

  const activeRecruiterIdSet = new Set(recruiters.filter((recruiter) => recruiter.isActive !== false).map((recruiter) => String(recruiter._id)));
  const scopedTeams = teams.filter((team) => scopedTeamIds.includes(String(team._id)));
  const teamMetrics = scopedTeams.map((team) => {
    const teamId = String(team._id);
    const teamMembers = membersByTeam.get(teamId) || [];
    const scopedMemberIds = teamMembers.filter((memberId) => scopedRecruiterSet.has(memberId));
    const recruiterIdsForTeam = teamMembers.filter((memberId) => allRecruiterIds.includes(String(memberId)));
    const totalJobs = jobsByTeam.get(teamId) || 0;
    const recentJobs = currentJobsByTeam.get(teamId) || 0;
    const closedTeamJobs = allJobs.filter((job) => String(job.teamId || teamByRecruiter.get(String(job.recruiterId || '')) || '') === teamId && job.status === 'closed').length;
    const openTeamJobs = allJobs.filter((job) => String(job.teamId || teamByRecruiter.get(String(job.recruiterId || '')) || '') === teamId && job.status === 'open').length;
    const draftTeamJobs = allJobs.filter((job) => String(job.teamId || teamByRecruiter.get(String(job.recruiterId || '')) || '') === teamId && job.status === 'draft').length;
    const activeMembers = recruiterIdsForTeam.filter((memberId) => activeRecruiterIdSet.has(memberId)).length;
    const teamCandidates = candidatesByTeam.get(teamId) || 0;
    const teamAiCalls = scopedMemberIds.reduce((sum, recruiterId) => sum + (aiRankCallsByRecruiter.get(recruiterId) || 0), 0);
    const teamMatchCalls = scopedMemberIds.reduce((sum, recruiterId) => sum + (matchCallsByRecruiter.get(recruiterId) || 0), 0);
    const teamRecentActions = recentActivityByTeam.get(teamId) || [];
    const hiringPerformance = totalJobs > 0 ? Math.round((closedTeamJobs / totalJobs) * 100) : 0;
    const engagementScore = clamp(recentJobs * 12 + teamCandidates * 5 + teamAiCalls * 8 + activeMembers * 10 + hiringPerformance * 0.35, 0, 100);
    const performanceScore = Math.round((engagementScore + hiringPerformance) / 2);

    return {
      _id: team._id,
      name: team.name,
      isActive: team.isActive !== false,
      memberCount: teamMembers.length,
      activeMembers,
      recruiterCount: recruiterIdsForTeam.length,
      totalJobs,
      recentJobs,
      openJobs: openTeamJobs,
      draftJobs: draftTeamJobs,
      closedJobs: closedTeamJobs,
      candidatesAnalyzed: teamCandidates,
      aiUsage: teamAiCalls,
      matchesGenerated: teamMatchCalls,
      hiringPerformance,
      engagementScore,
      performanceScore,
      activityCount: teamRecentActions.length,
      activityTimeline: teamRecentActions,
      recentActions: teamRecentActions,
      recentJobsList: recentJobsListByTeam.get(teamId) || [],
      recentCandidates: recentCandidatesByTeam.get(teamId) || [],
      createdAt: team.createdAt
    };
  }).sort((a, b) => b.engagementScore - a.engagementScore);

  const openJobs = allJobs.filter((job) => job.status === 'open').length;
  const draftJobs = allJobs.filter((job) => job.status === 'draft').length;
  const closedJobs = allJobs.filter((job) => job.status === 'closed').length;
  const recentJobs = allJobs.filter((job) => isWithinWindow(job.createdAt, since)).length;
  const previousJobs = allJobs.filter((job) => isWithinWindow(job.createdAt, previousSince, since)).length;

  const stackDistribution = [...allJobs.reduce((map, job) => {
    const stack = String(job.stack || 'Other').trim() || 'Other';
    map.set(stack, (map.get(stack) || 0) + 1);
    return map;
  }, new Map()).entries()]
    .map(([stack, count]) => ({ stack, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  const invitationFunnelFrom = (items) => ({
    total: items.length,
    pending: items.filter((item) => item.status === 'pending').length,
    accepted: items.filter((item) => item.status === 'accepted').length,
    expired: items.filter((item) => item.status === 'expired').length,
    revoked: items.filter((item) => item.status === 'revoked').length
  });

  const invFunnel = invitationFunnelFrom(currentInvitations);
  const previousInvFunnel = invitationFunnelFrom(previousInvitations);
  const acceptanceRate = invFunnel.total > 0 ? Math.round((invFunnel.accepted / invFunnel.total) * 100) : 0;
  const previousAcceptanceRate = previousInvFunnel.total > 0 ? Math.round((previousInvFunnel.accepted / previousInvFunnel.total) * 100) : 0;

  const monthlyTrend = [];
  for (let i = 5; i >= 0; i -= 1) {
    const monthDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const label = monthDate.toLocaleString('default', { month: 'short', year: '2-digit' });
    const count = allJobs.filter((job) => {
      const jobDate = new Date(job.createdAt);
      return jobDate.getMonth() === monthDate.getMonth() && jobDate.getFullYear() === monthDate.getFullYear();
    }).length;
    monthlyTrend.push({ label, count });
  }

  const DEFAULT_STACKS = ['Frontend', 'Backend', 'Full Stack', 'AI/ML'];
  const stacks = [...new Set([...DEFAULT_STACKS, ...jobStacks, ...candidateStacks]
    .map((stack) => String(stack || '').trim())
    .filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));

  const skillGapTrends = [...skillGapCounts.entries()]
    .map(([skill, count]) => ({ skill, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);

  const portfolioQuality = portfolioQualitySum.count > 0
    ? {
        avgGithubScore: Math.round(portfolioQualitySum.github / portfolioQualitySum.count),
        avgResumeScore: Math.round(portfolioQualitySum.resume / portfolioQualitySum.count),
        avgGrowthPotential: Math.round(portfolioQualitySum.growth / portfolioQualitySum.count),
        sampleSize: portfolioQualitySum.count
      }
    : { avgGithubScore: 0, avgResumeScore: 0, avgGrowthPotential: 0, sampleSize: 0 };

  const totalAnalyses = Array.from(allTimeAnalysesByRecruiter.values()).reduce((sum, count) => sum + Number(count || 0), 0);
  const recentAnalyses = Array.from(recentAnalysesByRecruiter.values()).reduce((sum, count) => sum + Number(count || 0), 0);
  const previousAnalyses = Array.from(previousAnalysesByRecruiter.values()).reduce((sum, count) => sum + Number(count || 0), 0);
  const totalCandidatesAnalyzed = recentCandidates.length;
  const previousCandidatesAnalyzed = previousCandidates.length;
  const totalAiEnhancedCandidates = Array.from(aiEnhancedCandidatesByRecruiter.values()).reduce((sum, count) => sum + Number(count || 0), 0);
  const previousAiEnhancedCandidates = Array.from(previousAiEnhancedCandidatesByRecruiter.values()).reduce((sum, count) => sum + Number(count || 0), 0);
  const totalAiRankCalls = Array.from(aiRankCallsByRecruiter.values()).reduce((sum, count) => sum + Number(count || 0), 0);
  const previousAiRankCalls = Array.from(previousAiRankCallsByRecruiter.values()).reduce((sum, count) => sum + Number(count || 0), 0);
  const totalMatchCalls = Array.from(matchCallsByRecruiter.values()).reduce((sum, count) => sum + Number(count || 0), 0);
  const previousMatchCalls = Array.from(previousMatchCallsByRecruiter.values()).reduce((sum, count) => sum + Number(count || 0), 0);

  const recruiterAverageScore = recruiterMetrics.length > 0
    ? recruiterMetrics.reduce((sum, recruiter) => sum + Number(recruiter.score || 0), 0) / recruiterMetrics.length
    : 0;
  const teamAverageScore = teamMetrics.length > 0
    ? teamMetrics.reduce((sum, team) => sum + Number(team.performanceScore || 0), 0) / teamMetrics.length
    : 0;
  const organizationPerformanceScore = clamp(Math.round((recruiterAverageScore + teamAverageScore + acceptanceRate) / 3), 0, 100);

  const previousRecruiterScores = scopedRecruiters.map((recruiter) => {
    const recruiterId = String(recruiter._id);
    const totalJobsForScore = jobsByRecruiter.get(recruiterId) || 0;
    const previousRecentJobs = previousJobsByRecruiter.get(recruiterId) || 0;
    const previousTotalAnalysesForRecruiter = previousAnalysesByRecruiter.get(recruiterId) || 0;
    const hiringSuccessRate = totalJobsForScore > 0 ? Math.round(((closedJobsByRecruiter.get(recruiterId) || 0) / totalJobsForScore) * 100) : 0;
    return clamp(totalJobsForScore * 8 + previousRecentJobs * 8 + previousTotalAnalysesForRecruiter * 3 + hiringSuccessRate * 0.5, 0, 100);
  });
  const previousTeamScores = scopedTeams.map((team) => {
    const teamId = String(team._id);
    const previousRecentJobs = previousJobsByTeam.get(teamId) || 0;
    const previousTeamCandidates = previousCandidatesByTeam.get(teamId) || 0;
    const previousTeamAiCalls = (membersByTeam.get(teamId) || []).reduce((sum, recruiterId) => sum + (previousAiRankCallsByRecruiter.get(recruiterId) || 0), 0);
    const closedTeamJobs = allJobs.filter((job) => String(job.teamId || teamByRecruiter.get(String(job.recruiterId || '')) || '') === teamId && job.status === 'closed').length;
    const totalJobsForScore = jobsByTeam.get(teamId) || 0;
    const hiringPerformance = totalJobsForScore > 0 ? Math.round((closedTeamJobs / totalJobsForScore) * 100) : 0;
    const activeMembers = (membersByTeam.get(teamId) || []).filter((memberId) => activeRecruiterIdSet.has(memberId)).length;
    const previousEngagement = clamp(previousRecentJobs * 12 + previousTeamCandidates * 5 + previousTeamAiCalls * 8 + activeMembers * 10 + hiringPerformance * 0.35, 0, 100);
    return Math.round((previousEngagement + hiringPerformance) / 2);
  });
  const previousOrganizationPerformanceScore = clamp(Math.round(((
    previousRecruiterScores.length > 0
      ? previousRecruiterScores.reduce((sum, score) => sum + score, 0) / previousRecruiterScores.length
      : 0
  ) + (
    previousTeamScores.length > 0
      ? previousTeamScores.reduce((sum, score) => sum + score, 0) / previousTeamScores.length
      : 0
  ) + previousAcceptanceRate) / 3), 0, 100);

  const HEATMAP_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const HEATMAP_BUCKETS = [
    { label: '0-3', start: 0, end: 3 },
    { label: '4-7', start: 4, end: 7 },
    { label: '8-11', start: 8, end: 11 },
    { label: '12-15', start: 12, end: 15 },
    { label: '16-19', start: 16, end: 19 },
    { label: '20-23', start: 20, end: 23 }
  ];

  const heatmapGrid = Array.from({ length: 7 }, () => Array.from({ length: HEATMAP_BUCKETS.length }, () => 0));
  const dayToIndex = (day) => (Number(day) === 0 ? 6 : Number(day) - 1);
  const bumpHeatmap = (value) => {
    if (!value) return;
    const date = new Date(value);
    if (Number.isNaN(date.getTime()) || date < since) return;
    const dayIndex = dayToIndex(date.getDay());
    const bucketIndex = HEATMAP_BUCKETS.findIndex((bucket) => date.getHours() >= bucket.start && date.getHours() <= bucket.end);
    if (dayIndex < 0 || bucketIndex < 0) return;
    heatmapGrid[dayIndex][bucketIndex] += 1;
  };

  allJobs.forEach((job) => bumpHeatmap(job.createdAt));
  recentCandidates.forEach((candidate) => bumpHeatmap(candidate.createdAt));
  aiActivityLogs.forEach((activity) => bumpHeatmap(activity.timestamp));

  let heatmapMax = 0;
  heatmapGrid.forEach((row) => row.forEach((count) => {
    if (count > heatmapMax) heatmapMax = count;
  }));

  const payload = {
    period: {
      days,
      since,
      until: now,
      previousSince
    },
    filters: {
      selectedTeamId,
      selectedRecruiterId,
      selectedStack,
      selectedJobStatus,
      teams: teams.map((team) => ({ _id: team._id, name: team.name })),
      recruiters: availableRecruiters.map((recruiter) => ({ _id: recruiter._id, name: recruiter.name })),
      stacks,
      jobStatuses: DEFAULT_JOB_STATUSES
    },
    recruiterMetrics,
    teamMetrics,
    hiringAnalytics: {
      total: allJobs.length,
      open: openJobs,
      draft: draftJobs,
      closed: closedJobs,
      recentJobs,
      stackDistribution,
      monthlyTrend,
      invitationFunnel: invFunnel,
      acceptanceRate
    },
    aiStats: {
      totalAnalyses,
      recentAnalyses,
      analysesByRecruiter: recruiterMetrics.map((recruiterMetric) => ({
        name: recruiterMetric.name,
        count: allTimeAnalysesByRecruiter.get(String(recruiterMetric._id)) || 0,
        recentCount: recruiterMetric.totalAnalyses
      }))
    },
    recentActivity: detailedActivityLogs.slice(0, 8).map((log) => {
      const recruiter = recruiterById.get(String(log.actor || ''));
      return {
        _id: log._id,
        action: String(log.action || log.route || 'Activity').trim() || 'Activity',
        method: String(log.method || '').trim(),
        route: String(log.route || '').trim(),
        statusCode: Number(log.statusCode || 0),
        timestamp: log.timestamp,
        actorName: recruiter?.name || recruiter?.email || 'Recruiter'
      };
    }),
    engagementMeta: {
      formula: 'clamp(recentJobs*12 + candidatesAnalyzed*5 + aiRankCalls*8 + activeRecruiters*10 + hiringPerformance*0.35, 0..100)',
      notes: [
        'recentJobs = jobs created in selected date range',
        'candidatesAnalyzed = candidates created in selected date range',
        'aiRankCalls = /api/recruiter/ai-rank POST count in selected date range',
        'activeRecruiters = active recruiters assigned to the team'
      ]
    },
    skillGapTrends,
    portfolioQuality,
    engagementHeatmap: {
      days: HEATMAP_DAYS,
      buckets: HEATMAP_BUCKETS.map((bucket) => bucket.label),
      grid: heatmapGrid,
      max: heatmapMax
    },
    candidateAnalytics: {
      candidatesAnalyzed: totalCandidatesAnalyzed,
      aiEnhancedCandidates: totalAiEnhancedCandidates
    },
    aiEffectiveness: {
      aiRankCalls: totalAiRankCalls,
      matchCalls: totalMatchCalls,
      aiEnhancedRate: totalCandidatesAnalyzed > 0 ? Math.round((totalAiEnhancedCandidates / totalCandidatesAnalyzed) * 100) : 0
    },
    comparisons: {
      jobsCreated: buildPerformanceComparison(recentJobs, previousJobs),
      invitationsAccepted: buildPerformanceComparison(invFunnel.accepted, previousInvFunnel.accepted),
      invitationAcceptanceRate: buildPerformanceComparison(acceptanceRate, previousAcceptanceRate),
      candidatesAnalyzed: buildPerformanceComparison(totalCandidatesAnalyzed, previousCandidatesAnalyzed),
      aiAnalyses: buildPerformanceComparison(recentAnalyses, previousAnalyses),
      aiEnhancedCandidates: buildPerformanceComparison(totalAiEnhancedCandidates, previousAiEnhancedCandidates),
      aiRankCalls: buildPerformanceComparison(totalAiRankCalls, previousAiRankCalls),
      matchCalls: buildPerformanceComparison(totalMatchCalls, previousMatchCalls),
      organizationPerformanceScore: buildPerformanceComparison(organizationPerformanceScore, previousOrganizationPerformanceScore)
    },
    summary: {
      totalRecruiters: scopedRecruiters.length,
      activeRecruiters: scopedRecruiters.filter((recruiter) => recruiter.isActive !== false).length,
      inactiveRecruiters: scopedRecruiters.filter((recruiter) => recruiter.isActive === false).length,
      totalTeams: scopedTeams.length,
      pendingInvitations: invFunnel.pending,
      totalJobs: allJobs.length,
      openJobs,
      draftJobs,
      closedJobs,
      matchesGenerated: totalMatchCalls,
      aiRankUsage: totalAiRankCalls,
      organizationPerformanceScore,
      topRecruiter: recruiterMetrics[0]?.name || null,
      topTeam: teamMetrics[0]?.name || null
    }
  };

  writePerformanceCache(cacheKey, payload);
  return payload;
};

module.exports = {
  clamp,
  DEFAULT_DASHBOARD_DATE_RANGE,
  ALLOWED_DASHBOARD_DATE_RANGES,
  DEFAULT_JOB_STATUSES,
  normalizeDashboardConfig,
  hydrateTeams,
  normalizeRecruiterIds,
  upsertRecruiterTeamMemberships,
  getConsolePerformanceData,
};
