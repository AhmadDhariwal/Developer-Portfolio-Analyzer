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
const promptSource = read('backend','src','prompts','recommendationPrompt.js');
const { extractSkillsFromText, canonicalizeSkillName } = require('../utils/skilldetector');
const {
  resolveRecommendationEnrichment,
  mergeNarrativeEnrichment,
  isUsableRecommendationNarrative,
  hasRecommendationFactPollution
} = require('../controllers/recommendationscontroller');

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

const sampleFallback = {
  analysisSummary: 'Backend engineer with React and SQL gaps needs focused proof projects.',
  projects: [
    {
      id: 'p_1',
      title: 'Backend SQL Builder',
      description: 'Ship a scoped backend project that proves SQL.',
      whyThisProject: 'Addresses SQL proof gap for Backend stack.',
      tech: ['Node.js'],
      newTech: ['SQL']
    }
  ],
  technologies: [{ name: 'SQL', description: 'Priority gap for Backend roles.' }],
  careerPaths: [{
    id: 'c_1',
    title: 'Backend Engineer',
    description: 'Primary Backend path.',
    actionItems: ['Convert SQL into a shipped project']
  }],
  portfolioRecommendations: ['Add working live links for your strongest public projects'],
  resumeRecommendations: ['Add quantified impact bullets for your most relevant projects'],
  learningActions: ['Practice SQL inside a real repository rather than isolated notes only'],
  interviewReadinessActions: ['Practice explaining one shipped project end-to-end']
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
  assert.match(controller, /recommendations:result/);
  assert.match(controller, /cacheLayer: 'memory'/);
  assert.match(controller, /cacheLayer: 'redis'/);
  assert.match(controller, /cacheLayer: 'mongo'/);
  assert.match(controller, /resolveRecommendationEnrichment\(/);
  assert.match(controller, /mergeNarrativeEnrichment\(fallback, enrichment\)/);
  assert.match(controller, /returnMeta:\s*true/);
  assert.match(controller, /parseGitHubUsername/);
  assert.match(controller, /readRecommendationMemory/);
  assert.match(controller, /withBudget\(/);
  assert.match(controller, /RECOMMENDATION_REDIS_LOOKUP_BUDGET_MS/);
  assert.match(controller, /recommendationInflight\.set\(inflightKey, workPromise\)/);
  assert.match(controller, /recommendationInflight\.get\(inflightKey\) === workPromise/);
  assert.match(controller, /voidRecommendationNotification/);
  assert.match(controller, /isPersistableRecommendationResult/);
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

test('failed refresh preserves previous valid result in the frontend component', () => {
  assert.match(component, /const previousResult = this\.result/);
  assert.match(component, /preservePrevious/);
  assert.match(component, /if \(preservePrevious && previousResult\)/);
  assert.match(component, /this\.loadingState = forceRefresh \? 'stale' : 'error'/);
  assert.equal(component.includes('this.result = null;\n        this.cdr.detectChanges();\n      }\n    });\n  }'), false);
});

test('polluted low-quality and ungrounded AI enrichment is rejected', () => {
  const context = {
    aiOk: true,
    careerStack: 'Backend',
    experienceLevel: 'Intern',
    anchors: ['SQL', 'Node.js', 'Backend SQL Builder']
  };

  assert.equal(isUsableRecommendationNarrative('As an AI language model I recommend synergy.'), false);
  assert.equal(hasRecommendationFactPollution({
    analysisSummary: 'Backend SQL progress looks strong for Intern level.',
    projects: [{ title: 'Injected' }],
    readinessScore: 99
  }), true);

  for (const polluted of [
    {
      analysisSummary: 'As an AI I think you should learn quantum computing immediately.',
      projectNarratives: [{ id: 'p_1', description: 'placeholder', whyThisProject: 'todo' }],
      projects: [{ title: 'Fake Project', impact: 99 }],
      recommendationScores: { overallRecommendationScore: 99 }
    },
    {
      analysisSummary: 'Leverage synergies in today\'s digital landscape for cutting-edge solutions across everything.',
      projectNarratives: [{ id: 'p_1', description: 'Generic filler without signal grounding at all.', whyThisProject: 'Because growth mindset.' }]
    },
    {
      analysisSummary: 'Quantum entanglement mentoring will transform your brand narrative overnight without evidence.',
      technologyNarratives: [{ name: 'SQL', description: 'Quantum entanglement mentoring will transform your brand.' }]
    }
  ]) {
    const enrichment = resolveRecommendationEnrichment(polluted, sampleFallback, context);
    assert.equal(enrichment.aiUsed, false);
    assert.equal(enrichment.analysisSummary, '');
    assert.equal(enrichment.projectNarratives.length, 0);
  }

  const grounded = resolveRecommendationEnrichment({
    analysisSummary: 'Backend Intern progress should prioritize SQL proof through a focused Node.js project.',
    projectNarratives: [{
      id: 'p_1',
      title: 'Should Not Override Title',
      description: 'Build a Backend SQL service that proves query design with Node.js.',
      whyThisProject: 'This closes the SQL proof gap for a Backend Intern profile.'
    }],
    technologyNarratives: [{
      name: 'SQL',
      description: 'SQL remains the highest-value Backend gap for this Intern profile.'
    }],
    careerPathNarratives: [{
      id: 'c_1',
      title: 'Should Not Override Path',
      description: 'Stay on the Backend Engineer path while converting SQL into shipped proof.',
      actionItems: ['Ship one Backend SQL project this month']
    }],
    portfolioRecommendations: ['Publish the Backend SQL project with a live demo link'],
    resumeRecommendations: ['Mention the Backend SQL project outcome with metrics'],
    learningActions: ['Practice SQL joins inside a Backend Node.js repository'],
    interviewReadinessActions: ['Explain the Backend SQL tradeoffs from your shipped project']
  }, sampleFallback, context);

  assert.equal(grounded.aiUsed, true);
  assert.match(grounded.analysisSummary, /SQL/);
  assert.equal(grounded.projectNarratives[0].id, 'p_1');
  assert.equal(grounded.projectNarratives[0].title, undefined);

  const merged = mergeNarrativeEnrichment(sampleFallback, grounded);
  assert.equal(merged.projects[0].title, 'Backend SQL Builder');
  assert.equal(merged.careerPaths[0].title, 'Backend Engineer');
  assert.match(merged.projects[0].description, /SQL/);
  assert.equal(merged.aiUsed, true);
});

test('AI timeout and fallback markers never mark aiUsed or override deterministic titles', () => {
  const failed = resolveRecommendationEnrichment(null, sampleFallback, {
    aiOk: false,
    careerStack: 'Backend',
    experienceLevel: 'Intern',
    anchors: ['SQL']
  });
  assert.equal(failed.aiUsed, false);

  const marker = resolveRecommendationEnrichment({ __fallback: true, analysisSummary: 'Backend SQL Intern summary with enough length for narrative checks.' }, sampleFallback, {
    aiOk: true,
    careerStack: 'Backend',
    experienceLevel: 'Intern',
    anchors: ['SQL']
  });
  assert.equal(marker.aiUsed, false);

  const merged = mergeNarrativeEnrichment(sampleFallback, failed);
  assert.equal(merged.projects[0].title, 'Backend SQL Builder');
  assert.equal(merged.aiUsed, false);
});

test('prompt remains narrative-only and schema-bound', () => {
  assert.match(promptSource, /projectNarratives/);
  assert.match(promptSource, /Do not calculate or return scores/);
  assert.match(promptSource, /Do not rename projects or career paths/);
  assert.match(promptSource, /Never return projects, technologies, careerPaths, recommendationScores/);
  assert.equal(promptSource.includes('"impact"'), false);
  assert.equal(promptSource.includes('"recommendationScores"'), false);
  assert.doesNotMatch(promptSource, /"title": string,\s*"description": string,\s*"whyThisProject"/);
});

test('notification dedupe uses cache signal hash and invalid usernames are rejected by handlers', () => {
  assert.match(controller, /dedupeKey: `recommendations:\$\{signalHash \|\| 'latest'\}/);
  assert.match(controller, /parseGitHubUsername\(isTemporaryMode \? githubUsername : activeGithub\)/);
  assert.match(controller, /parseGitHubUsername\(activeGithub\)/);
  assert.match(controller, /Target stack must be one of/);
  assert.match(controller, /Experience level must be one of/);
});
