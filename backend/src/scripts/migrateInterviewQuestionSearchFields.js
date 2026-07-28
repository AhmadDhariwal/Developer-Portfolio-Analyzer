require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const InterviewQuestionBank = require('../models/interviewQuestionBank');
const { buildQuestionIdentity } = require('../repositories/interviewQuestionRepository');

const BATCH_SIZE = 250;

const run = async () => {
  await connectDB();
  let scanned = 0;
  let updated = 0;
  let operations = [];
  const cursor = InterviewQuestionBank.find({ topicKey: { $type: 'string', $ne: '' }, question: { $type: 'string', $ne: '' } })
    .select('_id topicKey question normalizedQuestion normalizedQuestionHash canonicalQuestion canonicalQuestionKey searchableTokens')
    .lean()
    .cursor();

  for await (const record of cursor) {
    scanned += 1;
    const identity = buildQuestionIdentity({ question: record.question, topicKey: record.topicKey });
    operations.push({
      updateOne: {
        filter: { _id: record._id },
        update: { $set: identity }
      }
    });
    if (operations.length >= BATCH_SIZE) {
      const result = await InterviewQuestionBank.bulkWrite(operations, { ordered: false });
      updated += Number(result.modifiedCount || 0);
      operations = [];
    }
  }
  if (operations.length) {
    const result = await InterviewQuestionBank.bulkWrite(operations, { ordered: false });
    updated += Number(result.modifiedCount || 0);
  }

  await InterviewQuestionBank.collection.createIndex(
    { topicKey: 1, canonicalQuestionKey: 1 },
    { name: 'topic_canonical_exact', partialFilterExpression: { canonicalQuestionKey: { $type: 'string' } } }
  );
  await InterviewQuestionBank.collection.createIndex(
    { topicKey: 1, difficulty: 1, category: 1, isApproved: 1, qualityStatus: 1, relevanceScore: -1, confidenceScore: -1 },
    { name: 'topic_filtered_candidates' }
  );
  await InterviewQuestionBank.collection.createIndex(
    { topicKey: 1, searchableTokens: 1, difficulty: 1, category: 1 },
    { name: 'topic_searchable_tokens' }
  );
  console.log(JSON.stringify({ scanned, updated }));
};

run()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => mongoose.disconnect());