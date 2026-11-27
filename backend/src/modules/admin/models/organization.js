const mongoose = require('mongoose');
const { POLICY_CATALOG } = require('../config/organizationPolicies');

const policySchema = new mongoose.Schema(
  Object.fromEntries(
    Object.keys(POLICY_CATALOG).map((key) => [key, { type: Boolean, default: true }])
  ),
  { _id: false, versionKey: false, strict: 'throw' }
);

const governanceSchema = new mongoose.Schema(
  {
    version: { type: Number, default: 0, min: 0 },
    policies: { type: policySchema, default: () => ({}) }
  },
  { _id: false, versionKey: false, strict: 'throw' }
);

const dashboardConfigSchema = new mongoose.Schema(
  {
    preferredDateRangeDays: {
      type: Number,
      default: 30
    },
    defaultTeamId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Team',
      default: null
    },
    showKpiCards: {
      type: Boolean,
      default: true
    },
    showTeamAnalytics: {
      type: Boolean,
      default: true
    },
    showRecruiterPerformance: {
      type: Boolean,
      default: true
    },
    showJobTrends: {
      type: Boolean,
      default: true
    },
    showActivityFeed: {
      type: Boolean,
      default: true
    }
  },
  {
    _id: false,
    versionKey: false
  }
);

const organizationSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 80
    },
    slug: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 100,
      unique: true
    },
    description: {
      type: String,
      trim: true,
      maxlength: 500,
      default: ''
    },
    industry: { type: String, trim: true, maxlength: 100, default: '' },
    website: { type: String, trim: true, maxlength: 500, default: '' },
    timezone: { type: String, trim: true, maxlength: 100, default: '' },
    branding: {
      logoUrl: { type: String, trim: true, maxlength: 500, default: '' }
    },
    governance: { type: governanceSchema, default: () => ({}) },
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    isSuspended: {
      type: Boolean,
      default: false,
      index: true
    },
    dashboardConfig: {
      type: dashboardConfigSchema,
      default: () => ({})
    }
  },
  {
    timestamps: true,
    versionKey: false
  }
);

organizationSchema.index({ ownerId: 1, createdAt: -1 });

module.exports = mongoose.model('Organization', organizationSchema);
