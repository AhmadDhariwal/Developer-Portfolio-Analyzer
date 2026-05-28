require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const InterviewQuestionBank = require('../models/interviewQuestionBank');
const aiProvider = require('../services/providers/interviewAIProvider');

const BATCH_SIZE = 50;

const inferCategory = (item) => {
  const text = `${item.question || ''} ${(item.tags || []).join(' ')}`.toLowerCase();
  if (text.includes('design') || text.includes('architecture') || text.includes('scaling')) return 'system_design';
  if (text.includes('best') || text.includes('practice') || text.includes('avoid')) return 'best_practice';
  if (text.includes('output') || text.includes('code')) return 'code_output';
  if (text.includes('scenario') || text.includes('production')) return 'scenario_based';
  return 'conceptual';
};

const migrateBatch = async (rows) => {
  const operations = [];

  for (const item of rows) {
    const answerSections = await aiProvider.enrichAnswerToStructured({
      question: item.question,
      currentAnswer: item.answer
    });

    operations.push({
      updateOne: {
        filter: { _id: item._id },
        update: {
          $set: {
            answer: aiProvider.toStructuredAnswerText(answerSections),
            answerSections,
            category: item.category || inferCategory(item),
            qualityScore: Math.max(4, Number(item.qualityScore || 4)),
            answerFormat: 'structured',
            isEnriched: true
          }
        }
      }
    });
  }

  if (operations.length) {
    await InterviewQuestionBank.bulkWrite(operations, { ordered: false });
  }
};

const run = async () => {
  await connectDB();

  let processed = 0;
  while (true) {
    const rows = await InterviewQuestionBank.find({
      $or: [
        { category: { $exists: false } },
        { isEnriched: false },
        { answerFormat: { $ne: 'structured' } }
      ]
    })
      .sort({ createdAt: 1 })
      .limit(BATCH_SIZE)
      .lean();

    if (!rows.length) break;

    await migrateBatch(rows);
    processed += rows.length;
    console.log(`[interview-bank-migration] processed ${processed} records`);
  }

  console.log(`[interview-bank-migration] complete. total processed: ${processed}`);
  await mongoose.connection.close();
};

run().catch(async (error) => {
  console.error('[interview-bank-migration] failed:', error);
  await mongoose.connection.close().catch(() => {});
  process.exit(1);
});
