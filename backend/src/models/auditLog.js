const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema(
  {
    actor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      default: null,
      index: true
    },
    teamId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Team',
      default: null,
      index: true
    },
    action: {
      type: String,
      required: true,
      trim: true
    },
    method: {
      type: String,
      required: true,
      uppercase: true,
      trim: true
    },
    route: {
      type: String,
      required: true,
      trim: true
    },
    before: {
      type: mongoose.Schema.Types.Mixed,
      default: null
    },
    after: {
      type: mongoose.Schema.Types.Mixed,
      default: null
    },
    statusCode: {
      type: Number,
      default: 200
    },
    ipAddress: {
      type: String,
      default: null,
      trim: true
    },
    userAgent: {
      type: String,
      default: null,
      trim: true
    },
    deleted: {
      type: Boolean,
      default: false,
      index: true
    },
    deletedAt: {
      type: Date,
      default: null
    },
    timestamp: {
      type: Date,
      default: Date.now,
      index: true
    }
  },
  {
    versionKey: false
  }
);

// Compound indexes for efficient querying
auditLogSchema.index({ actor: 1, timestamp: -1 });
auditLogSchema.index({ organizationId: 1, timestamp: -1 });
auditLogSchema.index({ teamId: 1, timestamp: -1 });
auditLogSchema.index({ action: 1, timestamp: -1 });
auditLogSchema.index({ organizationId: 1, teamId: 1, timestamp: -1 });
auditLogSchema.index({ organizationId: 1, action: 1, timestamp: -1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);