const mongoose = require('mongoose');

const interviewQuestionSchema = new mongoose.Schema({
  question: { type: String, required: true },
  answer: { type: String, required: true },
  difficulty: { type: String, default: 'Medium' },
  tags: [{ type: String }]
}, { _id: false });

const interviewPrepSessionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  skillGaps: [{ type: String }],
  careerStack: { type: String, default: '' },
  experienceLevel: { type: String, default: '' },
  questions: [interviewQuestionSchema]
}, { timestamps: true });

module.exports = mongoose.model('InterviewPrepSession', interviewPrepSessionSchema);
