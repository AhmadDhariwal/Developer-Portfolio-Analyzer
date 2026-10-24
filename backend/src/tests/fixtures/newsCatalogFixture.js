const { load } = require('./newsHubRedisFixture');

async function create(connection) {
  const Article =
    connection.models.NewsArticle ||
    connection.model('NewsArticle', require('../../models/newsArticle').schema);
  await Article.createIndexes();
  return load('../services/newsCatalogService.js', {
    '../models/newsArticle': Article,
    './redisCacheService': { getRedisCacheClient: () => null }
  });
}
module.exports = { create };
