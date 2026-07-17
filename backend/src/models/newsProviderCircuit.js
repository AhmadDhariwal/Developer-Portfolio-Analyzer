const mongoose = require('mongoose');

const newsProviderCircuitSchema = new mongoose.Schema({
  provider: { type: String, required: true, unique: true, index: true, trim: true },
  failureCount: { type: Number, default: 0, min: 0 },
  circuitOpenUntil: { type: Date, default: null, index: true },
  lastFailureAt: { type: Date, default: null },
  expiresAt: { type: Date, default: null }
}, { timestamps: true });

newsProviderCircuitSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('NewsProviderCircuit', newsProviderCircuitSchema);
