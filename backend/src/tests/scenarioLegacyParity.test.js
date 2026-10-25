'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('./fixtures/scenario-legacy-golden.json');
const engine = require('../services/scoring/scenarioPlanningScore');
test('legacy numerical outputs exactly match thirty pre-extraction golden fixtures', () => {
  for (const fixture of fixtures) {
    const result = engine.calculate(fixture.payload, fixture.context);
    const actual = Object.fromEntries(Object.keys(fixture.expected).map((key) => [key, result[key]]));
    // The pre-extraction engine also emits -0 for a zero penalty. JSON golden
    // fixtures encode it as 0, so verify both the internal sign and wire value.
    assert.equal(Object.is(result.breakdown.penalty, -0), fixture.expected.breakdown.penalty === 0);
    assert.deepEqual(JSON.parse(JSON.stringify(actual)), fixture.expected);
  }
});
