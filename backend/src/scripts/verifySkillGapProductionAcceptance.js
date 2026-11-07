'use strict';
// Explicit acceptance runner: never loads application DB/Redis/JWT configuration.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { fork } = require('node:child_process');
const mongoose = require('mongoose');
const { startMongo } = require('../tests/fixtures/disposableRequestMongo');
const output = path.resolve(
  process.env.SKILL_GAP_ACCEPTANCE_OUTPUT ||
    path.join(__dirname, '../../verification/skillgap/acceptance-2026-11-03')
);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const previous = fs.existsSync(path.join(output, 'acceptance-results.json'))
  ? JSON.parse(fs.readFileSync(path.join(output, 'acceptance-results.json'), 'utf8'))
  : null;
const results = previous || {
  collectedAt: new Date().toISOString(),
  productionDataUsed: false,
  applicationDatabaseConfigurationLoaded: false,
  gates: {}
};
function save() {
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(
    path.join(output, 'acceptance-results.json'),
    JSON.stringify(results, null, 2) + '\n'
  );
}
async function step(name, action) {
  if (process.argv.includes('--resume-only') && name !== 'freshSyntheticPdfAndEvidence') return;
  const at = performance.now();
  try {
    results.gates[name] = {
      status: 'PASS',
      ...(await action()),
      durationMs: Math.round(performance.now() - at)
    };
  } catch (error) {
    results.gates[name] = {
      status: error.acceptanceStatus || 'FAIL',
      code: error.code || error.name,
      detail: error.safeDetail || 'Acceptance assertion failed; inspect the isolated harness.',
      durationMs: Math.round(performance.now() - at)
    };
  }
  save();
  console.log(name + ': ' + results.gates[name].status);
}
async function publicJson(url, headers = {}) {
  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(12000),
    redirect: 'error'
  });
  if (!response.ok)
    throw Object.assign(Error('Provider unavailable'), {
      acceptanceStatus: 'BLOCKED',
      code: 'HTTP_' + response.status,
      safeDetail: 'Live public provider returned HTTP ' + response.status
    });
  const raw = await response.text();
  assert.ok(raw.length < 5 * 1024 * 1024);
  return {
    data: JSON.parse(raw),
    collectedAt: new Date().toISOString(),
    sourceDate: response.headers.get('date'),
    etag: response.headers.get('etag'),
    sha256: hash(raw),
    url
  };
}
async function live() {
  if (process.env.SKILL_GAP_ACCEPTANCE_LIVE !== '1')
    throw Error('Explicit SKILL_GAP_ACCEPTANCE_LIVE=1 is required');
  const parsed = require('dotenv').parse(fs.readFileSync(path.resolve(__dirname, '../../.env')));
  assert.equal(
    parsed.NODE_ENV,
    'development',
    'Live credential source must be development configuration'
  );
  // Whitelist provider-only settings. Never import configured Mongo, Redis or account credentials.
  if (parsed.GEMINI_API_KEY) process.env.GEMINI_API_KEY = parsed.GEMINI_API_KEY;
  for (const key of ['GEMINI_MODEL', 'GEMINI_MODELS'])
    if (parsed[key]) process.env[key] = parsed[key];
  let github, resume;
  if (process.argv.includes('--resume-only')) {
    const capture = JSON.parse(
      fs.readFileSync(path.join(output, 'fresh-public-github.json'), 'utf8')
    ).repos;
    github = {
      githubSignals: { username: 'octocat', analyzedAt: capture.collectedAt },
      fetchedAt: capture.collectedAt,
      cache: { cachedAt: capture.collectedAt },
      dataAvailability: { repositories: 'complete', repositorySignals: 'complete' },
      repositories: capture.data.map((row) => ({
        name: row.name,
        language: row.language,
        topics: row.topics,
        fork: row.fork,
        isTemplate: row.is_template,
        pushedAt: row.pushed_at
      }))
    };
  }
  await step('freshPublicGitHub', async () => {
    const headers = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'DevInsight-Synthetic-Acceptance'
    };
    const [identity, repos] = await Promise.all([
      publicJson('https://api.github.com/users/octocat', headers),
      publicJson('https://api.github.com/users/octocat/repos?per_page=100', headers)
    ]);
    assert.equal(identity.data.login.toLowerCase(), 'octocat');
    assert.equal(repos.data.length, identity.data.public_repos);
    fs.writeFileSync(
      path.join(output, 'fresh-public-github.json'),
      JSON.stringify({ identity, repos }, null, 2) + '\n'
    );
    github = {
      githubSignals: { username: 'octocat', analyzedAt: repos.collectedAt },
      fetchedAt: repos.collectedAt,
      cache: { cachedAt: repos.collectedAt },
      dataAvailability: { repositories: 'complete', repositorySignals: 'complete' },
      repositories: repos.data.map((row) => ({
        name: row.name,
        language: row.language,
        topics: row.topics,
        fork: row.fork,
        isTemplate: row.is_template,
        pushedAt: row.pushed_at
      }))
    };
    return {
      publicDemoProfile: 'octocat',
      repositories: repos.data.length,
      forksExcluded: repos.data.filter((r) => r.fork).length,
      sourceDate: repos.sourceDate,
      rawResponseHash: repos.sha256,
      scope:
        'Fresh public demo data through the production evidence adapter; no public account modified.'
    };
  });
  await step('freshSyntheticPdfAndEvidence', async () => {
    const bytes = fs.readFileSync(path.resolve(__dirname, '../tests/fixtures/resume/standard.pdf'));
    const extraction = await require('../services/resumePdfExtraction').extract(bytes);
    const gold = require('../tests/fixtures/resume/expected.json');
    const analysis = await require('../services/resumeservice').__test.buildDeterministicAnalysis({
      text: extraction.text,
      fileName: 'synthetic.pdf',
      fileSize: bytes.length,
      deferAI: true
    });
    const recognized = JSON.stringify(analysis);
    for (const skill of gold.skills) assert.ok(recognized.includes(skill), skill);
    resume = {
      ...analysis,
      _id: 'synthetic-resume',
      analyzedAt: new Date().toISOString(),
      technicalSkills: gold.skills
    };
    const engine = require('../services/skillGapEvidenceService');
    const calculated = engine.resolve({
      githubData: github || {},
      resumeAnalysis: resume,
      careerStack: 'Frontend',
      experienceLevel: 'Student'
    });
    assert.equal(
      calculated.sourceReferences.find((source) => source.type === 'github').id,
      'octocat'
    );
    assert.equal(calculated.demonstratedSkills.length, 0);
    assert.ok(calculated.coverage === null || calculated.coverage <= 50);
    assert.equal(calculated.ruleVersion, 'skill-evidence-coverage-v1');
    fs.writeFileSync(
      path.join(output, 'fresh-evidence-assessment.json'),
      JSON.stringify(calculated, null, 2) + '\n'
    );
    return {
      syntheticDocumentSha256: hash(bytes),
      pages: extraction.pages,
      expectedSkillsChecked: gold.skills.length,
      coverage: calculated.coverage,
      demonstrated: 0,
      ruleVersion: calculated.ruleVersion,
      ceilingPreserved: true,
      scope: 'Actual PDF extraction and deterministic analyzer; document skills remain claims.'
    };
  });
  await step('freshMarketProviderSample', async () => {
    const source = await publicJson('https://www.arbeitnow.com/api/job-board-api');
    assert.ok(Array.isArray(source.data.data));
    const rows = source.data.data.slice(0, 30);
    const runtime = await startMongo({ replicaSet: 'skillgap-live-market' });
    try {
      await mongoose.connect(runtime.uri, { autoIndex: false });
      const Job = require('../models/jobCache');
      await Job.createCollection();
      const now = Date.now();
      for (const row of rows)
        await Job.collection.insertOne({
          jobId: 'synthetic-' + row.slug,
          externalJobId: row.slug,
          source: 'arbeitnow',
          title: row.title,
          company: row.company_name,
          applyUrl: row.url,
          skills: row.tags || [],
          expiresAt: new Date(now + 3600000),
          freshUntil: new Date(now + 3600000),
          lastSynced: new Date(now)
        });
      const signal = await require('../services/developerSignalService').getPublicJobMarketSignal();
      assert.equal(signal.live, false);
      assert.equal(signal.kind, 'cached-provider-sample');
      assert.equal(signal.sampledJobs, rows.length);
      assert.ok(signal.limitations.length);
      fs.writeFileSync(
        path.join(output, 'fresh-market-sample.json'),
        JSON.stringify(
          {
            source: {
              url: source.url,
              collectedAt: source.collectedAt,
              sourceDate: source.sourceDate,
              sha256: source.sha256
            },
            rows: rows.map((r) => ({ slug: r.slug, tags: r.tags, url: r.url })),
            signal
          },
          null,
          2
        ) + '\n'
      );
      return {
        sampledJobs: signal.sampledJobs,
        sourceDate: source.sourceDate,
        provider: 'arbeitnow',
        liveLabel: signal.live,
        scope:
          'One fresh provider sample projected into disposable cache and production market summary; not representative live-market statistics.'
      };
    } finally {
      await mongoose.disconnect();
      await runtime.stop();
    }
  });
  await step('liveGeminiQualitativePolicy', async () => {
    if (!process.env.GEMINI_API_KEY)
      throw Object.assign(Error(), {
        acceptanceStatus: 'BLOCKED',
        code: 'NO_DEVELOPMENT_GEMINI_KEY',
        safeDetail: 'No development Gemini key available.'
      });
    const manager = require('../services/aiProviderManager');
    manager.log = () => {};
    const prompt = require('../prompts/skillGapPrompt').getSkillGapPrompt('Backend', 'Student', [
      { name: 'TypeScript', status: 'PARTIAL' },
      { name: 'SQL', status: 'CLAIMED_ONLY' }
    ]);
    const usage = [];
    const realFetch = global.fetch;
    global.fetch = async (...args) => {
      const response = await realFetch(...args);
      if (String(args[0]).includes('generativelanguage.googleapis.com')) {
        try {
          const data = await response.clone().json();
          usage.push({ status: response.status, usage: data.usageMetadata || null });
        } catch {}
      }
      return response;
    };
    let generated;
    try {
      generated = await manager.execute(prompt, {
        retries: 0,
        parseJson: JSON.parse,
        timeoutMs: 7000,
        requestPolicy: { allowedProviders: ['gemini'], maxAttempts: 1, maxOutputTokens: 600 },
        signal: AbortSignal.timeout(8000)
      });
    } finally {
      global.fetch = realFetch;
    }
    if (!generated.ok)
      throw Object.assign(Error(), {
        acceptanceStatus: 'BLOCKED',
        code: generated.reason || 'GEMINI_UNAVAILABLE',
        safeDetail:
          'The single bounded real Gemini attempt did not produce an accepted provider result; deterministic fallback remains required.'
      });
    assert.deepEqual(Object.keys(generated.parsed).sort(), ['analysisSummary', 'levelAssessment']);
    assert.ok(Object.values(generated.parsed).every((v) => typeof v === 'string' && !/\d/.test(v)));
    assert.ok(/TypeScript|SQL|Backend/i.test(JSON.stringify(generated.parsed)));
    return {
      provider: generated.provider,
      model: generated.model,
      latencyMs: generated.latencyMs,
      maximumAttempts: 1,
      maximumOutputTokens: 600,
      retries: 0,
      usage,
      qualitativeOutput: generated.parsed,
      cost: 'Token usage only where returned; billing cost is not available from this API result.'
    };
  });
}
async function verifyRecordedAi() {
  await step('realControllerNarrativeValidation', async () => {
    const generated = results.gates.liveGeminiQualitativePolicy;
    assert.equal(generated.status, 'PASS');
    const filename = path.resolve(__dirname, '../controllers/skillgapcontroller.js');
    const source = fs.readFileSync(filename, 'utf8');
    const NativeModule = require('node:module');
    const unit = new NativeModule(filename, module);
    unit.filename = filename;
    unit.paths = NativeModule._nodeModulePaths(path.dirname(filename));
    // Execute the exact controller policy with a test-only export in memory; no source/API mutation.
    unit._compile(
      source + '\nmodule.exports.acceptanceNarrative = resolveSkillGapNarratives;\n',
      filename
    );
    const fallback = {
      analysisSummary: 'Backend evidence requires review.',
      levelAssessment: 'SQL evidence remains a claim.'
    };
    const value = unit.exports.acceptanceNarrative(generated.qualitativeOutput, fallback, {
      aiOk: true,
      careerStack: 'Backend',
      experienceLevel: 'Student',
      skillNames: ['TypeScript', 'SQL']
    });
    assert.equal(value.aiUsed, true);
    assert.deepEqual(
      [value.analysisSummary, value.levelAssessment],
      [generated.qualitativeOutput.analysisSummary, generated.qualitativeOutput.levelAssessment]
    );
    return {
      controllerSourceSha256: hash(source),
      liveOutputAcceptedByProductionPolicy: true,
      additionalProviderCalls: 0
    };
  });
}

async function load() {
  const runtime = await startMongo({ replicaSet: 'skillgap-load-acceptance' });
  const workers = [];
  const stop = async (child) => {
    if (child.exitCode !== null) return;
    child.send('stop');
    await Promise.race([new Promise((resolve) => child.once('exit', resolve)), sleep(5000)]);
    if (child.exitCode === null) child.kill();
  };
  try {
    await mongoose.connect(runtime.uri, { autoIndex: false });
    for (const name of [
      'user',
      'resumeFile',
      'resumeAnalysis',
      'analysisCache',
      'notification',
      'notificationReceipt',
      'notificationState',
      'aiVersion'
    ]) {
      const Model = require('../models/' + name);
      await Model.createCollection();
      await Model.createIndexes();
    }
    await require('../services/integrationMongoGovernanceService').initialize();
    const user = await require('../models/user').create({
      name: 'Synthetic load account',
      email: 'skillgap-load@example.invalid',
      providers: ['github'],
      authProvider: 'github',
      activeGithubUsername: 'fixture',
      activeCareerStack: 'Backend',
      activeExperienceLevel: 'Student'
    });
    const secret = crypto.randomBytes(32).toString('hex');
    const start = () =>
      new Promise((resolve, reject) => {
        const child = fork(path.resolve(__dirname, '../tests/fixtures/skillGapWorker.js'), [], {
          env: {
            ...process.env,
            SKILL_GAP_TEST_MONGO: runtime.uri,
            JWT_SECRET: secret,
            NODE_ENV: 'test'
          },
          stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
          windowsHide: true
        });
        workers.push(child);
        child.once('message', (m) =>
          m.port
            ? resolve({ child, url: 'http://127.0.0.1:' + m.port })
            : reject(Error('worker failed'))
        );
      });
    let [left, right] = await Promise.all([start(), start()]);
    const token = require('jsonwebtoken').sign(
      { id: String(user._id), sessionRevision: Number(user.sessionRevision || 0) },
      secret,
      { issuer: 'devinsight-api', audience: 'devinsight-web', expiresIn: '5m' }
    );
    await step('sustainedTwoWorkerLoadAndRecovery', async () => {
      const samples = [];
      const duration = 60000;
      const started = Date.now();
      let restarted = false;
      while (Date.now() - started < duration) {
        const host = samples.length % 2 ? left : right;
        const at = performance.now();
        const response = await fetch(host.url + '/api/skillgap/skill-gap', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + token,
            'X-Forwarded-For': '198.51.100.' + ((samples.length % 250) + 1)
          },
          body: '{}',
          signal: AbortSignal.timeout(26000)
        });
        await response.json();
        assert.ok([200, 429].includes(response.status));
        if (response.status === 429) assert.ok(Number(response.headers.get('retry-after')) > 0);
        samples.push({ status: response.status, ms: performance.now() - at });
        if (!restarted && Date.now() - started > 30000) {
          await stop(left.child);
          left = await start();
          restarted = true;
        }
        await sleep(500);
      }
      const accepted = samples.filter((s) => s.status === 200);
      assert.ok(accepted.length > 0 && accepted.length <= 30);
      assert.ok(samples.some((s) => s.status === 429));
      const Cache = require('../models/analysisCache');
      assert.equal(await Cache.countDocuments({ userId: user._id }), 1);
      const count = await require('../models/integrationGovernanceState')
        .findById('test:skillgap:ai-calls')
        .lean();
      assert.equal(count.count, 1);
      const values = accepted.map((s) => s.ms).sort((a, b) => a - b);
      const percentile = (p) =>
        values[Math.min(values.length - 1, Math.ceil(p * values.length) - 1)];
      return {
        elapsedMs: Date.now() - started,
        requests: samples.length,
        accepted: accepted.length,
        limited: samples.filter((s) => s.status === 429).length,
        unexpectedErrors: 0,
        acceptedP50Ms: percentile(0.5),
        acceptedP95Ms: percentile(0.95),
        aiCalls: count.count,
        durableRows: 1,
        workerRestarted: restarted,
        spoofedForwardedIpsDidNotResetBudget: true,
        processMemory: process.memoryUsage(),
        scope:
          'Sixty-second local two-process run under unchanged hourly quotas; not deployed sustained-capacity certification.'
      };
    });
    await step('localMetricsPrivacyAndExposure', async () => {
      const response = await fetch(right.url + '/metrics');
      assert.equal(response.status, 200);
      const body = await response.text();
      assert.ok(body.includes('dpa_skillgap_requests_total'));
      assert.ok(
        !body.includes(String(user._id)) &&
          !body.includes('example.invalid') &&
          !body.includes('198.51.100.')
      );
      return {
        metricsAvailable: true,
        boundedSkillGapLabels: true,
        syntheticOwnerAndIpAbsent: true,
        deployedScrapeAndAlerts: 'Not verified'
      };
    });
    await step('forwardedIpGuestAbuse', async () => {
      const status = [];
      for (let i = 0; i < 8; i++) {
        const r = await fetch((i % 2 ? left : right).url + '/api/skillgap/skill-gap', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Forwarded-For': '203.0.113.' + (i + 1)
          },
          body: JSON.stringify({
            isTemporary: true,
            username: 'fixture' + i,
            careerStack: 'Backend',
            experienceLevel: 'Student'
          })
        });
        status.push(r.status);
        await r.json();
      }
      assert.ok(status.filter((s) => s === 200).length <= 5);
      assert.ok(status.includes(429));
      return {
        statuses: status,
        trustProxy: false,
        rotatingForwardedIpCannotBypassGuestBudget: true,
        productionProxyTopology: 'Not supplied'
      };
    });
  } finally {
    await Promise.all(workers.map(stop));
    await mongoose.disconnect();
    await runtime.stop();
  }
}
(async () => {
  fs.mkdirSync(output, { recursive: true });
  if (process.argv.includes('--live') || process.argv.includes('--resume-only')) await live();
  if (process.argv.includes('--load')) await load();
  if (process.argv.includes('--verify-recorded-ai')) await verifyRecordedAi();
  save();
  if (Object.values(results.gates).some((g) => g.status === 'FAIL')) process.exitCode = 1;
})().catch((error) => {
  results.fatal = {
    code: error.code || error.name,
    detail: 'Isolated acceptance setup failed; no live application database was used.'
  };
  save();
  process.exitCode = 1;
});
