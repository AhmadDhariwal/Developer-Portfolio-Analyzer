'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const taxonomy = require('../services/courseCatalogTaxonomy');

const course = (title, topics = [], description = '') => ({ title, topics, description });
const cases = [
  ['Quantum Computing', course('AWS Cloud Computing'), false],
  ['Quantum Computing', course('Scientific Computing with Python'), false],
  [
    'Quantum Computing',
    course('Cloud infrastructure', ['AWS'], 'Modern computing infrastructure'),
    false,
  ],
  ['Quantum Computing', course('Quantum physics introduction'), false],
  ['Quantum Computing', course('Quantum Computing foundations'), true],
  ['Quantum Computing', course('Qiskit circuits'), true],
  ['Quantum Computing', course('Qubits and quantum gates'), true],
  ['Quantum Computing', course('Introduction', ['qubit']), true],
  ['Cloud Computing', course('AWS Cloud Computing'), true],
  ['Java', course('JavaScript ES6'), false],
  ['JavaScript', course('Java concurrency'), false],
  ['Java', course('Advanced Java concurrency'), true],
  ['Java', course('JavaScript', ['JavaScript'], 'ECMAScript programming'), false],
  ['Angular', course('Angular architecture'), true],
  ['Angular', course('AngularJS architecture'), false],
  ['Generative AI', course('Generative artificial intelligence'), true],
  ['genai', course('Generative AI with LLMs'), true],
  ['Generative AI', course('Cloud AI infrastructure'), false],
  ['RAG', course('Retrieval-augmented generation'), true],
  ['RAG', course('Retrieval systems'), false],
  ['Docker', course('Dockerfile patterns'), true],
  ['Docker', course('Container orchestration with Kubernetes'), false],
  ['Nebula Widgets', course('Advanced Nebula Widgets'), true],
  ['Nebula Widgets', course('Nebula programmable Widgets'), true],
  ['Nebula Widgets', course('Generic Widgets'), false],
  ['Nebula Widgets', course('Nebula', ['Widgets']), false],
  ['Nebula Widgets course', course('Nebula Widgets'), true],
  ['course', course('Cloud course'), false],
];
for (const [query, metadata, expected] of cases) {
  test(`${query}: ${metadata.title} => ${expected}`, () => {
    assert.equal(taxonomy.topicPredicate(query)(metadata), expected);
    assert.equal(taxonomy.matches(metadata, query), expected);
  });
}
test('context terms expand indexed candidates without becoming spelling aliases', () => {
  assert.ok(taxonomy.searchTerms('Quantum Computing').includes('qiskit'));
  assert.ok(!taxonomy.aliases('quantum computing').includes('qiskit'));
  assert.equal(taxonomy.canonical('Qiskit'), 'qiskit');
});

test('the corrected discovery policy cannot reuse a historical permissive pool key', () => {
  const crypto = require('node:crypto');
  const service = require('../services/courseService');
  const { buildPoolCacheKey } = require('../services/courseRecommendationService');
  const filters = service.normaliseCourseFilters({ topic: 'Quantum Computing', view: 'discover' });
  const legacySeed = {
    discoveryPolicy: 4,
    view: 'discover',
    catalogRevision: 'fixture-revision',
    careerStack: 'Backend',
    experienceLevel: 'Intern',
    skillGaps: [],
    knownSkills: [],
    evidenceFingerprint: 'unavailable',
    providerConfig: service.providerConfigurationFingerprint(),
    platform: 'All',
    rating: '',
    level: 'All',
    topic: 'Quantum Computing',
    duration: 'All',
  };
  const legacyHash = crypto
    .createHash('sha256')
    .update(JSON.stringify(legacySeed))
    .digest('hex')
    .slice(0, 20);
  const current = buildPoolCacheKey({
    userId: 'isolated-fixture',
    careerStack: 'Backend',
    experienceLevel: 'Intern',
    skillGaps: [],
    knownSkills: [],
    filters,
    catalogRevision: 'fixture-revision',
  });
  assert.notEqual(current.poolHash, legacyHash);
  assert.equal(current.cacheLookup.signalHash, current.poolHash);
  assert.ok(!current.memoryKey.includes(legacyHash));
  assert.ok(!current.redisKey.includes(legacyHash));
});
