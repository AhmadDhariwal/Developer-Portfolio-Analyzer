const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { fingerprint, readStableDashboard } = require('../services/dashboardConsistencyService');
const { comparableHistory } = require('../services/dashboardHistoryService');
const { buildDashboardProgress } = require('../services/dashboardProgressService');

test('canonical revision hashing ignores object key order but includes same-time fact changes and identity', () => {
  assert.equal(fingerprint({ a: 1, b: 2 }), fingerprint({ b: 2, a: 1 }));
  assert.notEqual(fingerprint({ at: 'same', value: 0 }), fingerprint({ at: 'same', value: null }));
  assert.notEqual(fingerprint({ owner: 'a' }), fingerprint({ owner: 'b' }));
});
test('optimistic reader retries an unstable pair, then returns only a validated result', async () => {
  let count = 0;
  const values = [{ scope: 'old' }, { scope: 'new' }, { scope: 'new' }, { scope: 'new' }];
  const result = await readStableDashboard(async () => values[count++]);
  assert.equal(count, 4);
  assert.equal(result.scope, 'new');
});
test('continuous writes fail closed after four reads instead of publishing a mixed snapshot', async () => {
  let count = 0;
  await assert.rejects(
    readStableDashboard(async () => ({ revision: count++ })),
    { status: 409, code: 'DASHBOARD_EVIDENCE_CHANGED' },
  );
  assert.equal(count, 4);
});
test('concurrent readers share no per-user mutable state', async () => {
  const values = await Promise.all(
    Array.from({ length: 20 }, (_, owner) => readStableDashboard(async () => ({ owner }))),
  );
  assert.equal(new Set(values.map((row) => row.revision)).size, 20);
});
test('durable trends require exact source identity, selected resume and scoring rule; measured zero is retained', () => {
  const identity = {
    githubUsername: 'dev',
    careerStack: 'Backend',
    experienceLevel: 'Student',
    resumeAnalysisId: 'r1',
  };
  const row = {
    _id: 'a',
    createdAt: '2026-01-01',
    provenance: {
      ...identity,
      producer: 'portfolio-score-v1',
      ruleVersion: 'portfolio-score-v1',
      sourceRevisionHash: 'b'.repeat(64),
      assessedAt: '2026-01-01',
      assessmentHash: 'a'.repeat(64),
    },
    outputJson: {
      portfolioScore: { overallScore: 0, scoring: { ruleVersion: 'portfolio-score-v1' } },
    },
  };
  assert.equal(
    comparableHistory([row, { ...row, _id: 'cached-copy' }], identity, 'portfolio-score-v1').length,
    1,
  );
  assert.equal(comparableHistory([row], identity, 'portfolio-score-v1')[0].value, 0);
  assert.equal(
    comparableHistory([row], { ...identity, resumeAnalysisId: 'r2' }, 'portfolio-score-v1').length,
    0,
  );
  assert.equal(comparableHistory([row], identity, 'other-v1').length, 0);
  assert.equal(
    comparableHistory([{ ...row, provenance: {} }], identity, 'portfolio-score-v1').length,
    0,
  );
});
test('velocity does not assign undated completions to today and evidence aliases do not double count', () => {
  const result = buildDashboardProgress(
    {
      latestCareerSprint: { tasks: [{ _id: '1', points: 9, isCompleted: true }] },
      sourceFreshness: {
        weekly: { available: true },
        weeklyReports: { available: true, status: 'fresh' },
      },
      history: {},
    },
    new Date('2026-11-12'),
  );
  assert.equal(result.sprint.undatedCompletions, 1);
  assert.equal(
    result.sprint.velocity.reduce((sum, day) => sum + day.points, 0),
    0,
  );
  assert.equal(result.evidence.totalSources, 1);
});
test('latency alert compares millisecond histogram values with 1800 milliseconds, not 1.8', () => {
  const rules = fs.readFileSync(
    require.resolve('../../observability/prometheus-alerts.yml'),
    'utf8',
  );
  assert.match(rules, /dpa_http_request_duration_ms_bucket.*> 1800/);
  assert.doesNotMatch(rules, /> 1\.8(?:\s|$)/);
  assert.match(rules, /P95 latency is above 1\.8s/);
});

test('client-authored AI-version metadata cannot authenticate portfolio history', () => {
  const identity = {
    githubUsername: 'dev',
    careerStack: 'Backend',
    experienceLevel: 'Student',
    resumeAnalysisId: 'r1',
  };
  const forged = {
    _id: 'forged',
    createdAt: '2026-11-01',
    source: 'portfolio_score',
    metadata: { ...identity, username: 'dev', producer: 'portfolio-score-v1' },
    outputJson: { overallScore: 100, scoring: { ruleVersion: 'portfolio-score-v1' } },
  };
  assert.deepEqual(comparableHistory([forged], identity, 'portfolio-score-v1'), []);
});
