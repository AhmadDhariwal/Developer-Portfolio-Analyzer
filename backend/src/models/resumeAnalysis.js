const mongoose = require('mongoose');

const suggestionSchema = new mongoose.Schema({
  id: String,
  title: String,
  description: String,
  color: {
    type: String,
    enum: ['red', 'orange', 'blue', 'purple', 'cyan']
  },
  icon: String
});

const resumeAnalysisSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  fileId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ResumeFile',
    required: true
  },
  fileName: {
    type: String,
    required: true
  },
  fileSize: {
    type: Number,
    required: true
  },
  atsScore: {
    type: Number,
    min: 0,
    max: 100,
    default: 0
  },
  keywordDensity: {
    type: Number,
    min: 0,
    max: 100,
    default: 0
  },
  formatScore: {
    type: Number,
    min: 0,
    max: 100,
    default: 0
  },
  contentQuality: {
    type: Number,
    min: 0,
    max: 100,
    default: 0
  },
  skills: {
    type: Map,
    of: [String],
    default: new Map()
  },
  suggestions: [suggestionSchema],
  uploadDate: {
    type: Date,
    default: Date.now
  },
  analyzedAt: {
    type: Date,
    default: Date.now
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('ResumeAnalysis', resumeAnalysisSchema);
