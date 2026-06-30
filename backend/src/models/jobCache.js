const mongoose = require('mongoose');

const JOB_CACHE_TTL_HOURS = Math.max(24, Math.min(48, Number.parseInt(process.env.JOB_CACHE_TTL_HOURS || '36', 10) || 36));
const JOB_CACHE_RETENTION_DAYS = Math.max(3, Number.parseInt(process.env.JOB_CACHE_RETENTION_DAYS || '7', 10) || 7);

const jobCacheSchema = new mongoose.Schema({
  jobId: {
    type: String,
    required: true,
    trim: true,
    unique: true,
    index: true
  },
  externalJobId: {
    type: String,
    default: '',
    trim: true,
    index: true
  },
  source: {
    type: String,
    required: true,
    trim: true,
    index: true
  },
  platform: {
    type: String,
    required: true,
    trim: true,
    default: 'Other'
  },
  title: {
    type: String,
    required: true,
    trim: true
  },
  company: {
    type: String,
    required: true,
    trim: true
  },
  companyLogo: {
    type: String,
    default: '',
    trim: true
  },
  description: {
    type: String,
    default: ''
  },
  requirements: {
    type: [String],
    default: []
  },
  benefits: {
    type: [String],
    default: []
  },
  skills: {
    type: [String],
    default: []
  },
  salary: {
    type: String,
    default: '',
    trim: true
  },
  location: {
    type: String,
    default: '',
    trim: true
  },
  jobType: {
    type: String,
    default: '',
    trim: true
  },
  experienceLevel: {
    type: String,
    default: '',
    trim: true
  },
  applyUrl: {
    type: String,
    required: true,
    trim: true
  },
  postedDate: {
    type: String,
    default: '',
    trim: true
  },
  lastSynced: {
    type: Date,
    default: Date.now,
    index: true
  },
  freshUntil: {
    type: Date,
    required: true,
    default: () => new Date(Date.now() + (JOB_CACHE_TTL_HOURS * 60 * 60 * 1000)),
    index: true
  },
  expiresAt: {
    type: Date,
    required: true,
    default: () => new Date(Date.now() + (JOB_CACHE_RETENTION_DAYS * 24 * 60 * 60 * 1000))
  }
}, { timestamps: true });

jobCacheSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
jobCacheSchema.index({ source: 1, externalJobId: 1 });
jobCacheSchema.index({ freshUntil: 1, lastSynced: -1, updatedAt: -1 });
jobCacheSchema.index({ platform: 1, jobType: 1, freshUntil: 1, lastSynced: -1 });

module.exports = mongoose.model('JobCache', jobCacheSchema);
