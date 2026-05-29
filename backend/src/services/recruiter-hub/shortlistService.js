const RecruiterShortlist = require('../../models/RecruiterShortlist');
const RecruiterMatch = require('../../models/RecruiterMatch');
const { getRecruiterCandidateDetails } = require('./candidateService');
const { getRecruiterJobDetails } = require('./recruiterJobService');

const SHORTLIST_STATUSES = new Set(['shortlisted', 'reviewing', 'contacted', 'interview', 'rejected']);

const normalizeStatus = (value, fallback = 'shortlisted') => {
  const status = String(value || fallback).trim().toLowerCase();
  if (!SHORTLIST_STATUSES.has(status)) {
    const error = new Error('Shortlist status is invalid.');
    error.statusCode = 400;
    throw error;
  }
  return status;
};

const hydrateShortlist = async ({ recruiterId, organizationId, item }) => {
  if (!item) return null;

  return {
    ...item,
    candidate: await getRecruiterCandidateDetails(item.candidateId, organizationId),
    job: item.jobId
      ? await getRecruiterJobDetails({ recruiterId, organizationId, jobId: item.jobId })
      : null
  };
};

const addToShortlist = async ({ recruiterId, organizationId, teamIds = [], payload = {} }) => {
  const candidateId = String(payload.candidateId || '').trim();
  const jobId = String(payload.jobId || '').trim() || null;
  if (!candidateId) {
    const error = new Error('candidateId is required.');
    error.statusCode = 400;
    throw error;
  }

  const candidate = await getRecruiterCandidateDetails(candidateId, organizationId);
  if (!candidate) {
    const error = new Error('Candidate not found.');
    error.statusCode = 404;
    throw error;
  }

  if (jobId) {
    const job = await getRecruiterJobDetails({ recruiterId, organizationId, jobId });
    if (!job) {
      const error = new Error('Job not found.');
      error.statusCode = 404;
      throw error;
    }
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
        status: normalizeStatus(payload.status, 'shortlisted')
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

  const hydrated = await Promise.all(
    items.map((item) => hydrateShortlist({ recruiterId, organizationId, item })),
  );

  return hydrated;
};

const updateShortlist = async ({ recruiterId, organizationId, shortlistId, payload = {} }) => {
  const update = {};

  if (payload.notes !== undefined) {
    update.notes = String(payload.notes || '').trim();
  }

  if (payload.status !== undefined) {
    update.status = normalizeStatus(payload.status, 'shortlisted');
  }

  const shortlist = await RecruiterShortlist.findOneAndUpdate(
    { _id: shortlistId, recruiterId, organizationId },
    Object.keys(update).length > 0 ? { $set: update } : {},
    { new: true, runValidators: true }
  ).lean();

  if (!shortlist) return null;

  if (shortlist.jobId) {
    const nextMatchStatus = shortlist.status === 'rejected' ? 'rejected' : 'shortlisted';
    await RecruiterMatch.updateMany(
      { recruiterId, organizationId, candidateId: shortlist.candidateId, jobId: shortlist.jobId },
      { $set: { status: nextMatchStatus } }
    );
  }

  return hydrateShortlist({ recruiterId, organizationId, item: shortlist });
};

const removeShortlist = async ({ recruiterId, organizationId, shortlistId }) => {
  const shortlist = await RecruiterShortlist.findOneAndDelete({ _id: shortlistId, recruiterId, organizationId }).lean();
  if (!shortlist) return null;

  if (shortlist.jobId) {
    await RecruiterMatch.updateMany(
      { recruiterId, organizationId, candidateId: shortlist.candidateId, jobId: shortlist.jobId },
      { $set: { status: 'generated' } }
    );
  }

  return shortlist;
};

module.exports = {
  addToShortlist,
  listShortlists,
  updateShortlist,
  removeShortlist
};
