const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { create } = require('./fixtures/newsCatalogFixture');

test(
  'isolated Mongo: indexed DevOps aliases, multi-tags, dates and totals update across warm worker caches',
  {
    skip: !process.env.NEWS_TEST_MONGODB_URI,
    timeout: 20000
  },
  async (t) => {
    const mongoose = require('mongoose');
    const uri = new URL(process.env.NEWS_TEST_MONGODB_URI);
    assert(['localhost', '127.0.0.1'].includes(uri.hostname));
    const database = 'news_search_test_' + randomUUID().replaceAll('-', '');
    const connection = await mongoose
      .createConnection(uri.href, { dbName: database, autoIndex: false })
      .asPromise();
    t.after(async () => {
      assert.equal(connection.name, database);
      await connection.dropDatabase();
      await connection.close();
    });
    const one = await create(connection),
      two = await create(connection);
    const filters = {
      mode: 'explore',
      tab: 'latest',
      search: 'devops',
      category: 'All',
      source: 'All',
      dateRange: 'week',
      popularity: 'all',
      page: 1,
      limit: 1
    };
    assert.equal((await two.query(filters)).total, 0);
    const input = (name, age) => ({
      title: name,
      url: `https://example.com/${age}`,
      source: 'Hacker News',
      publishedAt: new Date(Date.now() - age * 86400000)
    });
    await one.ingest([
      input('Docker Kubernetes security release', 0),
      input('Terraform deployment release', 20)
    ]);
    const recent = await two.query(filters);
    assert.equal(recent.total, 1);
    assert(recent.items[0].tags.includes('devops'));
    assert(recent.items[0].tags.includes('docker'));
    assert(recent.items[0].tags.includes('kubernetes'));
    assert.equal(recent.broadTotal, 2);
    assert.equal(recent.historicalTotal, 2);
    const month = await two.query({ ...filters, search: 'dev ops', dateRange: 'month', page: 2 });
    assert.equal(month.total, 2);
    assert.equal(month.items.length, 1);
    assert.match(month.items[0].title, /Terraform/);
    assert.equal((await two.query({ ...filters, source: 'Dev.to' })).total, 0);
    assert.equal((await two.query({ ...filters, search: 'docker security' })).total, 1);
    assert.equal((await two.query({ ...filters, search: 'k8s' })).total, 1);
    const model = connection.models.NewsArticle;
    const document = await model.findOne({ technologies: 'docker' }).lean();
    assert(document.searchTerms.includes('devops'));
    const explain = await model.find(one.predicate(filters)).explain('executionStats');
    assert(!JSON.stringify(explain.queryPlanner.winningPlan).includes('COLLSCAN'));
    const version = recent.version;
    await one.ingest([input('GitOps observability rollout', 1)]);
    const updated = await two.query(filters);
    assert.equal(updated.total, 2);
    assert(updated.version > version);
  }
);
