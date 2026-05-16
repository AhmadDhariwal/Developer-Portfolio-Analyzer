const { getRecruiterDashboard } = require('../../services/recruiter-hub/recruiterDashboardService');

const getDashboard = async (req, res) => {
  try {
    const dashboard = await getRecruiterDashboard(req);
    return res.status(200).json(dashboard);
  } catch (error) {
    console.error('Recruiter hub dashboard error:', error.message);
    return res.status(error.statusCode || 500).json({ message: error.message || 'Failed to load recruiter dashboard.' });
  }
};

module.exports = {
  getDashboard
};
