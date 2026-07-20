require('dotenv').config();

const IDENTITY_KEY = { userId: 1, module: 1, githubUsername: 1, careerStack: 1, experienceLevel: 1, resumeHash: 1 };
const IDENTITY_INDEX_NAME = 'saved_preview_identity_unique';

const hasIdentityKey = (index) => Object.entries(IDENTITY_KEY)
  .every(([key, value]) => index?.key?.[key] === value)
  && Object.keys(index?.key || {}).length === Object.keys(IDENTITY_KEY).length;

const isValidPreview = (preview) => Boolean(
  preview?.userId
  && String(preview?.module || '').trim()
  && String(preview?.githubUsername || '').trim()
  && String(preview?.careerStack || '').trim()
  && String(preview?.experienceLevel || '').trim()
  && String(preview?.resumeHash || '').trim()
  && preview?.resultSummary
  && typeof preview.resultSummary === 'object'
);

const DUPLICATE_GROUP_KEY = { userId: '$userId', module: '$module', githubUsername: '$githubUsername', careerStack: '$careerStack', experienceLevel: '$experienceLevel', resumeHash: '$resumeHash' };

const findDuplicateGroups = (SavedPreview) => SavedPreview.collection.aggregate([
  { $group: { _id: DUPLICATE_GROUP_KEY, count: { $sum: 1 } } },  { $match: { count: { $gt: 1 } } }
]).toArray();

const removeConfirmedDuplicates = async (SavedPreview) => {
  const groups = await findDuplicateGroups(SavedPreview);
  let removed = 0;

  for (const group of groups) {
    const records = await SavedPreview.find(group._id)
      .sort({ createdAt: -1, _id: -1 })
      .lean();
    const keeper = records.find(isValidPreview) || records[0];
    const duplicateIds = records
      .filter((record) => String(record._id) !== String(keeper?._id))
      .map((record) => record._id);
    if (duplicateIds.length) {
      const result = await SavedPreview.deleteMany({ _id: { $in: duplicateIds } });
      removed += Number(result?.deletedCount || 0);
    }
  }

  return { duplicateGroups: groups.length, duplicatesRemoved: removed };
};

const ensureUniqueIdentityIndex = async (SavedPreview) => {
  const indexes = await SavedPreview.collection.indexes();
  const conflicts = indexes.filter((index) => hasIdentityKey(index) && !index.unique);
  for (const index of conflicts) await SavedPreview.collection.dropIndex(index.name);

  const afterDrop = await SavedPreview.collection.indexes();
  if (!afterDrop.some((index) => hasIdentityKey(index) && index.unique)) {
    await SavedPreview.collection.createIndex(IDENTITY_KEY, { name: IDENTITY_INDEX_NAME, unique: true });
  }

  const finalIndexes = await SavedPreview.collection.indexes();
  const uniqueIndex = finalIndexes.find((index) => hasIdentityKey(index) && index.unique);
  if (!uniqueIndex) throw new Error('SavedPreview unique identity index verification failed.');
  return { dropped: conflicts.length, indexName: uniqueIndex.name, indexes: finalIndexes };
};

const migrateSavedPreviewIndexes = async (SavedPreview) => {
  let cleanup = await removeConfirmedDuplicates(SavedPreview);
  let index;
  try {
    index = await ensureUniqueIdentityIndex(SavedPreview);
  } catch (error) {
    if (error?.code !== 11000) throw error;
    const retry = await removeConfirmedDuplicates(SavedPreview);
    cleanup = {
      duplicateGroups: cleanup.duplicateGroups + retry.duplicateGroups,
      duplicatesRemoved: cleanup.duplicatesRemoved + retry.duplicatesRemoved
    };
    index = await ensureUniqueIdentityIndex(SavedPreview);
  }
  const remainingDuplicateGroups = (await findDuplicateGroups(SavedPreview)).length;
  return { ...cleanup, ...index, remainingDuplicateGroups };
};

const run = async () => {
  const mongoose = require('mongoose');
  const connectDB = require('../config/db');
  const SavedPreview = require('../models/savedPreview');
  await connectDB();
  try {
    const result = await migrateSavedPreviewIndexes(SavedPreview);
    console.log(`[saved-preview-index] duplicateGroups=${result.duplicateGroups} duplicatesRemoved=${result.duplicatesRemoved} nonUniqueIndexesDropped=${result.dropped} uniqueIndex=${result.indexName} remainingDuplicateGroups=${result.remainingDuplicateGroups}`);
  } finally {
    await mongoose.connection.close();
  }
};

if (require.main === module) {
  run().catch(async (error) => {
    console.error(`[saved-preview-index] failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { IDENTITY_KEY, IDENTITY_INDEX_NAME, hasIdentityKey, isValidPreview, findDuplicateGroups, removeConfirmedDuplicates, ensureUniqueIdentityIndex, migrateSavedPreviewIndexes };