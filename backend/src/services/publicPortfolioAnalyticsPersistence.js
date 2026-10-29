const persistence = require('./integrationPersistenceService');
const Profile = require('../models/publicProfile');
const Visit = require('../models/publicPortfolioVisit');
// Counter and deduplication receipt commit together. A crash cannot consume the
// receipt without incrementing the counter, or increment twice after a retry.
async function record(profile, visit) {
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
