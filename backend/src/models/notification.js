const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  type: {
    type: String,
    required: true,
    enum: ['profile_update', 'resume_upload', 'github_update', 'low_score', 'career_update', 'system', 'info', 'warning', 'success', 'error']
  },
  title: {
    type: String,
    required: true,
    trim: true
  },
  message: {
    type: String,
    required: true,
    trim: true
  },
  dedupeKey: {
    type: String,
    default: ''
  },
  isRead: {
    type: Boolean,
    default: false
  },
  meta: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, { timestamps: true });

notificationSchema.index({ userId: 1, createdAt: -1 });
notificationSchema.index({ userId: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ userId: 1, dedupeKey: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
