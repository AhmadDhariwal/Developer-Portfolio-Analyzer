const mongoose = require('mongoose');

const supportTicketSchema = new mongoose.Schema({
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
    enum: ['bug', 'feature_request', 'account_issue', 'billing_issue', 'general_feedback', 'other'],
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
  sourcePage: {
    type: String,
    default: ''
  },
  browserInfo: {
    type: String,
    default: ''
  }
}, { timestamps: true });

module.exports = mongoose.model('SupportTicket', supportTicketSchema);
