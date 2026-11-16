const mongoose = require('mongoose');

const recruiterShortlistSchema = new mongoose.Schema(
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
    candidateId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    jobId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Job',
      default: null,
      index: true
    },
    notes: {
      type: String,
      default: ''
    },
    status: {
      type: String,
      enum: ['shortlisted', 'reviewing', 'contacted', 'interview', 'rejected'],
      default: 'shortlisted',
      index: true
    }
  },
  { timestamps: true }
);

recruiterShortlistSchema.index({ recruiterId: 1, candidateId: 1, jobId: 1 }, { unique: true });

module.exports = mongoose.model('RecruiterShortlist', recruiterShortlistSchema);
