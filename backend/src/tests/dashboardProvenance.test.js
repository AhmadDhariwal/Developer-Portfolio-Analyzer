const test = require('node:test');
const assert = require('node:assert/strict');
const AIVersion = require('../models/aiVersion');
const { comparableHistory } = require('../services/dashboardHistoryService');
const identity = {
  githubUsername: 'dev',
  careerStack: 'Backend',
  experienceLevel: 'Student',
  resumeAnalysisId: 'no-resume',
};
const provenance = {
  ...identity,
  producer: 'portfolio-score-v1',
  ruleVersion: 'portfolio-score-v1',
  assessedAt: new Date('2026-11-12T00:00:00Z'),
  assessmentHash: 'a'.repeat(64),
  sourceRevisionHash: 'b'.repeat(64),
};
const outputJson = { overallScore: 0, scoring: { ruleVersion: provenance.ruleVersion } };
const base = {
  userId: '507f1f77bcf86cd799439011',
  source: 'portfolio_score',
  version: 1,
  outputJson,
};

test('optional provenance leaves legacy schema records untouched and validates complete server proof', () => {
  const legacy = new AIVersion(base);
  assert.equal(legacy.validateSync(), undefined);
  assert.equal(Object.hasOwn(legacy.toObject(), 'provenance'), false);
  const trusted = new AIVersion({ ...base, provenance });
  assert.equal(trusted.validateSync(), undefined);
  assert.equal(AIVersion.schema.path('provenance').options.immutable, true);
  trusted.$isNew = false;
  trusted.provenance = { ...provenance, githubUsername: 'replacement' };
  assert.equal(trusted.provenance.githubUsername, identity.githubUsername);
  for (const key of Object.keys(provenance)) {
    const partial = { ...provenance };
    delete partial[key];
    assert.ok(new AIVersion({ ...base, provenance: partial }).validateSync(), key);
  }
  assert.ok(
    new AIVersion({ ...base, provenance: { ...provenance, producer: 'client' } }).validateSync(),
  );
  assert.ok(
    new AIVersion({ ...base, provenance: { ...provenance, assessedAt: 'invalid' } }).validateSync(),
  );
});

test('generic public writer discards mass-assigned provenance; internal writer alone forwards it', async () => {
  const originalFind = AIVersion.findOne;
  const originalCreate = AIVersion.create;
  const saved = [];
  AIVersion.findOne = () => ({ sort: () => ({ select: () => ({ lean: async () => null }) }) });
  AIVersion.create = async (row) => {
    saved.push(row);
    return row;
  };
  try {
    const { createVersion, createPortfolioVersion } = require('../services/aiVersionService');
    await createVersion({ ...base, provenance, metadata: { provenance } });
    assert.equal(Object.hasOwn(saved.at(-1), 'provenance'), false);
    await createPortfolioVersion({ ...base, provenance });
    assert.deepEqual(saved.at(-1).provenance, provenance);
    const { createAiVersion, rollbackVersion } = require('../controllers/aiversioncontroller');
    const res = {
      status: (code) => {
        assert.ok(code < 400);
        return res;
      },
      json: (row) => row,
    };
    await createAiVersion(
      { user: { _id: base.userId }, body: { ...base, userId: 'attacker', provenance } },
      res,
    );
    assert.equal(saved.at(-1).userId, base.userId);
    assert.equal(Object.hasOwn(saved.at(-1), 'provenance'), false);
    AIVersion.findOne = (filter) => {
      assert.equal(filter.userId, base.userId);
      return {
        lean: async () => ({ ...base, _id: 'original', provenance }),
        sort: () => ({ select: () => ({ lean: async () => null }) }),
      };
    };
    await rollbackVersion(
      { user: { _id: base.userId }, body: { provenance }, params: { id: 'original' } },
      res,
    );
    assert.equal(Object.hasOwn(saved.at(-1), 'provenance'), false);
    const count = saved.length;
    AIVersion.findOne = (filter) => {
      assert.equal(filter.userId, 'other-owner');
      return { lean: async () => null };
    };
    let status;
    await rollbackVersion(
      { user: { _id: 'other-owner' }, body: { provenance }, params: { id: 'original' } },
      {
        status: (code) => {
          status = code;
          return { json: () => {} };
        },
      },
    );
    assert.equal(status, 404);
    assert.equal(saved.length, count);
  } finally {
    AIVersion.findOne = originalFind;
    AIVersion.create = originalCreate;
  }
});

test('history excludes legacy, scope/rule mismatches and incomplete proof, and deduplicates cache copies', () => {
  const row = { ...base, _id: '1', createdAt: new Date('2026-11-12'), provenance };
  assert.equal(
    comparableHistory([row, { ...row, _id: 'copy' }], identity, provenance.ruleVersion).length,
    1,
  );
  for (const key of Object.keys(identity)) {
    assert.equal(
      comparableHistory([row], { ...identity, [key]: 'different' }, provenance.ruleVersion).length,
      0,
    );
  }
  for (const patch of [
    { provenance: undefined },
    { provenance: { ...provenance, ruleVersion: 'other' } },
    { provenance: { ...provenance, sourceRevisionHash: '' } },
    { outputJson: { ...outputJson, overallScore: null } },
  ]) {
    assert.deepEqual(
      comparableHistory([{ ...row, ...patch }], identity, provenance.ruleVersion),
      [],
    );
  }
  const second = {
    ...row,
    _id: '2',
    provenance: {
      ...provenance,
      assessmentHash: 'c'.repeat(64),
      assessedAt: new Date('2026-11-13'),
    },
    outputJson: { ...outputJson, overallScore: 20 },
  };
  assert.deepEqual(
    comparableHistory([second, row], identity, provenance.ruleVersion).map((p) => p.value),
    [0, 20],
  );
});
