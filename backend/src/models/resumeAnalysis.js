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
  experienceYears: {
    type: Number,
    default: 0
  },
  experienceLevel: {
    type: String,
    enum: ['Junior', 'Intermediate', 'Senior'],
    default: 'Junior'
  },
  certifications: {
    type: [String],
    default: []
  },
  keyAchievements: {
    type: [String],
    default: []
  },
  suggestions: [suggestionSchema],
  scoreBreakdown: {
    atsScore:       { type: String, default: '' },
    keywordDensity: { type: String, default: '' },
    formatScore:    { type: String, default: '' },
    contentQuality: { type: String, default: '' }
  },
  resumeHash: {
    type: String,
    default: '',
    index: true
  },
  analysisVersion: {
    type: String,
    default: 'resume-intel-v2',
    index: true
  },
  normalized: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  qualityScores: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  technologyCategories: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  consistencyWarnings: {
    type: [mongoose.Schema.Types.Mixed],
    default: []
  },
  recruiterPerspective: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  resumeSignals: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  aiInsights: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  cacheMetadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  previousAnalysisId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ResumeAnalysis',
    default: null
  },
  improvementDelta: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  scoreChanges: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  newSkillsAdded: {
    type: [String],
    default: []
  },
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

resumeAnalysisSchema.index({ userId: 1, fileId: 1, resumeHash: 1, analysisVersion: 1, analyzedAt: -1 });
resumeAnalysisSchema.index({ userId: 1, fileId: 1, analyzedAt: -1 });
resumeAnalysisSchema.index({ userId: 1, analyzedAt: -1 });

module.exports = mongoose.model('ResumeAnalysis', resumeAnalysisSchema);
