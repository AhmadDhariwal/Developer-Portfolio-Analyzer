const mongoose = require('mongoose');

const statsSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  repositories: { type: Number, default: 0 },
  stars:        { type: Number, default: 0 },
  forks:        { type: Number, default: 0 },
  followers:    { type: Number, default: 0 },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Stats', statsSchema);
