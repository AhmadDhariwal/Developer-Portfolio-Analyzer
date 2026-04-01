require('dotenv').config();
const connectDB = require('../config/db');
const InterviewQuestionBank = require('../models/interviewQuestionBank');
const { listImportantTopics } = require('../services/interviewTopicNormalizer');
const { upsertQuestions } = require('../repositories/interviewQuestionRepository');
const { buildSeedRecordsForTopic } = require('../services/interviewQuestionSeedCatalog');

const run = async () => {
  await connectDB();

  const topics = listImportantTopics();
  let inserted = 0;
  let seededRecords = 0;

  for (const topic of topics) {
    const records = buildSeedRecordsForTopic(topic);
    const result = await upsertQuestions(records);
    inserted += Number(result.insertedCount || 0);
    seededRecords += records.length;
  }

  const total = await InterviewQuestionBank.countDocuments({
    topicKey: { $in: topics.map((topic) => topic.key) }
  });

  console.log(`[seed-interview-question-bank] topics=${topics.length} attempted=${seededRecords} inserted=${inserted} total=${total}`);
  process.exit(0);
};

run().catch((error) => {
  console.error('[seed-interview-question-bank] failed:', error.message);
  process.exit(1);
});
