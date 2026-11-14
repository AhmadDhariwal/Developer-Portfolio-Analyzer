'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const service = require('../services/courseService');
const taxonomy = require('../services/courseCatalogTaxonomy');
const seed = require('../data/courseAcquisitionCatalog');
const acquisition = require('../services/courseCatalogAcquisitionService');
const coverage = require('../services/courseCatalogCoverageService');
const identity = require('../utils/courseIdentity');

test('reviewed expansion preserves existing identities and has honest, unique metadata', () => {
  const courses = service.buildFallbackPool('All', 200);
  assert.equal(courses.length, 61);
  assert.equal(seed.courses.length, 26);
  assert.equal(new Set(courses.map((course) => course.id)).size, 61);
  assert.equal(new Set(courses.map(identity.canonicalCourseKey)).size, 61);
  assert.ok(
    courses.every(
      (course) => identity.validCourseId(course.id) && !course.rating && !course.durationHours,
    ),
  );
  for (const topic of ['Angular', 'Generative AI', 'LLM', 'RAG', 'Docker', 'Kubernetes']) {
    const before = courses.filter(
      (course) =>
        !seed.courses.some((added) => added.id === course.id) && taxonomy.matches(course, topic),
    );
    const after = courses.filter((course) => taxonomy.matches(course, topic));
    assert.ok(after.length > before.length, topic);
  }
  assert.equal(
    courses.find((course) => course.id === 'fb_u1').url,
    'https://www.udemy.com/course/the-complete-javascript-course/',
  );
});

test('coverage recognizes Skill Gap technologies and spelling aliases without merging distinct languages', () => {
  const requirements = require('../services/skillGapRequirements');
  for (const name of [
    ...requirements.DEFAULT_SKILLS,
    ...Object.values(requirements.STACK_SKILLS).flat(),
    ...Object.values(requirements.LEVEL_SKILLS).flat(),
  ])
    assert.ok(taxonomy.technologies.includes(name), name);
  for (const [alias, expected] of Object.entries({
    angular: 'Angular',
    genai: 'Generative AI',
    llms: 'LLM',
    'retrieval-augmented generation': 'RAG',
    dockerfile: 'Docker',
    k8s: 'Kubernetes',
    a11y: 'Accessibility',
    golang: 'Go',
  }))
    assert.equal(taxonomy.canonical(alias), expected);
  assert.notEqual(taxonomy.canonical('Java'), taxonomy.canonical('js'));
  assert.notEqual(taxonomy.canonical('.NET'), taxonomy.canonical('C#'));
  assert.notEqual(taxonomy.canonical('PostgreSQL'), taxonomy.canonical('SQL'));
});

test('official manifest only admits reviewed present entries with publisher titles and stable IDs', () => {
  const known = seed.fcc[0];
  const parsed = acquisition.parse(
    { superblocks: [known.manifestSlug || known.slug, 'unreviewed-new-course'] },
    {
      [known.slug]: { title: 'Publisher current title' },
      'unreviewed-new-course': { title: 'Unreviewed' },
    },
  );
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].id, known.id);
  assert.equal(parsed[0].title, 'Publisher current title');
  assert.equal(parsed[0].rating, null);
  assert.throws(() => acquisition.parse({ superblocks: 'bad' }, {}));
  assert.deepEqual(acquisition.parse({ superblocks: [known.manifestSlug || known.slug] }, {}), []);
});

test('retrieval capability is explicit; curated providers never imply an available API', () => {
  for (const provider of [
    'Udemy',
    'Coursera',
    'edX',
    'MDN',
    'The Odin Project',
    'Full Stack Open',
  ]) {
    assert.equal(coverage.capability(provider, 'Angular').supported, false);
    assert.equal(coverage.capability(provider, 'Angular').mode, 'controlled-curation');
  }
  assert.equal(coverage.capability('freeCodeCamp', 'Python').supported, true);
  assert.equal(coverage.capability('freeCodeCamp', 'Angular').supported, false);
});
