const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./fixtures/newsHubRedisFixture');

test('news pages filter and slice the entire cached pool without calling providers', async () => {
  const allItems = Array.from({ length: 36 }, (_, index) => ({
    id: `article-${index}`,
    title: `Engineering update number ${index}`,
    description: `Engineering article ${index}`,
    url: `https://example.com/news/${index}`,
    source: 'Dev.to',
    category: index < 31 ? 'Frontend' : 'Backend',
    publishedAt: new Date(),
    popularity: index,
    tags: [],
  }));
  const service = load('../services/newsService.js', {
    axios: { get: () => assert.fail('Pagination must never call providers') },
    './newsPoolService': {
      readPool: async () => ({ allItems, lastUpdated: new Date() }),
      freshness: () => 'fresh',
    },
    './developerSignalService': {
      getDeveloperSignals: async () => ({}),
      buildSignalHash: () => 'pagination-test',
    },
  });
  const controller = load('../controllers/newsController.js', {
    '../services/newsService': service,
    '../models/newsSavedItem': {},
  });
  for (const tab of ['for-you', 'trending', 'latest']) {
    const ids = [];
    for (let page = 1; page <= 4; page++) {
      let response;
      await controller.getNews(
        {
          user: { _id: 'pagination-owner', activeCareerStack: 'Frontend' },
          query: { tab, page, limit: 12, category: 'Frontend' },
        },
        {
          json: (value) => {
            response = value;
          },
        },
      );
      const expectedTotal = tab === 'for-you' ? 36 : 31;
      const expectedTotalPages = Math.ceil(expectedTotal / 12);
      assert.equal(response.page, page);
      assert.equal(response.limit, 12);
      assert.equal(response.total, expectedTotal);
      assert.equal(response.totalPages, expectedTotalPages);
      assert.equal(response.hasMore, page < expectedTotalPages);
      const expectedLengths = tab === 'for-you' ? [12, 12, 12, 0] : [12, 12, 7, 0];
      assert.equal(response.items.length, expectedLengths[page - 1]);
      if (tab !== 'for-you') {
        assert.ok(response.items.every((item) => item.category === 'Frontend'));
      }
      ids.push(...response.items.map((item) => item.id));
    }
    assert.equal(new Set(ids).size, tab === 'for-you' ? 36 : 31);
  }
});
