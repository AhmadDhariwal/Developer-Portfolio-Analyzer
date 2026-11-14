const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  reference: { type: String, required: true, unique: true },
  ownerId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  kind: { type: String, enum: ['avatars', 'portfolio-images', 'resumes'], required: true },
  bucketAlias: { type: String, enum: ['images', 'resumes'], required: true },
  bucket: { type: String, required: true },
  key: { type: String, required: true },
  versionId: { type: String, default: '' },
  size: { type: Number, required: true },
  mimeType: { type: String, required: true },
  sha256: { type: String, required: true },
  state: { type: String, enum: ['uploading', 'staged', 'ready', 'deleting'], required: true },
  expiresAt: { type: Date, required: true },
  retryAfter: { type: Date, default: () => new Date(0) },
  cleanupAttempts: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});
schema.index({ state: 1, retryAfter: 1, expiresAt: 1 });
// No TTL: pending work is a durable receipt, never an automatically lost object.
module.exports = mongoose.model('StoredAsset', schema);
