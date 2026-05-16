const RecruiterShortlist = require('../../models/RecruiterShortlist');
const RecruiterMatch = require('../../models/RecruiterMatch');
const { getRecruiterCandidateDetails } = require('./candidateService');
const { getRecruiterJobDetails } = require('./recruiterJobService');

const addToShortlist = async ({ recruiterId, organizationId, teamIds = [], payload = {} }) => {
  const candidateId = String(payload.candidateId || '').trim();
  const jobId = String(payload.jobId || '').trim() || null;
  if (!candidateId) {
    const error = new Error('candidateId is required.');
    error.statusCode = 400;
    throw error;
  }

  const shortlist = await RecruiterShortlist.findOneAndUpdate(
    {
      recruiterId,
      organizationId,
      candidateId,
      jobId
    },
    {
      $set: {
        teamId: teamIds[0] || null,
        notes: String(payload.notes || '').trim(),
        status: String(payload.status || 'shortlisted').trim()
      }
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();

  if (jobId) {
    await RecruiterMatch.updateMany(
      { recruiterId, organizationId, candidateId, jobId },
      { $set: { status: 'shortlisted' } }
    );
  }

  return shortlist;
};

const listShortlists = async ({ recruiterId, organizationId, query = {} }) => {
  const filter = { recruiterId, organizationId };
  if (query.jobId) filter.jobId = String(query.jobId);
  if (query.status) filter.status = String(query.status);

  const items = await RecruiterShortlist.find(filter)
    .sort({ updatedAt: -1 })
    .lean();

  const hydrated = await Promise.all(items.map(async (item) => ({
    ...item,
    candidate: await getRecruiterCandidateDetails(item.candidateId),
    job: item.jobId ? await getRecruiterJobDetails({ recruiterId, organizationId, jobId: item.jobId }) : null
  })));

  return hydrated;
};

const updateShortlist = async ({ recruiterId, organizationId, shortlistId, payload = {} }) => {
  return RecruiterShortlist.findOneAndUpdate(
    { _id: shortlistId, recruiterId, organizationId },
    {
      $set: {
        notes: payload.notes !== undefined ? String(payload.notes || '').trim() : undefined,
        status: payload.status !== undefined ? String(payload.status || 'shortlisted').trim() : undefined
      }
    },
    { new: true }
  ).lean();
};

const removeShortlist = async ({ recruiterId, organizationId, shortlistId }) => {
  return RecruiterShortlist.findOneAndDelete({ _id: shortlistId, recruiterId, organizationId }).lean();
};

module.exports = {
  addToShortlist,
  listShortlists,
  updateShortlist,
  removeShortlist
};
