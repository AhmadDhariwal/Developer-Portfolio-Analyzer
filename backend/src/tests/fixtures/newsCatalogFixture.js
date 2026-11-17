const { load } = require('./newsHubRedisFixture');

async function create(connection) {
  const Article =
    connection.models.NewsArticle ||
    connection.model('NewsArticle', require('../../modules/news/models/newsArticle').schema);
  await Article.createIndexes();
  return load('../modules/news/services/newsCatalogService.js', {
    '../models/newsArticle': Article,
    './redisCacheService': { getRedisCacheClient: () => null }
  });
}
module.exports = { create };
