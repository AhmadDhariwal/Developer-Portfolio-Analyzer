const { getRecruiterScope } = require('../../utils/recruiter-hub/recruiterAccess');
const { listRecruiterActivities } = require('../../services/recruiter-hub/recruiterActivityService');

const getActivity = async (req, res) => {
  try {
    const scope = await getRecruiterScope(req);
    const activity = await listRecruiterActivities({
      recruiterId: scope.recruiterId,
      organizationId: scope.organizationId,
      query: req.query || {}
    });
    return res.status(200).json(activity);
  } catch (error) {
    console.error('Recruiter hub activity error:', error.message);
    return res.status(error.statusCode || 500).json({ message: error.message || 'Failed to load recruiter activity.' });
  }
};

module.exports = {
  getActivity
};
