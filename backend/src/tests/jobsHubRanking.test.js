const test = require('node:test');
const assert = require('node:assert/strict');
const { rankJobs } = require('../utils/jobRanker');

const job = (id, patch = {}) => ({
  id,
  title: 'Engineer',
  skills: [],
  description: '',
  experienceLevel: 'Entry',
  postedDate: '',
  ...patch
});
const context = { careerStack: 'Full Stack', experienceLevel: 'Entry' };

test('stack coverage is normalized independently of its 28 percent ranking weight', () => {
  // Three of eleven Full Stack keywords: 27%, not 97%.
  const [partial] = rankJobs(
    [job('partial', { description: 'React Angular TypeScript' })],
    context
  );
  assert.equal(partial.matchScore, 46);
  assert.doesNotMatch(partial.whyMatched, /Aligned with your/);
  const [complete] = rankJobs(
    [
      job('complete', {
        description: 'full stack fullstack mern mean node express react angular vue next typescript'
      })
    ],
    context
  );
  assert.equal(complete.matchScore, 66);
  assert.match(complete.whyMatched, /Aligned with your Full Stack/);
});

test('equal-score jobs use stable IDs regardless of provider or cache input order', () => {
  const rows = [job('z'), job('a'), job('m')];
  assert.deepEqual(
    rankJobs(rows, context).map((row) => row.id),
    ['a', 'm', 'z']
  );
  assert.deepEqual(rankJobs([...rows].reverse(), context), rankJobs(rows, context));
});

test('a stack without a keyword policy does not borrow Full Stack alignment', () => {
  const [ranked] = rankJobs([job('other', { description: 'React Angular TypeScript' })], {
    ...context,
    careerStack: 'DevOps'
  });
  assert.equal(ranked.matchScore, 38);
  assert.doesNotMatch(ranked.whyMatched, /Aligned with your DevOps/);
});

test('an unspecified job experience level does not claim a verified experience fit', () => {
  const [ranked] = rankJobs([job('unknown-experience', { experienceLevel: '' })], context);
  assert.doesNotMatch(ranked.whyMatched, /Close fit for your current experience/);
  assert.ok(Number.isFinite(ranked.matchScore));
});

test('one ranking pass uses one recency observation at a boundary', (t) => {
  let now = Date.parse('2026-11-08T00:00:00Z');
  const postedDate = new Date(now - 3 * 86400000).toISOString();
  t.mock.method(Date, 'now', () => now++);
  const rows = rankJobs([job('a', { postedDate }), job('b', { postedDate })], context);
  assert.equal(rows[0].matchScore, rows[1].matchScore);
});
