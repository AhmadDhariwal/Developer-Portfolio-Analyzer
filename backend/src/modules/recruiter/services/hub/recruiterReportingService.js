const mongoose = require('mongoose');
const AuditLog = require('../../../admin/models/auditLog');
const Job = require('../../models/Job');
const RecruiterMatch = require('../../models/RecruiterMatch');
const { getCandidatesByIds } = require('../matching/matchingService');

const CANDIDATE_ANALYZED = 'RECRUITER_CANDIDATE_ANALYZED';
const MATCH_GENERATED = 'RECRUITER_MATCH_GENERATED';
const LEGACY_MATCH = /^\/api\/recruiter\/match(?:\?|$)/;
const LEGACY_RANK = /^\/api\/recruiter\/ai-rank(?:\?|$)/;
const usageFilter = {
  statusCode: { $gte: 200, $lt: 300 },
  $or: [
    { action: { $in: [CANDIDATE_ANALYZED, MATCH_GENERATED] } },
    { route: LEGACY_MATCH },
    { route: LEGACY_RANK }
  ]
};

const isRecruiterUsage = ({ action, route = '', statusCode }) =>
  statusCode >= 200 &&
  statusCode < 300 &&
  ([CANDIDATE_ANALYZED, MATCH_GENERATED].includes(action) || LEGACY_MATCH.test(route) || LEGACY_RANK.test(route));

const aggregateUsage = async ({ organizationId, actorIds, since, previousSince, teamId, visibleOnly }) => {
  const tenant = new mongoose.Types.ObjectId(organizationId);
  const scope = {
    organizationId: tenant,
    actor: { $in: actorIds },
    ...(teamId && { teamId: new mongoose.Types.ObjectId(teamId) }),
    ...(visibleOnly && { deleted: { $ne: true } }),
    ...usageFilter
  };
  if (!since) {
    return AuditLog.aggregate([{ $match: scope }, { $group: { _id: '$actor', count: { $sum: 1 } } }]);
  }
  const current = { $gte: ['$timestamp', since] };
  const previous = { $lt: ['$timestamp', since] };
  const isMatch = {
    $or: [
      { $eq: ['$action', MATCH_GENERATED] },
      { $regexMatch: { input: { $ifNull: ['$route', ''] }, regex: LEGACY_MATCH } }
    ]
  };
  const isRank = {
    $or: [
      { $eq: ['$action', CANDIDATE_ANALYZED] },
      { $regexMatch: { input: { $ifNull: ['$route', ''] }, regex: LEGACY_RANK } }
    ]
  };
  const count = (...conditions) => ({ $sum: { $cond: [{ $and: conditions }, 1, 0] } });
  return AuditLog.aggregate([
    { $match: { ...scope, timestamp: { $gte: previousSince } } },
    {
      $group: {
        _id: '$actor',
        currentCount: count(current),
        previousCount: count(previous),
        currentMatchCalls: count(isMatch, current),
        previousMatchCalls: count(isMatch, previous),
        currentAiRankCalls: count(isRank, current),
        previousAiRankCalls: count(isRank, previous)
      }
    }
  ]);
};

const listAnalyzedCandidates = async ({ organizationId, actorIds, since, stack, teamId, visibleOnly }) => {
  const logs = await AuditLog.find({
    organizationId,
    actor: { $in: actorIds },
    action: CANDIDATE_ANALYZED,
    timestamp: { $gte: since },
    ...(visibleOnly && { deleted: { $ne: true } }),
    ...(teamId && { teamId })
  })
    .sort({ timestamp: -1 })
    .select('actor timestamp after.candidateId')
    .lean();
  const candidates = await getCandidatesByIds(
    logs.map((event) => event.after?.candidateId),
    { organizationId }
  );
  return logs.flatMap((event) => {
    const candidate = candidates.get(String(event.after?.candidateId));
    if (!candidate || (stack && candidate.stack !== stack)) return [];
    return [
      {
        ...candidate,
        createdBy: event.actor,
        createdAt: event.timestamp,
        aiInsight: { summary: 'Candidate analyzed' }
      }
    ];
  });
};

const getRecruiterReportingSnapshot = async (recruiter) => {
  const organizationId = recruiter.organizationId?._id || recruiter.organizationId;
  const recruiterId = recruiter._id;
  const jobFilter = { recruiterId, organizationId };
  const analysisFilter = { actor: recruiterId, organizationId, action: CANDIDATE_ANALYZED };
  const [totalCandidatesAnalyzed, matchesGenerated, totalJobs, closedJobs, lastAnalysis, lastJob] =
    organizationId
      ? await Promise.all([
          AuditLog.countDocuments(analysisFilter),
          RecruiterMatch.countDocuments(jobFilter),
          Job.countDocuments(jobFilter),
          Job.countDocuments({ ...jobFilter, status: 'closed' }),
          AuditLog.findOne(analysisFilter).sort({ timestamp: -1 }).select('timestamp').lean(),
          Job.findOne(jobFilter).sort({ updatedAt: -1 }).select('updatedAt').lean()
        ])
      : [0, 0, 0, 0];
  const lastActive = [lastAnalysis?.timestamp, lastJob?.updatedAt, recruiter.createdAt]
    .filter(Boolean)
    .sort((a, b) => b - a)[0];
  const daysSince = lastActive ? Math.floor((Date.now() - lastActive) / 86400000) : 50;
  return {
    totalCandidatesAnalyzed,
    matchesGenerated,
    hiringRate: totalJobs ? Math.round((closedJobs / totalJobs) * 100) : 0,
    activityScore: Math.max(0, Math.min(100, 100 - daysSince * 2)),
    lastActive
  };
};

module.exports = {
  CANDIDATE_ANALYZED,
  aggregateUsage,
  isRecruiterUsage,
  listAnalyzedCandidates,
  getRecruiterReportingSnapshot
};
