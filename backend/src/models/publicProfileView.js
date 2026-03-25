const mongoose = require('mongoose');

const publicProfileViewSchema = new mongoose.Schema({
  profileId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PublicProfile',
    required: true,
    index: true
  },
  viewerHash: {
    type: String,
    required: true,
    index: true
  },
  ipAddress: {
    type: String,
    default: ''
  },
  userAgent: {
    type: String,
    default: ''
  },
  viewedAt: {
    type: Date,
    default: Date.now,
    index: true
  }
}, { timestamps: true });

module.exports = mongoose.model('PublicProfileView', publicProfileViewSchema);
