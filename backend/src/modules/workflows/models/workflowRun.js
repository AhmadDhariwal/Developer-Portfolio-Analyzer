const mongoose = require('mongoose');

const workflowStepSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, trim: true },
    label: { type: String, required: true, trim: true },
    status: {
      type: String,
      enum: ['pending', 'running', 'completed', 'failed', 'skipped'],
      default: 'pending'
    },
    attempts: { type: Number, default: 0 },
    maxRetries: { type: Number, default: 1 },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    error: { type: String, default: '' },
    output: { type: mongoose.Schema.Types.Mixed, default: null }
  },
  { _id: false }
);

const workflowRunSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    pipeline: {
      type: String,
      required: true,
      enum: ['github_only', 'resume_only', 'combined', 'deep_scan'],
      index: true
    },
    status: {
      type: String,
      enum: ['queued', 'running', 'completed', 'failed'],
      default: 'queued',
      index: true
    },
    input: { type: mongoose.Schema.Types.Mixed, default: {} },
    steps: { type: [workflowStepSchema], default: [] },
    result: { type: mongoose.Schema.Types.Mixed, default: {} },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    retryPolicy: {
      maxRetriesPerStep: { type: Number, default: 1 },
      retryDelayMs: { type: Number, default: 600 }
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model('WorkflowRun', workflowRunSchema);
