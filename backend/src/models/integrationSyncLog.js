const mongoose = require('mongoose');

const integrationSyncLogSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  provider: {
    type: String,
    enum: [
      'linkedin',
      'github',
      'leetcode',
      'kaggle',
      'stackoverflow',
      'hackerrank',
      'portfolio',
      'certifications',
      'devblogs'
    ],
    required: true,
    index: true
  },
  profileScore: { type: Number, default: 0 },
  activityScore: { type: Number, default: 0 },
  confidence: { type: Number, default: 0 },
  status: {
    type: String,
    enum: ['success', 'failed'],
    default: 'success'
  },
  expiresAt: {
    type: Date,
    default: () =>
      new Date(
        Date.now() +
          require('../services/integrationGovernanceService').integer(
            'INTEGRATION_SYNC_LOG_RETENTION_DAYS',
            90,
            1,
            3650
          ) *
            86400000
      )
  },
  error: { type: String, default: '' },
  reason: { type: String, default: 'manual' },
  createdAt: { type: Date, default: Date.now, index: true }
});

integrationSyncLogSchema.index({ userId: 1, provider: 1, createdAt: -1 });

module.exports = mongoose.model('IntegrationSyncLog', integrationSyncLogSchema);
