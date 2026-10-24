const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { fixture, load } = require('./fixtures/newsHubRedisFixture');

test(
  'isolated free-text HTTP search, Redis worker and Mongo publication round trip',
  {
    skip: !process.env.NEWS_TEST_REDIS_URL || !process.env.NEWS_TEST_MONGODB_URI,
    timeout: 180000
  },
  async (t) => {
    const mongoose = require('mongoose');
    const uri = new URL(process.env.NEWS_TEST_MONGODB_URI);
    assert.equal(uri.protocol, 'mongodb:');
    assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(uri.hostname));
    const connection = await mongoose
      .createConnection(uri.href, {
        dbName: `news_search_test_${randomUUID().replaceAll('-', '')}`,
        serverSelectionTimeoutMS: 3000
      })
      .asPromise();
    t.after(async () => {
      await connection.dropDatabase();
      await connection.close();
    });
    const catalog = await require('./fixtures/newsCatalogFixture').create(connection);
    const Topic = connection.model('NewsTopicCache', require('../models/newsTopicCache').schema);
    const Saved = connection.model('NewsSavedItem', require('../models/newsSavedItem').schema);
    const User = connection.model('User', require('../models/user').schema);
    await Promise.all([Topic.init(), Saved.init()]);
    const indexes = await Topic.collection.indexes();
    assert.ok(indexes.some((index) => index.unique && index.key.cacheKey));
    assert.ok(indexes.some((index) => index.expireAfterSeconds === 0 && index.key.expiresAt));
    assert.ok(indexes.some((index) => index.key['filters.topic'] && index.key.expiresAt));
    const users = [new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId()];
    await User.collection.insertMany(
      users.map((_id, index) => ({
        _id,
        name: 'Isolated news test',
        email: `news-${index}@example.invalid`,
        role: 'developer',
        isActive: true
      }))
    );
    const isolated = await fixture(t);
    const one = await isolated.worker();
    const two = await isolated.worker();
    process.env.NEWS_DISCOVERY_ENABLED = 'true';
    process.env.NEWS_INGESTION_ENABLED = 'true';
    process.env.NEWS_HACKERNEWSSEARCH_CONTENT_APPROVED = 'true';
    process.env.NEWS_HACKERNEWSSEARCH_DAILY_BUDGET = '12';
    process.env.NEWS_HACKERNEWSSEARCH_MONTHLY_BUDGET = '300';
    const governor = load('../services/newsGovernanceService.js', { './redisCacheService': one.cache });
    let calls = 0;
    let releaseSearch;
    let announceSearch;
    let searchStarted;
    let heldSearch;
    const configured = load('../services/newsDiscoveryProviders.js', {
      './newsGovernanceService': governor,
      './platformSettingsService': { getIntegrationSecretsSync: () => ({ newsEnabled: true }) },
      axios: {
        get: async (url) => {
          calls++;
          if (heldSearch) {
            announceSearch();
            await heldSearch;
          }
          const query = new URL(url).searchParams.get('query');
          return {
            status: 200,
            headers: {},
            data: {
              hits: Array.from(
                { length: process.env.NEWS_TEST_BROWSER === 'true' && calls >= 2 ? 16 : 15 },
                (_, index) => ({
                  title: `${query} engineering ${index}`,
                  url: `https://example.com/${encodeURIComponent(query)}/${index}`,
                  created_at: new Date(
                    Date.now() - (index === 14 ? 10 * 86400000 : index * 60000)
                  ).toISOString()
                })
              )
            }
          };
        }
      }
    });
    const available = configured.available;
    configured.available = (query) => available(query).filter((key) => key === 'hackernewssearch');
    const makeDiscovery = (worker) =>
      load('../services/newsDiscoveryService.js', {
        './newsCatalogService': catalog,
        '../models/newsTopicCache': Topic,
        './redisCacheService': worker.cache,
        './newsGovernanceService': load('../services/newsGovernanceService.js', {
          './redisCacheService': worker.cache
        }),
        './newsDiscoveryProviders': configured
      });
    const discovery = makeDiscovery(one);
    const otherWorker = makeDiscovery(two);
    t.after(() => {
      discovery.stopWorker();
      otherWorker.stopWorker();
    });
    const makeFeed = (worker) =>
      load('../services/newsService.js', {
        './newsCatalogService': catalog,
        './newsDiscoveryService': worker,
        './newsPoolService': { readPool: async () => null, freshness: () => 'fresh' },
        './developerSignalService': {
          getDeveloperSignals: async () => ({}),
          buildSignalHash: () => 'isolated'
        }
      });
    const feed = makeFeed(discovery);
    const controller = load('../controllers/newsController.js', {
      '../services/newsService': feed,
      '../models/newsSavedItem': Saved
    });
    const middleware = load('../middleware/newsMiddleware.js', {
      '../services/redisCacheService': one.cache
    });
    process.env.JWT_SECRET = 'isolated-news-search-test-secret-32-characters';
    const auth = load('../middleware/authmiddleware.js', { '../models/user': User });
    const router = load('../routes/newsRoutes.js', {
      '../controllers/newsController': controller,
      '../middleware/newsMiddleware': middleware,
      '../middleware/authmiddleware': auth
    });
    const express = require('express');
    const app = express();
    app.use(express.json());
    app.use('/api/news', router);
    const root = path.resolve(__dirname, '../../../frontend/dist/frontend/browser');
    app.use(express.static(root));
    app.get('/{*path}', (_req, res) => res.sendFile(path.join(root, 'index.html')));
    const server = await new Promise((resolve) => {
      const value = app.listen(0, '127.0.0.1', () => resolve(value));
    });
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const jwt = require('jsonwebtoken');
    const tokens = users.map((id) =>
      jwt.sign({ id }, process.env.JWT_SECRET, {
        issuer: 'devinsight-api',
        audience: 'devinsight-web',
        expiresIn: '10m'
      })
    );
    const request = (suffix = '', user = 0, options = {}) =>
      fetch(origin + '/api/news' + suffix, {
        ...options,
        headers: { Authorization: `Bearer ${tokens[user]}`, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(10000)
      });
    assert.equal((await fetch(origin + '/api/news')).status, 401);
    assert.equal((await request('?mode=explore&search=react%20OR%20private')).status, 400);
    // Admit concurrently across actual authenticated accounts before starting a worker.
    const suffix = '?mode=explore&search=generative%20ai&date=week&discover=true';
    const pending = await Promise.all(
      Array.from({ length: 12 }, async (_, index) => (await request(suffix, index % 2)).json())
    );
    assert.ok(pending.every((value) => value.enrichment.status === 'worker_unavailable'));
    const day = new Date().toISOString().slice(0, 10);
    assert.equal(await one.redis.get(`news:v1:{discovery}:jobs:${day}`), '1');
    assert.equal(calls, 0);
    discovery.startWorker();
    const deadline = Date.now() + 10000;
    while (!(await Topic.findOne({ cacheKey: discovery.topicKey('generative ai') })) && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(calls, 1, 'A running worker must dispatch promptly and once');
    const stored = await Topic.findOne({ cacheKey: discovery.topicKey('generative ai') }).lean();
    assert.equal(stored.allItems.length, 15);
    assert.equal(stored.filters.topic, 'generative ai');
    assert.ok(!JSON.stringify(stored).includes(String(users[0])));
    const cold = makeDiscovery(two);
    const cached = await cold.readTopic(' Generative AI ');
    assert.equal(cached.allItems.length, 15);
    const result = await makeFeed(cold).getNewsFeed({
      user: { _id: users[1] },
      query: { mode: 'explore', search: 'generative ai', date: 'week', page: 2, limit: 12 }
    });
    assert.equal(result.total, 14);
    assert.equal(result.items.length, 2);
    assert.equal(result.coverage.dateExcludedMatches, 1);
    assert.ok(result.items.every((item) => item.rankScore === null));
    const repeat = await (await request(suffix)).json();
    assert.equal(repeat.total, 14);
    assert.equal(repeat.enrichment.status, 'ready');
    assert.equal(calls, 1);
    const saved = await (
      await request('/save', 0, {
        method: 'POST',
        body: JSON.stringify({ ...repeat.items[0], articleId: repeat.items[0].id, type: 'read_later' })
      })
    ).json();
    assert.ok(saved.item?.id, JSON.stringify(saved));
    assert.equal(
      (await request(`/save/${saved.item.id}/read`, 1, { method: 'PATCH', body: '{}' })).status,
      404
    );
    const read = await (
      await request(`/save/${saved.item.id}/read`, 0, { method: 'PATCH', body: '{}' })
    ).json();
    const unread = await (
      await request(`/save/${saved.item.id}/read`, 0, { method: 'PATCH', body: '{"read":false}' })
    ).json();
    assert.ok(read.item.firstReadAt);
    assert.equal(unread.item.firstReadAt, read.item.firstReadAt);
    assert.equal(unread.item.readAt, null);
    assert.equal((await (await request('/saved?type=read_later', 1)).json()).total, 0);

    // Existing per-adapter usage counts toward new aggregate budgets; counters are not reset.
    const shared = governor.sharedPolicy('hackernewssearch');
    await one.redis.set(`news:v3:{hackernews}:day:${day}`, String(shared.daily));
    await one.redis.del('news:v3:{hackernewssearch}:interval');
    await one.redis.del('news:v3:{hackernews}:shared:interval');
    assert.equal((await governor.reserve('hackernewssearch')).reason, 'shared_daily_budget');
    await one.redis.del(`news:v3:{hackernews}:day:${day}`);

    discovery.stopWorker();
    const filters = { source: 'All', category: 'All', dateRange: 'week', popularity: 'all', page: 1 };
    for (const search of ['AWS Lambda', 'Next.js updates', 'Python async']) {
      const admitted = await discovery.coverage({
        filters: { ...filters, search },
        total: 0,
        broadTotal: 0,
        admissionKey: 'quota-owner'
      });
      assert.equal(admitted.enrichment.status, 'queued');
    }
    const denied = await discovery.coverage({
      filters: { ...filters, search: 'Docker vulnerabilities' },
      total: 0,
      broadTotal: 0,
      admissionKey: 'quota-owner'
    });
    assert.equal(denied.enrichment.reason, 'user_discovery_budget');
    process.env.NEWS_DISCOVERY_USER_DAILY_JOBS = '1';
    await discovery.coverage({
      filters: { ...filters, search: 'new framework' },
      total: 0,
      broadTotal: 0,
      admissionKey: 'daily-owner'
    });
    const daily = await discovery.coverage({
      filters: { ...filters, search: 'new framework updates two' },
      total: 0,
      broadTotal: 0,
      admissionKey: 'daily-owner'
    });
    assert.equal(daily.enrichment.reason, 'user_discovery_daily_budget');
    assert.ok(Date.parse(daily.enrichment.nextEligibleAt) > Date.now() + 60000);
    process.env.NEWS_DISCOVERY_USER_DAILY_JOBS = '6';

    if (process.env.NEWS_TEST_BROWSER === 'true') {
      const { chromium } = require('playwright');
      const browser = await chromium.launch({ headless: true, channel: 'msedge' });
      t.after(() => browser.close());
      const context = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
        colorScheme: 'light'
      });
      await context.addInitScript(
        ({ token, id }) => {
          localStorage.setItem('token', token);
          localStorage.setItem(
            'user',
            JSON.stringify({ _id: id, name: 'Isolated News Reader', role: 'developer' })
          );
          localStorage.setItem('devinsight_theme', 'system');
        },
        { token: tokens[0], id: String(users[0]) }
      );
      const page = await context.newPage();
      const evidence = path.resolve(__dirname, '../../../frontend/verification/tech-news/runtime-audit');
      fs.mkdirSync(evidence, { recursive: true });
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if (url.origin !== origin) return route.abort();
        if (url.pathname.startsWith('/api/') && !url.pathname.startsWith('/api/news'))
          return route.fulfill({
            json: {
              data: [],
              notifications: [],
              resumes: [],
              integrations: [],
              organizations: [],
              teams: [],
              profile: {},
              user: { _id: String(users[0]), role: 'developer' },
              careerStack: 'Frontend',
              experienceLevel: 'Student'
            }
          });
        return route.continue();
      });
      await page.goto(origin + '/app/news');
      await page.getByRole('button', { name: 'Explore', exact: true }).click();
      await page.locator('#news-search').fill('generative ai');
      await page.locator('#news-search').press('Enter');
      await page.locator('app-news-card').first().waitFor();
      assert.match(await page.locator('app-news-card').first().innerText(), /generative ai/i);
      assert.equal(await page.locator('app-news-card').count(), 12);
      await Promise.all([
        page.waitForResponse(
          (response) => response.url().includes('/api/news?') && response.url().includes('date=month')
        ),
        page.getByRole('button', { name: 'Show This Month', exact: true }).click()
      ]);
      // Make only the disposable fixture eligible for a manual revalidation.
      const refreshState = JSON.parse(await one.redis.get(discovery.stateKey('generative ai')));
      refreshState.checkedAtMs -= 61000;
      refreshState.nextEligibleAt = new Date(Date.now() - 1).toISOString();
      await one.redis.set(discovery.stateKey('generative ai'), JSON.stringify(refreshState));
      await one.redis.del(discovery.QUEUE);
      await one.redis.del('news:v3:{hackernewssearch}:interval');
      await one.redis.del('news:v3:{hackernews}:shared:interval');
      await one.redis.set(discovery.HEARTBEAT, String(Date.now()));
      await page.reload();
      await page.getByRole('button', { name: 'Explore', exact: true }).click();
      await page.locator('#news-search').fill('generative ai');
      await page.locator('#news-search').press('Enter');
      await page.locator('app-news-card').first().waitFor();
      heldSearch = new Promise((resolve) => {
        releaseSearch = resolve;
      });
      searchStarted = new Promise((resolve) => {
        announceSearch = resolve;
      });
      await Promise.all([
        page.waitForResponse((response) => response.url().includes('refresh=true')),
        page.getByRole('button', { name: 'Check for New Articles', exact: true }).click()
      ]);
      assert.equal(await page.locator('app-news-card').count(), 12);
      await page.locator('.discovery-loader').waitFor();
      await page.screenshot({ path: path.join(evidence, 'queued-light.png'), fullPage: true });
      const work = discovery.processQueue();
      await searchStarted;
      await Promise.all([
        page.waitForResponse((response) => response.url().includes('bypassCache=true')),
        page.locator('.page-header').getByRole('button', { name: 'Refresh Results', exact: true }).click()
      ]);
      await page.getByText('Searching additional sources', { exact: true }).waitFor();
      assert.equal(await page.locator('app-news-card').count(), 12);
      await page.screenshot({ path: path.join(evidence, 'searching-light.png'), fullPage: true });
      const visibleBefore = await page.locator('app-news-card').first().innerText();
      releaseSearch();
      heldSearch = null;
      assert.equal((await work).status, 'ready');
      // The next existing 20-second catalog-only poll must adopt the new persisted count.
      await page.getByText('Search results cached', { exact: true }).waitFor({ timeout: 30000 });
      await page.waitForFunction(() =>
        document.querySelector('.section-heading')?.textContent.includes('15 matching articles')
      );
      assert.equal(await page.locator('app-news-card').count(), 12);
      assert(await page.locator('app-news-card').first().innerText());
      assert(visibleBefore.length > 0);
      assert.equal(await page.locator('.discovery-loader').count(), 0);
      assert.ok(await page.getByRole('button', { name: /^Check again in / }).isDisabled());
      await page.screenshot({
        path: path.join(evidence, 'updated-cooldown-light.png'),
        fullPage: true
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.emulateMedia({ colorScheme: 'dark' });
      await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'dark');
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        'Mobile layout must not overflow'
      );
      await page.locator('.discovery-status').scrollIntoViewIfNeeded();
      await page.screenshot({
        path: path.resolve(
          __dirname,
          '../../../frontend/verification/tech-news/runtime-audit/updated-cooldown-mobile-dark.png'
        )
      });
      assert.deepEqual(errors, []);
      assert.equal(calls, 2, 'Only the explicit governed refresh adds one provider attempt');
      fs.writeFileSync(
        path.join(evidence, 'isolated-browser.json'),
        JSON.stringify(
          {
            status: 'VERIFIED',
            authenticatedApi: true,
            infrastructure: 'disposable local Redis/Mongo',
            upstreamResponses: 'controlled fixtures, not real publisher articles',
            states: ['queued', 'searching', 'ready', 'cooldown'],
            cardsVisibleDuringWork: 12,
            beforeTotal: 14,
            afterTotal: 15,
            automaticCatalogPoll: true,
            providerCalls: calls,
            errors,
            mobileDarkNoOverflow: true
          },
          null,
          2
        ) + '\n'
      );
      await context.close();
      t.diagnostic(
        'Angular browser used the actual authenticated news API and isolated Redis/Mongo; upstream articles were controlled fixtures.'
      );
    }
    t.diagnostic(
      JSON.stringify({
        coldQuery: 'generative ai',
        workerDispatched: true,
        providerRequests: calls,
        mongoArticles: stored.allItems.length,
        weeklyMatches: result.total,
        weeklyPageTwo: result.items.length,
        indexesVerified: indexes.length,
        savedOwnershipVerified: true
      })
    );
  }
);
