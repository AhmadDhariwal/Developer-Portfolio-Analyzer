const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  email: {
    type: String,
    required: true,
    unique: true
  },
  password: {
    type: String,
    required: true
  },
  githubUsername: {
    type: String,
    required: true
  },
  lastSearchedGithub: {
    type: String,
    default: ''
  },
  lastSearchedSkillGap: {
    type: String,
    default: ''
  },
  avatar: {
    type: String,
    default: ''
  },
  jobTitle: {
    type: String,
    default: ''
  },
  location: {
    type: String,
    default: ''
  },
  bio: {
    type: String,
    default: ''
  },
  website: {
    type: String,
    default: ''
  },
  twitter: {
    type: String,
    default: ''
  },
  linkedin: {
    type: String,
    default: ''
  },
  notifications: {
    weeklyScoreReport: { type: Boolean, default: true },
    skillTrendAlerts:  { type: Boolean, default: true },
    newRecommendations:{ type: Boolean, default: false },
    jobMatchAlerts:    { type: Boolean, default: true }
  },
  score: {
    type: Number,
    default: 0
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
  careerGoal: {
    type: String,
    enum: ['Get first job', 'Improve portfolio', 'Prepare for interviews', 'Switch tech stack', ''],
    default: ''
  },
  careerProfileSetAt: {
    type: Date,
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('User', userSchema);
