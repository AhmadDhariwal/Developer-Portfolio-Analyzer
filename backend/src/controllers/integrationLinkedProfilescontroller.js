const profiles = require('../services/integrationLinkedProfileService');

function failure(res, error) {
  return res.status(error.status || 503).json({
    message: error.status ? error.message : 'Linked profile storage is temporarily unavailable.'
  });
}

async function getLinkedProfile(req, res) {
  try {
    return res.json({ linkedProfile: await profiles.get(req.user._id) });
  } catch (error) {
    return failure(res, error);
  }
}

async function saveLinkedProfile(req, res) {
  try {
    return res.json({ linkedProfile: await profiles.save(req.user._id, req.body?.profile) });
  } catch (error) {
    return failure(res, error);
  }
}

async function removeLinkedProfile(req, res) {
  try {
    await profiles.remove(req.user._id);
    return res.json({ linkedProfile: null });
  } catch (error) {
    return failure(res, error);
  }
}

module.exports = { getLinkedProfile, saveLinkedProfile, removeLinkedProfile };

module.exports.kaggle = {
  async get(req, res) {
    try {
      return res.json({ linkedProfile: await profiles.get(req.user._id, 'kaggle') });
    } catch (error) {
      return failure(res, error);
    }
  },
  async save(req, res) {
    try {
      return res.json({
        linkedProfile: await profiles.save(req.user._id, req.body?.profile, 'kaggle')
      });
    } catch (error) {
      return res.status(error.status || 503).json({
        message:
          error.status === 400
            ? 'Enter a Kaggle username or an HTTPS Kaggle profile URL.'
            : 'Linked profile storage is temporarily unavailable.'
      });
    }
  },
  async remove(req, res) {
    try {
      await profiles.remove(req.user._id, 'kaggle');
      return res.json({ linkedProfile: null });
    } catch (error) {
      return failure(res, error);
    }
  }
};
