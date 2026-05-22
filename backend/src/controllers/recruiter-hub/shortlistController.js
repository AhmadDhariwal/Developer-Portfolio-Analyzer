const { getRecruiterScope } = require('../../utils/recruiter-hub/recruiterAccess');
const AuditLog = require('../../models/auditLog');
const {
  addToShortlist,
  listShortlists,
  updateShortlist,
  removeShortlist
} = require('../../services/recruiter-hub/shortlistService');

const createShortlist = async (req, res) => {
  try {
    const scope = await getRecruiterScope(req);
    const shortlist = await addToShortlist({ ...scope, payload: req.body || {} });
    await AuditLog.create({
      actor: scope.recruiterId,
      organizationId: scope.organizationId,
      teamId: scope.teamIds[0] || null,
      action: 'RECRUITER_SHORTLIST_CREATED',
      method: 'POST',
      route: req.originalUrl,
      before: null,
      after: {
        shortlistId: String(shortlist?._id || ''),
        candidateId: String(shortlist?.candidateId || req.body?.candidateId || ''),
        jobId: String(shortlist?.jobId || req.body?.jobId || ''),
        status: String(shortlist?.status || '')
      },
      statusCode: 201,
      timestamp: new Date()
    });
    return res.status(201).json({ shortlist });
  } catch (error) {
    console.error('Recruiter hub create shortlist error:', error.message);
    return res.status(error.statusCode || 500).json({ message: error.message || 'Failed to shortlist candidate.' });
  }
};

const getShortlists = async (req, res) => {
  try {
    const scope = await getRecruiterScope(req);
    const shortlists = await listShortlists({ ...scope, query: req.query || {} });
    return res.status(200).json({ shortlists });
  } catch (error) {
    console.error('Recruiter hub list shortlists error:', error.message);
    return res.status(error.statusCode || 500).json({ message: error.message || 'Failed to load shortlists.' });
  }
};

const patchShortlist = async (req, res) => {
  try {
    const scope = await getRecruiterScope(req);
    const shortlist = await updateShortlist({ ...scope, shortlistId: req.params.id, payload: req.body || {} });
    if (!shortlist) return res.status(404).json({ message: 'Shortlist entry not found.' });
    await AuditLog.create({
      actor: scope.recruiterId,
      organizationId: scope.organizationId,
      teamId: scope.teamIds[0] || null,
      action: 'RECRUITER_SHORTLIST_UPDATED',
      method: 'PATCH',
      route: req.originalUrl,
      before: null,
      after: {
        shortlistId: String(shortlist?._id || req.params.id || ''),
        candidateId: String(shortlist?.candidateId || ''),
        jobId: String(shortlist?.jobId || ''),
        status: String(shortlist?.status || '')
      },
      statusCode: 200,
      timestamp: new Date()
    });
    return res.status(200).json({ shortlist });
  } catch (error) {
    console.error('Recruiter hub patch shortlist error:', error.message);
    return res.status(error.statusCode || 500).json({ message: error.message || 'Failed to update shortlist.' });
  }
};

const deleteShortlist = async (req, res) => {
  try {
    const scope = await getRecruiterScope(req);
    const shortlist = await removeShortlist({ ...scope, shortlistId: req.params.id });
    if (!shortlist) return res.status(404).json({ message: 'Shortlist entry not found.' });
    await AuditLog.create({
      actor: scope.recruiterId,
      organizationId: scope.organizationId,
      teamId: scope.teamIds[0] || null,
      action: 'RECRUITER_SHORTLIST_REMOVED',
      method: 'DELETE',
      route: req.originalUrl,
      before: {
        shortlistId: String(shortlist?._id || req.params.id || ''),
        candidateId: String(shortlist?.candidateId || ''),
        jobId: String(shortlist?.jobId || '')
      },
      after: null,
      statusCode: 200,
      timestamp: new Date()
    });
    return res.status(200).json({ message: 'Shortlist removed successfully.' });
  } catch (error) {
    console.error('Recruiter hub delete shortlist error:', error.message);
    return res.status(error.statusCode || 500).json({ message: error.message || 'Failed to remove shortlist.' });
  }
};

module.exports = {
  createShortlist,
  getShortlists,
  patchShortlist,
  deleteShortlist
};
