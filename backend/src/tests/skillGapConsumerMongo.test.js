'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { startMongo } = require('./fixtures/disposableRequestMongo');
const Cache = require('../models/analysisCache');
const contract = require('../services/skillGapCacheContract');
const evidence = require('../services/skillGapEvidenceService');
const requirements = require('../services/skillGapRequirements');

test(
  'real disposable Mongo excludes mismatched current Skill Gap identities and prefers a valid zero/null over newer unrelated rows',
  { timeout: 120000 },
  async (t) => {
    const runtime = await startMongo({ replicaSet: 'skillgap-consumer-review' });
    t.after(async () => {
      await mongoose.disconnect();
      await runtime.stop();
    });
    await mongoose.connect(runtime.uri, { autoIndex: false });
    const userId = new mongoose.Types.ObjectId();
    const user = {
      activeGithubUsername: 'Current-Dev',
      activeCareerStack: 'Backend',
      activeExperienceLevel: 'Student'
    };
    const identity = { resumeHash: 'current-resume-hash', resumeAnalysisId: 'current-analysis' };
    const now = Date.now();
    const base = {
      userId,
      githubUsername: 'current-dev',
      careerStack: 'Backend',
      experienceLevel: 'Student',
      ...identity,
      analysisVersion: contract.ANALYSIS_VERSION,
      createdAt: new Date(now),
      updatedAt: new Date(now),
      analysisData: {
        ruleVersion: evidence.RULE_VERSION,
        evidencePolicyVersion: evidence.EVIDENCE_POLICY_VERSION,
        taxonomyVersion: requirements.TAXONOMY_VERSION,
        requirementMatrixVersion: requirements.MATRIX_VERSION,
        missingSkills: [],
        coverage: 0
      }
    };
    const current = await Cache.collection.insertOne(base);
    const scope = contract.buildScope({ userId, user, resumeIdentity: identity, now });
    const cases = [
      ['foreign-owner', { userId: new mongoose.Types.ObjectId() }],
      ['previous-GitHub', { githubUsername: 'previous-dev' }],
      ['previous-resume-hash', { resumeHash: 'old-hash' }],
      ['previous-resume-analysis', { resumeAnalysisId: 'old-analysis' }],
      ['previous-target', { careerStack: 'Frontend' }],
      ['previous-level', { experienceLevel: 'Intern' }],
      ['previous-producer', { analysisVersion: 'v8-skill-evidence' }],
      ['expired', { createdAt: new Date(now - 8 * 86400000) }],
      ...[
        'ruleVersion',
        'evidencePolicyVersion',
        'taxonomyVersion',
        'requirementMatrixVersion'
      ].map((key) => [key, { analysisData: { ...base.analysisData, [key]: 'obsolete' } }]),
      ['temporary', { analysisData: { ...base.analysisData, cacheMetadata: { temporary: true } } }]
    ];
    for (const [label, change] of cases) {
      const candidate = { ...base, ...change, updatedAt: new Date(now + 1000) };
      delete candidate._id;
      const inserted = await Cache.collection.insertOne(candidate);
      const selected = await Cache.findOne(scope).sort({ updatedAt: -1 }).lean();
      assert.equal(String(selected._id), String(current.insertedId), label);
      assert.equal(selected.analysisData.coverage, 0, label);
      await Cache.collection.deleteOne({ _id: inserted.insertedId });
    }
    await Cache.updateOne({ _id: current.insertedId }, { $set: { 'analysisData.coverage': null } });
    assert.equal((await Cache.findOne(scope).lean()).analysisData.coverage, null);
  }
);
