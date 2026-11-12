const mongoose = require('mongoose');

const provenanceSchema = new mongoose.Schema({
  producer: { type: String, required: true, enum: ['portfolio-score-v1'] },
  githubUsername: { type: String, required: true },
  careerStack: { type: String, required: true },
  experienceLevel: { type: String, required: true },
  resumeAnalysisId: { type: String, required: true },
  ruleVersion: { type: String, required: true },
  sourceRevisionHash: { type: String, required: true, match: /^[a-f0-9]{64}$/ },
  assessmentHash: { type: String, required: true, match: /^[a-f0-9]{64}$/ },
  assessedAt: { type: Date, required: true },
}, { _id: false, strict: 'throw' });

const aiVersionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    source: {
      type: String,
      required: true,
      trim: true,
      default: 'manual'
    },
    version: {
      type: Number,
      required: true
    },
    outputJson: {
      type: mongoose.Schema.Types.Mixed,
      required: true
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    // No default: legacy and caller-authored archives remain unverified.
    provenance: { type: provenanceSchema, immutable: true, default: undefined },
    createdAt: {
      type: Date,
      default: Date.now,
      index: true
    }
  },
  {
    versionKey: false
  }
);

aiVersionSchema.index({ userId: 1, source: 1, version: -1 }, { unique: true });

module.exports = mongoose.model('AIVersion', aiVersionSchema);
