const mongoose = require('mongoose');

const skillSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  skillName: {
    type: String,
    required: true
  },
  level: {
    type: Number,   // 0-100 proficiency
    default: 0
  },
  isMissing: {
    type: Boolean,
    default: false  // true = gap skill, false = acquired skill
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Skill', skillSchema);
