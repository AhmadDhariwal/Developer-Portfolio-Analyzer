const AuditLog = require('../../models/auditLog');
const Job = require('../../models/Job');
const { getRecruiterCandidateDetails } = require('./candidateService');

const buildDateFilter = ({ from, to }) => {
  const filter = {};
  if (from) filter.$gte = new Date(from);
  if (to) filter.$lte = new Date(to);
  return Object.keys(filter).length > 0 ? filter : null;
};

const buildRecruiterActivityFilter = ({ recruiterId, organizationId, query = {} }) => {
  const filter = {
    actor: recruiterId,
    organizationId
  };

  if (query.action) filter.action = String(query.action);
  const timestamp = buildDateFilter(query);
  if (timestamp) filter.timestamp = timestamp;
  if (query.jobId) filter['after.jobId'] = String(query.jobId);
  if (query.candidateId) filter['after.candidateId'] = String(query.candidateId);
  return filter;
};

const listRecruiterActivities = async ({ recruiterId, organizationId, query = {} }) => {
  const filter = buildRecruiterActivityFilter({ recruiterId, organizationId, query });
  const logs = await AuditLog.find(filter)
    .sort({ timestamp: -1 })
    .limit(Math.min(200, Math.max(1, Number(query.limit || 100))))
    .lean();

  const jobIds = [...new Set(logs.map((log) => String(log?.after?.jobId || '')).filter(Boolean))];
  const candidateIds = [...new Set(logs.map((log) => String(log?.after?.candidateId || '')).filter(Boolean))];

  const [jobs, candidates] = await Promise.all([
    jobIds.length > 0 ? Job.find({ _id: { $in: jobIds }, recruiterId, organizationId }).select('_id title').lean() : [],
    Promise.all(candidateIds.map((candidateId) => getRecruiterCandidateDetails(candidateId, organizationId)))
  ]);

  const jobMap = new Map(jobs.map((job) => [String(job._id), job]));
  const candidateMap = new Map(candidates.filter(Boolean).map((candidate) => [String(candidate.id || candidate.userId), candidate]));

  return {
    logs: logs.map((log) => ({
      ...log,
      job: log?.after?.jobId ? jobMap.get(String(log.after.jobId)) || null : null,
      candidate: log?.after?.candidateId ? candidateMap.get(String(log.after.candidateId)) || null : null
    })),
    filters: {
      actions: [...new Set(logs.map((log) => String(log.action || '')).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
      jobs: jobs.map((job) => ({ _id: String(job._id), title: job.title })),
      candidates: candidates
        .filter(Boolean)
        .map((candidate) => ({ _id: String(candidate.id || candidate.userId), name: candidate.name }))
    }
  };
};

module.exports = {
  listRecruiterActivities
};
