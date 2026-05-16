const mongoose = require('mongoose');

const recruiterMatchSchema = new mongoose.Schema(
  {
    recruiterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true
    },
    teamId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Team',
      default: null,
      index: true
    },
    jobId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Job',
      required: true,
      index: true
    },
    candidateId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    matchScore: {
      type: Number,
      min: 0,
      max: 100,
      default: 0
    },
    skillMatchPercent: {
      type: Number,
      min: 0,
      max: 100,
      default: 0
    },
    experienceMatch: {
      type: String,
      default: ''
    },
    githubProjectScore: {
      type: Number,
      min: 0,
      max: 100,
      default: 0
    },
    readinessScore: {
      type: Number,
      min: 0,
      max: 100,
      default: 0
    },
    confidenceScore: {
      type: Number,
      min: 0,
      max: 100,
      default: 0
    },
    recommendation: {
      type: String,
      default: ''
    },
    strengths: [{ type: String }],
    weaknesses: [{ type: String }],
    explanation: {
      type: String,
      default: ''
    },
    breakdown: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    status: {
      type: String,
      enum: ['generated', 'shortlisted', 'rejected'],
      default: 'generated',
      index: true
    }
  },
  { timestamps: true }
);

recruiterMatchSchema.index({ recruiterId: 1, jobId: 1, candidateId: 1 }, { unique: true });

module.exports = mongoose.model('RecruiterMatch', recruiterMatchSchema);
