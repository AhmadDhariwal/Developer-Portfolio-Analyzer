const test = require('node:test');
const assert = require('node:assert/strict');
const writes = [];
const archives = [];
let selectedReads = 0;
let cached = null;
const mock = (path, value) => {
  const id = require.resolve(path);
  require.cache[id] = { id, filename: id, loaded: true, exports: value };
};
const resume = {
  _id: 'selected-analysis',
  atsScore: 0,
  keywordDensity: 0,
  formatScore: 0,
  contentQuality: 0,
  skills: {},
};
const github = {
  repoCount: 1,
  scores: { codeQuality: 80, projectImpact: 10, consistency: 20, contribution: 30 },
};
mock('../services/developerContextService', {
  resolveGithubUsername: () => 'dev',
  resolveCareerStack: () => 'Backend',
  resolveExperienceLevel: () => 'Student',
  resolveResumeAnalysis: async () => {
    selectedReads += 1;
    return resume;
  },
});
mock('../services/developerSignalService', {
  buildResumeCacheIdentity: () => ({ resumeHash: 'canonical-hash', resumeAnalysisId: resume._id }),
});
mock('../services/skillGapCacheContract', {
  buildScope: () => ({ analysisVersion: 'skill-gap', userId: 'owner' }),
  coverage: (value) => value ?? null,
});
mock('../services/aiservice', {
  runAIAnalysis: async () => ({ overallScore: 99, summary: 'Narrative only' }),
});
mock('../prompts/portfolioScorePrompt', { getPortfolioScorePrompt: () => 'Test prompt' });
mock('../services/githubservice', { analyzeGitHubProfile: async () => github });
mock('../services/integrationInsightService', {
  getIntegrationInsight: async () => ({ integrationScore: 0, providers: [] }),
});
mock('../services/aiVersionService', {
  createVersion: async (value) => archives.push({ ...value, trustedWriter: false }),
  createPortfolioVersion: async (value) => archives.push({ ...value, trustedWriter: true }),
});
mock('../models/analysisCache', {
  findOne: (filter) => ({
    then: (resolve) => Promise.resolve(cached).then(resolve),
    lean: async () =>
      filter.analysisVersion === 'skill-gap' ? { analysisData: { coverage: 0 } } : null,
  }),
  findOneAndUpdate: async (key, update) => {
    writes.push({ key, update });
  },
});
const { getPortfolioReadiness } = require('../controllers/analysiscontroller');
const request = async (body) => {
  let result;
  await getPortfolioReadiness(
    { user: { _id: 'owner' }, body },
    {
      json: (value) => {
        result = value;
      },
      status: (code) => {
        throw Error('Unexpected HTTP ' + code);
      },
    },
  );
  return result;
};
test('profile portfolio scoring shares Dashboard selected-resume identity and canonical zero coverage', async () => {
  selectedReads = 0;
  const result = await request({});
  assert.equal(selectedReads, 1);
  assert.equal(writes.at(-1).key.resumeHash, 'canonical-hash');
  assert.equal(writes.at(-1).key.resumeAnalysisId, 'selected-analysis');
  assert.equal(writes.at(-1).key.analysisVersion, 'portfolio-score-v1');
  assert.equal(result.overallScore, 32);
  assert.equal(result.breakdown.skillCoverage, 0);
  assert.equal(result.breakdown.industryReadiness, 0);
  assert.equal(archives.at(-1).trustedWriter, true);
  assert.equal(archives.at(-1).provenance.resumeAnalysisId, resume._id);
  assert.equal(archives.at(-1).provenance.ruleVersion, result.scoring.ruleVersion);
  assert.match(archives.at(-1).provenance.sourceRevisionHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(
    writes.at(-1).update.$set['analysisData.portfolioProvenance'],
    archives.at(-1).provenance,
  );
});
test('explicit client-supplied preview inputs cannot acquire a canonical selected-resume cache identity', async () => {
  selectedReads = 0;
  await request({ githubAnalysis: github, resumeAnalysis: resume, resumeText: 'manual preview' });
  assert.equal(selectedReads, 0);
  assert.notEqual(writes.at(-1).key.resumeHash, 'canonical-hash');
  assert.equal(writes.at(-1).key.resumeAnalysisId, undefined);
  assert.equal(archives.at(-1).trustedWriter, false);
  assert.equal(archives.at(-1).provenance, undefined);
});

test('cache hits retain the original assessment time/hash and never upgrade legacy scores', async () => {
  await request({});
  const assessment = archives.at(-1);
  cached = {
    analysisData: {
      portfolioScore: assessment.outputJson,
      portfolioProvenance: assessment.provenance,
      portfolioIntegrationRevision: JSON.stringify([null, 0, []]),
    },
  };
  try {
    await request({});
    assert.equal(archives.at(-1).metadata.fromCache, true);
    assert.deepEqual(archives.at(-1).provenance, assessment.provenance);
    delete cached.analysisData.portfolioProvenance;
    await request({});
    assert.equal(archives.at(-1).trustedWriter, false);
    assert.equal(archives.at(-1).provenance, undefined);
  } finally {
    cached = null;
  }
});
