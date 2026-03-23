const mongoose = require('mongoose');

const integrationConnectionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  provider: {
    type: String,
    enum: ['linkedin', 'github', 'leetcode', 'kaggle'],
    required: true
  },
  status: {
    type: String,
    enum: ['disconnected', 'connected', 'error'],
    default: 'disconnected'
  },
  externalUsername: {
    type: String,
    default: ''
  },
  accessToken: {
    type: String,
    default: ''
  },
  tokenType: {
    type: String,
    default: 'Bearer'
  },
  tokenExpiresAt: {
    type: Date,
    default: null
  },
  refreshToken: {
    type: String,
    default: ''
  },
  oauthState: {
    type: String,
    default: ''
  },
  oauthStateExpiresAt: {
    type: Date,
    default: null
  },
  oauthRedirectUri: {
    type: String,
    default: ''
  },
  scopes: [{ type: String }],
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  nextSyncAt: {
    type: Date,
    default: null
  },
  lastSyncError: {
    type: String,
    default: ''
  },
  lastSyncedAt: {
    type: Date,
    default: null
  }
}, { timestamps: true });

integrationConnectionSchema.index({ userId: 1, provider: 1 }, { unique: true });

module.exports = mongoose.model('IntegrationConnection', integrationConnectionSchema);
