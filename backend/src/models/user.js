const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    default: null,
    index: true
  },
  name: {
    type: String,
    required: true
  },
  email: {
    type: String,
    required: true,
    unique: true
  },
  phoneNumber: {
    type: String,
    default: ''
  },
  countryCode: {
    type: String,
    default: ''
  },
  password: {
    type: String,
    required: true
  },
  isVerified: {
    type: Boolean,
    default: false
  },
  isActive: {
    type: Boolean,
    default: true,
    index: true
  },
  githubUsername: {
    type: String,
    default: ''
  },
  activeGithubUsername: {
    type: String,
    default: ''
  },
  lastSearchedGithub: {
    type: String,
    default: ''
  },
  defaultResumeFileId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ResumeFile',
    default: null
  },
  activeResumeFileId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ResumeFile',
    default: null
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
  activeCareerStack: {
    type: String,
    enum: ['Frontend', 'Backend', 'Full Stack', 'AI/ML'],
    default: 'Full Stack'
  },
  experienceLevel: {
    type: String,
    enum: ['Student', 'Intern', '0-1 years', '1-2 years', '2-3 years', '3-5 years', '5+ years'],
    default: 'Student'
  },
  activeExperienceLevel: {
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
  role: {
    type: String,
    enum: ['user', 'admin', 'developer', 'recruiter'],
    default: 'developer'
  },
  isPublic: {
    type: Boolean,
    default: false,
    index: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('User', userSchema);
