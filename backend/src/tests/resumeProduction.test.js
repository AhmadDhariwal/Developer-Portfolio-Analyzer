const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const pdf = require('../services/resumePdfExtraction');
const service = require('../services/resumeservice');
const ai = require('../services/aiservice');
const redis = require('../services/redisCacheService');
const root = path.join(__dirname, 'fixtures/resume');
const gold = require('./fixtures/resume/expected.json');
const bytes = (name) => fs.readFileSync(path.join(root, name + '.pdf'));
const build = async (text, options = {}) =>
  service.__test.buildDeterministicAnalysis({
    text,
    fileName: 'synthetic.pdf',
    fileSize: 20000,
    deferAI: true,
    ...options
  });

test('independent PDF field golds: standard, changed layout and columns', async () => {
  const measurements = [];
  for (const name of ['standard', 'layout-shift', 'columns']) {
    const evidence = {},
      started = performance.now();
    const text = await service.extractTextFromPDF(bytes(name), null, evidence);
    const result = await build(text, { documentHash: evidence.documentHash });
    let checked = 0;
    for (const [field, expected] of Object.entries(gold.personalInfo)) {
      assert.equal(result.normalized.personalInfo[field], expected, `${name}: ${field}`);
      checked++;
    }
    assert.equal(result.experienceYears, gold.experienceYears);
    checked++;
    const skills = Object.values(result.technologyCategories).flat();
    for (const skill of gold.skills) {
      assert.ok(skills.includes(skill), `${name}: ${skill}`);
      checked++;
    }
    for (const skill of gold.absentSkills) {
      assert.ok(!skills.includes(skill), `${name}: unsupported ${skill}`);
      checked++;
    }
    for (const section of gold.sections) {
      assert.equal(result.normalized.sectionPresence[section], true);
      checked++;
    }
    assert.ok(result.normalized.education.includes(gold.education));
    checked++;
    assert.deepEqual(result.normalized.certifications, [gold.certification]);
    checked++;
    assert.equal(result.resumeHash, pdf.fingerprint(bytes(name)));
    measurements.push({
      fixture: name,
      assertions: checked,
      correct: checked,
      milliseconds: Math.round(performance.now() - started),
      score: result.scoring.score
    });
  }
  const original = await pdf.extract(bytes('standard')),
    shifted = await pdf.extract(bytes('layout-shift'));
  assert.equal(original.text, shifted.text);
  assert.notEqual(pdf.fingerprint(bytes('standard')), pdf.fingerprint(bytes('layout-shift')));
  fs.mkdirSync(path.resolve(__dirname, '../../verification/resume'), { recursive: true });
  fs.writeFileSync(
    path.resolve(__dirname, '../../verification/resume/extraction-accuracy.json'),
    JSON.stringify(
      {
        measurements,
        limitations: gold.unsupported,
        ambiguous: gold.ambiguous,
        missing: gold.missing,
        inferred: gold.inferred
      },
      null,
      2
    )
  );
});

test('resource limits and scanned, encrypted, empty and corrupt PDF classification', async () => {
  for (const name of ['empty', 'scanned'])
    await assert.rejects(
      service.extractTextFromPDF(bytes(name)),
      (error) =>
        error.status === 422 &&
        error.contentQualityState.state === (name === 'scanned' ? 'UNREADABLE' : 'EMPTY')
    );
  for (const name of ['encrypted', 'corrupt'])
    await assert.rejects(service.extractTextFromPDF(bytes(name)), (error) => error.status === 422);
  await assert.rejects(pdf.extract(bytes('page-limit')), { code: 'RESUME_PDF_PAGE_LIMIT' });
  await assert.rejects(pdf.extract(Buffer.alloc(pdf.LIMITS.bytes + 1, '%PDF-')), { status: 413 });
  await assert.rejects(pdf.extract(bytes('standard'), { timeoutMs: 1 }), {
    code: 'RESUME_PDF_TIMEOUT'
  });
  await assert.rejects(
    pdf.__test.parse(Buffer.from('%PDF-'), async () => ({
      text: 'x'.repeat(pdf.LIMITS.characters + 1),
      numpages: 1
    })),
    { code: 'RESUME_PDF_TEXT_LIMIT' }
  );
  // Capacity is released after termination, including deadline errors.
  assert.ok((await pdf.extract(bytes('standard'))).text.includes('EXPERIENCE'));
});

test('negative claims, common verbs, repeated aliases, all twelve domains and monthly overlaps', async () => {
  const text =
    (await pdf.extract(bytes('standard'))).text +
    '\nSKILLS\nReact, PostgreSQL, Kubernetes, Jest, Flutter, TensorFlow, Pandas, Git, OAuth, Go, Express\nNo experience with Rust\nCurrently learning Swift\nWe go faster and express ideas clearly\nReact, React, reactjs\n';
  const result = await build(text),
    categories = result.technologyCategories,
    all = Object.values(categories).flat();
  assert.equal(Object.keys(categories).length, 12);
  for (const skills of Object.values(categories)) assert.ok(skills.length > 0);
  for (const skill of ['Rust', 'Swift']) assert.ok(!all.includes(skill));
  assert.equal(all.filter((x) => x === 'React').length, 1);
  assert.equal(
    service.__test.extractExperienceYears(
      '20 years experience',
      'Jan 2020 - Jan 2022\nJul 2021 - Jul 2023'
    ),
    3.5
  );
  assert.equal(
    service.__test.extractExperienceYears('', 'Jan 2020 - Jul 2020\nJan 2022 - Jul 2022'),
    1
  );
  const verbs = await build(
    (await pdf.extract(bytes('standard'))).text + '\nWe go faster and express ideas clearly'
  );
  assert.ok(!Object.values(verbs.technologyCategories).flat().includes('Go'));
});

test('AI timeout aborts the provider signal and sends no resume PII; success does not abort', async (t) => {
  const original = ai.runAIAnalysis;
  t.after(() => {
    ai.runAIAnalysis = original;
  });
  let signal, prompt;
  ai.runAIAnalysis = async (input, fallback, retries, options) => {
    prompt = input;
    signal = options.signal;
    return new Promise((resolve) =>
      signal.addEventListener('abort', () => resolve(fallback), { once: true })
    );
  };
  const result = await build((await pdf.extract(bytes('standard'))).text);
  const score = result.scoring.score;
  await result._critique();
  assert.equal(signal.aborted, true);
  assert.equal(result.scoring.score, score);
  assert.ok(!/zoe@example|Zoë|Núñez|555-0142|github.com/.test(prompt));
  ai.runAIAnalysis = async (input, fallback, retries, options) => {
    signal = options.signal;
    return { focusAreas: ['quantified_impact'] };
  };
  const success = await build((await pdf.extract(bytes('standard'))).text);
  await success._critique();
  assert.equal(signal.aborted, false);
});

test('Redis timeout and rejection are optional; Mongo remains authoritative', async (t) => {
  // The boundary is loaded with test doubles to simulate an unavailable optional transport.
  const Module = require('node:module'),
    key = require.resolve('../services/resumeservice'),
    old = require.cache[key],
    load = Module._load;
  t.after(() => {
    require.cache[key] = old;
  });
  const valid = await build((await pdf.extract(bytes('standard'))).text);
  delete valid._critique;
  delete require.cache[key];
  Module._load = function (request, parent, isMain) {
    if (request === './redisCacheService')
      return { ...redis, getCacheJsonWithMeta: () => new Promise(() => {}) };
    if (request === '../models/resumeAnalysisCache')
      return {
        findOne: () => ({
          select() {
            return this;
          },
          lean: async () => ({
            result: valid,
            analyzedAt: new Date(),
            expiresAt: new Date(Date.now() + 100000)
          })
        })
      };
    return load.call(this, request, parent, isMain);
  };
  let isolated;
  try {
    isolated = require(key);
  } finally {
    Module._load = load;
  }
  const started = performance.now();
  const cached = await isolated.findCachedResumeAnalysis({
    userId: 'owner',
    resumeFileId: 'file',
    resumeHash: 'hash'
  });
  assert.equal(cached.scoring.score, valid.scoring.score);
  assert.ok(performance.now() - started < 1000);
});

test('Gemini SDK receives and aborts the actual fetch signal; successful requests stay live', async (t) => {
  const manager = require('../services/aiProviderManager');
  const original = global.fetch;
  t.after(() => {
    global.fetch = original;
  });
  let received;
  global.fetch = async (_url, options) => {
    received = options.signal;
    return new Promise((resolve, reject) => {
      if (received.aborted) reject(new Error('cancelled'));
      else received.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
    });
  };
  const controller = new AbortController();
  const pending = manager.runGemini({
    prompt: 'Synthetic focus codes only',
    modelName: 'gemini-2.5-flash',
    apiKey: 'fixture-not-a-credential',
    parseJson: JSON.parse,
    timeoutMs: 500,
    signal: controller.signal
  });
  setTimeout(() => controller.abort(), 25);
  await assert.rejects(pending);
  assert.equal(received.aborted, true);
  global.fetch = async (_url, options) => {
    received = options.signal;
    return new Response(
      JSON.stringify({
        candidates: [{ content: { parts: [{ text: '{"focusAreas":["bullet_clarity"]}' }] } }]
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  };
  await manager.runGemini({
    prompt: 'Synthetic focus codes only',
    modelName: 'gemini-2.5-flash',
    apiKey: 'fixture-not-a-credential',
    parseJson: JSON.parse,
    timeoutMs: 500
  });
  assert.equal(received.aborted, false);
});

test('version and missing evidence comparisons never turn absence into improvement; zero remains zero', () => {
  const current = {
    analysisVersion: service.ANALYSIS_VERSION,
    atsScore: 50,
    keywordDensity: 50,
    formatScore: 50,
    contentQuality: 50,
    qualityScores: { overallResumeScore: 50 }
  };
  const previous = { ...current, atsScore: 90, qualityScores: { overallResumeScore: 0 } };
  const compare = service.__test.buildImprovementDelta;
  assert.equal(compare(current, previous).scoreChanges.overallResumeScore, 50);
  assert.equal(compare(current, { ...previous, analysisVersion: 'legacy' }).hasPrevious, false);
  assert.equal(compare(current, { ...previous, atsScore: undefined }).hasPrevious, false);
});

test('disconnect keeps the Mongo reservation until processing completes', async (t) => {
  const governance = require('../services/integrationMongoGovernanceService');
  const admission = require('../middleware/resumeAdmission');
  const { EventEmitter } = require('node:events');
  let released = 0;
  t.mock.method(governance, 'resumeLease', async () => ({ keys: ['synthetic'], token: 'fixture' }));
  t.mock.method(governance, 'release', async () => {
    released++;
  });
  const req = { user: { _id: 'owner' }, body: { fileId: '111111111111111111111111' } };
  const res = new EventEmitter();
  let proceeded = false;
  await admission.analysisLease(req, res, () => {
    proceeded = true;
  });
  assert.equal(proceeded, true);
  res.emit('close');
  assert.equal(released, 0);
  req.releaseResumeReservation();
  req.releaseResumeReservation();
  assert.equal(released, 1);
});
