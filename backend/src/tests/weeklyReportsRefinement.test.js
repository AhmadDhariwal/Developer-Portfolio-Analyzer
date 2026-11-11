const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const evidence = require('../services/weeklyReportEvidence');
const presentation = require('../services/weeklyReportPresentation');
const pdf = require('../services/weeklyReportPdfService');
const parse = require('pdf-parse');
const { __test: helpers } = require('../services/weeklyReportService');
const Report = require('../models/weeklyReport');

function snapshot() {
  return {
    _id: '000000000000000000000001',
    userId: '000000000000000000000002',
    weekStartDate: '2026-11-02T00:00:00Z',
    weekEndDate: '2026-11-08T23:59:59Z',
    score: 0,
    progressSummary: 'Résumé evidence establishes a saved baseline.',
    predictedHiringReadiness: { score: 0, reason: 'Planning indicator.' },
    topAchievements: ['Observed a genuine zero score.'],
    insights: ['No fabricated progress.'],
    recommendations: ['Refresh missing evidence.'],
    biggestRiskArea: 'Incomplete evidence.',
    meta: {
      version: 2,
      reportHash: 'a'.repeat(64),
      evidence: {
        scoreAvailable: false,
        inputs: {
          github: { available: true, value: 0 },
          sprint: { available: false, value: null },
        },
      },
      scoreBreakdown: {
        github: { label: 'GitHub', score: 0, weight: 30 },
        sprint: { label: 'Sprint', score: 0, weight: 20 },
      },
      comparison: { available: false, reason: 'No adjacent reporting week.' },
      dataSourcesUsed: {
        learning: {
          available: false,
          status: 'No tracked learning',
          freshness: 'unavailable',
        },
        interviewPrep: {
          analyzed: true,
          status: 'No activity this week',
          freshness: 'stale',
          lastAnalyzedAt: '2026-10-01T00:00:00Z',
        },
      },
      provenance: { timezone: 'UTC' },
      sprint: { tasksTotal: 0, completionRate: 0 },
      activity: {
        commits: 470,
        activeRepositories: 0,
        weeklyCommitSignal: null,
      },
    },
  };
}
test('470 lifetime commits are never inferred as weekly activity or repository updates', () => {
  const result = evidence.activity(
    [{ commits: 470, lastUpdated: '2026-10-01' }],
    new Date('2026-11-02'),
    new Date('2026-11-09'),
  );
  assert.equal(result.commits, 470);
  assert.equal(result.weeklyCommitSignal, null);
  assert.equal(result.activeRepositories, 0);
});
test('missing inputs and 0/0 sprint are not measured zero, while a saved zero remains zero', () => {
  const result = evidence.assess({
    analysis: { githubScore: 0 },
    resume: null,
    graph: null,
    sprint: { tasks: [] },
    interviewPresent: true,
    scores: { github: 0, interview: 0 },
  });
  assert.equal(result.inputs.github.value, 0);
  assert.equal(result.inputs.interview.value, 0);
  assert.equal(result.inputs.resume.value, null);
  assert.equal(result.inputs.sprint.value, null);
  assert.equal(result.scoreAvailable, false);
  assert.equal(result.inputs.resume.reason, 'Missing evidence');
  assert.equal(result.inputs.sprint.reason, 'No tasks to assess');
});
test('weights and mathematical score remain 30/25/20/15/10', () => {
  const keys = [
    'githubScore',
    'resumeScore',
    'sprintCompletionRate',
    'interviewSignal',
    'skillCoverage',
  ];
  const expected = [30, 25, 20, 15, 10];
  for (let index = 0; index < keys.length; index++)
    assert.equal(
      helpers.computeOverallScore(
        Object.fromEntries(keys.map((key, position) => [key, position === index ? 100 : 0])),
      ),
      expected[index],
    );
});
test('only the immediately preceding reporting window qualifies for comparison', () => {
  const week = {
    start: new Date('2026-11-02'),
    end: new Date('2026-11-08T23:59:59.999Z'),
  };
  assert.equal(evidence.adjacent({ weekStartDate: week.start, weekEndDate: week.end }, week), true);
  assert.equal(
    evidence.adjacent({ weekStartDate: '2026-09-01', weekEndDate: '2026-09-07' }, week),
    false,
  );
});
test('old interview history is available with zero current activity; tracked learning remains owner collector evidence', () => {
  const sources = helpers.buildDataSourcesUsed({
    recommendations: [],
    currentInterviewSessions: [],
    latestInterviewSession: { updatedAt: '2026-10-01' },
    integrationConnections: [],
    courseProgress: [{ updatedAt: '2026-11-09' }],
  });
  assert.equal(sources.interviewPrep.analyzed, true);
  assert.equal(sources.interviewPrep.status, 'No activity this week');
  assert.equal(sources.interviewPrep.freshness, 'stale');
  assert.equal(sources.learning.available, true);
});
test('practice on an older session is not counted as newly generated questions', () => {
  const result = helpers.buildInterviewSnapshot(
    [{ createdAt: '2026-10-01', updatedAt: '2026-11-03', questions: [{}, {}] }],
    new Date('2026-11-02'),
    new Date('2026-11-09'),
  );
  assert.deepEqual(result, { sessions: 1, questionsGenerated: 0 });
});
test('email renders the saved version, evidence gaps and sanitized content without zeros for missing evidence', () => {
  const saved = snapshot();
  saved.progressSummary = '<img src=x onerror=alert(1)>';
  saved.meta.evidence.inputs.sprint.reason = 'No tasks to assess';
  const body = presentation.email(
    saved,
    '<script>fixture</script>',
    'https://example.invalid/app/weekly-reports?report=one&version=two',
  );
  assert.ok(body.html.includes('&lt;script&gt;'));
  assert.ok(!body.html.includes('<script>'));
  assert.ok(!body.html.includes('<img src=x'));
  assert.ok(!body.html.includes('Version 2'));
  assert.ok(!body.html.includes('Snapshot Verification'));
  assert.ok(!body.html.includes('Content hash:'));
  assert.ok(!body.text.includes('Version 2'));
  assert.ok(body.html.includes('padding-bottom:24px'));
  assert.ok(body.html.includes('Not assessed'));
  assert.ok(body.html.includes('No tasks to assess'));
  assert.ok(body.html.includes('Learning Hub'));
  assert.ok(body.html.includes('Readiness indicator'));
  assert.ok(!body.text.includes(saved.meta.reportHash));
});
test('PDFs retain snapshot identity, Unicode typography and readable multipage content', async () => {
  const saved = snapshot();
  const before = JSON.stringify(saved);
  const buffer = await pdf.render(saved);
  assert.equal(buffer.subarray(0, 5).toString(), '%PDF-');
  const parsed = await parse(buffer);
  assert.ok(parsed.text.includes('Not assessed'));
  assert.ok(parsed.text.includes('470 lifetime'));
  assert.ok(parsed.text.includes('Résumé'));
  assert.ok(parsed.text.includes(saved.meta.reportHash));
  assert.equal(JSON.stringify(saved), before);
  const directory = path.join(__dirname, '../../verification/weekly-reports/refinement-2026-11-11');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'snapshot.pdf'), buffer);
  saved.insights = Array.from(
    { length: 24 },
    (_, index) =>
      `Evidence ${index + 1}: ` +
      'This is a long synthetic saved statement used to verify readable wrapping and pagination. '.repeat(
        9,
      ),
  );
  const long = await pdf.render(saved);
  const pages = await parse(long);
  assert.ok(pages.numpages >= 3);
  assert.ok(pages.numpages < 15);
  assert.ok(pages.text.includes('Evidence 24:'));
  assert.ok(pages.text.includes('Source freshness at assessment'));
  assert.ok(pages.text.includes('Interview Prep'));
  assert.ok(pages.text.includes('Readiness indicator'));
  fs.writeFileSync(path.join(directory, 'pagination.pdf'), long);
});
test('new evidence and revision metadata survive report persistence', () => {
  const report = new Report(snapshot());
  assert.equal(report.meta.evidence.inputs.sprint.value, null);
  assert.equal(report.meta.version, 2);
});
