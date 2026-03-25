const mongoose = require('mongoose');

const publicSkillSchema = new mongoose.Schema({
  name: { type: String, required: true },
  score: { type: Number, default: 0 }
}, { _id: false });

const publicProjectSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String, default: '' },
  url: { type: String, default: '' },
  tech: [{ type: String }]
}, { _id: false });

const publicProfileSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  slug: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  isPublic: {
    type: Boolean,
    default: false
  },
  headline: {
    type: String,
    default: ''
  },
  summary: {
    type: String,
    default: ''
  },
  skills: [publicSkillSchema],
  projects: [publicProjectSchema],
  seoTitle: {
    type: String,
    default: ''
  },
  seoDescription: {
    type: String,
    default: ''
  },
  socialLinks: {
    website: { type: String, default: '' },
    twitter: { type: String, default: '' },
    linkedin: { type: String, default: '' },
    github: { type: String, default: '' }
  },
  totalViews: {
    type: Number,
    default: 0
  },
  uniqueViews: {
    type: Number,
    default: 0
  },
  lastViewedAt: {
    type: Date,
    default: null
  }
}, { timestamps: true });

module.exports = mongoose.model('PublicProfile', publicProfileSchema);
