const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const mime = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2'
};
const recommendationsResponse = (response) =>
  new URL(response.url()).pathname === '/api/recommendations' &&
  response.request().method() === 'POST' &&
  response.ok();

async function verifyDefaultResumeTabs({
  workers,
  user,
  token,
  initialAnalysis,
  fileId,
  analysisId
}) {
  const { chromium } = require(process.env.DPA_PLAYWRIGHT_MODULE);
  const dist = path.resolve(__dirname, '../../../../frontend/dist/frontend/browser');
  const entry = path.join(dist, 'index.html');
  assert.ok(fs.existsSync(entry), 'Build the frontend before running the browser test');
  const app = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
    let file = path.resolve(dist, '.' + pathname);
    if (!file.startsWith(dist + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile())
      file = entry;
    res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + app.address().port;
  let browser;
  try {
    browser = await chromium.launch({
      executablePath: process.env.DPA_BROWSER_EXECUTABLE,
      headless: true
    });
    const context = await browser.newContext();
    await context.addInitScript(
      ({ user, token }) => {
        localStorage.setItem('token', token);
        localStorage.setItem('user', JSON.stringify(user));
      },
      { user, token }
    );
    const resumeTab = await context.newPage();
    const recommendationsTab = await context.newPage();
    const paidRequests = [];
    await context.route('**/*', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== origin) return route.abort();
      if (!url.pathname.startsWith('/api/')) return route.continue();
      if (!/^\/api\/(resume|profile|recommendations|github)(\/|$)/.test(url.pathname))
        return route.fulfill({ json: { data: [], notifications: [] } });
      if (url.pathname === '/api/recommendations' && request.postDataJSON()?.forceRefresh)
        paidRequests.push(url.pathname);
      const worker = request.frame().page() === resumeTab ? workers[0] : workers[1];
      const response = await route.fetch({
        url: worker.base + url.pathname + url.search,
        maxRedirects: 0,
        timeout: 10000
      });
      return route.fulfill({ response });
    });
    const first = recommendationsTab.waitForResponse(recommendationsResponse);
    await Promise.all([
      recommendationsTab.goto(origin + '/app/recommendations'),
      resumeTab.goto(origin + '/app/resume-analyzer')
    ]);
    assert.equal((await (await first).json()).resumeInsights.analysisId, initialAnalysis);
    await resumeTab.getByLabel('Select resume:').selectOption(fileId);
    const regenerated = recommendationsTab.waitForResponse(recommendationsResponse);
    await resumeTab.getByRole('button', { name: 'Set as Active & Default' }).click();
    const body = await (await regenerated).json();
    assert.equal(body.resumeInsights.fileId, fileId);
    assert.equal(body.resumeInsights.analysisId, analysisId);
    assert.deepEqual(paidRequests, []);
  } finally {
    await browser?.close();
    app.closeAllConnections();
    await new Promise((resolve) => app.close(resolve));
  }
}
module.exports = { verifyDefaultResumeTabs };
