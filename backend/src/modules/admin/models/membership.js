const mongoose = require('mongoose');

const membershipSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true
    },
    teamId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Team',
      default: null,
      index: true
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    role: {
      type: String,
      enum: ['admin', 'manager', 'member'],
      required: true,
      default: 'member'
    },
    status: {
      type: String,
      enum: ['active', 'invited', 'disabled'],
      default: 'active'
    },
    invitedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    joinedAt: {
      type: Date,
      default: Date.now
    }
  },
  {
    timestamps: true,
    versionKey: false
  }
);

membershipSchema.index({ organizationId: 1, userId: 1, teamId: 1 }, { unique: true });
membershipSchema.index({ organizationId: 1, role: 1, status: 1 });

module.exports = mongoose.model('Membership', membershipSchema);
