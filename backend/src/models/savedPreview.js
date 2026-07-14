const mongoose = require('mongoose');

const savedPreviewSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  title: { type: String, required: true, trim: true, maxlength: 120 },
  githubUsername: { type: String, required: true, trim: true, lowercase: true, maxlength: 39 },
  careerStack: { type: String, required: true },
  experienceLevel: { type: String, required: true },
  resumeHash: { type: String, required: true, maxlength: 128 },
  source: { type: String, enum: ['preview'], default: 'preview' },
  module: { type: String, enum: ['skill-gap', 'recommendations'], required: true },
  resultSummary: { type: mongoose.Schema.Types.Mixed, required: true },
  createdAt: { type: Date, default: Date.now }
}, { timestamps: false });

savedPreviewSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('SavedPreview', savedPreviewSchema);
