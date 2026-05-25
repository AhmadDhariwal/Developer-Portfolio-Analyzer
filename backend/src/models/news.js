const mongoose = require('mongoose');

const normalizedNewsSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    title: { type: String, required: true },
    description: { type: String, default: '' },
    source: { type: String, default: 'Unknown' },
    url: { type: String, required: true },
    image: { type: String, default: '' },
    publishedAt: { type: Date, required: true },
    category: { type: String, default: 'Backend' },
    popularity: { type: Number, default: 0 },
    relevanceScore: { type: Number, default: 0 },
    rankScore: { type: Number, default: 0 },
    tags: [{ type: String }]
  },
  { _id: false }
);

const newsCacheSchema = new mongoose.Schema(
  {
    cacheKey: { type: String, required: true, unique: true },
    filters: { type: Object, default: {} },
    allItems: { type: [normalizedNewsSchema], default: [] },
    total: { type: Number, default: 0 },
    sourceSummary: { type: Object, default: {} },
    trendingTopics: [{ type: String }],
    recommendedBasedOn: { type: Object, default: {} },
    providerUsed: [{ type: String }],
    providerFailureCount: { type: Number, default: 0 },
    responseTimeMs: { type: Number, default: 0 },
    lastUpdated: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true }
  },
  { timestamps: true }
);

newsCacheSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('NewsCache', newsCacheSchema);
