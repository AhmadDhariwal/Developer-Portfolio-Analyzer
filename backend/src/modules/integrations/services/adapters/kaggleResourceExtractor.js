const resources = require('./kaggleResources');

// Shared extraction accepted through the isolated resource lifecycle.
async function ingestData(connection = {}) {
  const username = String(connection.externalUsername || '').trim();
  const notebooks = await resources.list('notebooks', username);
  const datasets = await resources.list('datasets', username);
  return {
    provider: 'kaggle',
    resourceOnly: true,
    inferredSkills: [],
    profile: { username, ownershipVerified: false, visibility: 'public' },
    activity: { notebooks, datasets }
  };
}
module.exports = { ingestData };
