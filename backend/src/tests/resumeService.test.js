const test = require('node:test');
const assert = require('node:assert/strict');

const ResumeAnalysisCache = require('../models/resumeAnalysisCache');
const ResumeAnalysis = require('../models/resumeAnalysis');
const ResumeFile = require('../models/resumeFile');
const aiService = require('../services/aiservice');
const {
  ANALYSIS_VERSION,
  findCachedResumeAnalysis,
  __test
} = require('../services/resumeservice');

test('experience inference ignores education-only dates', () => {
  const resumeText = 'Education\nUniversity\n2012 - 2016\nSkills\nJavaScript';
  assert.equal(__test.extractExperienceYears(resumeText, ''), 0);
  assert.equal(__test.extractExperienceYears('8 years of experience', ''), 8);
  assert.equal(__test.extractExperienceYears(resumeText, 'Engineer\n2020 - 2024'), 4);
});

test('personal information comes only from resume text', () => {
  const personalInfo = __test.extractPersonalInfo('SUMMARY\nBackend engineer');
  assert.equal(personalInfo.name, '');
  assert.equal(personalInfo.location, '');
  assert.equal(personalInfo.portfolio, '');
});

test('AI focus areas are selected only from deterministic evidence', () => {
  const areas = __test.getApplicableAiFocusAreas({
    normalized: { sectionPresence: { skills: true, projects: false } },
    scores: { contentQuality: 55, keywordCoverage: 60, technicalDepth: 65, recruiterReadiness: 60 },
    warnings: [{ code: 'missing_projects_section' }, { code: 'missing_metrics' }]
  });

  assert.deepEqual(areas, [
    'quantified_impact',
    'project_evidence',
    'keyword_coverage',
    'bullet_clarity',
    'section_structure',
    'technical_depth',
    'recruiter_readiness'
  ]);
});

test('persistent resume cache returns the exact versioned result', async (t) => {
  const originalFindOne = ResumeAnalysisCache.findOne;
  t.after(() => { ResumeAnalysisCache.findOne = originalFindOne; });

  let query;
  ResumeAnalysisCache.findOne = (receivedQuery) => {
    query = receivedQuery;
    return {
      lean: async () => ({
        analyzedAt: new Date('2026-01-01T00:00:00.000Z'),
        result: { atsScore: 77, cacheMetadata: { aiUsed: true } }
      })
    };
  };

  const result = await findCachedResumeAnalysis({
    userId: 'user-id',
    resumeFileId: 'file-id',
    resumeHash: 'resume-hash',
    analysisVersion: ANALYSIS_VERSION
  });

  assert.deepEqual(query, {
    userId: 'user-id',
    resumeFileId: 'file-id',
    resumeHash: 'resume-hash',
    analysisVersion: ANALYSIS_VERSION
  });
  assert.equal(result.atsScore, 77);
  assert.equal(result.cacheMetadata.loadedFromCache, true);
  assert.equal(result.cacheMetadata.cacheHit, true);
  assert.equal(result.cacheMetadata.aiUsed, false);
});

test('unexpected AI failure still returns a usable deterministic analysis', async (t) => {
  const originalRunAIAnalysis = aiService.runAIAnalysis;
  t.after(() => { aiService.runAIAnalysis = originalRunAIAnalysis; });
  aiService.runAIAnalysis = async () => { throw new Error('provider unavailable'); };

  const result = await __test.buildDeterministicAnalysis({
    text: [
      'Jane Developer',
      'jane@example.com',
      'EXPERIENCE',
      'Built Node.js APIs and reduced latency by 30% for 100 users.',
      'PROJECTS',
      'Created an Angular dashboard with TypeScript.',
      'SKILLS',
      'Node.js, Angular, TypeScript'
    ].join('\n'),
    fileName: 'resume.pdf',
    fileSize: 1024
  });

  assert.equal(typeof result.atsScore, 'number');
  assert.ok(result.resumeSignals);
  assert.equal(result.aiInsights.aiUsed, false);
  assert.ok(result.suggestions.length > 0);
});

test('force refresh bypasses the result-cache read and repopulates it', async (t) => {
  const originalFindOne = ResumeAnalysisCache.findOne;
  const originalFindOneAndUpdate = ResumeAnalysisCache.findOneAndUpdate;
  const originalRunAIAnalysis = aiService.runAIAnalysis;
  t.after(() => {
    ResumeAnalysisCache.findOne = originalFindOne;
    ResumeAnalysisCache.findOneAndUpdate = originalFindOneAndUpdate;
    aiService.runAIAnalysis = originalRunAIAnalysis;
  });

  let cacheWritten = false;
  ResumeAnalysisCache.findOne = () => { throw new Error('cache read must be bypassed'); };
  ResumeAnalysisCache.findOneAndUpdate = async () => { cacheWritten = true; return {}; };
  aiService.runAIAnalysis = async (_prompt, fallback) => fallback;

  const result = await require('../services/resumeservice').analyzeResume(
    'Jane Developer\nEXPERIENCE\nBuilt APIs for 100 users.\nSKILLS\nNode.js',
    'resume.pdf',
    1024,
    { userId: 'user-id', resumeFileId: 'file-id', forceRefresh: true }
  );

  assert.equal(result.cacheMetadata.loadedFromCache, false);
  assert.equal(cacheWritten, true);
});

test('resume query indexes cover cache, latest file analysis, and active/default fallbacks', () => {
  const cacheIndexes = ResumeAnalysisCache.schema.indexes().map(([fields]) => fields);
  const analysisIndexes = ResumeAnalysis.schema.indexes().map(([fields]) => fields);
  const fileIndexes = ResumeFile.schema.indexes().map(([fields]) => fields);

  assert.ok(cacheIndexes.some((fields) => JSON.stringify(fields) === JSON.stringify({ userId: 1, resumeFileId: 1, resumeHash: 1, analysisVersion: 1 })));
  assert.ok(analysisIndexes.some((fields) => JSON.stringify(fields) === JSON.stringify({ userId: 1, fileId: 1, analyzedAt: -1 })));
  assert.ok(analysisIndexes.some((fields) => JSON.stringify(fields) === JSON.stringify({ userId: 1, analyzedAt: -1 })));
  assert.ok(fileIndexes.some((fields) => JSON.stringify(fields) === JSON.stringify({ userId: 1, uploadDate: -1 })));
  assert.ok(fileIndexes.some((fields) => JSON.stringify(fields) === JSON.stringify({ userId: 1, isAnalyzed: 1, uploadDate: -1 })));
});
