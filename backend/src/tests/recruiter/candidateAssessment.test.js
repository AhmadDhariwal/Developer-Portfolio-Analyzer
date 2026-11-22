const test = require('node:test');
const assert = require('node:assert/strict');
const User = require('../../modules/auth/models/user');
const Analysis = require('../../modules/skill-gap/models/analysis');
const Resume = require('../../modules/resume/models/resumeAnalysis');
const Profile = require('../../modules/public-portfolio/models/publicProfile');
const Sprint = require('../../modules/career-sprint/models/careerSprint');
const Weekly = require('../../modules/weekly-reports/models/weeklyReport');
const Candidate = require('../../modules/recruiter/models/Candidate');
const Settings = require('../../modules/super-admin/models/platformSettings');
const Audit = require('../../modules/admin/models/auditLog');
const matching = require('../../modules/recruiter/services/matching/matchingService');
const service = require('../../modules/recruiter/services/hub/candidateService');
const {
  measuredScore,
  averageAvailableScores
} = require('../../modules/recruiter/utils/hub/candidateFormatter');

const id = '507f1f77bcf86cd799439011';
const stamp = '2026-11-18T12:00:00.000Z';
const query = (value) => ({
  session() {
    return this;
  },
  select() {
    return this;
  },
  sort() {
    return this;
  },
  lean: async () => value
});

test('only valid measured scores participate; zero is a measurement', () => {
  for (const value of [null, undefined, '', '0', false, NaN, Infinity, -1, 101])
    assert.equal(measuredScore(value), null);
  assert.equal(measuredScore(0), 0);
  assert.equal(averageAvailableScores([null, undefined]), null);
  assert.equal(averageAvailableScores([0, null]), 0);
  assert.equal(averageAvailableScores([0, 80, null]), 40);
});

test('assessment preserves missing/zero evidence, provenance and existing ranking inputs', async (t) => {
  let analysis;
  let resume;
  let visible = true;
  let auditCount = 0;
  t.mock.method(Settings, 'findOne', () => query({ recruiter: { candidateVisibility: 'public' } }));
  t.mock.method(User, 'find', (filter) => {
    assert.equal(filter.isPublic, true);
    assert.deepEqual(filter.isActive, { $ne: false });
    assert.ok(filter.role.$in.includes('developer'));
    return query(visible ? [{ _id: id, name: 'Fixture', email: 'fixture@example.test' }] : []);
  });
  for (const model of [Candidate, Profile, Sprint, Weekly])
    t.mock.method(model, 'find', () => query([]));
  t.mock.method(Analysis, 'find', () => query(analysis ? [{ userId: id, ...analysis }] : []));
  t.mock.method(Resume, 'find', () => query(resume ? [{ userId: id, ...resume }] : []));
  t.mock.method(Audit, 'create', async () => {
    auditCount++;
  });
  const assess = () =>
    service.analyzeRecruiterCandidate({ candidateId: id, organizationId: id, recruiterId: id });

  let result = await assess();
  assert.equal(result.availableSignalScore, null);
  assert.equal(result.confidenceScore, null);
  assert.deepEqual(
    result.evidence.map((entry) => entry.score),
    [null, null, null]
  );
  assert.deepEqual(result.strengths, []);
  assert.match(result.summary, /does not establish low ability/);

  // A schema-default zero without GitHub analysis provenance is not measured evidence.
  analysis = { githubScore: 0 };
  assert.equal((await assess()).evidence[1].score, null);

  analysis = { githubScore: 0, githubSignals: { analyzedAt: stamp } };
  resume = { atsScore: 0, keywordDensity: 0, formatScore: 0, contentQuality: 0, analyzedAt: stamp };
  result = await assess();
  assert.equal(result.availableSignalScore, 0);
  assert.ok(result.evidence.every((entry) => entry.available));
  assert.equal(result.evidence[1].recordedAt, stamp);
  assert.equal(result.evidence[2].recordedAt, stamp);

  analysis = { githubScore: 80, githubSignals: { analyzedAt: stamp } };
  resume = undefined;
  result = await assess();
  assert.equal(result.availableSignalScore, 52); // (existing readiness 24 + GitHub 80) / 2
  assert.equal(result.evidence[2].score, null);

  resume = { atsScore: 40, analyzedAt: stamp };
  result = await assess();
  assert.equal(result.availableSignalScore, 49); // (27 + 80 + 40) / 3
  const rankedInput = (await matching.getCandidatesByIds([id], { organizationId: id })).get(id);
  assert.equal(rankedInput.resumeScore, 10, 'Existing matching calculation remains unchanged');
  assert.equal(rankedInput.score, 27);
  assert.equal(result.assessmentType, 'deterministic');
  assert.match(result.scoreExplanation, /neither statistical confidence nor a job-match score/);
  const before = auditCount;
  visible = false;
  assert.equal(await assess(), null);
  assert.equal(auditCount, before, 'An unavailable/private candidate is never assessed');
});
