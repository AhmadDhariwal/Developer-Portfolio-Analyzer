const mongoose = require('mongoose');

const repositorySchema = new mongoose.Schema({
  repoName: {
    type: String,
    required: true
  },
  language: {
    type: String
  },
  stars: {
    type: Number,
    default: 0
  },
  forks: {
    type: Number,
    default: 0
  },
  commits: {
    type: Number,
    default: 0
  },
  lastUpdated: {
    type: Date
  },
  ownerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
});

module.exports = mongoose.model('Repository', repositorySchema);
