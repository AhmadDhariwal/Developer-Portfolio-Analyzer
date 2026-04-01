const mongoose = require('mongoose');

const interviewQuestionBankSchema = new mongoose.Schema({
  skill: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    index: true
  },
  topicKey: {
    type: String,
    trim: true,
    lowercase: true,
    index: true,
    default: function defaultTopicKey() {
      return this.skill;
    }
  },
  topicType: {
    type: String,
    enum: ['stack', 'technology', 'language', 'framework'],
    default: 'technology',
    index: true
  },
  topicDimensions: {
    stack: [{ type: String, trim: true, lowercase: true }],
    technology: [{ type: String, trim: true, lowercase: true }],
    language: [{ type: String, trim: true, lowercase: true }],
    framework: [{ type: String, trim: true, lowercase: true }]
  },
  question: {
    type: String,
    required: true,
    trim: true
  },
  normalizedQuestion: {
    type: String,
    trim: true,
    lowercase: true,
    default: ''
  },
  answer: {
    type: String,
    required: true,
    trim: true
  },
  normalizedAnswer: {
    type: String,
    trim: true,
    lowercase: true,
    default: ''
  },
  difficulty: {
    type: String,
    enum: ['easy', 'medium', 'hard'],
    default: 'medium'
  },
  tags: [{ type: String, trim: true, lowercase: true }],
  source: {
    type: String,
    enum: ['prebuilt', 'ai', 'scraped', 'user_asked'],
    default: 'prebuilt'
  },
  sourceType: {
    type: String,
    enum: ['prebuilt', 'ai', 'scraped', 'user_asked'],
    default: 'prebuilt',
    index: true
  },
  sourceMeta: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  confidenceScore: {
    type: Number,
    default: 0.7,
    min: 0,
    max: 1
  },
  qualityState: {
    type: String,
    enum: ['approved', 'review', 'rejected'],
    default: 'approved'
  },
  popularity: {
    type: Number,
    default: 0
  },
  usageCount: {
    type: Number,
    default: 0
  },
  lastUsedAt: {
    type: Date,
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
}, {
  versionKey: false
});

interviewQuestionBankSchema.index({ question: 'text', answer: 'text', tags: 'text', topicKey: 'text' });
interviewQuestionBankSchema.index({ skill: 1, question: 1 }, { unique: true });
interviewQuestionBankSchema.index({ topicKey: 1, normalizedQuestion: 1 }, { unique: true, sparse: true });
interviewQuestionBankSchema.index({ topicKey: 1, popularity: -1, createdAt: -1 });
interviewQuestionBankSchema.index({ topicKey: 1, sourceType: 1 });

module.exports = mongoose.model('InterviewQuestionBank', interviewQuestionBankSchema);