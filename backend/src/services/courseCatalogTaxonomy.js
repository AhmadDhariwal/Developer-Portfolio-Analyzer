'use strict';

const identity = require('../utils/courseIdentity');
const requirements = require('./skillGapRequirements');
const { INDUSTRY_SKILLS } = require('../utils/skilldetector');
const shared = require('./sharedCourseCatalogService');
const technologies = [
  ...new Set([
    ...shared.TOPICS,
    ...INDUSTRY_SKILLS.map((skill) => skill.name),
    'Shell',
    'HCL',
    ...requirements.DEFAULT_SKILLS,
    ...Object.values(requirements.STACK_SKILLS).flat(),
    ...Object.values(requirements.LEVEL_SKILLS).flat(),
    ...Object.values(requirements.ALIASES),
  ]),
].sort();
if (technologies.length > 128) throw Error('Review the bounded course technology registry.');

function canonical(value) {
  const text = String(value || '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 60);
  const spelling = identity.skills([text], 1)[0] || '';
  return (
    [...technologies, ...shared.STACKS].find(
      (name) => name.toLowerCase() === spelling.toLowerCase(),
    ) ||
    requirements.canonicalize(spelling) ||
    INDUSTRY_SKILLS.find((skill) =>
      skill.aliases.some((alias) => alias.toLowerCase() === spelling.toLowerCase()),
    )?.name ||
    spelling.toLowerCase()
  );
}
function aliases(topic) {
  return [
    ...new Set([
      ...identity.skillAliases(topic),
      ...Object.entries(requirements.ALIASES)
        .filter(([, name]) => name === topic)
        .map(([alias]) => alias),
      ...INDUSTRY_SKILLS.filter((skill) => skill.name === topic).flatMap((skill) => skill.aliases),
    ]),
  ]
    .filter((alias) => canonical(alias) === topic)
    .slice(0, 20);
}
const SEARCH_POLICY = 'course-topic-eligibility-v2';
// Context is deliberately separate from spelling aliases: Qiskit is not renamed
// to Quantum Computing, nor are its saved-course identities or taxonomy changed.
const CONTEXT = { 'quantum computing': ['qiskit', 'qubit', 'qubits'] };
const QUERY_FILLER = new Set(
  'a an the and or for to of in on with about learn learning course courses tutorial tutorials training introduction intro beginner beginners intermediate advanced basics fundamentals complete comprehensive guide guides'.split(
    ' ',
  ),
);
const normalize = (value) =>
  String(value || '')
    .normalize('NFKC')
    .toLowerCase();
const boundary = (term) =>
  new RegExp(
    `(?:^|[^\\p{L}\\p{N}_+#])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^\\p{L}\\p{N}_+#])`,
    'iu',
  );

function topicPredicate(value) {
  const topic = canonical(value);
  if (!topic) return () => true;
  const context = CONTEXT[topic] || [];
  const exact = [...aliases(topic), ...context].map(boundary);
  const tokens = [
    ...new Set(
      (normalize(topic).match(/[\p{L}\p{N}_+#.]+/gu) || []).filter(
        (term) => !QUERY_FILLER.has(term),
      ),
    ),
  ];
  // Canonical technologies use verified aliases only. Unseen compound queries
  // require all meaningful terms in one metadata field, never a shared OR word.
  const compound = !technologies.includes(topic) && !context.length && tokens.length > 0;
  const required = tokens.map(boundary);
  return (course) => {
    const fields = [course.title, ...(course.topics || []), course.description]
      .filter(Boolean)
      .map(normalize);
    if (!tokens.length) return false;
    return fields.some(
      (field) =>
        exact.some((re) => re.test(field)) || (compound && required.every((re) => re.test(field))),
    );
  };
}

function searchTerms(topic) {
  topic = canonical(topic);
  return [
    ...new Set([
      ...(technologies.includes(topic) ? aliases(topic) : topic.split(/\s+/).filter(Boolean)),
      ...(CONTEXT[topic] || []),
    ]),
  ].slice(0, 24);
}

function matches(course, topic) {
  return topicPredicate(topic)(course);
}
module.exports = {
  technologies,
  canonical,
  aliases,
  matches,
  topicPredicate,
  searchTerms,
  SEARCH_POLICY,
};
