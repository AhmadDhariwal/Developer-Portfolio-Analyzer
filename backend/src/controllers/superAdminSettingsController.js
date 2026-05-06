const { getSettings, updateSettings } = require('../services/platformSettingsService');

const getPlatformSettings = async (req, res) => {
  try {
    const settings = await getSettings();
    return res.json({ settings });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to load platform settings', error: error?.message });
  }
};

const updatePlatformSettings = async (req, res) => {
  try {
    const settings = await updateSettings(req.body || {}, req.user?._id || null);
    return res.json({ message: 'Settings updated successfully.', settings });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to update platform settings', error: error?.message });
  }
};

module.exports = {
  getPlatformSettings,
  updatePlatformSettings
};

