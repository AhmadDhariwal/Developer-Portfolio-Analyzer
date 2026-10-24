'use strict';

const mongoose = require('mongoose');
const schema = new mongoose.Schema(
  {
    _id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    windows: [{ _id: false, sprintId: String, start: Date, end: Date, token: String }]
  },
  { timestamps: true, read: 'primary' }
);
module.exports = mongoose.model('SprintSchedule', schema);
