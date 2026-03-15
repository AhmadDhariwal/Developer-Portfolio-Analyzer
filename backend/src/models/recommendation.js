const mongoose = require('mongoose');

const recommendationSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  title: {
    type: String,
    required: true
  },
  priority: {
    type: String,
    enum: ['High', 'Medium', 'Low'],
    default: 'Medium'
  },
  priorityType: {
    type: String,
    enum: ['high', 'medium', 'low'],
    default: 'medium'
  },
  category: {
    type: String,
    default: 'Technology'
  },
  icon: {
    type: String,
    default: 'technology'
  },
  careerStack: {
    type: String,
    enum: ['Frontend', 'Backend', 'Full Stack', 'AI/ML'],
    default: 'Full Stack'
  },
  experienceLevel: {
    type: String,
    enum: ['Student', 'Intern', '0-1 years', '1-2 years', '2-3 years', '3-5 years', '5+ years'],
    default: 'Student'
  },
  techStack:       { type: [String], default: [] },
  isNewTech:       { type: [String], default: [] },
  difficultyScore: { type: Number, min: 1, max: 10, default: 5 },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Recommendation', recommendationSchema);
