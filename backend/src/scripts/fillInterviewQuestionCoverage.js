// Explicit operator action only; never imported or run by startup/cron.
const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
const mongoose = require('mongoose');
const { listImportantTopics } = require('../services/interviewTopicNormalizer');
const { DIFFICULTY_SET } = require('../services/interviewQuestionQualityService');
const { coverageTarget } = require('../services/interviewCoverageService');

const run = async () => {
  const args = process.argv.slice(2);
  const value = (flag) => args[args.indexOf(flag) + 1];
  const topic = args.includes('--topic') ? value('--topic') : '';
  const difficulty = args.includes('--difficulty') ? value('--difficulty') : '';
  if (
    !args.includes('--allow-ai') ||
    !listImportantTopics().some((item) => item.key === topic) ||
    !DIFFICULTY_SET.has(difficulty)
  )
    throw new Error(
      'Use --topic <canonical technology> --difficulty <easy|medium|hard|senior> --allow-ai. One bounded batch is generated.'
    );
  const batch = args.includes('--batch') ? Number(value('--batch')) : 5;
  if (!Number.isInteger(batch) || batch < 1 || batch > 10) throw new Error('Batch must be between 1 and 10.');
  await mongoose.connect(process.env.MONGODB_URI, {
    autoIndex: false,
    autoCreate: false,
    serverSelectionTimeoutMS: 5000
  });
  const repository = require('../repositories/interviewQuestionRepository');
  const { total } = await repository.findAllQuestionsPage({ topicKey: topic, difficulty, limit: 1 });
  const missing = Math.max(0, coverageTarget() - total);
  if (!missing)
    return console.log(
      JSON.stringify({ topic, difficulty, target: coverageTarget(), available: total, generated: 0 })
    );
  const { generateFreshInterviewQuestions } = require('../services/interviewPrepService');
  const result = await generateFreshInterviewQuestions({
    skill: topic,
    difficulty,
    source: 'ai',
    reuseAI: false,
    limit: Math.min(batch, missing)
  });
  console.log(
    JSON.stringify({
      topic,
      difficulty,
      target: coverageTarget(),
      previous: total,
      generated: result.aiGeneratedCount
    })
  );
};
if (require.main === module)
  run()
    .catch((error) => {
      console.error(error.statusCode ? 'Coverage generation unavailable; retry later.' : error.message);
      process.exitCode = 1;
    })
    .finally(async () => {
      await require('../services/redisCacheService').closeRedisCache();
      await mongoose.disconnect();
    });
