const mongoose = require('mongoose');

const recommendationSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  title: {
    type: String,
    required: true
  },
  priority: {
    type: String,
    enum: ['High', 'Medium', 'Low'],
    default: 'Medium'
  },
  priorityType: {
    type: String,
    enum: ['high', 'medium', 'low'],
    default: 'medium'
  },
  category: {
    type: String,
    default: 'Technology'
  },
  icon: {
    type: String,
    default: 'technology'
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Recommendation', recommendationSchema);
