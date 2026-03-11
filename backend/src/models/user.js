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
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('User', userSchema);
