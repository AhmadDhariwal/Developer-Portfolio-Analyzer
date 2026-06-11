const mongoose = require('mongoose');

const resumeAnalysisCacheSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  resumeFileId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ResumeFile',
    required: true,
    index: true
  },
  resumeHash: {
    type: String,
    required: true,
    index: true
  },
  analysisVersion: {
    type: String,
    required: true,
    default: 'resume-intel-v2',
    index: true
  },
  result: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  },
  analyzedAt: {
    type: Date,
    default: Date.now
  },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: '30d'
  }
}, { timestamps: true });

resumeAnalysisCacheSchema.index(
  { userId: 1, resumeFileId: 1, resumeHash: 1, analysisVersion: 1 },
  { unique: true }
);

module.exports = mongoose.model('ResumeAnalysisCache', resumeAnalysisCacheSchema);
