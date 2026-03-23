const mongoose = require('mongoose');

const providerInsightSchema = new mongoose.Schema({
  provider: {
    type: String,
    enum: ['linkedin', 'github', 'leetcode', 'kaggle'],
    required: true
  },
  profileScore: { type: Number, default: 0 },
  activityScore: { type: Number, default: 0 },
  confidence: { type: Number, default: 0 },
  inferredSkills: [{ type: String }],
  normalized: { type: mongoose.Schema.Types.Mixed, default: {} },
  syncedAt: { type: Date, default: Date.now }
}, { _id: false });

const integrationInsightSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
    index: true
  },
  providers: [providerInsightSchema],
  mergedSkills: [{ type: String }],
  integrationScore: { type: Number, default: 0 },
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('IntegrationInsight', integrationInsightSchema);
