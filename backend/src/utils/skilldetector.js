/**
 * Comprehensive industry skill database used for skill-gap detection.
 * Each entry represents a skill demanded in senior developer job postings.
 */
const INDUSTRY_SKILLS = [
  // Frontend
  { name: 'React',        category: 'Frontend',  priority: 'High',   jobDemand: 91, aliases: ['react.js', 'reactjs'] },
  { name: 'TypeScript',   category: 'Language',  priority: 'High',   jobDemand: 88, aliases: ['ts'] },
  { name: 'Next.js',      category: 'Frontend',  priority: 'High',   jobDemand: 76, aliases: ['nextjs', 'next'] },
  { name: 'Angular',      category: 'Frontend',  priority: 'Medium', jobDemand: 62, aliases: [] },
  { name: 'Vue',          category: 'Frontend',  priority: 'Medium', jobDemand: 54, aliases: ['vue.js', 'vuejs'] },
  { name: 'Tailwind CSS', category: 'Frontend',  priority: 'Medium', jobDemand: 65, aliases: ['tailwind'] },
  // Backend
  { name: 'Node.js',      category: 'Backend',   priority: 'High',   jobDemand: 84, aliases: ['nodejs', 'node'] },
  { name: 'REST APIs',    category: 'Backend',   priority: 'High',   jobDemand: 88, aliases: ['rest', 'restful', 'rest api'] },
  { name: 'GraphQL',      category: 'Backend',   priority: 'Medium', jobDemand: 60, aliases: [] },
  { name: 'Python',       category: 'Language',  priority: 'High',   jobDemand: 82, aliases: [] },
  { name: 'Go',           category: 'Language',  priority: 'Medium', jobDemand: 75, aliases: ['golang'] },
  { name: 'Rust',         category: 'Language',  priority: 'Low',    jobDemand: 56, aliases: [] },
  { name: 'Java',         category: 'Language',  priority: 'Medium', jobDemand: 68, aliases: [] },
  // DevOps / Cloud
  { name: 'Docker',       category: 'DevOps',    priority: 'High',   jobDemand: 87, aliases: ['dockerfile'] },
  { name: 'Kubernetes',   category: 'DevOps',    priority: 'High',   jobDemand: 94, aliases: ['k8s'] },
  { name: 'AWS',          category: 'Cloud',     priority: 'High',   jobDemand: 98, aliases: ['amazon web services'] },
  { name: 'Terraform',    category: 'DevOps',    priority: 'Medium', jobDemand: 76, aliases: ['hcl'] },
  { name: 'CI/CD',        category: 'DevOps',    priority: 'High',   jobDemand: 83, aliases: ['cicd', 'github actions', 'jenkins', 'gitlab ci'] },
  { name: 'Kafka',        category: 'Backend',   priority: 'Medium', jobDemand: 71, aliases: ['apache kafka'] },
  { name: 'Prometheus',   category: 'DevOps',    priority: 'Low',    jobDemand: 55, aliases: [] },
  // Databases
  { name: 'PostgreSQL',   category: 'Database',  priority: 'High',   jobDemand: 79, aliases: ['postgres'] },
  { name: 'Redis',        category: 'Database',  priority: 'High',   jobDemand: 82, aliases: [] },
  { name: 'MongoDB',      category: 'Database',  priority: 'Medium', jobDemand: 65, aliases: ['mongo'] },
  // Tools
  { name: 'Git',          category: 'Tools',     priority: 'High',   jobDemand: 97, aliases: [] },
  { name: 'Jest',         category: 'Testing',   priority: 'Medium', jobDemand: 62, aliases: [] },
  // Additional languages — recognised so they show up as "current skills"
  { name: 'C',            category: 'Language',  priority: 'Medium', jobDemand: 60, aliases: [] },
  { name: 'C++',          category: 'Language',  priority: 'Medium', jobDemand: 63, aliases: ['cpp'] },
  { name: 'C#',           category: 'Language',  priority: 'Medium', jobDemand: 65, aliases: ['csharp', 'dotnet', '.net'] },
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
  'JavaScript':  'Node.js',
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
  'CSS':         'Tailwind CSS',
  'HTML':        'React',   // HTML repos are usually frontend
  'Shell':       'CI/CD',
  'Dockerfile':  'Docker',
  'HCL':         'Terraform',
};

/**
 * Given a list of skill names (strings), return which INDUSTRY_SKILLS are present vs missing.
 * Returns { currentSkills, missingSkills } — both typed as INDUSTRY_SKILLS entries.
 */
const detectSkillGaps = (currentSkillNames = []) => {
  const lowerNames = currentSkillNames.map(s => s.toLowerCase());

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
    const mapped = LANGUAGE_TO_SKILL[language];
    if (mapped) skills.add(mapped);
  });
  return [...skills];
};

module.exports = { detectSkillGaps, skillsFromLanguages, INDUSTRY_SKILLS, LANGUAGE_TO_SKILL };

