const { listRecruiterAnalytics } = require('../../services/recruiter-hub/recruiterAnalyticsService');

const getAnalytics = async (req, res) => {
  try {
    const analytics = await listRecruiterAnalytics(req);
    return res.status(200).json(analytics);
  } catch (error) {
    console.error('Recruiter hub analytics error:', error.message);
    return res.status(error.statusCode || 500).json({ message: error.message || 'Failed to load recruiter analytics.' });
  }
};

module.exports = {
  getAnalytics
};
