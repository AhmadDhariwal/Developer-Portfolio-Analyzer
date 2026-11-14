'use strict';

const mongoose = require('mongoose');
const schema = new mongoose.Schema(
  {
    _id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    timeZone: { type: String, required: true }
  },
  { timestamps: true, read: 'primary' }
);
module.exports = mongoose.model('SprintPreference', schema);
