// Explicit live Custom Q&A acceptance using the user's Netflix system-design question.
// Real providers/API, private owned persistence, no mocked answer or logged credentials.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { chromium } = require(
  process.env.PLAYWRIGHT_MODULE ||
    'C:/Users/Ahmad/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright',
);
const backend = path.resolve(__dirname, '../../backend');
require(path.join(backend, 'node_modules/dotenv')).config({
  path: path.join(backend, '.env'),
  quiet: true,
});
const mongoose = require(path.join(backend, 'node_modules/mongoose'));
const jwt = require(path.join(backend, 'node_modules/jsonwebtoken'));
const output = path.join(backend, 'verification/interview-prep/custom-system-design');
const dist = path.resolve(__dirname, '../dist/frontend/browser');
const upstream = process.env.INTERVIEW_ACCEPTANCE_API || 'http://localhost:5008';
const report = {
  at: new Date().toISOString(),
  synthetic: false,
  liveProvider: true,
  backendOrigin: upstream,
  requests: [],
  checks: [],
  screenshots: [],
};

(async () => {
  let server, browser;
  try {
    const readinessDeadline = Date.now() + 30000;
    let ready = false;
    while (Date.now() < readinessDeadline && !ready) {
      try {
        const response = await fetch(`${upstream}/`, { signal: AbortSignal.timeout(1000) });
        ready = response.ok;
        await response.arrayBuffer();
      } catch {
        // A restarted backend connects Mongo/Redis before opening its listener.
      }
      if (!ready) await new Promise((resolve) => setTimeout(resolve, 250));
    }
    assert.ok(ready, 'The real backend must be listening before browser acceptance.');
    await mongoose.connect(process.env.MONGODB_URI, {
      autoIndex: false,
      autoCreate: false,
      serverSelectionTimeoutMS: 5000,
    });
    const user = await mongoose.connection
      .collection('users')
      .findOne(
        { role: 'developer', isActive: { $ne: false } },
        { projection: { _id: 1, sessionRevision: 1 } },
      );
    assert.ok(user, 'An existing developer verification identity is required.');
    const token = jwt.sign(
      { id: String(user._id), sessionRevision: user.sessionRevision || 0 },
      process.env.JWT_SECRET,
      {
        expiresIn: '10m',
        algorithm: 'HS256',
        issuer: process.env.JWT_ISSUER || 'devinsight-api',
        audience: process.env.JWT_AUDIENCE || 'devinsight-web',
      },
    );
    const localUser = {
      _id: String(user._id),
      name: 'Verification Developer',
      role: 'developer',
      careerStack: 'Full Stack',
      experienceLevel: 'Student',
      isConfigured: true,
    };
    report.ownerIdentity = 'Existing developer; credentials and personal profile omitted.';
    report.sourceFingerprint = crypto
      .createHash('sha256')
      .update(fs.readFileSync(path.join(backend, 'src/services/interviewPrepService.js')))
      .digest('hex');
    server = http.createServer(async (req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1:4319');
      if (url.pathname === '/__live_verification') {
        res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
        return res.end(`<html><body>Live Interview Prep verification<script>
          localStorage.setItem('token', ${JSON.stringify(token)});
          localStorage.setItem('user', ${JSON.stringify(JSON.stringify(localUser))});
          localStorage.setItem('devinsight_career_profile', ${JSON.stringify(JSON.stringify(localUser))});
          localStorage.setItem('devinsight_theme', 'light');
        </script></body></html>`);
      }
      if (url.pathname.startsWith('/api/')) {
        const target = new URL(req.url, upstream);
        const proxy = http.request(
          target,
          { method: req.method, headers: { ...req.headers, host: target.host } },
          (response) => {
            res.writeHead(response.statusCode, response.headers);
            response.pipe(res);
          },
        );
        proxy.on('error', () => {
          if (!res.headersSent) res.writeHead(502);
          res.end('Local verification backend unavailable');
        });
        return req.pipe(proxy);
      }
      let file = path.resolve(dist, `.${decodeURIComponent(url.pathname)}`);
      if (!file.startsWith(dist + path.sep)) {
        res.writeHead(403);
        return res.end();
      }
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory())
        file = path.join(dist, 'index.html');
      const mime =
        {
          '.js': 'text/javascript',
          '.css': 'text/css',
          '.html': 'text/html',
          '.svg': 'image/svg+xml',
          '.png': 'image/png',
          '.woff2': 'font/woff2',
        }[path.extname(file)] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-store' });
      fs.createReadStream(file).pipe(res);
    });
    await new Promise((resolve) => server.listen(4319, '127.0.0.1', resolve));
    browser = await chromium.launch({
      headless: true,
      executablePath:
        process.env.INTERVIEW_CHROMIUM_PATH ||
        'C:/Program Files/Google/Chrome/Application/chrome.exe',
    });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    const question = 'system design of netflix';
    const fields = Object.keys(
      require(path.join(backend, 'src/services/interviewAIValidation')).SYSTEM_DESIGN_FIELDS,
    );
    const bankBefore = await mongoose.connection
      .collection('interviewquestionbanks')
      .countDocuments({ topicKey: 'system-design', question: /system design of netflix/i });
    report.publicBankCountBefore = bankBefore;
    await page.goto('http://127.0.0.1:4319/__live_verification');
    const openForm = async () => {
      await page.goto('http://127.0.0.1:4319/app/interview-prep');
      await page.locator('.workspace-nav button').filter({ hasText: 'Generate Questions' }).click();
      await page.locator('#studio-topic').selectOption('system-design');
      await page.locator('#custom-question').fill(question);
    };
    const submit = async (label) => {
      const responsePromise = page.waitForResponse(
        (response) =>
          response.url().endsWith('/api/interview-prep/ask-question') &&
          response.request().method() === 'POST',
        { timeout: 45000 },
      );
      const started = Date.now();
      await page.locator('form:has(#custom-question) button[type=submit]').click();
      const response = await responsePromise;
      const body = await response.json();
      report.requests.push({
        label,
        request: response.request().postDataJSON(),
        status: response.status(),
        durationMs: Date.now() - started,
        response: body,
      });
      assert.equal(response.request().postDataJSON().skill, 'system-design');
      assert.equal(response.request().postDataJSON().question, question);
      assert.equal(
        response.status(),
        200,
        `Actual Custom Q&A failed: ${body.code || body.message}`,
      );
      assert.equal(body.topicKey, 'system-design');
      assert.equal(body.verificationStatus, 'unverified');
      assert.equal(body.sourceType, 'ai_generated');
      assert.ok(body.answerSections?.scopeNote);
      for (const field of fields)
        assert.ok(
          typeof body.answerSections?.systemDesign?.[field] === 'string' &&
            body.answerSections.systemDesign[field].trim(),
          `Missing ${field}`,
        );
      return body;
    };
    await openForm();
    const first = await submit('actual-netflix-custom-answer');
    const stored = await mongoose.connection
      .collection('interviewprepsessions')
      .findOne({ _id: new mongoose.Types.ObjectId(first.sessionId), userId: user._id });
    assert.ok(stored, 'The private snapshot belongs to the verification identity.');
    assert.equal(stored.kind, 'custom');
    const snapshot = stored.questions[0];
    assert.equal(snapshot.sourceMeta.verificationStatus, 'unverified');
    assert.ok(
      snapshot.sourceMeta.provider && snapshot.sourceMeta.model && snapshot.sourceMeta.generatedAt,
    );
    for (const field of fields)
      assert.equal(
        snapshot.answerSections.systemDesign[field],
        first.answerSections.systemDesign[field],
      );
    report.persistence = {
      sessionId: String(stored._id),
      kind: stored.kind,
      ownerMatched: true,
      provider: snapshot.sourceMeta.provider,
      model: snapshot.sourceMeta.model,
      generatedAt: snapshot.sourceMeta.generatedAt,
      verificationStatus: snapshot.sourceMeta.verificationStatus,
      designFieldCount: fields.length,
    };
    const card = page.locator('.custom-result-section app-interview-question-card');
    await card.waitFor();
    assert.match(await card.locator('.source').innerText(), /unverified/i);
    await card.getByRole('button', { name: 'Reveal answer', exact: false }).click();
    await card.getByText(first.answerSections.scopeNote, { exact: true }).waitFor();
    const rendered = await card.textContent();
    for (const title of Object.values(
      require(path.join(backend, 'src/services/interviewAIValidation')).SYSTEM_DESIGN_FIELDS,
    ))
      assert.ok(rendered.includes(title), `Design heading not rendered: ${title}`);
    await page.screenshot({
      path: path.join(output, 'netflix-custom-desktop.png'),
      fullPage: true,
    });
    report.screenshots.push('netflix-custom-desktop.png');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(
      () => document.querySelector('.shell-body')?.getBoundingClientRect().left === 0,
    );
    report.mobileLayout = await page.evaluate(() => ({
      viewport: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    assert.ok(report.mobileLayout.scrollWidth <= report.mobileLayout.viewport + 1);
    await page.screenshot({ path: path.join(output, 'netflix-custom-mobile.png'), fullPage: true });
    report.screenshots.push('netflix-custom-mobile.png');
    await openForm();
    const reused = await submit('refresh-and-reuse-private-answer');
    assert.equal(String(reused.sessionId), String(first.sessionId));
    assert.ok(
      reused.fromCache || reused.generationStatus === 'reused',
      'The same private snapshot must be reused from cache or owned history.',
    );
    assert.deepEqual(reused.answerSections, first.answerSections);
    report.publicBankCountAfter = await mongoose.connection
      .collection('interviewquestionbanks')
      .countDocuments({ topicKey: 'system-design', question: /system design of netflix/i });
    assert.equal(report.publicBankCountAfter, bankBefore);
    report.checks.push(
      'Actual built browser asks the exact Netflix question for selected System Design.',
      'All fifteen design sections and educational scope note are rendered.',
      'Actual provider/model and unverified provenance persist only in the owned private snapshot.',
      'Refresh reuses the same immutable private answer; public bank count is unchanged.',
    );
    report.pageErrors = pageErrors;
    assert.deepEqual(pageErrors, []);
    report.passed = true;
  } catch (error) {
    report.passed = false;
    report.failure = error.message;
    process.exitCode = 1;
  } finally {
    await browser?.close();
    await new Promise((resolve) => (server ? server.close(resolve) : resolve()));
    await mongoose.disconnect();
    fs.writeFileSync(
      path.join(output, 'live-custom-acceptance.json'),
      `${JSON.stringify(report, null, 2)}\n`,
    );
    console.log(
      JSON.stringify({
        passed: report.passed,
        failure: report.failure,
        requests: report.requests.map((row) => ({
          label: row.label,
          status: row.status,
          durationMs: row.durationMs,
          generationStatus: row.response.generationStatus,
          code: row.response.code,
        })),
      }),
    );
  }
})();
