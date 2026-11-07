// Real authenticated local acceptance. Never writes tokens or account details to evidence.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
const backend = path.resolve(__dirname, '../../backend');
const mongoose = require(path.join(backend, 'node_modules/mongoose'));
const jwt = require(path.join(backend, 'node_modules/jsonwebtoken'));
require(path.join(backend, 'node_modules/dotenv')).config({
  path: path.join(backend, '.env'),
  quiet: true,
});
const before = process.argv.includes('--before');
const runtimeAudit = process.argv.includes('--runtime-audit');
const flowAudit = process.argv.includes('--flow-audit');
const root = path.resolve(__dirname, '../dist/frontend/browser');
const output = path.resolve(
  __dirname,
  flowAudit
    ? '../verification/tech-news/flow-audit'
    : runtimeAudit
      ? '../verification/tech-news/runtime-audit'
      : '../verification/tech-news/search-corrections',
);
const result = {
  phase: runtimeAudit ? 'live' : before ? 'before' : 'after',
  realApi: true,
  requests: [],
  errors: [],
  checks: [],
};
const auditCache = flowAudit ? require(path.join(backend, 'src/services/redisCacheService')) : null;
async function admissionCounters() {
  const redis = auditCache?.getRedisCacheClient({ commandTimeoutMs: 1500 });
  if (!redis) return null;
  const day = new Date().toISOString().slice(0, 10);
  const keys = [
    `news:v1:{discovery}:jobs:${day}`,
    `news:v1:{discovery}:prewarm:${day}`,
    `news:v3:{hackernewssearch}:day:${day}`,
    `news:v3:{devtosearch}:day:${day}`,
  ];
  return Promise.all(
    keys.map((key) =>
      redis
        .get(key)
        .then((value) => Number(value || 0))
        .catch(() => null),
    ),
  );
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI, {
    autoIndex: false,
    serverSelectionTimeoutMS: 5000,
  });
  const User = require(path.join(backend, 'src/models/user'));
  const user = await User.findOne({ role: 'developer', isActive: { $ne: false } }).lean();
  assert(user, 'An active local developer account is required');
  const token = jwt.sign({ id: String(user._id) }, process.env.JWT_SECRET, {
    expiresIn: '10m',
    issuer: process.env.JWT_ISSUER || 'devinsight-api',
    audience: process.env.JWT_AUDIENCE || 'devinsight-web',
  });
  if (flowAudit) {
    await auditCache.initRedisCache({ probeOnly: true });
    result.admissionBefore = await admissionCounters();
  }
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/api/')) {
      const upstream = http.request(
        {
          hostname: 'localhost',
          port: 5000,
          path: req.url,
          method: req.method,
          headers: { ...req.headers, connection: 'close' },
          agent: false,
        },
        (response) => {
          res.writeHead(response.statusCode, response.headers);
          response.pipe(res);
        },
      );
      upstream.on('error', () => {
        res.writeHead(502);
        res.end();
      });
      req.pipe(upstream);
      return;
    }
    let file = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
    if (
      !file.startsWith(root + path.sep) ||
      !fs.existsSync(file) ||
      fs.statSync(file).isDirectory()
    )
      file = path.join(root, 'index.html');
    res.setHeader(
      'Content-Type',
      {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.ttf': 'font/ttf',
        '.ico': 'image/x-icon',
      }[path.extname(file)] || 'application/octet-stream',
    );
    fs.createReadStream(file).pipe(res);
  });
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addInitScript(
      ({ token, user }) => {
        localStorage.setItem('token', token);
        localStorage.setItem('user', JSON.stringify(user));
      },
      {
        token,
        user: {
          _id: String(user._id),
          role: user.role,
          name: user.name,
          activeCareerStack: user.activeCareerStack,
          activeGithubUsername: user.activeGithubUsername,
        },
      },
    );
    const page = await context.newPage();
    page.on('pageerror', (error) => result.errors.push(error.message));
    const capture = async (response) => {
      const url = new URL(response.url());
      if (url.pathname !== '/api/news') return;
      let body;
      try {
        body = await response.json();
      } catch {
        return;
      }
      result.requests.push({
        query: Object.fromEntries(url.searchParams),
        http: response.status(),
        total: body.total,
        items: body.items?.length,
        coverage: body.coverage,
        enrichment: body.enrichment,
        catalogUnavailable: body.telemetry?.catalogUnavailable,
      });
    };
    const waitFeed = async (action, matches = () => true) => {
      const [response] = await Promise.all([
        page.waitForResponse((response) => {
          const url = new URL(response.url());
          return url.pathname === '/api/news' && matches(url.searchParams);
        }),
        action(),
      ]);
      await capture(response);
    };
    await waitFeed(() => page.goto(`http://127.0.0.1:${server.address().port}/app/news`));
    await page.locator('app-news-filters').waitFor();
    result.forYou = {
      categoryControls: await page.locator('#news-category').count(),
      searchControls: await page.locator('#news-search').count(),
      sourceControls: await page.locator('#news-source').count(),
      dateControls: await page.locator('#news-date').count(),
      technologyButtons: await page.locator('.topic-list button').count(),
    };
    if (!before)
      assert.deepEqual(result.forYou, {
        categoryControls: 0,
        searchControls: 0,
        sourceControls: 1,
        dateControls: 1,
        technologyButtons: 0,
      });
    await waitFeed(() => page.getByRole('button', { name: 'Explore', exact: true }).click());
    if (flowAudit) {
      // A fixed-feed source cannot admit keyword discovery. Preserve that explicit filter
      // while exercising correction through the real API without spending provider quota.
      await page.locator('#news-source').selectOption('GitHub Releases');
      await page.locator('#news-search').fill('kubernets');
      await waitFeed(() =>
        page.getByRole('button', { name: 'Apply Filters', exact: true }).click(),
      );
      await page
        .locator('.discovery-status')
        .getByText('Did you mean Kubernetes?', { exact: false })
        .waitFor();
      assert.equal(result.requests.at(-1).enrichment.reason, 'spelling_suggestion');
      fs.mkdirSync(output, { recursive: true });
      await page.screenshot({ path: path.join(output, 'suggestion.png'), fullPage: true });
      await waitFeed(
        () => page.getByRole('button', { name: 'Search Kubernetes', exact: true }).click(),
        (params) => params.get('search') === 'kubernetes' && params.get('discover') === 'true',
      );
      assert.equal(result.requests.at(-1).query.search, 'kubernetes');
      assert.equal(result.requests.at(-1).query.discover, 'true');
      assert.equal(result.requests.at(-1).query.source, 'GitHub Releases');
      assert.equal(result.requests.at(-1).enrichment.status, 'not_needed');
      result.checks.push(
        'Reviewed typo suggestion keeps literal query; correction retains source and normal discovery rules',
      );
      await page.locator('#news-source').selectOption('All');
    }
    await page.locator('#news-search').fill('  DevOps  ');
    await waitFeed(() => page.getByRole('button', { name: 'Apply Filters', exact: true }).click());
    await page.locator('app-news-card').first().waitFor();
    const search = result.requests.find(
      (entry) => entry.query.discover === 'true' && entry.query.search === 'devops',
    );
    assert(
      search && search.query.mode === 'explore' && search.query.search.toLowerCase() === 'devops',
    );
    assert(search.http === 200 && search.total > 0 && search.items > 0);
    if (!before) assert.equal(search.query.search, 'devops');
    result.checks.push('Real authenticated Explore submission returns stored DevOps articles');
    if (before) {
      fs.mkdirSync(output, { recursive: true });
      await page.locator('app-news').screenshot({ path: path.join(output, 'before.png') });
      return;
    }
    await waitFeed(() =>
      page
        .locator('#news-date')
        .selectOption('month')
        .then(() => page.getByRole('button', { name: 'Apply Filters', exact: true }).click()),
    );
    const filtered = result.requests.at(-1);
    assert.equal(filtered.query.bypassCache, 'true');
    assert(!filtered.query.discover && !filtered.query.refresh);
    await waitFeed(() => page.getByRole('button', { name: 'Next', exact: true }).click());
    const paged = result.requests.at(-1);
    assert.equal(paged.query.page, '2');
    assert(!paged.query.discover && !paged.query.refresh);
    await waitFeed(() =>
      page.locator('header').getByRole('button', { name: 'Refresh Results', exact: true }).click(),
    );
    const refreshed = result.requests.at(-1);
    assert.equal(refreshed.query.bypassCache, 'true');
    assert(!refreshed.query.discover && !refreshed.query.refresh);
    result.checks.push('Date, pagination and Refresh Results remain catalog-only');
    if (!before && !flowAudit) {
      fs.mkdirSync(output, { recursive: true });
      await page.locator('app-news').screenshot({
        path: path.join(output, runtimeAudit ? 'live-explore.png' : 'after-explore.png'),
      });
      await waitFeed(() => page.getByRole('button', { name: /Check for New Articles/ }).click());
      const checked = result.requests.at(-1);
      assert.equal(checked.query.refresh, 'true');
      assert.equal(checked.query.page, '1');
      assert(!checked.query.bypassCache && !checked.query.discover);
      assert(checked.enrichment && checked.enrichment.status !== 'not_needed');
      result.checks.push('Check for New Articles uses explicit governed refresh on page one');
      if (runtimeAudit) {
        await page.evaluate(
          () =>
            new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
        );
        await page.screenshot({ path: path.join(output, 'live-check-result.png'), fullPage: true });
      }
      await waitFeed(() => page.getByRole('button', { name: 'For You', exact: true }).click());
      assert.equal(await page.locator('#news-category, #news-search').count(), 0);
      assert(!result.requests.at(-1).query.category && !result.requests.at(-1).query.search);
      result.checks.push(
        'For You controls and request parameters remain corrected after switching views',
      );
    }
    if (flowAudit) {
      await page.screenshot({ path: path.join(output, 'explore.png'), fullPage: true });
      await waitFeed(() => page.getByRole('button', { name: 'For You', exact: true }).click());
      assert.equal(await page.locator('#news-category, #news-search').count(), 0);
      result.checks.push('For You remains personalized without hidden search controls');
    }
    fs.mkdirSync(output, { recursive: true });
    if (flowAudit)
      await page.screenshot({ path: path.join(output, `${result.phase}.png`), fullPage: true });
    else
      await page.locator('app-news').screenshot({ path: path.join(output, `${result.phase}.png`) });
    assert.deepEqual(result.errors, []);
  } catch (error) {
    result.failure = error.message;
    throw error;
  } finally {
    if (flowAudit) {
      result.admissionAfter = await admissionCounters();
      result.admissionCountersUnchanged = result.admissionBefore?.every(
        (value, index) => value !== null && value === result.admissionAfter?.[index],
      );
      await auditCache.closeRedisCache();
    }
    await browser.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await mongoose.disconnect();
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(
      path.join(output, `${result.phase}.json`),
      JSON.stringify(result, null, 2) + '\n',
    );
  }
  console.log(
    JSON.stringify({
      phase: result.phase,
      checks: result.checks,
      forYou: result.forYou,
      requests: result.requests.length,
      errors: result.errors,
    }),
  );
}
main()
  .then(() => process.exit(0))
  .catch(async (error) => {
    console.error(error.message);
    await mongoose.disconnect();
    process.exit(1);
  });
