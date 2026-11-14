const path = require('node:path');
const mongoose = require('mongoose');
const Article = require('../models/newsArticle');
const catalog = require('../services/newsCatalogService');

// Dry-run by default. Add indexes only and copy eligible public metadata in bounded
// batches. Never sync/drop indexes, delete legacy caches, or touch saved/history data.
async function migrate({ apply = false } = {}) {
  const inventory = {
    apply,
    eligible: 0,
    inserted: 0,
    legacyDocuments: 0,
    indexes: Article.schema.indexes()
  };
  if (apply) {
    await Article.createIndexes();
    for (const source of Object.keys(catalog.SOURCE_KEYS))
      await Article.collection.updateMany({ source }, [
        {
          $set: {
            expiresAt: { $min: ['$expiresAt', { $add: ['$publishedAt', catalog.retentionMs(source)] }] }
          }
        }
      ]);
  }
  for (const name of ['NewsCache', 'NewsTopicCache']) {
    const model = require(name === 'NewsCache' ? '../models/news' : '../models/newsTopicCache');
    const cursor = model
      .find({ cacheKey: name === 'NewsCache' ? 'news:v3:public:pool' : /^news:v1:\{discovery\}:topic:/ })
      .lean()
      .cursor();
    for await (const snapshot of cursor) {
      inventory.legacyDocuments++;
      const articles = (snapshot.allItems || []).filter((item) => catalog.prepare(item));
      inventory.eligible += articles.length;
      if (apply) inventory.inserted += (await catalog.ingest(articles)).inserted;
    }
  }
  return inventory;
}
if (require.main === module)
  (async () => {
    try {
      require('dotenv').config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
      await mongoose.connect(process.env.MONGODB_URI, { autoIndex: false, serverSelectionTimeoutMS: 5000 });
      console.log(JSON.stringify(await migrate({ apply: process.argv.includes('--apply') }), null, 2));
    } catch (error) {
      console.error('Catalog migration failed:', error.name);
      process.exitCode = 1;
    } finally {
      await mongoose.disconnect();
    }
  })();
module.exports = { migrate };
