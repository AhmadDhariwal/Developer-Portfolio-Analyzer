const mongoose = require('mongoose');

const resumeFileSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  fileName: {
    type: String,
    required: true
  },
  fileUrl: {
    type: String,
    required: true
  },
  fileSize: {
    type: Number,
    required: true
  },
  mimeType: {
    type: String,
    default: 'application/pdf'
  },
  uploadDate: {
    type: Date,
    default: Date.now
  },
  isAnalyzed: {
    type: Boolean,
    default: false
  },
  resumeHash: {
    type: String,
    default: ''
  },
  lastAnalyzedAt: {
    type: Date,
    default: null
  },
  analysisVersion: {
    type: String,
    default: ''
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

resumeFileSchema.index({ userId: 1, uploadDate: -1 });
resumeFileSchema.index({ userId: 1, isAnalyzed: 1, uploadDate: -1 });

module.exports = mongoose.model('ResumeFile', resumeFileSchema);
