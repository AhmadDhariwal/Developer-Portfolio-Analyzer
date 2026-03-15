/**
 * Maps each experience level to constraints used by the AI prompts.
 * Controllers and prompts import EXPERIENCE_CONFIG directly.
 */
const EXPERIENCE_CONFIG = {
  'Student': {
    difficultyRange:  ['Beginner'],
    maxNewTechs:      1,
    projectCount:     3,
    complexityHint:   'simple single-page apps, CLI tools, or static sites',
    techDepth:        'focus on core fundamentals — HTML/CSS/JS or a single framework',
    salaryContext:    'internship or entry-level positions'
  },
  'Intern': {
    difficultyRange:  ['Beginner', 'Intermediate'],
    maxNewTechs:      1,
    projectCount:     3,
    complexityHint:   'guided CRUD apps, REST API consumption, or component libraries',
    techDepth:        'solidify one framework and introduce basic backend connectivity',
    salaryContext:    'junior developer or associate engineer positions'
  },
  '0-1 years': {
    difficultyRange:  ['Beginner', 'Intermediate'],
    maxNewTechs:      2,
    projectCount:     4,
    complexityHint:   'full CRUD applications with authentication and a database',
    techDepth:        'integrate frontend + backend with deployment on a cloud platform',
    salaryContext:    'junior or associate developer positions ($40k–$70k)'
  },
  '1-2 years': {
    difficultyRange:  ['Intermediate'],
    maxNewTechs:      2,
    projectCount:     4,
    complexityHint:   'multi-feature apps with real-time features, file handling, or third-party APIs',
    techDepth:        'introduce testing, CI/CD basics, and containerisation fundamentals',
    salaryContext:    'mid-level developer positions ($65k–$95k)'
  },
  '2-3 years': {
    difficultyRange:  ['Intermediate', 'Advanced'],
    maxNewTechs:      2,
    projectCount:     5,
    complexityHint:   'distributed systems, microservices-lite, or data-heavy dashboards',
    techDepth:        'emphasise system design, performance optimisation, and observability',
    salaryContext:    'mid to senior developer positions ($85k–$120k)'
  },
  '3-5 years': {
    difficultyRange:  ['Advanced'],
    maxNewTechs:      2,
    projectCount:     5,
    complexityHint:   'production-grade architecture: event-driven, scalable, secure',
    techDepth:        'focus on architectural patterns, cloud-native tooling, and team-level concerns',
    salaryContext:    'senior developer positions ($110k–$150k)'
  },
  '5+ years': {
    difficultyRange:  ['Advanced'],
    maxNewTechs:      1,
    projectCount:     5,
    complexityHint:   'platform or infrastructure engineering, open-source contributions, or technical leadership',
    techDepth:        'leadership, mentoring, architecture decisions, and cross-team impact',
    salaryContext:    'staff/principal engineer or tech lead positions ($140k+)'
  }
};

/**
 * Resolves the config for a given level, defaulting to Student if unknown.
 * @param {string} experienceLevel
 * @returns {{ difficultyRange: string[], maxNewTechs: number, projectCount: number, complexityHint: string, techDepth: string, salaryContext: string }}
 */
const getExperienceConfig = (experienceLevel) => {
  return EXPERIENCE_CONFIG[experienceLevel] || EXPERIENCE_CONFIG['Student'];
};

module.exports = { EXPERIENCE_CONFIG, getExperienceConfig };
