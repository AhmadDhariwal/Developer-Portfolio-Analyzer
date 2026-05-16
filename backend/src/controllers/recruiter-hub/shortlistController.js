const { getRecruiterScope } = require('../../utils/recruiter-hub/recruiterAccess');
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
