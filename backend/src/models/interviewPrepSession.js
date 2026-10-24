const mongoose = require('mongoose');

const interviewQuestionSchema = new mongoose.Schema(
  {
    question: { type: String, required: true },
    answer: { type: String, required: true },
    difficulty: { type: String, default: 'Medium' },
    tags: [{ type: String }],
    normalizedQuestionHash: { type: String, default: '' },
    answerSections: { type: mongoose.Schema.Types.Mixed, default: {} },
    sourceType: { type: String, default: '' },
    confidenceScore: Number,
    relevanceScore: Number,
    qualityScore: Number,
    category: String,
    answerFormat: String,
    verificationStatus: { type: String, default: 'unverified' }
  },
  { _id: false }
);

const interviewPrepSessionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    skillGaps: [{ type: String }],
    kind: { type: String, enum: ['practice', 'custom'], default: 'practice' },
    topicKey: { type: String, default: '' },
    personalization: { type: mongoose.Schema.Types.Mixed, default: {} },
    careerStack: { type: String, default: '' },
    experienceLevel: { type: String, default: '' },
    questions: [interviewQuestionSchema]
  },
  { timestamps: true }
);

interviewPrepSessionSchema.index({ userId: 1, createdAt: -1 });
interviewPrepSessionSchema.index({
  userId: 1,
  kind: 1,
  topicKey: 1,
  'questions.normalizedQuestionHash': 1,
  createdAt: -1
});

module.exports = mongoose.model('InterviewPrepSession', interviewPrepSessionSchema);
