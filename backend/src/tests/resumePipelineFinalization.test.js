'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const service = require('../services/resumeservice');
const quality = require('../services/resumeContentQuality');
const engine = require('../services/scoring/resumeOverallScore');
const controllerTest = require('../controllers/resumecontoller').__test;
const SAMPLE = [
  'Jane Developer', 'jane@example.com', 'EXPERIENCE',
  'Engineer 2020 - 2024',
  'Built Node.js services and reduced latency by 30% for 100 users across internal customer support applications.',
  'Developed reliable Python automation and tested deployment workflows with Docker and GitHub Actions.',
  'PROJECTS', 'Created an Angular dashboard with TypeScript and SQL to track customer service requests and improve team reporting.',
  'SKILLS', 'Node.js, Python, Angular, TypeScript, SQL, Docker',
  'EDUCATION', 'Bachelor of Computer Science completed in 2019.'
].join(String.fromCharCode(10));
const copy = value => structuredClone(value);
const chain = value => ({ select() { return this; }, sort() { return this; }, lean: async () => value, then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); } });

const harness = async t => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'resume-pipeline-'));
  const sourcePath = path.join(folder, 'source.pdf');
  await fs.writeFile(sourcePath, '%PDF-1.4\nfixture');
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  const state = { text: SAMPLE, parserFailure: false, parserCalls: 0, aiMode: 'success', aiCalls: 0, prefixInvalidations: 0, dashboardInvalidations: 0, events: [], cache: new Map(), records: [], files: [], users: { _id: 'user', activeResumeFileId: '222222222222222222222222', defaultResumeFileId: '222222222222222222222222' } };
  const fileId = '111111111111111111111111';
  const historical = { _id: fileId, userId: 'user', fileName: 'resume.pdf', fileSize: 1024, fileUrl: sourcePath, uploadDate: new Date(), async save() { state.events.push('file-save'); } };
  state.files.push(historical);
  class ResumeFile {
    constructor(data) { Object.assign(this, data, { _id: String(state.files.length + 3).padStart(24, '0'), uploadDate: new Date() }); }
    async save() { if (!state.files.includes(this)) state.files.push(this); state.events.push('upload-save'); }
    static findById(id) { return chain(state.files.find(file => String(file._id) === String(id)) || null); }
    static findOne(query) { return chain(state.files.find(file => (!query._id || String(file._id) === String(query._id)) && file.userId === query.userId) || null); }
  }
  class ResumeAnalysis {
    constructor(data) { Object.assign(this, copy(data), { _id: String(state.records.length + 9).padStart(24, '0') }); }
    async save() { state.records.push(this); state.events.push('analysis-save'); }
    static findOne(query) { return chain(state.records.filter(row => row.userId === query.userId && (!query.fileId || String(row.fileId) === String(query.fileId))).at(-1) || null); }
    static async updateOne(query, update) { const row = state.records.find(row => row._id === query._id); if (row) { row.aiInsights = copy(update.$set.aiInsights); row.suggestions = copy(update.$set.suggestions); } state.events.push('critique-save'); }
  }
  const cacheKey = query => [query.userId, query.resumeFileId, query.resumeHash, query.analysisVersion].join(':');
  const mocks = {
    'pdf-parse': async () => { state.parserCalls++; if (state.parserFailure) throw new Error('parser secret C:\private'); return { text: state.text }; },
    '../models/resumeAnalysisCache': { findOne: query => chain(state.cache.get(cacheKey(query)) || null), async findOneAndUpdate(query, update) { state.events.push('cache-save'); state.cache.set(cacheKey(query), copy(update.$set)); }, async updateOne(query, update) { const entry = state.cache.get(cacheKey(query)); if (entry) for (const [key, value] of Object.entries(update.$set)) if (key.startsWith('result.')) entry.result[key.slice(7)] = copy(value); } },
    '../models/resumeFile': ResumeFile, '../models/resumeAnalysis': ResumeAnalysis,
    '../models/user': { findById: () => chain(state.users), async findByIdAndUpdate(_id, update) { Object.assign(state.users, update); return state.users; } },
    './aiservice': { async runAIAnalysis(_prompt, fallback) { state.aiCalls++; state.events.push('ai'); assert.ok(state.events.includes('cache-save')); assert.ok(state.events.includes('analysis-save')); if (state.aiMode === 'throw') throw new Error('provider secret'); if (state.aiMode === 'hang') return new Promise(() => {}); if (state.aiMode === 'malformed') return 'bad-json'; if (state.aiMode === 'polluted') return { focusAreas: ['quantified_impact'], atsScore: 999, scoring: { ruleVersion: 'evil-v1' }, skills: ['Invented'], normalized: {}, analyzedAt: '2099-01-01' }; return { focusAreas: ['quantified_impact'] }; }, async invalidateCachePrefix() { state.prefixInvalidations++; } },
    './redisCacheService': { getCacheJsonWithMeta: async () => ({ value: null }), setCacheJson: async () => {} },
    '../services/notificationService': { createNotification: async () => {} },
    './dashboardcontroller': { invalidateDashboardSummaryCache() { state.dashboardInvalidations++; } },
    '../services/resumeGuideService': { generateResumeGuide: async () => '' },
    '../services/previewResumeCacheService': { createPreviewResume: async () => ({}) }
  };
  mocks['../services/aiservice'] = mocks['./aiservice'];
  const servicePath = require.resolve('../services/resumeservice');
  const controllerPath = require.resolve('../controllers/resumecontoller');
  const previousService = require.cache[servicePath]; const previousController = require.cache[controllerPath];
  delete require.cache[servicePath]; delete require.cache[controllerPath];
  const original = Module._load;
  Module._load = function(request, parent, isMain) { return mocks[request] || original.call(this, request, parent, isMain); };
  let loadedService, controller;
  try { loadedService = require(servicePath); mocks['../services/resumeservice'] = loadedService; controller = require(controllerPath); }
  finally { Module._load = original; }
  t.after(() => { require.cache[servicePath] = previousService; require.cache[controllerPath] = previousController; });
  const invoke = async (handler, extras = {}) => {
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    await handler({ user: { _id: 'user' }, body: { fileId }, query: {}, ...extras }, res); return res;
  };
  return { state, service: loadedService, controller, invoke, fileId, sourcePath };
};

test('content quality rejects empty, unreadable and unsupported text without a score', async () => {
  for (const [text, expected] of [['', 'EMPTY'], ['   ', 'EMPTY'], ['hello world', 'UNREADABLE'], ['\ufffd\ufffd\ufffd', 'UNREADABLE'], [null, 'INVALID']]) {
    assert.equal(quality.assessContent(text).state, expected);
    await assert.rejects(service.analyzeResume(text, 'resume.pdf', 100), error => error.status === 422 && error.contentQualityState.state === expected);
  }
});
test('very short readable content has unavailable inputs and no score floor', async () => {
  const result = await service.__test.buildDeterministicAnalysis({ text: 'Jane Developer EXPERIENCE Built APIs SKILLS Node.js', fileName: 'resume.pdf', fileSize: 100 });
  assert.equal(result.contentQualityState.state, 'PARTIALLY_READABLE'); assert.equal(result.scoring.score, null); assert.equal(result.atsScore, 0);
  assert.ok(Object.values(result.scoring.breakdown).every(item => !item.available)); assert.ok(result.scoring.warnings.includes('score_unavailable'));
});
test('PDF parser classifies corrupt, empty and image-only data using safe errors', async () => {
  const pdf = Buffer.from('%PDF-1.4\nfixture');
  assert.equal(await service.__test.parsePDFBuffer(pdf, async () => ({ text: SAMPLE })), SAMPLE);
  await assert.rejects(service.__test.parsePDFBuffer(Buffer.from('not pdf')), error => error.status === 400);
  await assert.rejects(service.__test.parsePDFBuffer(pdf, async () => { throw new Error('raw parser secret'); }), error => error.status === 422 && !error.message.includes('secret') && error.contentQualityState.state === 'INVALID');
  for (const text of ['', '  ']) await assert.rejects(service.__test.parsePDFBuffer(pdf, async () => ({ text, numpages: 1 })), error => error.status === 422 && error.contentQualityState.state === 'EMPTY');
});
test('file metadata validation preserves PDF type and ten-megabyte limit', () => {
  controllerTest.validateResumeUploadMetadata({ originalname: 'resume.PDF', mimetype: 'application/pdf', size: 1024 });
  for (const file of [{ originalname: 'resume.txt', mimetype: 'application/pdf', size: 10 }, { originalname: 'resume.pdf', mimetype: 'image/png', size: 10 }]) assert.throws(() => controllerTest.validateResumeUploadMetadata(file), error => error.status === 400);
  assert.throws(() => controllerTest.validateResumeUploadMetadata({ originalname: 'resume.pdf', mimetype: 'application/pdf', size: 10 * 1024 * 1024 + 1 }), error => error.status === 413);
});
test('normal extraction, score parity, bounds and bounded provenance', async t => {
  const h = await harness(t); const res = await h.invoke(h.controller.analyzeResumeFile);
  assert.equal(res.statusCode, 200); const result = res.body;
  assert.equal(result.contentQualityState.state, 'VALID'); assert.equal(result.scoring.ruleVersion, 'resume-overall-score-v1');
  assert.equal(result.scoring.score, engine.calculate(result.scoring.evidence.inputs).score);
  assert.equal(Object.keys(result.scoring.breakdown).length, 8); assert.ok(result.scoring.score >= 0 && result.scoring.score <= 100);
  assert.equal(result.experienceYears, 4); assert.ok(JSON.stringify(result.skills).includes('Node.js'));
  assert.ok(result.scoring.evidence.sources.some(source => source.type === 'resume-file' && source.id === h.fileId));
  assert.ok(JSON.stringify(result.scoring.evidence).length < 2500); assert.ok(!JSON.stringify(result.scoring.evidence).includes('jane@example.com'));
  assert.ok(h.state.events.indexOf('analysis-save') < h.state.events.indexOf('ai'));
});
test('repeated analysis preserves source time, active identity and all histories', async t => {
  const h = await harness(t); const first = await h.invoke(h.controller.analyzeResumeFile); const active = h.state.users.activeResumeFileId;
  const second = await h.invoke(h.controller.analyzeResumeFile);
  assert.equal(second.statusCode, 200); assert.equal(h.state.aiCalls, 1); assert.equal(h.state.parserCalls, 1); assert.equal(h.state.records.length, 1);
  assert.equal(second.body.analyzedAt, first.body.analyzedAt); assert.deepEqual(second.body.scoring, first.body.scoring); assert.equal(h.state.users.activeResumeFileId, active);
  await h.invoke(h.controller.analyzeResumeFile, { body: { fileId: h.fileId, forceRefresh: true } });
  assert.equal(h.state.records.length, 2); assert.equal(h.state.files.length, 1); assert.equal(h.state.prefixInvalidations, 2); assert.equal(h.state.dashboardInvalidations, 2);
});
test('AI success, failure, malformed and polluted output preserve deterministic facts', async t => {
  const h = await harness(t); let baseline;
  for (const mode of ['success', 'throw', 'malformed', 'polluted']) {
    h.state.aiMode = mode; const res = await h.invoke(h.controller.analyzeResumeFile, { body: { fileId: h.fileId, forceRefresh: true } });
    assert.equal(res.statusCode, 200); const facts = { skills: res.body.skills, normalized: res.body.normalized, atsScore: res.body.atsScore, breakdown: res.body.scoring.breakdown, evidence: res.body.scoring.evidence, version: res.body.scoring.ruleVersion };
    if (baseline) assert.deepEqual(facts, baseline); else baseline = copy(facts);
    assert.equal(res.body.analyzedAt, res.body.scoring.calculatedAt); assert.equal(h.state.users.activeResumeFileId, '222222222222222222222222');
  }
});
test('AI deadline returns a persisted deterministic analysis when provider hangs', async t => {
  const h = await harness(t); h.state.aiMode = 'hang'; const res = await h.invoke(h.controller.analyzeResumeFile);
  assert.equal(res.statusCode, 200); assert.equal(res.body.aiInsights.aiUsed, false); assert.equal(h.state.records.length, 1);
});
test('uploads validate before persistence and invalidate dependent caches without deleting history', async t => {
  const h = await harness(t); const file = { path: h.sourcePath, originalname: 'resume.pdf', mimetype: 'application/pdf', size: 1024 };
  const res = await h.invoke(h.controller.uploadResume, { file });
  assert.equal(res.statusCode, 200); assert.equal(h.state.files.length, 2); assert.equal(h.state.users.activeResumeFileId, res.body.fileId);
  assert.equal(h.state.prefixInvalidations, 1); assert.equal(h.state.dashboardInvalidations, 1); assert.equal(h.state.records.length, 0);
  const duplicate = await h.invoke(h.controller.uploadResume, { file }); assert.equal(duplicate.statusCode, 200); assert.equal(h.state.files.length, 3);
  assert.notEqual(duplicate.body.fileId, res.body.fileId);
});
test('corrupt uploads and parser failures return safe errors without saving files or changing selection', async t => {
  const h = await harness(t); h.state.parserFailure = true;
  const res = await h.invoke(h.controller.uploadResume, { file: { path: h.sourcePath, originalname: 'resume.pdf', mimetype: 'application/pdf', size: 1024 } });
  assert.equal(res.statusCode, 422); assert.equal(res.body.contentQualityState.state, 'INVALID'); assert.equal(h.state.files.length, 1);
  assert.equal(h.state.users.activeResumeFileId, '222222222222222222222222'); assert.ok(!JSON.stringify(res.body).includes('secret'));
});
test('duplicate bullet evidence, date gaps and employment overlaps do not inflate facts', async () => {
  const first = await service.__test.buildDeterministicAnalysis({ text: SAMPLE, fileName: 'resume.pdf', fileSize: 100, deferAI: true });
  const duplicated = SAMPLE.replace('SKILLS', 'Created an Angular dashboard with TypeScript and SQL to track customer service requests and improve team reporting.\nSKILLS');
  const second = await service.__test.buildDeterministicAnalysis({ text: duplicated, fileName: 'resume.pdf', fileSize: 100, deferAI: true });
  assert.equal(second.scoring.score, first.scoring.score); assert.equal(second.scoring.evidence.facts.quantifiedAchievementCount, 1);
  assert.equal(service.__test.extractExperienceYears('', 'Engineer 2015 - 2016\nEngineer 2023 - 2024'), 2);
  assert.equal(service.__test.extractExperienceYears('', 'Engineer 2020 - 2024\nLead 2022 - 2024'), 4);
  assert.equal(service.__test.extractPersonalInfo('Engineer 2020 - 2024').phone, '');
});

const textPDF = (text) => {
  const newline = String.fromCharCode(10);
  const stream = 'BT /F1 12 Tf 50 760 Td (' + text + ') Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Length ' + Buffer.byteLength(stream) + ' >>' + newline + 'stream' + newline + stream + newline + 'endstream'
  ];
  let document = '%PDF-1.4' + newline;
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(document));
    document += (index + 1) + ' 0 obj' + newline + object + newline + 'endobj' + newline;
  });
  const xref = Buffer.byteLength(document);
  document += 'xref' + newline + '0 6' + newline + '0000000000 65535 f ' + newline;
  offsets.slice(1).forEach(offset => { document += String(offset).padStart(10, '0') + ' 00000 n ' + newline; });
  document += 'trailer' + newline + '<< /Size 6 /Root 1 0 R >>' + newline + 'startxref' + newline + xref + newline + '%%EOF';
  return Buffer.from(document);
};

test('installed PDF parser reads real text PDFs and rejects blank and corrupt PDFs', async () => {
  const text = SAMPLE.split(String.fromCharCode(10)).join(' ');
  const parsed = await service.__test.parsePDFBuffer(textPDF(text));
  assert.ok(parsed.includes('Node.js')); assert.equal(quality.assessContent(parsed).state, 'VALID');
  await assert.rejects(service.__test.parsePDFBuffer(textPDF('')), error => error.status === 422);
  await assert.rejects(service.__test.parsePDFBuffer(Buffer.from('%PDF-1.4 corrupt')), error => error.status === 422 && error.code === 'RESUME_PARSER_FAILURE');
});

test('centralized eight-component zero, missing-input and rounding behavior is retained', () => {
  const values = Object.fromEntries(Object.keys(engine.WEIGHTS).map(key => [key, 0]));
  const zero = engine.calculate(values);
  assert.equal(zero.score, 0); assert.ok(Object.values(zero.breakdown).every(item => item.available));
  const unavailable = engine.calculate({ ...values, technicalDepth: null });
  assert.equal(unavailable.score, 0); assert.equal(unavailable.breakdown.technicalDepth.available, false);
  for (const value of [0, 12.25, 49.5, 100, 150, -10]) {
    const result = engine.calculate(Object.fromEntries(Object.keys(values).map(key => [key, value])));
    assert.ok(Number.isInteger(result.score)); assert.ok(result.score >= 0 && result.score <= 100);
  }
});

test('missing sections and unusual Unicode formatting retain factual extraction', async () => {
  const unusual = SAMPLE.replace('EXPERIENCE', 'ＥＸＰＥＲＩＥＮＣＥ').replaceAll(String.fromCharCode(10), String.fromCharCode(13, 10));
  const result = await service.__test.buildDeterministicAnalysis({ text: unusual, fileName: 'resume.pdf', fileSize: 100, deferAI: true });
  assert.equal(result.normalized.sectionPresence.experience, true);
  assert.equal(result.experienceYears, 4);
  const missing = await service.__test.buildDeterministicAnalysis({ text: 'A developer resume explains professional interests and describes several general responsibilities related to designing useful software products for customers and collaborating with other people to improve reliable delivery and maintenance.', fileName: 'resume.pdf', fileSize: 100, deferAI: true });
  assert.equal(missing.normalized.sectionPresence.projects, false);
  assert.equal(missing.scoring.evidence.facts.technologyCount, 0);
  assert.deepEqual(missing.certifications, []);
  assert.ok(missing.consistencyWarnings.some(warning => warning.code === 'missing_projects_section'));
});

test('active selection invalidates current caches and selected unanalyzed files never borrow history', async t => {
  const h = await harness(t);
  await h.invoke(h.controller.analyzeResumeFile);
  const historical = copy(h.state.records);
  const absent = await h.invoke(h.controller.getResumeAnalysis);
  assert.equal(absent.statusCode, 404);
  const selected = await h.invoke(h.controller.setActiveResume, { body: { fileId: h.fileId } });
  assert.equal(selected.statusCode, 200);
  assert.equal(h.state.users.activeResumeFileId, h.fileId);
  assert.equal(h.state.users.defaultResumeFileId, '222222222222222222222222');
  const current = await h.invoke(h.controller.getResumeAnalysis);
  assert.equal(current.statusCode, 200); assert.equal(current.body.fileId, h.fileId);
  assert.deepEqual(copy(h.state.records), historical);
  assert.equal(h.state.prefixInvalidations, 2); assert.equal(h.state.dashboardInvalidations, 2);
});

test('expired resume caches cannot extend source freshness when warmed from Mongo', async t => {
  const h = await harness(t);
  const first = await h.invoke(h.controller.analyzeResumeFile);
  h.service.clearResumeAnalysisMemoryCache();
  for (const entry of h.state.cache.values()) entry.expiresAt = new Date(Date.now() - 1000);
  const cached = await h.service.findCachedResumeAnalysis({ userId: 'user', resumeFileId: h.fileId, resumeHash: first.body.resumeHash });
  assert.equal(cached, null);
  const next = await h.invoke(h.controller.analyzeResumeFile);
  assert.equal(next.statusCode, 200); assert.equal(h.state.records.length, 2); assert.equal(h.state.aiCalls, 2);
  assert.notEqual(next.body.scoring.calculatedAt, first.body.scoring.calculatedAt);
});
