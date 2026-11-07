'use strict';

// Read-only release audit. Emits counts and index metadata, never user records.
const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
const mongoose = require('mongoose');
const CareerSprint = require('../models/careerSprint');

const auditCareerSprintData = async () => {
  const now = new Date();
  const [totalRecords, unreservedLegacyRecords, activeConflicts, invalidWindows, indexes] = await Promise.all([
    CareerSprint.countDocuments({}),
    CareerSprint.countDocuments({ 'occupiedDays.0': { $exists: false } }),
    CareerSprint.aggregate([
      {
        $match: {
          $expr: {
            $and: [
              { $lte: [{ $ifNull: ['$sprintStartDate', '$weekStartDate'] }, now] },
              { $gte: [{ $ifNull: ['$sprintEndDate', '$weekEndDate'] }, now] }
            ]
          }
        }
      },
      { $group: { _id: '$userId', count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
      { $count: 'owners' }
    ]),
    CareerSprint.countDocuments({
      $expr: {
        $gt: [{ $ifNull: ['$sprintStartDate', '$weekStartDate'] }, { $ifNull: ['$sprintEndDate', '$weekEndDate'] }]
      }
    }),
    CareerSprint.collection.indexes()
  ]);
  return {
    auditedAt: now.toISOString(),
    totalRecords,
    unreservedLegacyRecords,
    ownersWithMultipleActiveSprints: activeConflicts[0]?.owners || 0,
    invalidWindows,
    indexes: indexes
      .filter((index) => index.key.creationKey || index.key.occupiedDays)
      .map(({ key, unique, partialFilterExpression }) => ({ key, unique: Boolean(unique), partialFilterExpression }))
  };
};

module.exports = { auditCareerSprintData };
if (require.main === module) {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('MongoDB configuration is required.');
  mongoose
    .connect(uri, { serverSelectionTimeoutMS: 5000, autoIndex: false })
    .then(auditCareerSprintData)
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch(() => {
      console.error('Career Sprint data audit failed. Check database access.');
      process.exitCode = 1;
    })
    .finally(() => mongoose.disconnect());
}
