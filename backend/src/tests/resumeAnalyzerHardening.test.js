'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const ResumeAnalysisCache = require('../models/resumeAnalysisCache');
const aiService = require('../services/aiservice');
const { __test: controllerTest } = require('../controllers/resumecontoller');
const { analyzeResume, clearResumeAnalysisMemoryCache, __test: serviceTest } = require('../services/resumeservice');

test('parseResumeFileId rejects missing and malformed ids', () => {
  assert.throws(() => controllerTest.parseResumeFileId(''), /fileId is required/);
  assert.throws(() => controllerTest.parseResumeFileId('not-an-object-id'), /Invalid fileId/);
  const valid = new mongoose.Types.ObjectId();
  assert.equal(controllerTest.parseResumeFileId(String(valid)), String(valid));
});

test('canReadResumeAnalysisForUser blocks cross-user IDOR reads', () => {
  const ownerId = new mongoose.Types.ObjectId();
  const otherId = new mongoose.Types.ObjectId();
  assert.equal(controllerTest.canReadResumeAnalysisForUser({ _id: ownerId }, ownerId), true);
  assert.equal(controllerTest.canReadResumeAnalysisForUser({ _id: ownerId }, otherId), false);
});

test('sanitizeClientMessage hides filesystem and stack details', () => {
  const sanitized = controllerTest.sanitizeClientMessage(
    new Error('ENOENT: no such file C:\\Users\\secret\\uploads\\resume.pdf'),
    'Server Error'
  );
  assert.equal(sanitized, 'Server Error');
});

test('missing PDF analyze errors map to safe 404 client messaging', () => {
  const missing = new Error('ENOENT: no such file');
  missing.code = 'ENOENT';
  const mapped = controllerTest.sanitizeClientMessage(missing, 'Resume file is missing or unreadable. Please upload the PDF again.');
  assert.match(mapped, /missing|unreadable|Server Error/i);
});

test('polluted AI narrative fields are ignored for resume insights', async (t) => {
  const originalRunAIAnalysis = aiService.runAIAnalysis;
  t.after(() => { aiService.runAIAnalysis = originalRunAIAnalysis; });
  aiService.runAIAnalysis = async () => ({
    focusAreas: ['quantified_impact', 'invented_area'],
    resumeSummary: 'Fabricated employer history',
    strengths: ['Fake strength'],
    concerns: ['Fake concern'],
    hiringReadiness: 'Strong'
  });

  const result = await serviceTest.buildDeterministicAnalysis({
    text: [
      'Jane Developer',
      'jane@example.com',
      'EXPERIENCE',
      'Built Node.js APIs and reduced latency by 30% for 100 users.',
      'SKILLS',
      'Node.js'
    ].join('\n'),
    fileName: 'resume.pdf',
    fileSize: 1024
  });

  assert.equal(result.aiInsights.aiUsed, false);
  assert.deepEqual(result.aiInsights.strengths, []);
  assert.equal(String(result.recruiterPerspective.resumeSummary || '').includes('Fabricated'), false);
});

test('failed refresh does not write a new cache entry', async (t) => {
  clearResumeAnalysisMemoryCache();
  const originalFindOne = ResumeAnalysisCache.findOne;
  const originalFindOneAndUpdate = ResumeAnalysisCache.findOneAndUpdate;
  const originalRunAIAnalysis = aiService.runAIAnalysis;
  t.after(() => {
    ResumeAnalysisCache.findOne = originalFindOne;
    ResumeAnalysisCache.findOneAndUpdate = originalFindOneAndUpdate;
    aiService.runAIAnalysis = originalRunAIAnalysis;
  });

  let cacheWrites = 0;
  ResumeAnalysisCache.findOne = () => {
    const chain = {
      select() { return chain; },
      lean: async () => null
    };
    return chain;
  };
  ResumeAnalysisCache.findOneAndUpdate = async () => { cacheWrites += 1; return {}; };
  aiService.runAIAnalysis = async (_prompt, fallback) => fallback;

  await analyzeResume(
    'Jane Developer\nEXPERIENCE\nBuilt APIs.\nSKILLS\nNode.js',
    'resume.pdf',
    1024,
    { userId: 'user-a', resumeFileId: 'file-a', forceRefresh: false }
  );
  assert.equal(cacheWrites, 1);

  await assert.rejects(
    () => analyzeResume(
      'Jane Developer\nEXPERIENCE\nBuilt APIs.\nSKILLS\nNode.js',
      'resume.pdf',
      1024,
      {
        userId: 'user-a',
        resumeFileId: 'file-a',
        forceRefresh: true,
        analysisBuilder: async () => { throw new Error('refresh failed'); }
      }
    ),
    /refresh failed/
  );
  assert.equal(cacheWrites, 1);
});

test('non-finite scores are not persisted to resume cache', async (t) => {
  clearResumeAnalysisMemoryCache();
  const originalFindOne = ResumeAnalysisCache.findOne;
  const originalFindOneAndUpdate = ResumeAnalysisCache.findOneAndUpdate;
  t.after(() => {
    ResumeAnalysisCache.findOne = originalFindOne;
    ResumeAnalysisCache.findOneAndUpdate = originalFindOneAndUpdate;
  });

  let cacheWrites = 0;
  ResumeAnalysisCache.findOne = () => {
    const chain = {
      select() { return chain; },
      lean: async () => null
    };
    return chain;
  };
  ResumeAnalysisCache.findOneAndUpdate = async () => { cacheWrites += 1; return {}; };

  await analyzeResume(
    'Jane Developer\nEXPERIENCE\nBuilt APIs.\nSKILLS\nNode.js',
    'resume.pdf',
    1024,
    {
      userId: 'user-b',
      resumeFileId: 'file-b',
      forceRefresh: true,
      analysisBuilder: async () => ({
        atsScore: Number.NaN,
        keywordDensity: 50,
        formatScore: 50,
        contentQuality: 50,
        skills: {},
        resumeHash: 'bad-hash',
        analysisVersion: 'resume-intel-v2',
        cacheMetadata: {}
      })
    }
  );

  assert.equal(cacheWrites, 0);
});
