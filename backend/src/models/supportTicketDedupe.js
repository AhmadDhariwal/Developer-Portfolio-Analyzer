const mongoose = require('mongoose');

const supportTicketDedupeSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, required: true },
  dedupeKey: { type: String, required: true },
  expiresAt: { type: Date, required: true }
}, { timestamps: true });

supportTicketDedupeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('SupportTicketDedupe', supportTicketDedupeSchema);
