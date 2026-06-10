const mongoose = require('mongoose');

const jobSourceHealthSchema = new mongoose.Schema({
  source: {
    type: String,
    required: true,
    trim: true,
    unique: true,
    index: true
  },
  configured: {
    type: Boolean,
    default: false
  },
  reachable: {
    type: Boolean,
    default: false
  },
  jobsFetched: {
    type: Number,
    default: 0,
    min: 0
  },
  lastSuccessAt: {
    type: Date,
    default: null
  },
  lastFailureAt: {
    type: Date,
    default: null
  },
  error: {
    type: String,
    default: ''
  },
  endpoint: {
    type: String,
    default: ''
  },
  requestQuery: {
    type: String,
    default: ''
  },
  requestParams: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  statusCode: {
    type: Number,
    default: null
  },
  responseBody: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  }
}, { timestamps: true });

module.exports = mongoose.model('JobSourceHealth', jobSourceHealthSchema);
