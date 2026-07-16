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
  recordType: {
    type: String,
    enum: ['view', 'unique_guard'],
    default: 'view',
    index: true
  },
  uniqueWindowUntil: {
    type: Date,
    default: null
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

publicProfileViewSchema.index(
  { profileId: 1, viewerHash: 1, recordType: 1 },
  { unique: true, partialFilterExpression: { recordType: 'unique_guard' } }
);
publicProfileViewSchema.index({ uniqueWindowUntil: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('PublicProfileView', publicProfileViewSchema);
