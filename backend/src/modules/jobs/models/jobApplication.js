const mongoose = require('mongoose');
const immutable = (type, extra = {}) => ({ type, immutable: true, required: true, ...extra });
const schema = new mongoose.Schema(
  {
    // Deterministic primary key prevents duplicates even before secondary indexes exist.
    _id: immutable(String),
    organizationId: immutable(mongoose.Schema.Types.ObjectId),
    organizationName: immutable(String),
    recruiterId: immutable(mongoose.Schema.Types.ObjectId),
    jobId: immutable(mongoose.Schema.Types.ObjectId),
    applicantId: immutable(mongoose.Schema.Types.ObjectId),
    applicantName: immutable(String),
    jobTitle: immutable(String),
    resume: immutable(
      new mongoose.Schema(
        {
          fileId: mongoose.Schema.Types.ObjectId,
          fileName: String,
          sha256: String,
          uploadedAt: Date
        },
        { _id: false }
      )
    ),
    // Independent copy survives source deletion/replacement; never serialized in JSON.
    resumeBytes: immutable(Buffer, { select: false }),
    portfolio: { type: mongoose.Schema.Types.Mixed, immutable: true, default: null },
    consent: immutable(
      new mongoose.Schema(
        {
          version: String,
          submittedAt: Date,
          sharePortfolio: Boolean
        },
        { _id: false }
      )
    ),
    status: {
      type: String,
      enum: ['submitted', 'reviewing', 'rejected', 'withdrawn'],
      default: 'submitted'
    },
    history: [{ from: String, to: String, actorId: mongoose.Schema.Types.ObjectId, at: Date }]
  },
  { timestamps: true }
);
schema.index({ jobId: 1, applicantId: 1 }, { unique: true });
schema.index({ organizationId: 1, recruiterId: 1, jobId: 1, createdAt: -1 });
schema.index({ applicantId: 1, createdAt: -1 });
module.exports = mongoose.model('JobApplication', schema);
