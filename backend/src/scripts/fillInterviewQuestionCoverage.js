// Explicit operator action only; never imported or run by startup/cron.
const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
const mongoose = require('mongoose');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const { listImportantTopics } = require('../services/interviewTopicNormalizer');
const { DIFFICULTY_SET } = require('../services/interviewQuestionQualityService');
const { coverageTarget, planCoverageBatch } = require('../services/interviewCoverageService');

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
  const Bank = require('../models/interviewQuestionBank');
  const coordination = require('../services/interviewCoordinationService');
  const runId = args.includes('--run-id') ? value('--run-id') : `coverage-${randomUUID()}`;
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(runId)) throw new Error('Invalid coverage run ID.');
  const target = coverageTarget(topic, difficulty);
  const report = { runId, topic, difficulty, target, batch, startedAt: new Date().toISOString() };
  const leaseKey = `coverage-fill:${topic}:${difficulty}`;
  const token = randomUUID();
  const output = path.resolve(__dirname, `../../verification/interview-prep/coverage-fill-${runId}.json`);
  let acquired = false;
  try {
    const { generateFreshInterviewQuestions } = require('../services/interviewPrepService');
    const { generationTimeoutMs } = require('../services/providers/interviewAIProvider');
    acquired = Boolean(await coordination.acquire(leaseKey, token, generationTimeoutMs() + 10000));
    if (!acquired)
      throw Object.assign(
        new Error('A coverage batch for this technology and difficulty is already running.'),
        { code: 'coverage_busy' }
      );
    const previousRun = await Bank.find({ 'sourceMeta.coverageRunId': runId })
      .select('topicKey difficulty')
      .lean();
    if (previousRun.some((row) => row.topicKey !== topic || row.difficulty !== difficulty))
      throw new Error('Coverage run ID belongs to different filters.');
    const { total } = await repository.findAllQuestionsPage({ topicKey: topic, difficulty, limit: 1 });
    const requested = planCoverageBatch({
      batch,
      alreadyGenerated: previousRun.length,
      target,
      available: total
    });
    Object.assign(report, { previous: total, alreadyGeneratedByRun: previousRun.length, requested });
    if (requested) {
      const result = await generateFreshInterviewQuestions({
        skill: topic,
        difficulty,
        source: 'ai',
        reuseAI: false,
        coverageRunId: runId,
        limit: requested
      });
      report.generated = result.aiGeneratedCount;
    } else report.generated = 0;
    report.status = requested ? 'completed' : 'already_satisfied';
  } catch (error) {
    report.status = 'failed';
    report.code = error.code || 'coverage_generation_failed';
    report.retryable = error.retryable !== false;
    process.exitCode = 1;
  } finally {
    if (acquired) await coordination.release(leaseKey, token).catch(() => {});
    try {
      report.availableAfter = (
        await repository.findAllQuestionsPage({ topicKey: topic, difficulty, limit: 1 })
      ).total;
      report.missingAfter = Math.max(0, target - report.availableAfter);
    } catch {
      report.afterCountUnavailable = true;
    }
    report.finishedAt = new Date().toISOString();
    const prior = fs.existsSync(output) ? JSON.parse(fs.readFileSync(output, 'utf8')) : null;
    const attempts = prior?.attempts || [];
    attempts.push({ ...report });
    fs.writeFileSync(output, `${JSON.stringify({ ...report, attempts }, null, 2)}\n`);
  }
  console.log(JSON.stringify({ ...report, output }));
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
