// Run from the repository root: node backend/src/scripts/smokeDirectApplications.cjs
// Requires the installed MongoDB binary and Playwright (or NODE_PATH to its install).
// Uses the actual backend entry point and Angular dev server; never intercepts APIs.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const mongoose = require('mongoose');
const { startMongo } = require('../tests/fixtures/disposableRequestMongo');
const root = path.resolve(__dirname, '../..');
const repository = path.dirname(root);
const frontend = path.join(repository, 'frontend');
const output = path.join(root, 'verification/jobs-hub/p1.1a.1-real-smoke.json');
const backendPort = Number(process.env.DIRECT_API_PORT || 5011);
const angularPort = Number(process.env.DIRECT_UI_PORT || 4211);
const origin = `http://localhost:${angularPort}`;
const evidence = {
  branch: '',
  checkout: repository,
  apiMocks: false,
  requests: [],
  backendLogs: [],
  checks: []
};
const children = [];
const temporary = [];
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function start(file, args, cwd, env, logs) {
  const child = spawn(process.execPath, [file, ...args], {
    cwd,
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  children.push(child);
  for (const stream of [child.stdout, child.stderr])
    stream.on('data', (bytes) => logs.push(bytes.toString()));
  return child;
}
async function ready(url, child) {
  for (let i = 0; i < 240; i++) {
    if (child.exitCode !== null) throw Error(`Server exited before readiness: ${url}`);
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (r.status < 500) return;
    } catch {}
    await delay(1000);
  }
  throw Error(`Server readiness timeout: ${url}`);
}
async function main() {
  let mongo, browser;
  const jwtSecret = crypto.randomBytes(32).toString('hex');
  try {
    evidence.branch = require('node:child_process')
      .execFileSync('git', ['branch', '--show-current'], { cwd: repository, encoding: 'utf8' })
      .trim();
    assert.equal(evidence.branch, 'fix/P1-project');
    mongo = await startMongo({
      replicaSet: 'direct-real-smoke',
      temporaryRoot: path.join(root, 'verification'),
      readinessAttempts: 200
    });
    // Preserve validated non-secret settings; blank service credentials before dotenv runs.
    const dotenv = require('dotenv');
    const env = { ...process.env, ...dotenv.parse(fs.readFileSync(path.join(root, '.env'))) };
    for (const key of Object.keys(env)) {
      if (
        /(KEY|TOKEN|SECRET|PASSWORD|PASS$|URI|URL|HOST|ENDPOINT|BUCKET|REGION|EMAIL|TWILIO|PROXY)/.test(
          key
        )
      )
        env[key] = '';
    }
    Object.assign(env, {
      NODE_ENV: 'development',
      MONGODB_URI: mongo.uri,
      PORT: String(backendPort),
      JWT_SECRET: jwtSecret,
      JWT_ISSUER: 'devinsight-api',
      JWT_AUDIENCE: 'devinsight-web',
      STORAGE_DRIVER: 'filesystem',
      SECURITY_STRICT_ENV: 'false',
      SETTINGS_ENCRYPTION_KEY: crypto.randomBytes(32).toString('hex'),
      LOG_REQUESTS: 'true'
    });
    const api = start(path.join(root, 'index.js'), ['--api-only'], root, env, evidence.backendLogs);
    await ready(`http://localhost:${backendPort}/api/jobs/internal`, api);
    await mongoose.connect(mongo.uri);
    const User = require('../modules/auth/models/user');
    const Organization = require('../modules/admin/models/organization');
    const Resume = require('../modules/resume/models/resumeFile');
    const developer = new mongoose.Types.ObjectId(),
      recruiter = new mongoose.Types.ObjectId(),
      organization = new mongoose.Types.ObjectId();
    await User.collection.insertMany([
      {
        _id: developer,
        name: 'Smoke Developer',
        email: 'dev@smoke.test',
        role: 'developer',
        isActive: true,
        sessionRevision: 0
      },
      {
        _id: recruiter,
        name: 'Smoke Recruiter',
        email: 'recruiter@smoke.test',
        role: 'recruiter',
        organizationId: organization,
        isActive: true,
        sessionRevision: 0
      }
    ]);
    await Organization.create({
      _id: organization,
      name: 'Disposable Smoke Organization',
      slug: 'smoke',
      ownerId: recruiter,
      createdBy: recruiter
    });
    const sign = (id) =>
      require('jsonwebtoken').sign({ id, sessionRevision: 0 }, jwtSecret, {
        issuer: 'devinsight-api',
        audience: 'devinsight-web',
        expiresIn: '15m'
      });
    const developerToken = sign(developer),
      recruiterToken = sign(recruiter);
    const proxy = path.join(frontend, `.direct-smoke-${crypto.randomUUID()}.json`);
    fs.writeFileSync(
      proxy,
      JSON.stringify({
        '/api': { target: `http://localhost:${backendPort}`, secure: false, changeOrigin: true }
      })
    );
    temporary.push(proxy);
    const angularLogs = [];
    const angular = start(
      path.join(frontend, 'node_modules/@angular/cli/bin/ng.js'),
      ['serve', '--port', String(angularPort), '--proxy-config', proxy],
      frontend,
      process.env,
      angularLogs
    );
    await ready(origin, angular);
    const { chromium } = require('playwright');
    browser = await chromium.launch({
      headless: true,
      channel: process.env.DIRECT_BROWSER_CHANNEL || 'chrome'
    });
    const page = await browser.newPage();
    async function request(route, token, expected, method = 'GET', body) {
      const url = origin + '/api' + route;
      const r = await page.request.fetch(url, {
        method,
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        ...(body ? { data: body } : {})
      });
      const content = r.headers()['content-type']?.includes('application/json')
        ? await r.json()
        : (await r.body()).toString();
      evidence.requests.push({ url, method, status: r.status(), body: content });
      assert.equal(r.status(), expected, `${method} ${url}: ${JSON.stringify(content)}`);
      return content;
    }
    for (const route of [
      '/jobs/internal',
      '/jobs/internal/options',
      '/jobs/internal/applications'
    ]) {
      await request(route, null, 401);
      await request(route, recruiterToken, 403);
      const empty = await request(route, developerToken, 200);
      assert.equal((empty.jobs || empty.resumes || empty.applications).length, 0);
    }
    evidence.checks.push(
      'Authenticated empty collections return 200; missing auth 401; recruiter role 403 through Angular proxy'
    );
    const pdf = Buffer.from('%PDF-1.7\nDisposable smoke resume\n%%EOF');
    const file = path.join(root, 'uploads', `direct-smoke-${crypto.randomUUID()}.pdf`);
    fs.writeFileSync(file, pdf);
    temporary.push(file);
    const resume = await Resume.create({
      userId: developer,
      fileName: 'smoke-resume.pdf',
      fileUrl: file,
      fileSize: pdf.length
    });
    const created = await request('/recruiter-hub/jobs', recruiterToken, 201, 'POST', {
      title: 'Smoke Engineer',
      description: 'Disposable workflow verification',
      requiredSkills: ['Angular'],
      location: 'Remote'
    });
    const jobId = created.job._id;
    await request(`/recruiter-hub/jobs/${jobId}`, recruiterToken, 200, 'PATCH', {
      published: true
    });
    await page.addInitScript(
      ({ token, id }) => {
        localStorage.setItem('token', token);
        localStorage.setItem(
          'user',
          JSON.stringify({ _id: id, role: 'developer', name: 'Smoke Developer' })
        );
      },
      { token: developerToken, id: String(developer) }
    );
    const observed = [];
    page.on('response', (response) => {
      if (response.url().includes('/api/jobs/internal'))
        observed.push({ url: response.url(), status: response.status() });
    });
    await page.goto(origin + '/app/jobs');
    await page
      .getByRole('button', { name: 'Internal jobs', exact: true })
      .click({ timeout: 60000 });
    await page
      .getByRole('button', { name: 'Review and apply', exact: true })
      .click({ timeout: 60000 });
    await page.locator('#direct-resume').selectOption(String(resume._id));
    await page.locator('input[name="consent"]').check();
    await page.getByRole('button', { name: 'Submit application', exact: true }).click();
    await page.getByText('Application submitted.', { exact: false }).waitFor();
    evidence.angularRequests = observed;
    assert.ok(observed.some((r) => r.status === 201));
    const applicants = await request(
      `/recruiter-hub/jobs/${jobId}/applications`,
      recruiterToken,
      200
    );
    const application = applicants.applications[0];
    assert.ok(application);
    const downloaded = await request(
      `/recruiter-hub/jobs/${jobId}/applications/${application._id}/resume`,
      recruiterToken,
      200
    );
    assert.equal(downloaded, pdf.toString());
    await request(
      `/recruiter-hub/jobs/${jobId}/applications/${application._id}`,
      recruiterToken,
      200,
      'PATCH',
      { status: 'reviewing' }
    );
    await page.getByRole('button', { name: 'Refresh direct applications' }).click();
    await page.getByText('Application: reviewing', { exact: true }).waitFor();
    await page.screenshot({
      path: path.join(frontend, 'verification/jobs-hub/p1.1a.1-real-developer.png'),
      fullPage: true
    });
    evidence.checks.push(
      'Real Angular service loaded all internal APIs, submitted consent/resume to Express/Mongo; recruiter publication/list/PDF/status succeeded; Developer UI refreshed reviewing status'
    );
    evidence.passed = true;
  } finally {
    await browser?.close();
    await mongoose.disconnect();
    for (const child of children.reverse()) {
      if (child.exitCode === null) {
        const exited = once(child, 'exit');
        child.kill();
        await exited;
      }
    }
    for (const file of temporary) {
      assert.ok(
        file.startsWith(frontend + path.sep) ||
          file.startsWith(path.join(root, 'uploads') + path.sep)
      );
      if (fs.existsSync(file)) fs.unlinkSync(file);
    }
    if (mongo) evidence.cleanup = await mongo.stop();
    fs.writeFileSync(output, JSON.stringify(evidence, null, 2) + '\n');
  }
}
async function checkRunning() {
  const target = new URL(process.env.DIRECT_SMOKE_ORIGIN || 'http://localhost:4200');
  assert.ok(
    ['localhost', '127.0.0.1', '[::1]'].includes(target.hostname),
    'Only loopback servers are allowed'
  );
  assert.ok(
    process.env.DIRECT_SMOKE_TOKEN,
    'Set DIRECT_SMOKE_TOKEN to a valid local Developer session token; it is never logged'
  );
  for (const [route, collection] of [
    ['internal', 'jobs'],
    ['internal/options', 'resumes'],
    ['internal/applications', 'applications']
  ]) {
    const url = new URL(`/api/jobs/${route}`, target);
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${process.env.DIRECT_SMOKE_TOKEN}` },
      signal: AbortSignal.timeout(10000)
    });
    console.log(JSON.stringify({ url: url.href, status: response.status }));
    assert.equal(
      response.status,
      200,
      'Route smoke failed: verify checkout, proxy target and restart stale Express before UI acceptance'
    );
    const body = await response.json();
    assert.ok(Array.isArray(body[collection]), `Missing ${collection} collection contract`);
  }
}
(process.argv.includes('--check-running') ? checkRunning() : main()).catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
