const persistence = require('./integrationPersistenceService');
const Profile = require('../models/publicProfile');
const Visit = require('../models/publicPortfolioVisit');
// Counter and deduplication receipt commit together. A crash cannot consume the
// receipt without incrementing the counter, or increment twice after a retry.
async function record(profile, visit) {
  // A committed receipt already represents an atomic counter increment. Avoid
  // repeated write transactions on the same owner/profile for refreshes today.
  // Concurrent first views still rely on the unique index inside the transaction.
  if (await Visit.exists({ profileId: visit.profileId, viewerHash: visit.viewerHash })) return;
  try {
    await persistence.transaction(async (session) => {
      await persistence.ownerFence(profile.userId, session);
      const result = await Profile.updateOne(
        { _id: profile._id, isPublic: true },
        { $inc: { totalViews: 1, uniqueViews: 1 }, $set: { lastViewedAt: visit.viewedAt } },
        { session, timestamps: false }
      );
      if (!result.matchedCount) return;
      await Visit.create([visit], { session });
    });
  } catch (error) {
    if (error.code !== 11000) throw error;
  }
}
module.exports = { record };
