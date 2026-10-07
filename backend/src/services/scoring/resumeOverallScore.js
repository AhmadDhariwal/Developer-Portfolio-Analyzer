'use strict';
const { scoreFeatures } = require('./aggregate');
const RULE_VERSION = 'resume-overall-score-v1';
// Existing eight-component resume aggregate; parsing and component rules stay local.
const WEIGHTS = Object.freeze({ atsScore: 0.18, keywordDensity: 0.12, formatScore: 0.12, contentQuality: 0.16, projectQuality: 0.12, experienceStrength: 0.12, skillsCoverage: 0.10, technicalDepth: 0.08 });
const calculate = (features, options) => scoreFeatures(features, WEIGHTS, RULE_VERSION, options);
module.exports = { RULE_VERSION, WEIGHTS, calculate };
