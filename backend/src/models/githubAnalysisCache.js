const mongoose = require('mongoose');

const snapshotSchema = new mongoose.Schema({
  analyzedAt: { type: Date, default: Date.now },
  healthScore: { type: Number, default: 0 },
  repoCount: { type: Number, default: 0 },
  totalStars: { type: Number, default: 0 },
  totalForks: { type: Number, default: 0 },
  followers: { type: Number, default: 0 },
  topLanguages: [{ type: String }],
  topTechnologies: [{ type: String }]
}, { _id: false });

const githubAnalysisCacheSchema = new mongoose.Schema({
  githubUsername: {
    type: String,
    required: true,
    trim: true
  },
  normalizedUsername: {
    type: String,
    required: true,
    lowercase: true,
    trim: true
  },
  analysisVersion: {
    type: String,
    required: true,
    default: 'github-v2'
  },
  result: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  },
  snapshots: {
    type: [snapshotSchema],
    default: []
  },
  expiresAt: {
    type: Date,
    required: true,
    index: { expires: 0 }
  }
}, { timestamps: true });

githubAnalysisCacheSchema.index(
  { normalizedUsername: 1, analysisVersion: 1 },
  { unique: true }
);

module.exports = mongoose.model('GitHubAnalysisCache', githubAnalysisCacheSchema);
