const RecruiterShortlist = require('../../models/RecruiterShortlist');
const RecruiterMatch = require('../../models/RecruiterMatch');
const Job = require('../../models/Job');
const { lockOwnedJob } = require('../matching/jobLifecycleService');
const { requireObjectId, invalidInput } = require('../../utils/recruiterValidation');
const { getRecruiterCandidateDetails, getRecruiterCandidatesByIds } = require('./candidateService');
const { getRecruiterJobDetails } = require('./recruiterJobService');

const SHORTLIST_STATUSES = new Set([
  'shortlisted',
  'reviewing',
  'contacted',
  'interview',
  'rejected'
]);

const normalizeStatus = (value) => {
  const status = String(value || 'shortlisted')
    .trim()
    .toLowerCase();
  if (!SHORTLIST_STATUSES.has(status)) throw invalidInput('Shortlist status is invalid.');
  return status;
};

const hydrateShortlists = async ({ recruiterId, organizationId, items }) => {
  const jobIds = [
    ...new Set(items.map((item) => item.jobId && String(item.jobId)).filter(Boolean))
  ];
  const [candidates, jobs] = await Promise.all([
    getRecruiterCandidatesByIds(
      items.map((item) => item.candidateId),
      organizationId
    ),
    jobIds.length ? Job.find({ _id: { $in: jobIds }, recruiterId, organizationId }).lean() : []
  ]);
  const jobMap = new Map(jobs.map((job) => [String(job._id), job]));
  return items
    .filter(
      (item) =>
        candidates.get(String(item.candidateId)) && (!item.jobId || jobMap.has(String(item.jobId)))
    )
    .map((item) => ({
      ...item,
      candidate: candidates.get(String(item.candidateId)),
      job: jobMap.get(String(item.jobId)) || null
    }));
};

const syncMatchStatus = async (item, status, session) => {
  if (!item.jobId) return;
  const { recruiterId, organizationId, candidateId, jobId } = item;
  await RecruiterMatch.updateMany(
    { recruiterId, organizationId, candidateId, jobId },
    { $set: { status } },
    { session }
  );
};

const shortlistMatchStatus = (status) => (status === 'rejected' ? 'rejected' : 'shortlisted');

const addToShortlist = async ({ recruiterId, organizationId, teamIds = [], payload = {} }) => {
  const id = requireObjectId(payload.candidateId, 'candidateId');
  const jobId = payload.jobId ? requireObjectId(payload.jobId, 'jobId') : null;
  const status = normalizeStatus(payload.status);
  const candidate = await getRecruiterCandidateDetails(id, organizationId);
  if (!candidate) throw Object.assign(new Error('Candidate not found.'), { statusCode: 404 });

  return RecruiterShortlist.db.transaction(async (session) => {
    if (jobId) await lockOwnedJob({ jobId, recruiterId, organizationId, session });
    const job = jobId && (await Job.findById(jobId).session(session).select('teamId').lean());
    const shortlist = await RecruiterShortlist.findOneAndUpdate(
      { recruiterId, organizationId, candidateId: candidate.userId, jobId },
      {
        $set: {
          teamId: jobId ? job.teamId : teamIds[0] || null,
          notes: String(payload.notes || '').trim(),
          status
        }
      },
      { session, upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();
    await syncMatchStatus(shortlist, shortlistMatchStatus(status), session);
    return shortlist;
  });
};

const listShortlists = async ({ recruiterId, organizationId, query = {} }) => {
  const filter = { recruiterId, organizationId };
  if (query.jobId) filter.jobId = requireObjectId(query.jobId, 'jobId');
  if (query.status) filter.status = normalizeStatus(query.status);
  const items = await RecruiterShortlist.find(filter).sort({ updatedAt: -1 }).lean();
  return hydrateShortlists({ recruiterId, organizationId, items });
};

const updateShortlist = async ({ recruiterId, organizationId, shortlistId, payload = {} }) => {
  const filter = { _id: requireObjectId(shortlistId, 'shortlistId'), recruiterId, organizationId };
  const existing = await RecruiterShortlist.findOne(filter).select('candidateId jobId').lean();
  if (!existing) return null;
  const [visible, job] = await Promise.all([
    getRecruiterCandidateDetails(existing.candidateId, organizationId),
    existing.jobId
      ? getRecruiterJobDetails({ recruiterId, organizationId, jobId: existing.jobId })
      : true
  ]);
  if (!visible || !job) return null;
  const update = {};
  if (payload.notes !== undefined) update.notes = String(payload.notes || '').trim();
  if (payload.status !== undefined) update.status = normalizeStatus(payload.status);

  const shortlist = await RecruiterShortlist.db.transaction(async (session) => {
    const item = await RecruiterShortlist.findOneAndUpdate(
      filter,
      { $set: update },
      { session, new: true, runValidators: true }
    ).lean();
    if (item && update.status)
      await syncMatchStatus(item, shortlistMatchStatus(item.status), session);
    return item;
  });
  if (!shortlist) return null;
  const [hydrated] = await hydrateShortlists({ recruiterId, organizationId, items: [shortlist] });
  return hydrated || null;
};

const removeShortlist = async ({ recruiterId, organizationId, shortlistId }) => {
  const filter = { _id: requireObjectId(shortlistId, 'shortlistId'), recruiterId, organizationId };
  return RecruiterShortlist.db.transaction(async (session) => {
    const shortlist = await RecruiterShortlist.findOneAndDelete(filter, { session }).lean();
    if (shortlist) await syncMatchStatus(shortlist, 'generated', session);
    return shortlist;
  });
};

module.exports = { addToShortlist, listShortlists, updateShortlist, removeShortlist };
