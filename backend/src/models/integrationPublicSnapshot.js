'use strict';
const mongoose = require('mongoose');
const schema = new mongoose.Schema(
  {
    _id: String,
    generation: { type: Number, default: 0 },
    leaseToken: String,
    leaseUntil: Date,
    freshUntil: Date,
    expiresAt: Date,
    observation: mongoose.Schema.Types.Mixed,
    requestCost: Number
  },
  { autoCreate: false, autoIndex: false, versionKey: false }
);
schema.index({ expiresAt: 1 }, { name: 'public_snapshot_expiry', expireAfterSeconds: 0 });
module.exports = mongoose.model('IntegrationPublicSnapshot', schema);
