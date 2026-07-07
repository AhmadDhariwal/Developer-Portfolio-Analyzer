/**
 * One-time optional backfill script for canonicalQuestionKey.
 *
 * Usage:
 *   node backend/src/scripts/backfillCanonicalQuestionKey.js
 *   node backend/src/scripts/backfillCanonicalQuestionKey.js --dry-run
 *
 * Safe to run multiple times. Only updates records missing canonicalQuestionKey.
 */
require('dotenv').config();
const connectDB = require('../config/db');
const InterviewQuestionBank = require('../models/interviewQuestionBank');
const { buildCanonicalQuestionKey } = require('../services/interviewQuestionQualityService');

const isDryRun = process.argv.includes('--dry-run');
const BATCH_SIZE = 200;

const run = async () => {
  await connectDB();
  console.log(`[backfill-canonical-key] dryRun=${isDryRun} batchSize=${BATCH_SIZE}`);

  let processed = 0;
  let updated = 0;
  let skipped = 0;

  const filter = {
    $or: [
      { canonicalQuestionKey: '' },
      { canonicalQuestionKey: { $exists: false } },
      { canonicalQuestionKey: null }
    ]
  };

  const totalToProcess = await InterviewQuestionBank.countDocuments(filter);
  console.log(`[backfill-canonical-key] recordsToProcess=${totalToProcess}`);

  if (totalToProcess === 0) {
    console.log('[backfill-canonical-key] nothing to backfill.');
    process.exit(0);
  }

  const cursor = InterviewQuestionBank.find(filter)
    .select('question topicKey normalizedQuestion')
    .lean()
    .cursor({ batchSize: BATCH_SIZE });

  const bulkOps = [];

  for await (const record of cursor) {
    processed += 1;
    const question = record.question || record.normalizedQuestion || '';
    const topicKey = record.topicKey || '';
    const canonicalKey = buildCanonicalQuestionKey(question, topicKey);

    if (!canonicalKey) {
      skipped += 1;
      continue;
    }

    bulkOps.push({
      updateOne: {
        filter: { _id: record._id },
        update: { $set: { canonicalQuestionKey: canonicalKey } }
      }
    });

    if (bulkOps.length >= BATCH_SIZE) {
      if (!isDryRun) {
        const result = await InterviewQuestionBank.bulkWrite(bulkOps);
        updated += result.modifiedCount || 0;
      } else {
        updated += bulkOps.length;
      }
      console.log(`[backfill-canonical-key] progress: processed=${processed} updated=${updated} skipped=${skipped}`);
      bulkOps.length = 0;
    }
  }

  if (bulkOps.length > 0) {
    if (!isDryRun) {
      const result = await InterviewQuestionBank.bulkWrite(bulkOps);
      updated += result.modifiedCount || 0;
    } else {
      updated += bulkOps.length;
    }
  }

  console.log(`[backfill-canonical-key] done: processed=${processed} updated=${updated} skipped=${skipped}`);
  process.exit(0);
};

run().catch((error) => {
  console.error('[backfill-canonical-key] failed:', error.message);
  process.exit(1);
});
