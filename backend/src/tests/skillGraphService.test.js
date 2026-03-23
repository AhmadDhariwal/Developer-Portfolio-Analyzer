const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSkillGraph, generateWeeklyLearningRoadmap } = require('../services/skillGraphService');

test('buildSkillGraph returns nodes and edges for current and missing skills', () => {
  const graph = buildSkillGraph({
    currentSkills: [{ name: 'TypeScript', category: 'Language', proficiency: 78 }],
    missingSkills: [{ name: 'React', category: 'Frontend', jobDemand: 91 }]
  });

  assert.ok(Array.isArray(graph.nodes));
  assert.ok(Array.isArray(graph.edges));
  assert.ok(graph.nodes.some((n) => n.name === 'TypeScript'));
  assert.ok(graph.nodes.some((n) => n.name === 'React'));
  assert.ok(graph.edges.some((e) => e.type === 'prerequisite' || e.type === 'related'));
});

test('generateWeeklyLearningRoadmap returns bounded weekly plan', () => {
  const graph = buildSkillGraph({
    currentSkills: [{ name: 'Git', category: 'Tools' }, { name: 'TypeScript', category: 'Language' }],
    missingSkills: [{ name: 'React', category: 'Frontend', jobDemand: 91 }, { name: 'Next.js', category: 'Frontend', jobDemand: 80 }]
  });

  const weeks = generateWeeklyLearningRoadmap(graph, 4);
  assert.equal(weeks.length, 4);
  assert.ok(weeks.every((w) => typeof w.week === 'number'));
});
