const TOPIC_TYPES = {
  LANGUAGE: 'language',
  FRAMEWORK: 'framework',
  TECHNOLOGY: 'technology',
  STACK: 'stack'
};

const IMPORTANT_TOPICS = [
  { key: 'javascript', type: TOPIC_TYPES.LANGUAGE, label: 'JavaScript', aliases: ['js', 'ecmascript'] },
  { key: 'typescript', type: TOPIC_TYPES.LANGUAGE, label: 'TypeScript', aliases: ['ts'] },
  { key: 'python', type: TOPIC_TYPES.LANGUAGE, label: 'Python', aliases: ['py'] },
  { key: 'java', type: TOPIC_TYPES.LANGUAGE, label: 'Java', aliases: [] },
  { key: 'cpp', type: TOPIC_TYPES.LANGUAGE, label: 'C++', aliases: ['c++', 'cplusplus', 'c plus plus'] },

  { key: 'angular', type: TOPIC_TYPES.FRAMEWORK, label: 'Angular', aliases: ['angularjs'] },
  { key: 'react', type: TOPIC_TYPES.FRAMEWORK, label: 'React', aliases: ['reactjs', 'react.js'] },
  { key: 'nodejs', type: TOPIC_TYPES.FRAMEWORK, label: 'Node.js', aliases: ['node', 'node.js', 'node js'] },
  { key: 'expressjs', type: TOPIC_TYPES.FRAMEWORK, label: 'Express.js', aliases: ['express', 'express.js', 'express js'] },
  { key: 'nextjs', type: TOPIC_TYPES.FRAMEWORK, label: 'Next.js', aliases: ['next', 'next.js', 'next js'] },

  { key: 'mongodb', type: TOPIC_TYPES.TECHNOLOGY, label: 'MongoDB', aliases: ['mongo', 'mongo db'] },
  { key: 'mysql', type: TOPIC_TYPES.TECHNOLOGY, label: 'MySQL', aliases: ['my sql'] },
  { key: 'postgresql', type: TOPIC_TYPES.TECHNOLOGY, label: 'PostgreSQL', aliases: ['postgres', 'postgresql db', 'postgres sql'] },
  { key: 'redis', type: TOPIC_TYPES.TECHNOLOGY, label: 'Redis', aliases: [] },
  { key: 'rest-apis', type: TOPIC_TYPES.TECHNOLOGY, label: 'REST APIs', aliases: ['rest', 'rest api', 'restful api', 'restful apis'] },
  { key: 'graphql', type: TOPIC_TYPES.TECHNOLOGY, label: 'GraphQL', aliases: ['graph ql'] },

  { key: 'mern', type: TOPIC_TYPES.STACK, label: 'MERN', aliases: ['mongo express react node', 'mern stack'] },
  { key: 'mean', type: TOPIC_TYPES.STACK, label: 'MEAN', aliases: ['mongo express angular node', 'mean stack'] },
  { key: 'full-stack-web-development', type: TOPIC_TYPES.STACK, label: 'Full Stack Web Development', aliases: ['fullstack', 'full stack', 'full stack web', 'full stack development'] }
];

const normalizeAlias = (value = '') => {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\+/g, ' plus ')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

const slugify = (value = '') => {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\+/g, ' plus ')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
};

const buildAliasMap = () => {
  const map = new Map();
  for (const topic of IMPORTANT_TOPICS) {
    const aliases = [topic.key, topic.label, ...(topic.aliases || [])];
    for (const alias of aliases) {
      const normalized = normalizeAlias(alias);
      if (!normalized) continue;
      if (!map.has(normalized)) {
        map.set(normalized, topic);
      }
    }
  }
  return map;
};

const ALIAS_MAP = buildAliasMap();

const resolveTopic = (value = '', preferredType = '') => {
  const normalizedAlias = normalizeAlias(value);
  if (!normalizedAlias) return null;

  const found = ALIAS_MAP.get(normalizedAlias);
  if (found && (!preferredType || found.type === preferredType)) {
    return {
      topicKey: found.key,
      topicType: found.type,
      topicLabel: found.label
    };
  }

  if (found) {
    return {
      topicKey: found.key,
      topicType: found.type,
      topicLabel: found.label
    };
  }

  const fallbackKey = slugify(value);
  if (!fallbackKey) return null;
  return {
    topicKey: fallbackKey,
    topicType: preferredType || TOPIC_TYPES.TECHNOLOGY,
    topicLabel: String(value || '').trim()
  };
};

const splitValues = (value = '') => {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item || '').trim())
      .filter(Boolean);
  }

  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
};

const normalizeDimensionValues = (values = [], preferredType = '') => {
  const dedup = new Set();
  for (const item of values) {
    const resolved = resolveTopic(item, preferredType);
    if (!resolved) continue;
    dedup.add(resolved.topicKey);
  }
  return [...dedup];
};

const normalizeTopicInput = ({
  skill = '',
  topic = '',
  stack = '',
  technology = '',
  language = '',
  framework = ''
} = {}) => {
  const candidates = [
    ...splitValues(framework).map((value) => ({ value, preferredType: TOPIC_TYPES.FRAMEWORK })),
    ...splitValues(language).map((value) => ({ value, preferredType: TOPIC_TYPES.LANGUAGE })),
    ...splitValues(technology).map((value) => ({ value, preferredType: TOPIC_TYPES.TECHNOLOGY })),
    ...splitValues(stack).map((value) => ({ value, preferredType: TOPIC_TYPES.STACK })),
    ...splitValues(skill).map((value) => ({ value, preferredType: '' })),
    ...splitValues(topic).map((value) => ({ value, preferredType: '' }))
  ];

  let primary = null;
  for (const candidate of candidates) {
    primary = resolveTopic(candidate.value, candidate.preferredType);
    if (primary) break;
  }

  const fallback = primary || {
    topicKey: 'javascript',
    topicType: TOPIC_TYPES.LANGUAGE,
    topicLabel: 'JavaScript'
  };

  const dimensions = {
    stack: normalizeDimensionValues(splitValues(stack), TOPIC_TYPES.STACK),
    technology: normalizeDimensionValues(splitValues(technology), TOPIC_TYPES.TECHNOLOGY),
    language: normalizeDimensionValues(splitValues(language), TOPIC_TYPES.LANGUAGE),
    framework: normalizeDimensionValues(splitValues(framework), TOPIC_TYPES.FRAMEWORK)
  };

  if (!dimensions[fallback.topicType]?.includes(fallback.topicKey)) {
    dimensions[fallback.topicType] = [...(dimensions[fallback.topicType] || []), fallback.topicKey];
  }

  return {
    ...fallback,
    skill: fallback.topicKey,
    topicDimensions: dimensions
  };
};

const listImportantTopics = () => IMPORTANT_TOPICS.map((item) => ({ ...item }));

module.exports = {
  TOPIC_TYPES,
  IMPORTANT_TOPICS,
  listImportantTopics,
  normalizeAlias,
  slugify,
  resolveTopic,
  normalizeTopicInput
};
