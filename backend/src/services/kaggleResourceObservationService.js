const Connection = require('../models/integrationConnection');

function normalize(ingested) {
  if (ingested?.provider !== 'kaggle' || ingested.resourceOnly !== true)
    throw Error('Invalid resource observation.');
  return {
    version: 'kaggle-resources-v1',
    ownershipVerified: false,
    evidenceKind: 'public-resources',
    profile: { ...ingested.profile, ownershipVerified: false, visibility: 'public' },
    activity: ingested.activity,
    observedAt: new Date().toISOString()
  };
}
async function getForUser(userId) {
  const rows = await Connection.find({
    userId,
    provider: 'kaggle',
    status: 'connected',
    'metadata.resourceObservation.version': 'kaggle-resources-v1'
  })
    .select('metadata.resourceObservation')
    .limit(1)
    .lean();
  return rows.map((row) => ({
    provider: 'kaggle',
    ...row.metadata.resourceObservation,
    ownershipVerified: false,
    evidenceKind: 'public-resources'
  }));
}
module.exports = { normalize, getForUser };
