const mongoose = require('mongoose');

const interviewQuestionBankSchema = new mongoose.Schema({
  skill: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    index: true
  },
  question: {
    type: String,
    required: true,
    trim: true
  },
  answer: {
    type: String,
    required: true,
    trim: true
  },
  difficulty: {
    type: String,
    enum: ['easy', 'medium', 'hard'],
    default: 'medium'
  },
  tags: [{ type: String, trim: true, lowercase: true }],
  source: {
    type: String,
    enum: ['prebuilt', 'ai', 'scraped'],
    default: 'prebuilt'
  },
  popularity: {
    type: Number,
    default: 0
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
}, {
  versionKey: false
});

interviewQuestionBankSchema.index({ question: 'text', answer: 'text', tags: 'text' });
interviewQuestionBankSchema.index({ skill: 1, question: 1 }, { unique: true });

module.exports = mongoose.model('InterviewQuestionBank', interviewQuestionBankSchema);