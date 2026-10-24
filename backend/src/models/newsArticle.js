const mongoose = require('mongoose');
const schema = new mongoose.Schema(
  {
    canonicalId: { type: String, required: true },
    article: { type: require('./news').schema.path('allItems').schema, required: true },
    technologies: [String],
    searchTerms: [String],
    source: String,
    category: String,
    publishedAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true }
  },
  { timestamps: true, autoIndex: false, bufferCommands: false }
);
schema.index({ canonicalId: 1 }, { unique: true });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
schema.index({ publishedAt: -1, canonicalId: 1 });
schema.index({ technologies: 1, publishedAt: -1, canonicalId: 1 });
schema.index({ searchTerms: 1, publishedAt: -1, canonicalId: 1 });
schema.index({ source: 1, publishedAt: -1, canonicalId: 1 });
schema.index({ category: 1, publishedAt: -1, canonicalId: 1 });
module.exports = mongoose.model('NewsArticle', schema);
