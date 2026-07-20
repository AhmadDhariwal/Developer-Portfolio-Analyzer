const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const detector = require('../utils/skilldetector');
const { buildSkillGraph, generateWeeklyLearningRoadmap } = require('../services/skillGraphService');

const root = path.resolve(__dirname, '..');
const resolve = (relative) => require.resolve(path.join(root, relative));
const mock = (relative, exports) => { const filename = resolve(relative); require.cache[filename] = { id: filename, filename, loaded: true, exports }; };
const chain = (value) => ({ sort: () => ({ lean: async () => value }), lean: async () => value });

const harness = () => {
  const shared = new Map(); const deterministic = new Map();
  const calls = { github: 0, ai: 0, private: 0 };
  mock('services/githubservice.js', {
    getCachedGitHubAnalysis: async () => { calls.github += 1; await new Promise((done) => setTimeout(done, 15)); return { status: 'fresh', ageMs: 0, data: { repoCount: 2, languageDistribution: [{ language: 'TypeScript' }], repositories: [{ name: 'react-app', description: 'React app', language: 'TypeScript' }], cache: { cachedAt: '2026-07-20', expiresAt: '2026-07-21' } } }; },
    refreshGitHubAnalysisInBackground: () => ({ queued: true, running: false })
  });
  mock('services/aiservice.js', {
    getSharedCache: async (key, namespace) => shared.get(`${namespace}:${key}`) || null,
    setSharedCache: async (key, value, _ttl, namespace) => shared.set(`${namespace}:${key}`, value),
    getDeterministicSummary: async (_scope, key) => deterministic.get(JSON.stringify(key)) || null,
    setDeterministicSummary: async (_scope, key, value) => deterministic.set(JSON.stringify(key), value),
    runAIAnalysis: async () => { calls.ai += 1; return { analysisSummary: 'Narrative.', levelAssessment: 'Narrative.', coverage: 100, yourSkills: [{ name: 'Kubernetes' }], missingSkills: [{ name: 'Kubernetes' }] }; },
    recordDeterministicSkip: () => {}
  });
  mock('models/analysisCache.js', { findOne: () => chain(null), findOneAndUpdate: async () => null });
  mock('models/resumeAnalysis.js', { findOne: () => chain({ fileId: 'default', fileName: 'default.pdf', technicalSkills: ['React', 'TypeScript'], atsScore: 80 }) });
  mock('services/aiVersionService.js', { createVersion: async () => {} });
  mock('services/notificationService.js', { createNotification: async () => {} });
  mock('prompts/skillGapPrompt.js', { getSkillGapPrompt: () => 'prompt' });
  mock('services/promptBuilderService.js', { estimateTokens: () => 1, buildSkillGapPromptContext: () => ({ detectedSkills: [], resume: {}, github: {}, signals: {} }) });
  mock('services/developerSignalService.js', {
    getDeveloperSignals: async () => { calls.private += 1; return { integrationSignal: { present: true, integrationScore: 0, detectedSkills: [], weakProof: [] }, careerSprintSignal: { completedSkillSignals: [], repeatedIncompleteSkills: [] }, weeklyReportSignal: { repeatedWeakAreas: [] }, portfolioSignal: { portfolioSkills: [] }, jobsDemandSignal: { present: true, sampledJobs: 1, topSkills: [] } }; },
    buildSignalHash: () => 'signals', buildSignalsUsedSummary: () => ({}),
    buildResumeAnalysisSignals: (value, level) => ({ ...(value || {}), skills: value?.technicalSkills || [], technicalSkills: value?.technicalSkills || [], atsScore: value?.atsScore || 0, experienceLevel: level, statusMessage: 'Saved resume' }),
    buildResumeCacheIdentity: () => ({ resumeHash: 'a'.repeat(64), resumeAnalysisId: 'default' }), buildAnalysisBasedOn: () => ({}), getPublicJobMarketSignal: async () => ({ present: true, sampledJobs: 1, topSkills: [] })
  });
  const controller = resolve('controllers/skillgapcontroller.js'); delete require.cache[controller]; const { analyzeSkillGap } = require(controller);
  const call = async (body, user) => { const out = { status: 200 }; const res = { status: (status) => { out.status = status; return res; }, json: (body) => { out.body = body; return res; } }; await analyzeSkillGap({ body, user, skillGapRouteStartedAt: Date.now(), skillGapAuthCompletedAt: Date.now() }, res); return out; };
  return { call, calls };
};

test('aliases preserve distinct languages and recognized aliases', () => {
  [['React.js', 'React'], ['Node.js', 'Node.js'], ['Next.js', 'Next.js'], ['TypeScript', 'TypeScript'], ['C++', 'C++'], ['C#', 'C#'], ['.NET', 'C#'], ['SQL', 'SQL'], ['CI/CD', 'CI/CD'], ['Docker', 'Docker'], ['Kubernetes', 'Kubernetes']].forEach(([a, e]) => assert.equal(detector.canonicalizeSkillName(a), e));
  assert.deepEqual(detector.extractSkillsFromText('Java service only'), ['Java']);
  assert.ok(!detector.extractSkillsFromText('Java service only').includes('JavaScript'));
});

test('detector requires real repository evidence and survives missing sources', () => {
  const skills = detector.extractSkillsFromRepositories([{ name: 'dockerize', description: '', language: 'Java' }], [{ language: 'Java' }]);
  assert.ok(skills.includes('Java')); assert.ok(!skills.includes('Docker'));
  assert.deepEqual(detector.extractSkillsFromRepositories(null, null), []);
});

test('graph has configured prerequisite edges and finite 0-100 scores', () => {
  const graph = buildSkillGraph({ currentSkills: [{ name: 'Git', jobDemand: NaN }], missingSkills: [{ name: 'Next.js', jobDemand: Infinity }, { name: 'Kubernetes' }] });
  assert.ok(graph.edges.every((edge) => edge.type === 'prerequisite'));
  assert.ok(graph.edges.some((edge) => edge.from === 'react' && edge.to === 'next-js'));
  assert.ok(graph.edges.some((edge) => edge.from === 'docker' && edge.to === 'kubernetes'));
  assert.ok(graph.nodes.every((node) => Number.isFinite(node.demandScore) && node.demandScore >= 0 && node.demandScore <= 100));
});

test('roadmap is ordered, bounded, unique, and does not schedule blocked skills', () => {
  const graph = buildSkillGraph({ currentSkills: [{ name: 'Git' }, { name: 'TypeScript' }], missingSkills: [{ name: 'Next.js' }, { name: 'Kubernetes' }] });
  const roadmap = generateWeeklyLearningRoadmap(graph, 8); const all = roadmap.flatMap((week) => week.focusSkills); const weekOf = (name) => roadmap.find((week) => week.focusSkills.includes(name))?.week;
  assert.ok(roadmap.every((week) => week.focusSkills.length <= 2)); assert.equal(new Set(all).size, all.length);
  assert.ok(weekOf('React') < weekOf('Next.js')); assert.ok(weekOf('Docker') < weekOf('Kubernetes')); assert.equal(roadmap.length, 8);
});

test('preview resolver rejects mismatch, expiry, and oversized input without returning raw resume text', async () => {
  const cache = new Map(); mock('services/aiservice.js', { setSharedCache: async (key, value, _ttl, ns) => cache.set(`${ns}:${key}`, value), getSharedCache: async (key, ns) => cache.get(`${ns}:${key}`) || null });
  const file = resolve('services/previewResumeCacheService.js'); delete require.cache[file]; const { createPreviewResume, resolvePreviewResume, MAX_INLINE_PREVIEW_RESUME_CHARS } = require(file);
  const item = await createPreviewResume('React and TypeScript');
  assert.equal((await resolvePreviewResume({ previewResumeId: item.previewResumeId, resumeHash: 'b'.repeat(64) })).status, 400); cache.clear();
  assert.equal((await resolvePreviewResume({ previewResumeId: item.previewResumeId, resumeHash: item.resumeHash })).status, 400);
  assert.equal((await resolvePreviewResume({ resumeText: 'x'.repeat(MAX_INLINE_PREVIEW_RESUME_CHARS + 1) })).status, 413); assert.ok(!JSON.stringify(item).includes('React and TypeScript'));
});

test('profile uses active user data while preview excludes private signals and AI cannot change skills', async () => {
  const h = harness(); const user = { _id: 'u1', activeGithubUsername: 'active', activeCareerStack: 'Frontend', activeExperienceLevel: 'Intern', defaultResumeFileId: 'default' };
  const profile = await h.call({}, user); assert.equal(profile.status, 200); assert.equal(profile.body.careerStack, 'Frontend'); assert.equal(profile.body.experienceLevel, 'Intern'); assert.equal(profile.body.username, 'active'); assert.equal(h.calls.private, 1);
  assert.ok(!profile.body.missingSkills.some((skill) => skill.name === 'Kubernetes'));
  const preview = await h.call({ isTemporary: true, username: 'public', careerStack: 'Backend', experienceLevel: 'Student', resumeText: 'Node.js SQL' }); assert.equal(preview.body.mode, 'preview'); assert.equal(h.calls.private, 1);
});

test('cache hit uses zero GitHub and AI calls; concurrent refreshes share one pipeline', async () => {
  const h = harness(); const user = { _id: 'u2', activeGithubUsername: 'cache', activeCareerStack: 'Full Stack', activeExperienceLevel: 'Student', defaultResumeFileId: 'default' };
  await h.call({}, user); h.calls.github = 0; h.calls.ai = 0; const hit = await h.call({}, user); assert.equal(hit.body.fromCache, true); assert.equal(h.calls.github, 0); assert.equal(h.calls.ai, 0);
  h.calls.github = 0; h.calls.ai = 0; const results = await Promise.all(Array.from({ length: 5 }, () => h.call({ forceRefresh: true }, user))); assert.ok(results.every((r) => r.status === 200)); assert.equal(h.calls.github, 1); assert.equal(h.calls.ai, 1);
});

test('saved previews are owner-scoped, deduplicated, raw-text-free, and load without analysis', () => {
  const SavedPreview = require('../models/savedPreview'); const indexes = SavedPreview.schema.indexes();
  assert.ok(indexes.some(([keys, opts]) => keys.userId === 1 && keys.module === 1 && keys.resumeHash === 1 && opts.unique)); assert.equal(SavedPreview.schema.path('resumeText'), undefined); assert.equal(SavedPreview.schema.path('userId').options.required, true);
  const component = fs.readFileSync(path.resolve(__dirname, '../../../frontend/src/app/pages/skill-gap/skill-gap.component.ts'), 'utf8'); const load = component.slice(component.indexOf('openSavedPreview('), component.indexOf('deleteSavedPreview(')); assert.ok(load.includes('this.applyResult(')); assert.ok(!load.includes('this.analyze('));
});
test('SavedPreview migration removes only confirmed duplicates and is idempotent', async () => {
  const { migrateSavedPreviewIndexes } = require('../scripts/migrateSavedPreviewIndexes');
  const same = { userId: 'u1', module: 'skill-gap', githubUsername: 'dev', careerStack: 'Frontend', experienceLevel: 'Intern', resumeHash: 'a'.repeat(64) };
  const records = [
    { ...same, _id: 'old', createdAt: new Date('2026-01-01'), resultSummary: {} },
    { ...same, _id: 'new', createdAt: new Date('2026-02-01'), resultSummary: { coverage: 50 } },
    { ...same, _id: 'other-user', userId: 'u2', createdAt: new Date('2026-02-01'), resultSummary: { coverage: 50 } }
  ];
  let indexes = [{ name: '_id_', key: { _id: 1 } }, { name: 'legacy_identity', key: { userId: 1, module: 1, githubUsername: 1, careerStack: 1, experienceLevel: 1, resumeHash: 1 } }];
  const equal = (record, filter) => Object.entries(filter).every(([key, value]) => String(record[key]) === String(value));
  const model = {
    collection: {
      aggregate: () => ({ toArray: async () => {
        const counts = new Map(); records.forEach((record) => { const key = `${record.userId}:${record.module}:${record.githubUsername}:${record.careerStack}:${record.experienceLevel}:${record.resumeHash}`; counts.set(key, (counts.get(key) || 0) + 1); });
        return [...counts.entries()].filter(([, count]) => count > 1).map(([key, count]) => { const [userId, module, githubUsername, careerStack, experienceLevel, resumeHash] = key.split(':'); return { _id: { userId, module, githubUsername, careerStack, experienceLevel, resumeHash }, count }; });
      } }),
      indexes: async () => indexes,
      dropIndex: async (name) => { indexes = indexes.filter((index) => index.name !== name); },
      createIndex: async (key, options) => { indexes.push({ name: options.name, key, unique: options.unique }); }
    },
    find: (filter) => ({ sort: () => ({ lean: async () => records.filter((record) => equal(record, filter)).sort((a, b) => b.createdAt - a.createdAt) }) }),
    deleteMany: async ({ _id: { $in } }) => { const before = records.length; for (let index = records.length - 1; index >= 0; index -= 1) if ($in.includes(records[index]._id)) records.splice(index, 1); return { deletedCount: before - records.length }; }
  };
  const first = await migrateSavedPreviewIndexes(model); const second = await migrateSavedPreviewIndexes(model);
  assert.equal(first.duplicatesRemoved, 1); assert.equal(first.dropped, 1); assert.equal(first.remainingDuplicateGroups, 0);
  assert.equal(second.duplicatesRemoved, 0); assert.equal(second.dropped, 0); assert.equal(records.length, 2); assert.ok(indexes.some((index) => index.name === 'saved_preview_identity_unique' && index.unique));
});

test('concurrent saved-preview duplicate recovery returns the persisted winner', () => {
  const source = fs.readFileSync(path.resolve(root, 'controllers/recommendationscontroller.js'), 'utf8');
  assert.match(source, /findOneAndUpdate\([\s\S]*upsert: true/);
  assert.match(source, /error\?\.code !== 11000/);
  assert.match(source, /SavedPreview\.findOne\(previewIdentity\)\.lean\(\)/);
  assert.match(source, /yourSkills: previewSkills\(result\.yourSkills\)/);
});