const test = require('node:test');
const assert = require('node:assert/strict');
const {
  canonicalizeSkillName,
  extractSkillsFromRepositories,
  extractSkillsFromText
} = require('../utils/skilldetector');

test('canonicalizeSkillName resolves aliases to a shared skill name', () => {
  assert.equal(canonicalizeSkillName('reactjs'), 'React');
  assert.equal(canonicalizeSkillName('node js'), 'Node.js');
  assert.equal(canonicalizeSkillName('Dockerfile'), 'Docker');
});

test('extractSkillsFromText detects common technology mentions', () => {
  const skills = extractSkillsFromText([
    'Built an Angular dashboard with TypeScript and CI/CD.',
    'Deployed the service to AWS using Docker.'
  ]);

  assert.ok(skills.includes('Angular'));
  assert.ok(skills.includes('TypeScript'));
  assert.ok(skills.includes('CI/CD'));
  assert.ok(skills.includes('AWS'));
  assert.ok(skills.includes('Docker'));
});

test('extractSkillsFromRepositories combines repository text and language signals', () => {
  const skills = extractSkillsFromRepositories(
    [
      { name: 'angular-admin-portal', description: 'Angular admin app with RxJS', language: 'TypeScript' },
      { name: 'infra-scripts', description: 'Docker and AWS deployment helpers', language: 'Shell' }
    ],
    [
      { language: 'TypeScript', percentage: 70 },
      { language: 'Dockerfile', percentage: 20 }
    ]
  );

  assert.ok(skills.includes('Angular'));
  assert.ok(skills.includes('TypeScript'));
  assert.ok(skills.includes('Docker'));
  assert.ok(skills.includes('AWS'));
});
