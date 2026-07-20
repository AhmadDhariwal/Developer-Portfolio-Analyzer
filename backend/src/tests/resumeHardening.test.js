const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const aiService = require('../services/aiservice');
const ResumeAnalysisCache = require('../models/resumeAnalysisCache');
const { ANALYSIS_VERSION, extractTextFromPDF, findCachedResumeAnalysis, __test } = require('../services/resumeservice');
const source = (relative) => fs.readFileSync(path.resolve(__dirname, '..', relative), 'utf8');
const fixture = ['Jane Developer', 'jane@example.com', '+1 555 123 4567', 'https://linkedin.com/in/jane', 'https://github.com/jane', 'SUMMARY', 'Software engineer with 4 years of experience.', 'EXPERIENCE', 'Built Node.js and TypeScript APIs that reduced latency by 30% for 100 users.', '2020 - 2024', 'PROJECTS', 'Created a Next.js React.js platform using Docker and CI/CD with SQL persistence.', 'SKILLS', 'Java, C++, C#, .NET, Node.js, Next.js, TypeScript, SQL, Docker, CI/CD', 'EDUCATION', 'BSc Computer Science, Example University'].join('\n');
test('extraction fixture keeps Java distinct and recognizes required aliases', () => { const all = Object.values(__test.detectTechnologies(fixture)).flat(); ['Java','C++','C#','Node.js','Next.js','TypeScript','SQL','Docker','CI/CD'].forEach((skill) => assert.ok(all.includes(skill), skill)); assert.ok(!all.includes('JavaScript')); });
test('deterministic scores are finite, bounded, and AI cannot change facts or scores', async (t) => { const original = aiService.runAIAnalysis; t.after(() => { aiService.runAIAnalysis = original; }); let args; aiService.runAIAnalysis = async (...received) => { args = received; return { focusAreas: ['technical_depth'], atsScore: 0, skills: ['Fake'] }; }; const result = await __test.buildDeterministicAnalysis({ text: fixture, fileName: 'resume.pdf', fileSize: 1000 }); ['atsScore','keywordDensity','formatScore','contentQuality'].forEach((key) => assert.ok(Number.isFinite(result[key]) && result[key] >= 0 && result[key] <= 100)); assert.equal(result.experienceYears, 4); assert.ok(!Object.values(result.technologyCategories).flat().includes('Fake')); assert.deepEqual({ retries: args[2], timeoutMs: args[3]?.timeoutMs }, { retries: 0, timeoutMs: 6500 }); });
test('versioned cache identity returns without PDF or AI work', async (t) => { const original = ResumeAnalysisCache.findOne; t.after(() => { ResumeAnalysisCache.findOne = original; }); let query; ResumeAnalysisCache.findOne = (value) => { query = value; return { lean: async () => ({ result: { atsScore: 77 }, analyzedAt: new Date() }) }; }; const value = await findCachedResumeAnalysis({ userId: 'u', resumeFileId: 'f', resumeHash: 'h', analysisVersion: ANALYSIS_VERSION }); assert.deepEqual(query, { userId: 'u', resumeFileId: 'f', resumeHash: 'h', analysisVersion: ANALYSIS_VERSION }); assert.equal(value.cacheMetadata.loadedFromCache, true); });
test('controller enforces PDF signature, ownership, safe paths, clean errors, and development-only timings', () => { const controller = source('controllers/resumecontoller.js'); assert.match(controller, /signature\.toString\('ascii'\) !== '%PDF-'/); assert.match(controller, /resolvedFilePath\.startsWith\(uploadsRoot\)/); assert.match(controller, /String\(userId\) !== String\(req\.user\?\._id/); assert.match(controller, /process\.env\.RESUME_TIMING !== '1'/); assert.match(controller, /Resume analysis could not be completed/); assert.match(controller, /Resume upload could not be completed/); assert.match(controller, /Resume analysis could not be completed/); });
test('cache schema carries user/file/hash/version identity', () => { const index = ResumeAnalysisCache.schema.indexes().find(([keys, options]) => keys.userId === 1 && keys.resumeFileId === 1 && keys.resumeHash === 1 && keys.analysisVersion === 1 && options.unique); assert.ok(index); });
test('isolated parser rejects unreadable PDFs before a result can be scored or cached', async () => {
  const unreadablePath = path.join(require('node:os').tmpdir(), `resume-unreadable-${process.pid}.pdf`);
  fs.writeFileSync(unreadablePath, '%PDF-1.4\nthis is not a parseable PDF');
  try {
    await assert.rejects(() => extractTextFromPDF(unreadablePath), (error) => error?.code === 'RESUME_UNREADABLE_PDF');
  } finally {
    fs.unlinkSync(unreadablePath);
  }
  const service = source('services/resumeservice.js');
  const worker = source('services/resumePdfWorker.js');
  assert.match(service, /spawn\(process\.execPath, \[path\.join\(__dirname, 'resumePdfWorker\.js'\)\]/);
  assert.match(worker, /pdfParse\(Buffer\.concat\(chunks\), \{ max: 0 \}\)/);
});

test('single-flight key and successful persistence sequence are explicit and downstream caches refresh once', () => {
  const controller = source('controllers/resumecontoller.js');
  assert.match(controller, /resumeAnalysisInflight/);
  assert.match(controller, /if \(!resumeAnalysis \|\| forceRefresh\)/);
  assert.match(controller, /resumeAnalysisLookupStartedAt/);
  assert.match(controller, /String\(resumeHash \|\| 'pending'\)/);
  assert.match(controller, /ANALYSIS_VERSION/);
  const saveIndex = controller.indexOf('await resumeAnalysis.save()');
  const cacheIndex = controller.indexOf('await persistResumeAnalysisCache');
  const activeIndex = controller.indexOf('resumeFile.isAnalyzed = true');
  assert.ok(saveIndex >= 0 && saveIndex < cacheIndex && cacheIndex < activeIndex);
  assert.match(controller, /invalidateDashboardSummaryCache\(req\.user\._id\)/);
  assert.match(controller, /invalidateCareerSprintCache\(req\.user\._id\)/);
  assert.match(controller, /invalidateContextCache\(req\.user\._id\)/);
  assert.match(controller, /RESUME_UNREADABLE_PDF' \? 422 : 500/);
});