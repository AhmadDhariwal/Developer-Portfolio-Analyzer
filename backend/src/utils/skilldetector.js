/**
 * Comprehensive industry skill database used for skill-gap detection.
 * Each entry represents a skill demanded in senior developer job postings.
 */
const INDUSTRY_SKILLS = [
  // Frontend
  { name: 'React',        category: 'Frontend',  priority: 'High',   jobDemand: 91, aliases: ['react.js', 'reactjs'] },
  { name: 'JavaScript',   category: 'Language',  priority: 'High',   jobDemand: 89, aliases: ['js', 'ecmascript', 'es6'] },
  { name: 'TypeScript',   category: 'Language',  priority: 'High',   jobDemand: 88, aliases: ['ts'] },
  { name: 'Next.js',      category: 'Frontend',  priority: 'High',   jobDemand: 76, aliases: ['nextjs', 'next'] },
  { name: 'Angular',      category: 'Frontend',  priority: 'Medium', jobDemand: 62, aliases: [] },
  { name: 'Vue',          category: 'Frontend',  priority: 'Medium', jobDemand: 54, aliases: ['vue.js', 'vuejs'] },
  { name: 'HTML',         category: 'Frontend',  priority: 'Medium', jobDemand: 63, aliases: ['html5'] },
  { name: 'CSS',          category: 'Frontend',  priority: 'Medium', jobDemand: 66, aliases: ['css3'] },
  { name: 'Tailwind CSS', category: 'Frontend',  priority: 'Medium', jobDemand: 65, aliases: ['tailwind'] },
  { name: 'Accessibility', category: 'Frontend', priority: 'Medium', jobDemand: 69, aliases: ['a11y', 'wcag'] },
  // Backend
  { name: 'Node.js',      category: 'Backend',   priority: 'High',   jobDemand: 84, aliases: ['nodejs', 'node', 'node js'] },
  { name: 'REST APIs',    category: 'Backend',   priority: 'High',   jobDemand: 88, aliases: ['rest', 'restful', 'rest api'] },
  { name: 'GraphQL',      category: 'Backend',   priority: 'Medium', jobDemand: 60, aliases: [] },
  { name: 'Python',       category: 'Language',  priority: 'High',   jobDemand: 82, aliases: [] },
  { name: 'Go',           category: 'Language',  priority: 'Medium', jobDemand: 75, aliases: ['golang'] },
  { name: 'Rust',         category: 'Language',  priority: 'Low',    jobDemand: 56, aliases: [] },
  { name: 'Java',         category: 'Language',  priority: 'Medium', jobDemand: 68, aliases: [] },
  { name: 'SQL',          category: 'Database',  priority: 'High',   jobDemand: 85, aliases: ['relational sql'] },
  // DevOps / Cloud
  { name: 'Docker',       category: 'DevOps',    priority: 'High',   jobDemand: 87, aliases: ['dockerfile'] },
  { name: 'Kubernetes',   category: 'DevOps',    priority: 'High',   jobDemand: 94, aliases: ['k8s'] },
  { name: 'AWS',          category: 'Cloud',     priority: 'High',   jobDemand: 98, aliases: ['amazon web services'] },
  { name: 'Cloud Basics', category: 'Cloud',     priority: 'Medium', jobDemand: 72, aliases: ['cloud fundamentals'] },
  { name: 'Terraform',    category: 'DevOps',    priority: 'Medium', jobDemand: 76, aliases: ['hcl'] },
  { name: 'CI/CD',        category: 'DevOps',    priority: 'High',   jobDemand: 83, aliases: ['cicd', 'github actions', 'jenkins', 'gitlab ci'] },
  { name: 'Deployment',   category: 'DevOps',    priority: 'Medium', jobDemand: 74, aliases: ['deployments', 'release automation'] },
  { name: 'Monitoring and Observability', category: 'DevOps', priority: 'Medium', jobDemand: 73, aliases: ['observability', 'monitoring'] },
  { name: 'Linux',        category: 'DevOps',    priority: 'Medium', jobDemand: 68, aliases: ['unix', 'bash'] },
  { name: 'Kafka',        category: 'Backend',   priority: 'Medium', jobDemand: 71, aliases: ['apache kafka'] },
  { name: 'Prometheus',   category: 'DevOps',    priority: 'Low',    jobDemand: 55, aliases: [] },
  // Databases
  { name: 'PostgreSQL',   category: 'Database',  priority: 'High',   jobDemand: 79, aliases: ['postgres'] },
  { name: 'Redis',        category: 'Database',  priority: 'High',   jobDemand: 82, aliases: [] },
  { name: 'MongoDB',      category: 'Database',  priority: 'Medium', jobDemand: 65, aliases: ['mongo'] },
  // Tools
  { name: 'Git',          category: 'Tools',     priority: 'High',   jobDemand: 97, aliases: [] },
  { name: 'Jest',         category: 'Testing',   priority: 'Medium', jobDemand: 62, aliases: [] },
  { name: 'Testing',      category: 'Testing',   priority: 'High',   jobDemand: 78, aliases: ['unit testing', 'integration testing', 'test automation'] },
  { name: 'System Design', category: 'General',  priority: 'High',   jobDemand: 86, aliases: ['distributed systems design'] },
  { name: 'Security Basics', category: 'General', priority: 'High',  jobDemand: 82, aliases: ['web security', 'owasp'] },
  { name: 'Performance Optimization', category: 'General', priority: 'Medium', jobDemand: 76, aliases: ['performance tuning'] },
  { name: 'Design Patterns', category: 'General', priority: 'Medium', jobDemand: 67, aliases: ['software design patterns'] },
  { name: 'API Versioning', category: 'Backend', priority: 'Medium', jobDemand: 61, aliases: ['api compatibility'] },
  { name: 'Caching Strategies', category: 'Backend', priority: 'Medium', jobDemand: 70, aliases: ['cache design', 'caching'] },
  { name: 'Documentation', category: 'General', priority: 'Medium', jobDemand: 58, aliases: ['technical writing', 'docs'] },
  // Additional languages — recognised so they show up as "current skills"
  { name: 'C',            category: 'Language',  priority: 'Medium', jobDemand: 60, aliases: [] },
  { name: 'C++',          category: 'Language',  priority: 'Medium', jobDemand: 63, aliases: ['cpp'] },
  { name: 'C#',           category: 'Language',  priority: 'Medium', jobDemand: 65, aliases: ['csharp', 'dotnet', '.net'] },
  { name: 'Dart',         category: 'Language',  priority: 'Low',    jobDemand: 42, aliases: [] },
  { name: 'Ruby',         category: 'Language',  priority: 'Low',    jobDemand: 48, aliases: ['ruby on rails', 'rails'] },
  { name: 'Swift',        category: 'Language',  priority: 'Low',    jobDemand: 52, aliases: [] },
  { name: 'Kotlin',       category: 'Language',  priority: 'Low',    jobDemand: 55, aliases: [] },
  { name: 'PHP',          category: 'Language',  priority: 'Low',    jobDemand: 45, aliases: [] },
  { name: 'Scala',        category: 'Language',  priority: 'Low',    jobDemand: 50, aliases: [] },
  { name: 'Assembly',     category: 'Language',  priority: 'Low',    jobDemand: 35, aliases: ['asm'] },
];

/**
 * Map of GitHub language names → skill names in our database.
 * Used to infer current skills from a user's repo language data.
 */
const LANGUAGE_TO_SKILL = {
  'TypeScript':  'TypeScript',
  'JavaScript':  'JavaScript',
  'Python':      'Python',
  'Go':          'Go',
  'Rust':        'Rust',
  'Java':        'Java',
  'C':           'C',
  'C++':         'C++',
  'C#':          'C#',
  'Ruby':        'Ruby',
  'Swift':       'Swift',
  'Kotlin':      'Kotlin',
  'PHP':         'PHP',
  'Scala':       'Scala',
  'Dart':        'Dart',
  'Assembly':    'Assembly',
  'CSS':         'CSS',
  'HTML':        'HTML',
  'Shell':       'CI/CD',
  'Dockerfile':  'Docker',
  'HCL':         'Terraform',
};

const escapeRegex = (value = '') => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const normalizeKey = (value = '') => String(value)
  .toLowerCase()
  .replace(/[^a-z0-9+#]+/g, ' ')
  .trim();

const SKILL_ALIAS_LOOKUP = (() => {
  const map = new Map();
  INDUSTRY_SKILLS.forEach((skill) => {
    [skill.name, ...(skill.aliases || [])].forEach((candidate) => {
      const key = normalizeKey(candidate);
      if (key && !map.has(key)) {
        map.set(key, skill.name);
      }
    });
  });

  Object.entries(LANGUAGE_TO_SKILL).forEach(([language, mappedSkill]) => {
    const key = normalizeKey(language);
    if (key && !map.has(key)) {
      map.set(key, mappedSkill);
    }
  });

  return map;
})();

const SKILL_PATTERNS = INDUSTRY_SKILLS.map((skill) => {
  const candidates = [skill.name, ...(skill.aliases || [])]
    .map((candidate) => escapeRegex(candidate).replace(/\s+/g, '\\s+'))
    .filter(Boolean);

  return {
    name: skill.name,
    pattern: new RegExp(`(^|[^a-z0-9+#])(?:${candidates.join('|')})(?=$|[^a-z0-9+#])`, 'i')
  };
});

const uniqueStrings = (values = []) => {
  const seen = new Set();
  return values.filter((value) => {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
};

const canonicalizeSkillName = (value = '') => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return SKILL_ALIAS_LOOKUP.get(normalizeKey(raw)) || '';
};

const isRecognizedSkill = (value = '') => Boolean(canonicalizeSkillName(value));

const normalizeSkillList = (values = []) => uniqueStrings(
  (Array.isArray(values) ? values : [values])
    .map((value) => canonicalizeSkillName(value))
    .filter(Boolean)
);

/**
 * Given a list of skill names (strings), return which INDUSTRY_SKILLS are present vs missing.
 * Returns { currentSkills, missingSkills } — both typed as INDUSTRY_SKILLS entries.
 */
const detectSkillGaps = (currentSkillNames = []) => {
  const lowerNames = normalizeSkillList(currentSkillNames).map(s => s.toLowerCase());

  const matched = [];
  const missing  = [];

  INDUSTRY_SKILLS.forEach(skill => {
    const nameMatch  = lowerNames.includes(skill.name.toLowerCase());
    const aliasMatch = skill.aliases.some(a => lowerNames.includes(a.toLowerCase()));
    if (nameMatch || aliasMatch) {
      matched.push(skill);
    } else {
      missing.push(skill);
    }
  });

  return { currentSkills: matched, missingSkills: missing };
};

/**
 * Derive an initial skill list from GitHub language distribution array
 * [ { language: 'TypeScript', percentage: 38 }, ... ]
 */
const skillsFromLanguages = (languageDistribution = []) => {
  const skills = new Set();
  languageDistribution.forEach(({ language }) => {
    const mapped = canonicalizeSkillName(LANGUAGE_TO_SKILL[language] || language);
    if (mapped) skills.add(mapped);
  });
  return [...skills];
};

const extractSkillsFromText = (sources = []) => {
  const haystack = (Array.isArray(sources) ? sources : [sources])
    .flatMap((source) => Array.isArray(source) ? source : [source])
    .map((source) => String(source || '').trim())
    .filter(Boolean)
    .join('\n');

  if (!haystack) return [];

  const matches = SKILL_PATTERNS
    .filter(({ pattern }) => pattern.test(haystack))
    .map(({ name }) => name);

  return uniqueStrings(matches);
};

const extractSkillsFromRepositories = (repositories = [], languageDistribution = []) => {
  const repoSources = (Array.isArray(repositories) ? repositories : []).flatMap((repo) => ([
    repo?.name,
    repo?.description,
    ...(Array.isArray(repo?.topics) ? repo.topics : []),
    repo?.language
  ]));

  return uniqueStrings([
    ...skillsFromLanguages(languageDistribution),
    ...extractSkillsFromText(repoSources)
  ]).map((skill) => canonicalizeSkillName(skill)).filter(Boolean);
};

module.exports = {
  detectSkillGaps,
  skillsFromLanguages,
  extractSkillsFromText,
  extractSkillsFromRepositories,
  canonicalizeSkillName,
  isRecognizedSkill,
  normalizeSkillList,
  INDUSTRY_SKILLS,
  LANGUAGE_TO_SKILL
};

