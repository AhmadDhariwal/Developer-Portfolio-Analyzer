const mongoose = require('mongoose');

const candidateProjectSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String, default: '' },
  impactScore: { type: Number, min: 0, max: 100, default: 50 },
  technologies: [{ type: String }],
  status: {
    type: String,
    enum: ['completed', 'in-progress', 'planned'],
    default: 'completed'
  }
}, { _id: false });

const candidateInsightSchema = new mongoose.Schema({
  summary: { type: String, default: '' },
  strengths: [{ type: String }],
  weaknesses: [{ type: String }],
  recommendation: { type: String, default: '' }
}, { _id: false });

const candidateSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
    index: true
  },
  fullName: {
    type: String,
    required: true,
    trim: true
  },
  email: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    index: true
  },
  stack: {
    type: String,
    default: 'Full Stack'
  },
  yearsOfExperience: {
    type: Number,
    min: 0,
    default: 0
  },
  headline: {
    type: String,
    default: ''
  },
  location: {
    type: String,
    default: ''
  },
  githubUsername: {
    type: String,
    default: ''
  },
  githubScore: {
    type: Number,
    min: 0,
    max: 100,
    default: 0
  },
  resumeScore: {
    type: Number,
    min: 0,
    max: 100,
    default: 0
  },
  consistencyScore: {
    type: Number,
    min: 0,
    max: 100,
    default: 0
  },
  growthPotentialScore: {
    type: Number,
    min: 0,
    max: 100,
    default: 0
  },
  skills: [{ type: String }],
  projects: [candidateProjectSchema],
  skillGaps: [{ type: String }],
  githubStats: {
    repos: { type: Number, default: 0 },
    stars: { type: Number, default: 0 },
    forks: { type: Number, default: 0 },
    followers: { type: Number, default: 0 }
  },
  aiInsight: {
    type: candidateInsightSchema,
    default: () => ({})
  },
  isActive: {
    type: Boolean,
    default: true,
    index: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  }
}, { timestamps: true });

candidateSchema.index({ fullName: 'text', email: 'text', skills: 'text' });

module.exports = mongoose.model('Candidate', candidateSchema);
