'use strict';
const githubHealthScore = require('./githubHealthScore');
const resumeOverallScore = require('./resumeOverallScore');
const sprintProgressScore = require('./sprintProgressScore');
const portfolioScore = require('./portfolioScore');

// Exact lookup: add future versions alongside predecessors. Never relabel history.
const engines = Object.freeze(Object.fromEntries([
  githubHealthScore, resumeOverallScore, sprintProgressScore, portfolioScore
].map(engine => [engine.RULE_VERSION, engine])));
const getEngine = (ruleVersion) => {
  if (!Object.hasOwn(engines, ruleVersion)) throw new RangeError('Unknown scoring rule version');
  return engines[ruleVersion];
};
module.exports = { math: require('./math'), createScoreResult: require('./result').createScoreResult,
  buildEvidence: require('./evidence').buildEvidence, engines, getEngine };
