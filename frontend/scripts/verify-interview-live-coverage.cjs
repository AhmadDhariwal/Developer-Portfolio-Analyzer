// Explicit live acceptance: one five-question public practice set, then reuse.
// No mocked Interview Prep responses, private-session writes, or logged credentials.
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
const output = path.join(backend, 'verification/interview-prep/final-coverage-correction');
const dist = path.resolve(__dirname, '../dist/frontend/browser');
const upstream = process.env.INTERVIEW_ACCEPTANCE_API || 'http://localhost:5007';
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
      const url = new URL(req.url, 'http://127.0.0.1:4318');
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
    await new Promise((resolve) => server.listen(4318, '127.0.0.1', resolve));
    browser = await chromium.launch({
      headless: true,
      executablePath:
        process.env.INTERVIEW_CHROMIUM_PATH ||
        'C:/Program Files/Google/Chrome/Application/chrome.exe',
    });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    const generate = page.locator('form:has(#practice-level) button[type=submit]');
    const configure = async () => {
      await page.goto('http://127.0.0.1:4318/app/interview-prep');
      await page.locator('.workspace-nav button').filter({ hasText: 'Generate Questions' }).click();
      await page.locator('#studio-topic').selectOption('mern');
      await page.locator('#practice-level').selectOption('easy');
      await page.locator('#practice-source').selectOption('');
      await page.locator('#practice-count').selectOption({ label: '5 questions drill' });
    };
    const requestSet = async (label) => {
      const pending = page.waitForResponse(
        (response) =>
          response.url().endsWith('/api/interview-prep/generate') &&
          response.request().method() === 'POST',
        { timeout: 45000 },
      );
      await generate.click();
      const response = await pending;
      const payload = response.request().postDataJSON();
      const body = await response.json();
      report.requests.push({ label, request: payload, status: response.status(), response: body });
      assert.equal(payload.skill, 'mern');
      assert.equal(payload.difficulty, 'easy');
      assert.equal(payload.target, 5);
      assert.equal(payload.limit, 5);
      assert.equal(payload.source, 'database');
      return { body, status: response.status() };
    };
    await page.goto('http://127.0.0.1:4318/__live_verification');
    await configure();
    const first = await requestSet('real-provider-generation');
    assert.equal(
      first.status,
      200,
      `Live generation failed: ${first.body.code || first.body.message}`,
    );
    assert.equal(first.body.questions.length, 5);
    assert.ok(
      first.body.questions.every(
        (row) =>
          row.topicKey === 'mern' &&
          row.difficulty === 'easy' &&
          row.verificationStatus === 'unverified',
      ),
    );
    report.checks.push(
      'Actual browser payload requests exactly five Easy MERN questions with explicit all-source policy.',
    );
    const hashes = first.body.questions.map((row) =>
      crypto
        .createHash('sha256')
        .update(
          row.question
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, '')
            .replace(/\s+/g, ' ')
            .trim(),
        )
        .digest('hex'),
    );
    const stored = await mongoose.connection
      .collection('interviewquestionbanks')
      .find({ topicKey: 'mern', normalizedQuestionHash: { $in: hashes } })
      .toArray();
    assert.equal(stored.length, 5);
    assert.ok(
      stored.every(
        (row) =>
          row.difficulty === 'easy' &&
          row.sourceType === 'ai_generated' &&
          row.sourceMeta?.verificationStatus === 'unverified' &&
          row.answerSections?.shortAnswer &&
          row.sourceMeta?.provider &&
          row.sourceMeta?.model &&
          Number.isFinite(Date.parse(row.sourceMeta?.generatedAt)) &&
          row.normalizedQuestionHash &&
          row.canonicalQuestionKey,
      ),
    );
    report.persistence = stored.map((row) => ({
      id: String(row._id),
      difficulty: row.difficulty,
      sourceType: row.sourceType,
      verificationStatus: row.sourceMeta.verificationStatus,
      provider: row.sourceMeta.provider,
      model: row.sourceMeta.model,
      generatedAt: row.sourceMeta.generatedAt,
      identity: row.normalizedQuestionHash,
    }));
    report.checks.push(
      'All five real response questions exist in MongoDB with Easy canonical difficulty and unverified AI provenance.',
    );
    await page.locator('.practice-result').waitFor();
    report.renderedQuestions = [];
    for (let index = 0; index < 5; index++) {
      const difficulty = await page.locator('.practice-result .difficulty').innerText();
      assert.match(difficulty, /easy/i);
      report.renderedQuestions.push({
        index: index + 1,
        question: await page.locator('.practice-result .question-title').innerText(),
        difficulty,
      });
      if (index < 4) await page.getByRole('button', { name: 'Next →', exact: true }).click();
    }
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({
      path: path.join(output, 'live-mern-easy-desktop.png'),
      fullPage: true,
    });
    report.screenshots.push('live-mern-easy-desktop.png');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(
      () => document.querySelector('.shell-body')?.getBoundingClientRect().left === 0,
    );
    const mobileLayout = await page.evaluate(() => ({
      viewport: innerWidth,
      pageRight: document.querySelector('.interview-prep-page').getBoundingClientRect().right,
      cardRight: document.querySelector('.practice-result').getBoundingClientRect().right,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    report.mobileLayout = mobileLayout;
    assert.ok(
      mobileLayout.pageRight <= mobileLayout.viewport + 1 &&
        mobileLayout.cardRight <= mobileLayout.viewport + 1 &&
        mobileLayout.scrollWidth <= mobileLayout.viewport + 1,
      'Mobile content must fit after the sidebar transition settles.',
    );
    await page.screenshot({ path: path.join(output, 'live-mern-easy-mobile.png'), fullPage: true });
    report.screenshots.push('live-mern-easy-mobile.png');
    await configure();
    const second = await requestSet('refresh-and-reuse');
    assert.equal(second.status, 200);
    assert.equal(second.body.questions.length, 5);
    assert.equal(second.body.aiGeneratedCount, 0);
    assert.ok(
      second.body.questions.every((row) => row.difficulty === 'easy' && row.topicKey === 'mern'),
    );
    report.checks.push(
      'Refresh and regeneration reuse eligible saved AI questions without generating another set.',
    );
    await page.locator('#practice-source').selectOption('seed');
    const failureResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/interview-prep/generate') &&
        response.request().method() === 'POST',
    );
    await generate.click();
    const failure = await failureResponse;
    const failureBody = await failure.json();
    report.requests.push({
      label: 'verified-only-insufficiency',
      request: failure.request().postDataJSON(),
      status: failure.status(),
      response: failureBody,
    });
    assert.equal(failure.status(), 503);
    assert.equal(failureBody.code, 'insufficient_results');
    assert.equal(await page.locator('.practice-result').count(), 0);
    report.checks.push(
      'Verified-only mode returns explicit insufficiency and clears the incompatible AI drill.',
    );
    report.firstGenerationCount = first.body.aiGeneratedCount;
    report.providerInvoked = first.body.aiGeneratedCount > 0;
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
      path.join(output, 'live-acceptance.json'),
      `${JSON.stringify(report, null, 2)}\n`,
    );
    console.log(
      JSON.stringify({
        passed: report.passed,
        failure: report.failure,
        requests: report.requests.map((row) => ({
          label: row.label,
          status: row.status,
          count: row.response.questions?.length,
          generated: row.response.aiGeneratedCount,
          code: row.response.code,
        })),
      }),
    );
  }
})();
