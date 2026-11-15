// Read-only audit. No seeding, migrations, provider requests, or database writes.
const fs = require('node:fs');
const path = require('node:path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
const { listImportantTopics } = require('../services/interviewTopicNormalizer');
const { buildSeedRecordsForTopic } = require('../services/interviewQuestionSeedCatalog');
const { summarizeCoverage, coverageTarget } = require('../services/interviewCoverageService');
const repository = require('../repositories/interviewQuestionRepository');
const Bank = require('../models/interviewQuestionBank');
const Session = require('../models/interviewPrepSession');
const {
  groupCoverageExclusions,
  nearDuplicateCoverage,
  coveragePlan
} = require('../services/interviewCoverageAudit');

const run = async ({ outputPath } = {}) => {
  const seeds = listImportantTopics().flatMap(buildSeedRecordsForTopic);
  const report = {
    generatedAt: new Date().toISOString(),
    synthetic: false,
    readOnly: true,
    targetPerTechnologyDifficulty: coverageTarget(),
    sourceCatalog: summarizeCoverage(seeds),
    sourceTop30: summarizeCoverage(seeds.filter((row) => row.isTopQuestion)),
    database: { available: false }
  };
  try {
    if (!process.env.MONGODB_URI) throw new Error('missing_configuration');
    await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 10000,
      autoIndex: false,
      autoCreate: false
    });
    const projection = {
      question: 1,
      answer: 1,
      topicKey: 1,
      skill: 1,
      difficulty: 1,
      sourceType: 1,
      source: 1,
      sourceMeta: 1,
      verificationStatus: 1,
      canonicalQuestionKey: 1,
      reviewStatus: 1,
      isTopQuestion: 1,
      isApproved: 1,
      confidenceScore: 1,
      qualityScore: 1,
      relevanceScore: 1,
      qualityState: 1,
      qualityStatus: 1,
      normalizedQuestionHash: 1,
      searchableTokens: 1,
      answerSections: 1
    };
    const rows = await Bank.collection.find({}, { projection, maxTimeMS: 10000 }).toArray();
    const eligible = repository.buildQuestionFilter({ excludeGenericSeeds: true });
    const accessible = await Bank.collection.find(eligible, { projection, maxTimeMS: 10000 }).toArray();
    const eligibleIds = new Set(accessible.map((row) => String(row._id)));
    const failures = new Map(rows.map((row) => [String(row._id), []]));
    for (const { reason, query } of repository.publicEligibilityRules()) {
      for (const row of await Bank.collection
        .find({ $nor: [query] }, { projection: { _id: 1 }, maxTimeMS: 10000 })
        .toArray())
        failures.get(String(row._id)).push(reason);
    }
    const sessions = await Session.collection
      .aggregate(
        [
          { $unwind: '$questions' },
          {
            $group: {
              _id: {
                topicKey: { $ifNull: ['$questions.topicKey', '$topicKey'] },
                difficulty: '$questions.difficulty',
                kind: '$kind',
                sourceType: '$questions.sourceType'
              },
              count: { $sum: 1 }
            }
          }
        ],
        { maxTimeMS: 10000 }
      )
      .toArray();
    report.database = {
      available: true,
      collections: { catalog: Bank.collection.collectionName, sessions: Session.collection.collectionName },
      catalogIndexes: (await Bank.collection.indexes()).map(({ name, key }) => ({ name, key })),
      allRecords: summarizeCoverage(rows),
      exclusionGroups: groupCoverageExclusions(rows, eligibleIds, failures),
      nearDuplicates: nearDuplicateCoverage(rows),
      coveragePlan: coveragePlan(summarizeCoverage(accessible).matrix),
      bySource: Object.fromEntries(
        [...new Set(rows.map((row) => row.sourceType || row.source || 'unknown'))].map((source) => [
          source,
          summarizeCoverage(rows.filter((row) => (row.sourceType || row.source || 'unknown') === source))
        ])
      ),
      exclusionIndicators: {
        legacyV2: rows.filter((row) => row.sourceMeta?.seedVersion === 'v2').length,
        pendingOrRejectedReview: rows.filter((row) => ['pending', 'rejected'].includes(row.reviewStatus))
          .length,
        notApproved: rows.filter((row) => row.isApproved === false).length,
        lowConfidence: rows.filter((row) => Number(row.confidenceScore || 0) < 0.72).length,
        lowQuality: rows.filter((row) => Number(row.qualityScore || 0) < 80).length,
        privateLegacyRows: rows.filter((row) => row.sourceMeta?.userId).length
      },
      accessibleAllQuestions: summarizeCoverage(accessible),
      excludedFromAllQuestions: rows.length - accessible.length,
      verifiedSeed: summarizeCoverage(
        rows.filter((row) => ['verified_seed', 'prebuilt'].includes(row.sourceType || row.source))
      ),
      aiPool: summarizeCoverage(
        rows.filter((row) => ['ai', 'ai_generated', 'user_asked'].includes(row.sourceType || row.source))
      ),
      top30: summarizeCoverage(
        accessible.filter(
          (row) =>
            row.isTopQuestion && row.sourceType === 'verified_seed' && row.sourceMeta?.seedVersion !== 'v2'
        )
      ),
      privateSessionQuestionGroups: sessions
    };
  } catch (error) {
    report.database = {
      available: false,
      blocker:
        error.message === 'missing_configuration'
          ? 'MONGODB_URI is not configured.'
          : `Read-only database audit failed (${error.name}).`,
      blockedSources: [
        'persisted catalog',
        'verified seed documents',
        'AI pool documents',
        'private session aggregates',
        'database pagination counts'
      ]
    };
  } finally {
    await mongoose.disconnect();
  }
  const output =
    outputPath || path.resolve(__dirname, '../../verification/interview-prep/complete-ai-coverage.json');
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    JSON.stringify({
      output,
      sourceRecords: report.sourceCatalog.total,
      databaseAvailable: report.database.available,
      blocker: report.database.blocker
    })
  );
};
if (require.main === module)
  run({
    outputPath: process.argv.includes('--output')
      ? path.resolve(process.argv[process.argv.indexOf('--output') + 1])
      : undefined
  }).catch(() => {
    console.error('Interview coverage audit failed.');
    process.exitCode = 1;
  });
module.exports = { run };
