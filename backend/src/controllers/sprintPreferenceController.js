'use strict';

const { getPreference, setPreference } = require('../services/sprintPreferenceService');
const action = (operation) => async (req, res) => {
  if (!req.user?._id) return res.status(401).json({ message: 'Authentication required.' });
  try {
    res.json(await operation(req));
  } catch (error) {
    res.status(error.statusCode === 400 ? 400 : 500).json({
      message:
        error.statusCode === 400
          ? 'A valid IANA timeZone is required; no other fields are accepted.'
          : 'Unable to update Sprint preferences.'
    });
  }
};
module.exports = {
  read: action((req) => getPreference(req.user._id)),
  update: action((req) => setPreference(req.user._id, req.body))
};
