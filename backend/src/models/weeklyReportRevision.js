const mongoose = require('mongoose');
const schema = new mongoose.Schema(
  {
    reportId: { type: mongoose.Schema.Types.ObjectId, required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, required: true },
    contentHash: { type: String, required: true },
    snapshot: { type: mongoose.Schema.Types.Mixed, required: true, immutable: true },
  },
  { timestamps: true },
);
schema.index({ reportId: 1, contentHash: 1 }, { unique: true });
schema.index({ userId: 1, reportId: 1 });
module.exports = mongoose.model('WeeklyReportRevision', schema);
