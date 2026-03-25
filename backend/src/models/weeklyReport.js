const mongoose = require('mongoose');

const weeklyReportSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  weekStartDate: {
    type: Date,
    required: true
  },
  weekEndDate: {
    type: Date,
    required: true
  },
  score: {
    type: Number,
    required: true
  },
  progressSummary: {
    type: String,
    required: true
  },
  insights: [{ type: String }],
  recommendations: [{ type: String }],
  reportText: {
    type: String,
    required: true
  },
  meta: {
    githubScore: { type: Number, default: 0 },
    resumeScore: { type: Number, default: 0 },
    skillFocus: [{ type: String }]
  }
}, { timestamps: true });

module.exports = mongoose.model('WeeklyReport', weeklyReportSchema);
