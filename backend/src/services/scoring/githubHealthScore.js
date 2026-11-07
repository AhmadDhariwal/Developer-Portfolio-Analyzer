'use strict';
const { scoreFeatures } = require('./aggregate');
const RULE_VERSION = 'github-health-score-v1';
// Existing GitHub health aggregate; component extraction remains in githubservice.
const WEIGHTS = Object.freeze({ codeQuality: 0.24, projectDiversity: 0.17, contribution: 0.18, consistency: 0.13, projectImpact: 0.14, profileStrength: 0.14 });
const calculate = (features, options) => scoreFeatures(features, WEIGHTS, RULE_VERSION, options);
module.exports = { RULE_VERSION, WEIGHTS, calculate };
