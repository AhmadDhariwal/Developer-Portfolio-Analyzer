const IntegrationSyncLog = require('../models/integrationSyncLog');
const mongoose = require('mongoose');

function buildCachePipeline(userId, careerStack, experienceLevel, cachePredicates) {
  const owner = mongoose.isValidObjectId(userId)
    ? new mongoose.Types.ObjectId(String(userId))
    : userId;
  const projections = [
    { 'analysisData.portfolioScore': 1 },
    {
      'analysisData.yourSkills': 1,
      'analysisData.missingSkills': 1,
      'analysisData.highDemandSkills': 1,
      'analysisData.coverage': 1,
      'analysisData.ruleVersion': 1,
      'analysisData.provenSkills': 1,
      'analysisData.claimedButNotProvenSkills': 1,
    },
    {
      'analysisData.recommendationSignals': 1,
      'analysisData.structuredRecommendations': 1,
      'analysisData.projects': 1,
      'analysisData.recommendationScores': 1,
    },
  ];
  const facets = Object.fromEntries(
    cachePredicates.map((predicate, index) => [
      String(index),
      [
        { $match: { ...predicate, userId: owner } },
        { $sort: { updatedAt: -1, _id: -1 } },
        { $limit: 1 },
        { $project: { ...projections[index], updatedAt: 1, createdAt: 1 } },
      ],
    ]),
  );
  return [{ $match: { userId: owner, careerStack, experienceLevel } }, { $facet: facets }];
}

function buildIntegrationPipeline(userId, since) {
  return [
    {
      $match: {
        userId: mongoose.isValidObjectId(userId)
          ? new mongoose.Types.ObjectId(String(userId))
          : userId,
        createdAt: { $gte: since },
        provider: {
          $in: IntegrationSyncLog.schema.path('provider').enumValues,
        },
      },
    },
    {
      $group: {
        _id: '$provider',
        count: { $sum: 1 },
        successes: { $sum: { $cond: [{ $eq: ['$status', 'success'] }, 1, 0] } },
        recent: {
          $topN: {
            n: 2,
            sortBy: { status: -1, createdAt: -1, _id: -1 },
            output: {
              status: '$status',
              activityScore: '$activityScore',
              profileScore: '$profileScore',
              confidence: '$confidence',
              createdAt: '$createdAt',
            },
          },
        },
      },
    },
  ];
}
module.exports = { buildCachePipeline, buildIntegrationPipeline };
