const mongoose = require('mongoose');

const supportTicketQuotaSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true },
  window: { type: Number, required: true },
  count: { type: Number, default: 0 },
  expiresAt: { type: Date, required: true }
}, { timestamps: true });

supportTicketQuotaSchema.index({ userId: 1, window: 1 }, { unique: true });
supportTicketQuotaSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('SupportTicketQuota', supportTicketQuotaSchema);
