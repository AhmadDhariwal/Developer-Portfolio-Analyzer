const User = require('../../models/user');
const Team = require('../../models/team');
const Membership = require('../../models/membership');
const Job = require('../../models/Job');
const Candidate = require('../../models/Candidate');
const AuditLog = require('../../models/auditLog');

const DEFAULT_DASHBOARD_DATE_RANGE = 30;

const clamp = (v, min = 0, max = 100) => Math.max(min, Math.min(max, Number(v || 0)));

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

/**
 * Computes full metrics and scores for all teams in the organization.
 * @param {string} orgId The organization ID.
 * @returns {Promise<object>} Map of team metrics, lists, and metadata.
 */
const computeOrgTeamsMetrics = async (orgId) => {
  const days = DEFAULT_DASHBOARD_DATE_RANGE;
  const now = new Date();
  const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const previousSince = new Date(since.getTime() - days * 24 * 60 * 60 * 1000);

  // 1. Fetch main entities
  const [recruiters, teams, memberships] = await Promise.all([
    User.find({ role: 'recruiter', organizationId: orgId }).select('_id name email isActive createdAt').lean(),
    Team.find({ organizationId: orgId }).select('_id name isActive description slug createdAt').lean(),
    Membership.find({ organizationId: orgId, status: 'active', teamId: { $ne: null } })
      .populate('userId', 'name email role isActive')
      .lean()
  ]);

  // Map of teamId -> Array of member details
  const membersByTeam = new Map();
  const teamByRecruiter = new Map();

  memberships.forEach((m) => {
    if (!m.teamId || !m.userId) return;
    const teamIdStr = String(m.teamId);
    const recruiterIdStr = String(m.userId._id || m.userId);
    
    // Add to members list
    const currentList = membersByTeam.get(teamIdStr) || [];
    if (!currentList.some((item) => String(item._id) === recruiterIdStr)) {
      currentList.push({
        _id: m.userId._id || m.userId,
        name: m.userId.name || 'Unknown Recruiter',
        email: m.userId.email || '',
        role: m.userId.role === 'recruiter' ? 'recruiter' : m.role,
        isActive: m.userId.isActive !== false
      });
      membersByTeam.set(teamIdStr, currentList);
    }
    
    // Map recruiter -> team
    teamByRecruiter.set(recruiterIdStr, teamIdStr);
  });

  const recruiterById = recruiters.reduce((map, recruiter) => {
    map.set(String(recruiter._id), recruiter);
    return map;
  }, new Map());

  const allRecruiterIds = recruiters.map((recruiter) => String(recruiter._id));
  const recruiterObjectIds = recruiters.map((recruiter) => recruiter._id);
  const activeRecruiterIdSet = new Set(
    recruiters.filter((recruiter) => recruiter.isActive !== false).map((recruiter) => String(recruiter._id))
  );

  // 2. Fetch activity & records
  const [
    allJobs,
    candidateWindow,
    detailedActivityLogs,
    periodAnalysisUsage
  ] = await Promise.all([
    Job.find({ organizationId: orgId })
      .select('_id recruiterId teamId title role status createdAt updatedAt stack')
      .lean(),
    Candidate.find({ createdBy: { $in: recruiterObjectIds }, createdAt: { $gte: previousSince } })
      .select('createdBy fullName createdAt stack githubScore resumeScore growthPotentialScore skillGaps aiInsight')
      .lean(),
    AuditLog.find({ organizationId: orgId, actor: { $in: recruiterObjectIds }, timestamp: { $gte: since } })
      .select('_id actor teamId action method route statusCode timestamp')
      .lean(),
    AuditLog.aggregate([
      {
        $match: {
          organizationId: orgId,
          actor: { $in: recruiterObjectIds },
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
          currentMatchCalls: {
            $sum: {
              $cond: [{ $and: ['$isMatch', { $gte: ['$timestamp', since] }] }, 1, 0]
            }
          },
          currentAiRankCalls: {
            $sum: {
              $cond: [{ $and: ['$isAiRank', { $gte: ['$timestamp', since] }] }, 1, 0]
            }
          }
        }
      }
    ])
  ]);

  // 3. Process jobs
  const jobsByRecruiter = new Map();
  const openJobsByRecruiter = new Map();
  const closedJobsByRecruiter = new Map();
  const openJobsByTeam = new Map();
  const closedJobsByTeam = new Map();
  const jobsByTeam = new Map();
  const recentJobsListByTeam = new Map();

  allJobs.forEach((job) => {
    const recruiterId = String(job.recruiterId || '');
    if (!recruiterId) return;

    const teamId = String(job.teamId || teamByRecruiter.get(recruiterId) || '');

    // Track by recruiter
    jobsByRecruiter.set(recruiterId, (jobsByRecruiter.get(recruiterId) || 0) + 1);
    if (job.status === 'open') openJobsByRecruiter.set(recruiterId, (openJobsByRecruiter.get(recruiterId) || 0) + 1);
    if (job.status === 'closed') closedJobsByRecruiter.set(recruiterId, (closedJobsByRecruiter.get(recruiterId) || 0) + 1);

    // Track by team
    if (teamId) {
      jobsByTeam.set(teamId, (jobsByTeam.get(teamId) || 0) + 1);
      if (job.status === 'open') openJobsByTeam.set(teamId, (openJobsByTeam.get(teamId) || 0) + 1);
      if (job.status === 'closed') closedJobsByTeam.set(teamId, (closedJobsByTeam.get(teamId) || 0) + 1);

      const jobSummary = {
        _id: job._id,
        title: String(job.title || job.role || 'Untitled role').trim() || 'Untitled role',
        status: String(job.status || 'open'),
        stack: String(job.stack || 'Other').trim() || 'Other',
        createdAt: job.createdAt,
        updatedAt: job.updatedAt || job.createdAt
      };

      if (isWithinWindow(job.createdAt, since)) {
        pushLimited(recentJobsListByTeam, teamId, jobSummary);
      }
    }
  });

  // 4. Process AI usages
  const recentAnalysesByRecruiter = new Map();
  const matchCallsByRecruiter = new Map();
  const aiRankCallsByRecruiter = new Map();

  periodAnalysisUsage.forEach((item) => {
    const recruiterId = String(item._id || '');
    recentAnalysesByRecruiter.set(recruiterId, Number(item.currentCount || 0));
    matchCallsByRecruiter.set(recruiterId, Number(item.currentMatchCalls || 0));
    aiRankCallsByRecruiter.set(recruiterId, Number(item.currentAiRankCalls || 0));
  });

  // 5. Process activity & timeline
  const recentActivityByTeam = new Map();
  const activityTimelineByTeam = new Map();

  detailedActivityLogs.forEach((log) => {
    const recruiterId = String(log.actor || '');
    if (!recruiterId) return;

    const recruiter = recruiterById.get(recruiterId);
    const route = String(log.route || '');
    const teamId = String(log.teamId || teamByRecruiter.get(recruiterId) || '');
    if (!teamId) return;

    // Determine Timeline Action Event
    let timelineEvent = null;
    if (log.action && (log.action.includes('assign') || log.action.includes('add recruiter'))) {
      timelineEvent = 'Recruiter Assigned';
    } else if (log.action && log.action.includes('remove recruiter')) {
      timelineEvent = 'Recruiter Removed';
    } else if (route.includes('/recruiters') && log.method === 'POST') {
      timelineEvent = 'Recruiter Assigned';
    } else if (route.includes('/recruiters') && log.method === 'DELETE') {
      timelineEvent = 'Recruiter Removed';
    } else if (route.includes('/jobs') && log.method === 'POST') {
      timelineEvent = 'Job Created';
    } else if (route.includes('/match') && log.method === 'POST') {
      timelineEvent = 'Match Generated';
    } else if (route.includes('/ai-rank') && log.method === 'POST') {
      timelineEvent = 'AI Ranking Run';
    } else if (route.includes('/analyze') && log.method === 'POST') {
      timelineEvent = 'Candidate Analyzed';
    }

    const activityItem = {
      _id: log._id,
      action: String(log.action || route || 'Activity').trim() || 'Activity',
      timelineEvent: timelineEvent || 'Activity',
      method: String(log.method || '').trim(),
      route,
      statusCode: Number(log.statusCode || 0),
      timestamp: log.timestamp,
      actorName: recruiter?.name || recruiter?.email || 'Recruiter'
    };

    pushLimited(recentActivityByTeam, teamId, activityItem);

    // Build timeline specific list (only actions that match our specific timeline events)
    if (timelineEvent) {
      pushLimited(activityTimelineByTeam, teamId, activityItem, 15);
    }
  });

  // 6. Process candidates
  const candidatesByRecruiter = new Map();
  const recentCandidatesByTeam = new Map();
  const candidatesByTeam = new Map();

  candidateWindow.forEach((candidate) => {
    const recruiterId = String(candidate.createdBy || '');
    if (!recruiterId) return;

    const teamId = String(teamByRecruiter.get(recruiterId) || '');
    if (!teamId) return;

    if (isWithinWindow(candidate.createdAt, since)) {
      candidatesByRecruiter.set(recruiterId, (candidatesByRecruiter.get(recruiterId) || 0) + 1);
      candidatesByTeam.set(teamId, (candidatesByTeam.get(teamId) || 0) + 1);

      const candidateSummary = {
        fullName: String(candidate.fullName || 'Candidate').trim() || 'Candidate',
        stack: String(candidate.stack || 'Other').trim() || 'Other',
        createdAt: candidate.createdAt
      };
      pushLimited(recentCandidatesByTeam, teamId, candidateSummary);
    }
  });

  // 7. Map & calculate final team metrics
  const teamMetrics = teams.map((team) => {
    const teamId = String(team._id);
    const teamMembers = membersByTeam.get(teamId) || [];
    const recruiterIdsForTeam = teamMembers.map(m => String(m._id));

    // Stats
    const openJobs = openJobsByTeam.get(teamId) || 0;
    const closedJobs = closedJobsByTeam.get(teamId) || 0;
    const totalJobs = jobsByTeam.get(teamId) || 0;
    
    const candidatesAnalyzed = candidatesByTeam.get(teamId) || 0;
    const aiUsage = recruiterIdsForTeam.reduce((sum, rId) => sum + (aiRankCallsByRecruiter.get(rId) || 0), 0);
    const matchesGenerated = recruiterIdsForTeam.reduce((sum, rId) => sum + (matchCallsByRecruiter.get(rId) || 0), 0);
    const activeMembers = teamMembers.filter((m) => activeRecruiterIdSet.has(String(m._id))).length;
    
    const teamRecentActions = recentActivityByTeam.get(teamId) || [];
    const activityCount = teamRecentActions.length;
    
    // Formula:
    // (openJobs * 20 + matchesGenerated * 25 + candidatesAnalyzed * 20 + activeMembers * 15 + aiUsage * 10 + activityCount * 10)
    const rawScore = (
      openJobs * 20 +
      matchesGenerated * 25 +
      candidatesAnalyzed * 20 +
      activeMembers * 15 +
      aiUsage * 10 +
      activityCount * 10
    );
    const performanceScore = clamp(rawScore, 0, 100);

    // Health Status
    let health = 'Critical';
    if (performanceScore >= 70) {
      health = 'Healthy';
    } else if (performanceScore >= 30) {
      health = 'Warning';
    }

    const teamTimeline = activityTimelineByTeam.get(teamId) || [];

    return {
      _id: team._id,
      name: team.name,
      slug: team.slug,
      description: team.description || '',
      isActive: team.isActive !== false,
      members: teamMembers,
      memberCount: teamMembers.length,
      activeMembers,
      recruiterCount: teamMembers.length, // recruiters assigned
      
      totalJobs,
      openJobs,
      closedJobs,
      candidatesAnalyzed,
      aiUsage,
      matchesGenerated,
      
      performanceScore,
      health,
      
      activityCount,
      activityTimeline: teamTimeline,
      recentActions: teamRecentActions,
      recentJobsList: recentJobsListByTeam.get(teamId) || [],
      recentCandidates: recentCandidatesByTeam.get(teamId) || [],
      createdAt: team.createdAt
    };
  });

  return { teamMetrics, recruiters, memberships };
};

module.exports = {
  computeOrgTeamsMetrics
};
