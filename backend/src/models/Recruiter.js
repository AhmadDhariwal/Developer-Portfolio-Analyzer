const mongoose = require('mongoose');

const recruiterSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
    index: true
  },
  company: {
    type: String,
    default: ''
  },
  title: {
    type: String,
    default: ''
  },
  hiringPreferences: {
    preferredStacks: [{ type: String }],
    minExperienceYears: { type: Number, default: 0 },
    preferredLocations: [{ type: String }]
  }
}, { timestamps: true });

module.exports = mongoose.model('Recruiter', recruiterSchema);
