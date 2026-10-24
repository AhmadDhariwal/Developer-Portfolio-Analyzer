'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const scoring = require('../services/scoring');
const { LIMITS } = require('../services/scoring/evidence');
const github = require('../services/scoring/githubHealthScore');
const resume = require('../services/scoring/resumeOverallScore');
const sprint = require('../services/scoring/sprintProgressScore');
const portfolio = require('../services/scoring/portfolioScore');
const { calculateTransparentScore, normalizeTransparentScorePayload } = require('../services/transparentScoringService');
const { numeric, round, clamp, clampScore, safeAverage, safeDivide, normalizeWeights, weightedCalculation } = scoring.math;
const options = { calculatedAt: '2026-10-08T00:00:00.000Z' };
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);

test('clamping uses finite score bounds and protects invalid input', () => {
  assert.equal(clamp(-10), 0);
  assert.equal(clamp(120), 100);
  assert.equal(clamp(42.7), 42.7);
  assert.equal(clampScore(42.7), 43);
  assert.equal(clamp(20, -5, 10), 10);
  for (const value of [NaN, Infinity, -Infinity, null, undefined, '', 'x', {}, []]) assert.equal(clamp(value), 0);
  assert.throws(() => clamp(5, 10, 0), RangeError);
  assert.throws(() => clamp(5, 0, Infinity), RangeError);
});
test('rounding is explicit, reproducible, finite and normalizes negative zero', () => {
  assert.equal(round(42.5), 43);
  assert.equal(round(42.56, 1), 42.6);
  assert.equal(round(-1.25, 1), -1.2); // Preserve JavaScript Math.round convention.
  assert.equal(Object.is(round(-0.1), -0), false);
  assert.equal(round('2.345', 2), 2.35);
  assert.equal(round(Infinity), null);
  assert.equal(round(Number.MAX_VALUE, 6), Number.MAX_VALUE);
  assert.throws(() => round(4, 7), RangeError);
});
test('numeric handling accepts finite numbers/numeric strings, never implicit object or boolean values', () => {
  assert.equal(numeric(0), 0);
  assert.equal(numeric('0'), 0);
  assert.equal(numeric(' 42.5 '), 42.5);
  for (const value of [null, undefined, '', ' ', 'broken', Infinity, NaN, true, false, [], {}, new Date(), { valueOf: () => 75 }]) assert.equal(numeric(value), null);
});
test('safe averages omit unavailable optional values but retain measured zeros', () => {
  assert.equal(safeAverage([80, undefined, null, '', 'bad']), 80);
  assert.equal(safeAverage([80, 0]), 40);
  assert.equal(safeAverage([0, 0]), 0);
  assert.equal(safeAverage([]), null);
  assert.equal(safeAverage(undefined, { fallback: 0 }), 0);
  assert.equal(safeAverage([0, 50], { predicate: value => value > 0 }), 50);
  assert.equal(safeAverage([Number.MAX_VALUE, Number.MAX_VALUE]), Number.MAX_VALUE);
});
test('zero/invalid denominators yield explicit unavailable results', () => {
  assert.equal(safeDivide(0, 10), 0);
  assert.equal(safeDivide(10, 0), null);
  assert.equal(safeDivide(0, 0), null);
  assert.equal(safeDivide('bad', 2), null);
  assert.equal(safeDivide(10, null), null);
  assert.equal(safeDivide(10, 0, 0), 0);
  assert.equal(safeDivide(Number.MAX_VALUE, 0.001), null);
});
test('weight normalization preserves ratios, excludes invalid weights, and handles extreme magnitudes', () => {
  assert.deepEqual(normalizeWeights({ a: 2, b: 3, c: 5 }), { a: 0.2, b: 0.3, c: 0.5 });
  assert.deepEqual(normalizeWeights({ a: 0, b: -1, c: 'bad' }), { a: 0, b: 0, c: 0 });
  assert.deepEqual(normalizeWeights({ a: Number.MAX_VALUE, b: Number.MAX_VALUE }), { a: 0.5, b: 0.5 });
  assert.deepEqual(normalizeWeights({ a: 2, b: null }), { a: 1, b: 0 });
});
test('weighted calculations use caller weights and an available-signal denominator', () => {
  assert.equal(weightedCalculation([{ id: 'a', value: 80, weight: 3 }, { id: 'b', value: 40, weight: 1 }]).value, 70);
  assert.equal(weightedCalculation([{ id: 'a', value: 80, weight: 0.75 }, { id: 'b', value: 40, weight: 0.25 }], { normalize: false }).value, 70);
  const missing = weightedCalculation([{ id: 'a', value: 80, weight: 1 }, { id: 'b', value: null, weight: 1 }]);
  assert.equal(missing.value, 80);
  assert.equal(missing.breakdown.b.available, false);
  assert.equal(missing.breakdown.b.value, null);
  assert.ok(missing.warnings.includes('unavailable_signal:b'));
  assert.equal(weightedCalculation([{ id: 'a', value: 80, weight: 1 }, { id: 'b', value: 0, weight: 1 }]).value, 40);
  assert.equal(weightedCalculation([{ id: 'a', value: 0, weight: 1, available: false }]).value, null);
});
test('duplicate signal ids count once, distinct equal scores remain independent signals', () => {
  const duplicate = weightedCalculation([{ id: 'a', value: 80, weight: 1 }, { id: 'a', value: 80, weight: 1 }, { id: 'b', value: 20, weight: 1 }]);
  assert.equal(duplicate.value, 50);
  assert.deepEqual(duplicate.warnings, ['duplicate_signal:a']);
  near(weightedCalculation([{ id: 'a', value: 80, weight: 1 }, { id: 'b', value: 80, weight: 1 }, { id: 'c', value: 20, weight: 1 }]).value, 60);
  assert.throws(() => weightedCalculation([{ value: 80, weight: 1 }]), TypeError);
});
test('invalid inputs/weights cannot produce NaN or a phantom zero-quality signal', () => {
  const result = weightedCalculation([{ id: 'bad', value: NaN, weight: 1 }, { id: 'negative', value: 80, weight: -1 }, { id: 'good', value: '70', weight: '2' }]);
  assert.equal(result.value, 70);
  assert.equal(result.breakdown.bad.value, null);
  assert.equal(result.breakdown.negative.weight, 0);
  assert.equal(weightedCalculation([]).value, null);
  assert.equal(weightedCalculation([{ id: 'toString', value: null, weight: 1 }]).breakdown.toString.weight, 0);
  const overflow = weightedCalculation([{ id: 'huge', value: Number.MAX_VALUE, weight: Number.MAX_VALUE }], { normalize: false });
  assert.equal(overflow.value, null);
  assert.equal(overflow.breakdown.huge.contribution, null);
});
test('shared results expose bounded scores, unavailable status, explicit ruleVersion and calculatedAt', () => {
  const result = scoring.createScoreResult({ score: 160, ruleVersion: 'test-score-v1', ...options });
  assert.equal(result.score, 100);
  assert.equal(result.ruleVersion, 'test-score-v1');
  assert.equal(result.calculatedAt, options.calculatedAt);
  assert.deepEqual(Object.keys(result), ['score', 'breakdown', 'warnings', 'evidence', 'ruleVersion', 'calculatedAt']);
  assert.equal(scoring.createScoreResult({ score: NaN, ruleVersion: 'test-score-v1', ...options }).score, null);
  assert.throws(() => scoring.createScoreResult({ score: 50 }), TypeError);
  assert.throws(() => scoring.createScoreResult({ score: 50, ruleVersion: 'test-score-v1', calculatedAt: 'broken' }), TypeError);
});
test('evidence is flat, bounded and drops full payloads/text/AI content', () => {
  const blob = 'PRIVATE_FULL_PAYLOAD'.repeat(10000);
  const evidence = scoring.buildEvidence({
    sources: Array.from({ length: 1000 }, (_, i) => ({ type: 'github', id: `${i}-${blob}`, ruleVersion: 'github-health-score-v1', payload: blob })),
    inputs: { quality: 80, measuredZero: 0, missing: null, present: true, resumeText: blob, github: { payload: blob }, aiResponse: blob,
      ...Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [`metric${i}`, i])) },
    facts: { repositoryCount: 4, payload: { blob }, invalid: Infinity }
  });
  assert.equal(evidence.sources.length, LIMITS.sources);
  assert.equal(Object.keys(evidence.inputs).length, LIMITS.metrics);
  assert.deepEqual(Object.keys(evidence.sources[0]), ['type', 'id', 'ruleVersion']);
  assert.equal(evidence.inputs.resumeText, undefined);
  assert.equal(evidence.inputs.github, undefined);
  assert.equal(evidence.inputs.aiResponse, undefined);
  assert.equal(evidence.facts.invalid, undefined);
  assert.ok(Buffer.byteLength(JSON.stringify(evidence)) < 16384);
  assert.deepEqual(scoring.buildEvidence({ sources: [{ type: 'resume', id: 'a' }, { type: 'resume', id: 'a' }] }).sources, [{ type: 'resume', id: 'a' }]);
});
test('result warnings/breakdown are lean and never accept arbitrary nested facts', () => {
  const result = scoring.createScoreResult({ score: 10, ruleVersion: 'test-score-v1', ...options,
    warnings: Array.from({ length: 100 }, (_, i) => `${i}-${'x'.repeat(1000)}`),
    breakdown: Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`signal${i}`, { value: 10, weight: 0.1, contribution: 1, available: true, payload: 'PRIVATE' }])) });
  assert.equal(result.warnings.length, LIMITS.warnings);
  assert.equal(result.warnings[0].length, LIMITS.warningLength);
  assert.equal(Object.keys(result.breakdown).length, LIMITS.breakdown);
  assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
});
test('engines use exact version lookup and deterministic repeatability with a fixed calculation timestamp', () => {
  for (const engine of Object.values(scoring.engines)) {
    assert.equal(scoring.getEngine(engine.RULE_VERSION), engine);
    const input = engine === sprint ? [{ _id: 'a', points: 2, isCompleted: true }] : {};
    assert.deepEqual(engine.calculate(input, options), engine.calculate(input, options));
    assert.equal(engine.calculate(input, options).ruleVersion, engine.RULE_VERSION);
  }
  assert.throws(() => scoring.getEngine('github-health-score-v99'), RangeError);
  assert.throws(() => scoring.getEngine(undefined), RangeError);
});

test('GitHub and Resume migrated aggregates exactly preserve the original formulas across fixed fixtures', () => {
  let seed = 101;
  const next = () => { seed = (seed * 16807) % 2147483647; return seed % 101; };
  for (let i = 0; i < 5000; i += 1) {
    const g = { codeQuality: next(), projectDiversity: next(), contribution: next(), consistency: next(), projectImpact: next(), profileStrength: next() };
    const expectedG = Math.round(g.codeQuality * 0.24 + g.projectDiversity * 0.17 + g.contribution * 0.18 + g.consistency * 0.13 + g.projectImpact * 0.14 + g.profileStrength * 0.14);
    assert.equal(github.calculate(g, options).score, expectedG);
    const r = { atsScore: next(), keywordDensity: next(), formatScore: next(), contentQuality: next(), projectQuality: next(), experienceStrength: next(), skillsCoverage: next(), technicalDepth: next() };
    const expectedR = Math.round(r.atsScore * 0.18 + r.keywordDensity * 0.12 + r.formatScore * 0.12 + r.contentQuality * 0.16 + r.projectQuality * 0.12 + r.experienceStrength * 0.12 + r.skillsCoverage * 0.10 + r.technicalDepth * 0.08);
    assert.equal(resume.calculate(r, options).score, expectedR);
  }
});
test('sprint point progress preserves valid legacy calculations and makes missing/duplicates explicit', () => {
  const tasks = [{ _id: 'a', points: 3, isCompleted: true }, { _id: 'b', points: 7, isCompleted: false }];
  assert.equal(sprint.calculate(tasks, options).score, 30);
  assert.equal(sprint.calculate([...tasks, tasks[0]], options).score, 30);
  assert.ok(sprint.calculate([...tasks, tasks[0]], options).warnings.includes('duplicate_task'));
  assert.equal(sprint.calculate([], options).score, null);
  assert.equal(sprint.calculate([{ isCompleted: true }, { points: 0 }], options).score, 50);
  assert.equal(sprint.calculate([{ points: -3, isCompleted: true }, ...tasks], options).score, 30);
  assert.equal(require('../services/careerSprintService').calcWeightedProgress(tasks), 30);
  assert.equal(require('../services/careerSprintService').calcWeightedProgress([]), 0);
});
test('portfolio weights retain every existing stack policy and deterministic scoring ignores AI numbers', () => {
  assert.deepEqual(portfolio.getWeights('toString'), portfolio.BASE_WEIGHTS);
  const input = { githubAnalysis: { scores: { codeQuality: 80, projectImpact: 60, consistency: 70, contribution: 80 } },
    resumeAnalysis: { atsScore: 60, keywordDensity: 70, contentQuality: 80, formatScore: 90 }, skillGapAnalysis: { coverage: 40 }, integrationInsight: { integrationScore: 90 } };
  for (const stack of ['Full Stack', 'Frontend', 'Backend', 'AI/ML']) {
    const weights = portfolio.getWeights(stack);
    near(Object.values(weights).reduce((a, b) => a + b, 0), 1);
    const expected = Math.round(80 * weights.codeQuality + 40 * weights.skillCoverage + 75 * weights.industryReadiness + 75 * weights.projectImpact);
    assert.equal(portfolio.calculate({ ...input, careerStack: stack }, options).score, expected);
    const low = calculateTransparentScore({ ...input, careerStack: stack, aiOverallScore: 0, aiBreakdown: { codeQuality: 0 } }, options);
    const high = calculateTransparentScore({ ...input, careerStack: stack, aiOverallScore: 100, aiBreakdown: { codeQuality: 100 }, evidence: 'AI' }, options);
    assert.deepEqual(low, high);
    assert.equal(low.overallScore, expected);
    assert.equal(low.explainabilityBreakdown.aiInfluence, 0);
  }
});
test('portfolio missing optional data does not lower quality; measured zero does, and disconnected integrations are unavailable', () => {
  const base = { githubAnalysis: { scores: { codeQuality: 80, projectImpact: 80, consistency: 80, contribution: 80 } } };
  const absent = portfolio.calculate(base, options);
  assert.equal(absent.score, 80);
  assert.equal(absent.breakdown.industryReadiness.value, null);
  assert.equal(portfolio.calculate({ ...base, integrationInsight: { integrationScore: 0, providers: [] } }, options).score, 80);
  assert.ok(portfolio.calculate({ ...base, integrationInsight: { integrationScore: 0 } }, options).score < 80);
  assert.ok(portfolio.calculate({ ...base, resumeAnalysis: { atsScore: 0 } }, options).score < 80);
  assert.equal(portfolio.calculate({ resumeAnalysis: { atsScore: 90, contentQuality: undefined } }, options).score, 90);
  assert.equal(portfolio.calculate({}, options).score, null);
  assert.equal(portfolio.calculate({ githubAnalysis: { present: false, score: 80 } }, options).score, null);
});
test('legacy reads preserve zeros, old versions/dates and never claim a new rule version', () => {
  const old = { overallScore: 0, weightedScore: 60, confidenceScore: 0, breakdown: { codeQuality: 80 } };
  const normalized = normalizeTransparentScorePayload(old);
  assert.equal(normalized.overallScore, 0);
  assert.equal(normalized.confidenceScore, 0);
  assert.equal(normalized.scoring, undefined);
  assert.equal(normalized.ruleVersion, undefined);
  assert.equal(normalized.calculatedAt, undefined);
  const versioned = { ...old, scoring: { score: 0, ruleVersion: 'portfolio-score-v0', calculatedAt: '2024-01-01T00:00:00.000Z' } };
  assert.deepEqual(normalizeTransparentScorePayload(versioned).scoring, versioned.scoring);
  assert.deepEqual(old, { overallScore: 0, weightedScore: 60, confidenceScore: 0, breakdown: { codeQuality: 80 } });
});
test('portfolio API permits AI narrative only; malicious AI metrics/evidence/dates/identity cannot overwrite deterministic output', async t => {
  const aiService = require('../services/aiservice');
  const AnalysisCache = require('../models/analysisCache');
  t.mock.method(AnalysisCache, 'findOne', async () => null);
  t.mock.method(aiService, 'runAIAnalysis', async () => ({
    overallScore: 999, weightedScore: 999, confidenceScore: 999, breakdown: { codeQuality: 999 },
    scoring: { score: 999, evidence: 'AI forged evidence', ruleVersion: 'forged-v1' },
    score: 999, percentages: [999], dates: ['2099-01-01'], calculatedAt: '2099-01-01',
    username: 'forged-identity', evidence: { fullResume: 'PRIVATE_FULL_TEXT' }, summary: 'Narrative only'
  }));
  let body;
  await require('../controllers/analysiscontroller').getPortfolioReadiness({ body: {
    username: 'developer', careerStack: 'Backend', githubAnalysis: { scores: { codeQuality: 80, skillCoverage: 80, projectImpact: 80, consistency: 80, contribution: 80 } },
    resumeAnalysis: { atsScore: 80, keywordDensity: 80, contentQuality: 80, formatScore: 80 }
  } }, { status(code) { assert.fail(`Unexpected HTTP ${code}`); }, json(value) { body = value; } });
  assert.equal(body.overallScore, 80);
  assert.equal(body.scoring.ruleVersion, 'portfolio-score-v1');
  assert.equal(body.summary, 'Narrative only');
  for (const key of ['username', 'evidence', 'dates', 'calculatedAt', 'score', 'percentages']) assert.equal(body[key], undefined);
  assert.equal(JSON.stringify(body).includes('PRIVATE_FULL_TEXT'), false);
  aiService.runAIAnalysis = async () => ({ summary: { evidence: 'PRIVATE_FULL_TEXT', score: 999 } });
  await require('../controllers/analysiscontroller').getPortfolioReadiness({ body: {
    username: 'developer', githubAnalysis: { scores: { codeQuality: 80 } }, resumeAnalysis: {}
  } }, { status(code) { assert.fail(`Unexpected HTTP ${code}`); }, json(value) { body = value; } });
  assert.equal(typeof body.summary, 'string');
  assert.equal(body.overallScore, 80);
  assert.equal(JSON.stringify(body).includes('PRIVATE_FULL_TEXT'), false);
});
