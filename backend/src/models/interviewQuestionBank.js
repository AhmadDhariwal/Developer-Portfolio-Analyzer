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
  seedId: {
    type: String,
    trim: true,
    lowercase: true,
    default: '',
    index: true
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
  normalizedQuestionHash: {
    type: String,
    trim: true,
    lowercase: true,
    index: true
  },
  answer: {
    type: String,
    required: true,
    trim: true
  },
  answerSections: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  normalizedAnswer: {
    type: String,
    trim: true,
    lowercase: true,
    default: ''
  },
  difficulty: {
    type: String,
    enum: ['easy', 'medium', 'hard', 'senior'],
    default: 'medium'
  },
  category: {
    type: String,
    enum: [
      'core-concepts',
      'practical-implementation',
      'debugging',
      'performance',
      'security',
      'architecture',
      'testing',
      'real-world-scenarios',
      'behavioral-technical',
      'system-design'
    ],
    default: 'core-concepts',
    index: true
  },
  tags: [{ type: String, trim: true, lowercase: true }],
  source: {
    type: String,
    enum: ['verified_seed', 'prebuilt', 'ai', 'ai_generated', 'scraped', 'user_asked'],
    default: 'verified_seed'
  },
  sourceType: {
    type: String,
    enum: ['verified_seed', 'prebuilt', 'ai', 'ai_generated', 'scraped', 'user_asked'],
    default: 'verified_seed',
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
  // NEW: Human/product quality score used for Top 30 eligibility and ranking.
  qualityScore: {
    type: Number,
    default: 80,
    min: 0,
    max: 100,
    index: true
  },
  rank: {
    type: Number,
    default: 0,
    index: true
  },
  rankScore: {
    type: Number,
    default: 0,
    index: true
  },
  isTopQuestion: {
    type: Boolean,
    default: false,
    index: true
  },
  expectedSignals: [{ type: String, trim: true }],
  badAnswerSignals: [{ type: String, trim: true }],
  reviewStatus: {
    type: String,
    enum: ['approved', 'pending', 'rejected'],
    default: 'approved',
    index: true
  },
  version: {
    type: String,
    trim: true,
    default: ''
  },
  // NEW: Tracks whether `answer`/`answerSections` are structured or legacy plain text.
  answerFormat: {
    type: String,
    enum: ['structured', 'plain'],
    default: 'plain',
    index: true
  },
  // NEW: False means the answer can be enriched once, then persisted as structured.
  isEnriched: {
    type: Boolean,
    default: false,
    index: true
  },
  qualityState: {
    type: String,
    enum: ['approved', 'review', 'rejected'],
    default: 'approved'
  },
  isApproved: {
    type: Boolean,
    default: true,
    index: true
  },
  qualityStatus: {
    type: String,
    enum: ['approved', 'pending', 'rejected'],
    default: 'approved',
    index: true
  },
  rejectedReason: {
    type: String,
    trim: true,
    default: ''
  },
  relevanceScore: {
    type: Number,
    default: 0.75,
    min: 0,
    max: 1,
    index: true
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
interviewQuestionBankSchema.index(
  { topicKey: 1, normalizedQuestionHash: 1 },
  { unique: true, partialFilterExpression: { normalizedQuestionHash: { $type: 'string' } } }
);
interviewQuestionBankSchema.index(
  { topicKey: 1, seedId: 1 },
  { unique: true, partialFilterExpression: { seedId: { $type: 'string', $ne: '' } } }
);
interviewQuestionBankSchema.index({ topicKey: 1, popularity: -1, createdAt: -1 });
interviewQuestionBankSchema.index({ topicKey: 1, sourceType: 1 });
// NEW: Supports Block 1 Top 30 filters and ranking.
interviewQuestionBankSchema.index({ topicKey: 1, category: 1, qualityScore: -1, usageCount: -1 });
interviewQuestionBankSchema.index({ topicKey: 1, isTopQuestion: 1, rank: 1 });
interviewQuestionBankSchema.index({ topicKey: 1, qualityScore: -1, rankScore: -1, usageCount: -1, createdAt: -1 });
interviewQuestionBankSchema.index({ topicKey: 1, isApproved: 1, qualityStatus: 1, confidenceScore: -1, relevanceScore: -1 });
// NEW: Supports finding legacy/plain answers that need one-time enrichment.
interviewQuestionBankSchema.index({ topicKey: 1, isEnriched: 1, answerFormat: 1 });

module.exports = mongoose.model('InterviewQuestionBank', interviewQuestionBankSchema);
