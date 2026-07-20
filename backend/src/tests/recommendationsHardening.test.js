const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const root = path.resolve(__dirname, '../../..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const controller = read('backend','src','controllers','recommendationscontroller.js');
const client = read('frontend','src','app','shared','services','recommendations.service.ts');
const component = read('frontend','src','app','pages','recommendations','recommendations.component.ts');
const routes = read('backend','src','routes','recommendations.routes.js');
const { extractSkillsFromText, canonicalizeSkillName } = require('../utils/skilldetector');

const loadPreviewService = (cache) => {
  const target = path.join(root, 'backend','src','services','previewResumeCacheService.js');
  delete require.cache[target];
  const original = Module._load;
  Module._load = function(request, parent, isMain) {
    if (request === './aiservice' && parent?.filename === target) return cache;
    return original.call(this, request, parent, isMain);
  };
  try { return require(target); } finally { Module._load = original; }
};

test('skill matching keeps language identities distinct', () => {
  const skills = extractSkillsFromText(['JavaScript TypeScript Node.js Next.js SQL C++ C# .NET']);
  for (const skill of ['JavaScript','TypeScript','Node.js','Next.js','SQL','C++','C#']) assert.ok(skills.includes(skill));
  assert.equal(extractSkillsFromText(['JavaScript']).includes('Java'), false);
  assert.equal(canonicalizeSkillName('.NET'), 'C#');
});

test('preview resumes require an unguessable id plus matching hash and never retain text', async () => {
  const calls = []; const store = new Map();
  const cache = { setSharedCache: async (key, value) => { calls.push(['set', key]); store.set(key, value); }, getSharedCache: async key => { calls.push(['get', key]); return store.get(key) || null; } };
  const service = loadPreviewService(cache);
  const created = await service.createPreviewResume('Ada: TypeScript, Node.js');
  assert.equal(JSON.stringify([...store.values()]).includes('Ada:'), false);
  assert.equal((await service.resolvePreviewResume({ previewResumeId: created.previewResumeId, experienceLevel: 'Student' })).status, 400);
  assert.equal((await service.resolvePreviewResume({ previewResumeId: created.previewResumeId, resumeHash: '0'.repeat(64), experienceLevel: 'Student' })).status, 400);
  const resolved = await service.resolvePreviewResume({ previewResumeId: created.previewResumeId, resumeHash: created.resumeHash, experienceLevel: 'Student' });
  assert.equal(resolved.resumeCacheIdentity.resumeHash, created.resumeHash);
  assert.equal(resolved.resumeInsights.resumeText, undefined);
  assert.ok(calls.filter(([type]) => type === 'get').length >= 2);
});

test('oversized and expired previews return clean client errors', async () => {
  const service = loadPreviewService({ setSharedCache: async () => {}, getSharedCache: async () => null });
  assert.equal((await service.resolvePreviewResume({ resumeText: 'x'.repeat(service.MAX_INLINE_PREVIEW_RESUME_CHARS + 1) })).status, 413);
  assert.equal((await service.resolvePreviewResume({ previewResumeId: 'missing', resumeHash: 'a'.repeat(64) })).status, 400);
});

test('profile and preview isolation plus provider/cache invariants are enforced', () => {
  assert.match(routes, /router\.post\('\/', protect, getRecommendations\)/);
  assert.match(controller, /Authentication required for profile mode/);
  assert.match(controller, /Use Preview mode to analyze another GitHub username/);
  assert.match(controller, /allowSignals: !isTemporaryMode/);
  assert.match(controller, /saveResult: !isTemporaryMode/);
  assert.match(controller, /recommendations:preview:/);
  assert.match(controller, /:\$\{signalHash\}:\$\{RECOMMENDATION_ANALYSIS_VERSION\}/);
  assert.match(controller, /if \(isTemporaryMode && !forceRefresh\)[\s\S]{0,1000}return res\.json\(stageTimer\.attach\(normalizeRecommendationResponse\(cachedResult\)\)\)/);
  assert.match(controller, /recommendationInflight\.set\(inflightKey, workPromise\)/);
  assert.match(controller, /workPromise\.finally\(\(\) => recommendationInflight\.delete/);
  assert.match(controller, /mergeNarrativeEnrichment\(fallback, aiEnrichment\)/);
  assert.doesNotMatch(controller, /error: error\.message/);
});

test('saved previews remain owner-scoped and summary-only', () => {
  assert.match(controller, /SavedPreview\.find\(\{ userId: req\.user\._id \}\)/);
  assert.match(controller, /findOneAndDelete\(\{ _id: req\.params\.id, userId: req\.user\._id \}\)/);
  assert.match(controller, /resultSummary: buildSavedPreviewSummary/);
  assert.doesNotMatch(controller, /resumeText:\s*req\.body/);
});

test('frontend separates profile identities, inline resumes, and duplicate requests', () => {
  assert.match(client, /recommendations:profile:\$\{userId\}:\$\{cleanUsername\}:\$\{cleanStack\}:\$\{cleanLevel\}/);
  assert.match(client, /inlineResumeIdentity/);
  assert.match(client, /this\.inflight\.get\(key\)/);
  assert.match(client, /shareReplay\(\{ bufferSize: 1, refCount: false \}\)/);
  assert.match(client, /savedPreviewListRequest/);
  assert.match(client, /cacheSavedPreview/);
  assert.match(client, /removeSavedPreviewFromCache/);
});

test('UI has seven primary tabs and safe score rendering', () => {
  const declaration = component.match(/readonly sections: AdvisorSection\[\] = \[([\s\S]*?)\];/)[1];
  assert.equal((declaration.match(/'/g) || []).length / 2, 7);
  assert.match(component, /Number\.isFinite\(Number\(value\)\)/);
  assert.match(component, /if \(!preview \|\| this\.isLoading\) return/);
  assert.match(component, /if \(!this\.result \|\| !this\.isTemporaryView \|\| !this\.isAuthenticated \|\| this\.isSavingPreview\) return/);
  assert.match(component, /openSavedPreview[\s\S]{0,1300}this\.applyResult/);
});
