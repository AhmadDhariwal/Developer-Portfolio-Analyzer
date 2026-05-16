const mongoose = require('mongoose');

const jobSchema = new mongoose.Schema({
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    default: null,
    index: true
  },
  recruiterId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  teamId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Team',
    default: null,
    index: true
  },
  title: {
    type: String,
    required: true,
    trim: true
  },
  role: {
    type: String,
    default: ''
  },
  description: {
    type: String,
    required: true,
    default: ''
  },
  stack: {
    type: String,
    default: 'Full Stack'
  },
  requiredSkills: [{ type: String }],
  preferredSkills: [{ type: String }],
  minExperienceYears: {
    type: Number,
    min: 0,
    default: 0
  },
  location: {
    type: String,
    default: ''
  },
  salaryRangeMin: {
    type: Number,
    min: 0,
    default: 0
  },
  salaryRangeMax: {
    type: Number,
    min: 0,
    default: 0
  },
  employmentType: {
    type: String,
    enum: ['full-time', 'part-time', 'contract', 'internship'],
    default: 'full-time'
  },
  status: {
    type: String,
    enum: ['draft', 'open', 'closed'],
    default: 'open',
    index: true
  },
  archivedAt: {
    type: Date,
    default: null
  }
}, { timestamps: true });

module.exports = mongoose.model('Job', jobSchema);
