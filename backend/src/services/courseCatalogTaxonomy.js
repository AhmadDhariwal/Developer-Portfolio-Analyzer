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
function matches(course, topic) {
  const text = [course.title, ...(course.topics || [])].join(' ');
  return aliases(topic).some((term) =>
    new RegExp(
      `(?:^|[^a-z0-9_+#])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:[^a-z0-9_+#]|$)`,
      'i',
    ).test(text),
  );
}
module.exports = { technologies, canonical, aliases, matches };
