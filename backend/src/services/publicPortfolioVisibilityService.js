const PlatformSettings = require('../models/platformSettings');

// Publication is a security boundary: the platform settings service's process
// snapshot can lag an administrator's revocation on another worker.
async function isPortfolioEnabled() {
  const settings = await PlatformSettings.findOne({ scope: 'global' })
    .select('developer.publicPortfolioVisibility')
    .lean();
  return settings?.developer?.publicPortfolioVisibility !== false;
}
module.exports = { isPortfolioEnabled };
