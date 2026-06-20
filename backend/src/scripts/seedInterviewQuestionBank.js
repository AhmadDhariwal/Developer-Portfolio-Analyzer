require('dotenv').config();
const connectDB = require('../config/db');
const InterviewQuestionBank = require('../models/interviewQuestionBank');
const { listImportantTopics } = require('../services/interviewTopicNormalizer');
const { upsertQuestions } = require('../repositories/interviewQuestionRepository');
const {
  buildSeedRecordsForTopic,
  getSeedCatalogValidationReport,
  validateInterviewSeedCatalog,
  verifiedSeedCatalog
} = require('../services/interviewQuestionSeedCatalog');

const isDryRun = process.argv.includes('--dry-run')
  || process.env.npm_config_dry_run === 'true'
  || process.env.npm_config_dry_run === '1';

const buildDryRunSummary = () => {
  const topics = listImportantTopics();
  const validation = getSeedCatalogValidationReport();
  const topicSummaries = topics.map((topic) => {
    const records = verifiedSeedCatalog[topic.key] || [];
    const topCount = records.filter((record) => record.isTopQuestion).length;
    const approvedCount = records.filter((record) => record.reviewStatus === 'approved').length;
    return {
      topic: topic.key,
      topCount,
      approvedCount,
      totalCount: records.length
    };
  });
  const totalApprovedQuestions = topicSummaries.reduce((total, item) => total + item.approvedCount, 0);

  return {
    validation,
    topics: topics.length,
    topicSummaries,
    totalApprovedQuestions,
    invalidRecords: validation.failures.length,
    duplicateWarnings: validation.duplicateWarnings,
    plannedUpserts: validation.isValid ? totalApprovedQuestions : 0
  };
};

const printDryRunSummary = (summary) => {
  console.log('[seed-interview-question-bank] dryRun=true');
  console.log(`[seed-interview-question-bank] topics=${summary.topics}`);
  console.log(`[seed-interview-question-bank] valid=${summary.validation.isValid}`);
  console.log(`[seed-interview-question-bank] failures=${summary.validation.failures.length}`);
  console.log('[seed-interview-question-bank] topQuestionsPerTopic:');
  summary.topicSummaries.forEach((item) => {
    console.log(`[seed-interview-question-bank] - ${item.topic}: top=${item.topCount} approved=${item.approvedCount} total=${item.totalCount}`);
  });
  console.log(`[seed-interview-question-bank] totalApprovedQuestions=${summary.totalApprovedQuestions}`);
  console.log(`[seed-interview-question-bank] invalidRecords=${summary.invalidRecords}`);
  console.log(`[seed-interview-question-bank] duplicateWarnings=${summary.duplicateWarnings}`);
  console.log(`[seed-interview-question-bank] databaseWritePlan=upsert ${summary.plannedUpserts} approved records into InterviewQuestionBank across ${summary.topics} topics`);
  console.log('[seed-interview-question-bank] mongoWrites=0');
  if (!summary.validation.isValid) {
    console.error('[seed-interview-question-bank] invalid catalog failures:');
    summary.validation.failures.slice(0, 50).forEach((failure) => console.error(`[seed-interview-question-bank] - ${failure}`));
  }
};

const run = async () => {
  const topics = listImportantTopics();
  if (isDryRun) {
    const summary = buildDryRunSummary();
    printDryRunSummary(summary);
    process.exit(summary.validation.isValid ? 0 : 1);
  }

  validateInterviewSeedCatalog();
  await connectDB();

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
