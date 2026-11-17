'use strict';
const mongoose = require('mongoose');

const schema = new mongoose.Schema(
  {
    _id: String,
    count: Number,
    leases: [{ _id: false, token: String, until: Date }],
    expiresAt: { type: Date, required: true }
  },
  { autoCreate: false, autoIndex: false, versionKey: false }
);
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'governance_expiry' });

module.exports = mongoose.model('IntegrationGovernanceState', schema);
