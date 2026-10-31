const mongoose = require('mongoose');

const supportTicketSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    name: {
      type: String,
      required: true
    },
    email: {
      type: String,
      required: true
    },
    category: {
      type: String,
      enum: [
        'bug',
        'feature_request',
        'account_issue',
        'billing_issue',
        'general_feedback',
        'other'
      ],
      required: true
    },
    priority: {
      type: String,
      enum: ['low', 'medium', 'high', 'urgent'],
      required: true
    },
    subject: {
      type: String,
      required: true,
      maxlength: 150
    },
    message: {
      type: String,
      required: true,
      maxlength: 5000
    },
    status: {
      type: String,
      enum: ['open', 'in_progress', 'resolved', 'closed'],
      default: 'open',
      index: true
    },
    statusRevision: { type: Number, default: 0 },
    emailDelivery: {
      status: {
        type: String,
        enum: ['pending', 'processing', 'retrying', 'sent', 'failed', 'uncertain', 'skipped'],
        default: 'skipped'
      },
      attempts: { type: Number, default: 0 },
      nextAttemptAt: Date,
      leaseUntil: Date,
      leaseId: String,
      lastError: String
    },
    sourcePage: {
      type: String,
      default: ''
    },
    browserInfo: {
      type: String,
      default: '',
      maxlength: 512
    },
    dedupeKey: {
      type: String,
      required: true,
      maxlength: 128
    },
    dedupeWindow: {
      type: Number,
      required: true
    }
  },
  { timestamps: true }
);

supportTicketSchema.index({ userId: 1, createdAt: -1 });
supportTicketSchema.index({ status: 1, createdAt: -1 });
supportTicketSchema.index(
  { 'emailDelivery.status': 1, 'emailDelivery.nextAttemptAt': 1 },
  { name: 'support_email_due' }
);
supportTicketSchema.index(
  { userId: 1, dedupeKey: 1, dedupeWindow: 1 },
  { unique: true, partialFilterExpression: { dedupeKey: { $type: 'string' } } }
);

module.exports = mongoose.model('SupportTicket', supportTicketSchema);
