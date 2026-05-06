const mongoose = require('mongoose');

const platformSettingsSchema = new mongoose.Schema(
  {
    scope: {
      type: String,
      default: 'global',
      unique: true,
      index: true
    },
    general: {
      platformName: { type: String, default: 'DevInsight AI' },
      logoUrl: { type: String, default: '' },
      maintenanceMode: { type: Boolean, default: false },
      defaultTimezone: { type: String, default: 'Asia/Karachi' },
      defaultLanguage: { type: String, default: 'en' }
    },
    ai: {
      enabled: { type: Boolean, default: true },
      provider: { type: String, default: 'openai' },
      model: { type: String, default: 'gpt-4.1-mini' },
      usageLimitPerDay: { type: Number, default: 5000 },
      recommendationLimit: { type: Number, default: 10 },
      promptTemplate: { type: String, default: '' },
      providerApiKey: { type: String, default: '' }
    },
    organization: {
      allowOrgCreation: { type: Boolean, default: false },
      maxTeamsPerOrganization: { type: Number, default: 10 },
      recruiterLimitPerOrg: { type: Number, default: 5 },
      adminInvitesRequireApproval: { type: Boolean, default: true }
    },
    recruiter: {
      enableRecruiterAccess: { type: Boolean, default: true },
      candidateVisibility: { type: String, default: 'public' },
      activityThresholdDays: { type: Number, default: 14 }
    },
    developer: {
      publicPortfolioVisibility: { type: Boolean, default: true },
      githubRequirement: { type: Boolean, default: true },
      profileCompletionRequirement: { type: Number, default: 70 }
    },
    security: {
      jwtExpiresIn: { type: String, default: '20h' },
      otpExpiryMinutes: { type: Number, default: 10 },
      otpMaxAttempts: { type: Number, default: 3 },
      passwordMinLength: { type: Number, default: 6 },
      requireStrongPassword: { type: Boolean, default: false },
      loginMaxFailures: { type: Number, default: 6 },
      loginLockoutMinutes: { type: Number, default: 10 },
      globalRateLimitMax: { type: Number, default: 500 }
    },
    analytics: {
      refreshIntervalMinutes: { type: Number, default: 30 },
      dashboardCacheMinutes: { type: Number, default: 10 },
      enableStructuredLogging: { type: Boolean, default: true }
    },
    notifications: {
      emailNotifications: { type: Boolean, default: true },
      systemAlerts: { type: Boolean, default: true },
      recruiterAlerts: { type: Boolean, default: true },
      adminAlerts: { type: Boolean, default: true }
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    integrations: {
      github: {
        enabled: { type: Boolean, default: true },
        apiKey: { type: String, default: '' }
      },
      news: {
        enabled: { type: Boolean, default: true },
        apiKey: { type: String, default: '' }
      },
      jobs: {
        enabled: { type: Boolean, default: true },
        apiKey: { type: String, default: '' }
      }
    }
  },
  { timestamps: true, versionKey: false }
);

module.exports = mongoose.model('PlatformSettings', platformSettingsSchema);
