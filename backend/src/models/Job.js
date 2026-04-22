const mongoose = require('mongoose');

const jobSchema = new mongoose.Schema({
  recruiterId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
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
  }
}, { timestamps: true });

module.exports = mongoose.model('Job', jobSchema);
