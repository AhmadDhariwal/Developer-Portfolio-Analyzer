/**
 * Interview Prep shared constants — single source of truth for skill lists and aliases.
 *
 * TODO: replace static INTERVIEW_SKILLS list with GET /api/interview-prep/topics
 * when the backend topic API is implemented.
 */

/** Canonical list of supported interview prep skill/topic keys. */
export const INTERVIEW_SKILLS: string[] = [
  'javascript', 'typescript', 'python', 'java', 'cpp',
  'angular', 'react', 'nodejs', 'expressjs', 'nextjs',
  'mongodb', 'mysql', 'postgresql', 'redis', 'rest-apis',
  'graphql', 'html', 'css', 'git-github', 'oop', 'dsa',
  'aws', 'generative-ai', 'ai-agents', 'llm', 'rag',
  'langchain', 'system-design', 'mern', 'mean',
  'full-stack-web-development'
];

/** Human-readable display labels keyed by skill key. */
export const SKILL_LABELS: Record<string, string> = {
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  python: 'Python',
  java: 'Java',
  cpp: 'C++',
  angular: 'Angular',
  react: 'React',
  nodejs: 'Node.js',
  expressjs: 'Express.js',
  nextjs: 'Next.js',
  mongodb: 'MongoDB',
  mysql: 'MySQL',
  postgresql: 'PostgreSQL',
  redis: 'Redis',
  'rest-apis': 'REST APIs',
  graphql: 'GraphQL',
  html: 'HTML',
  css: 'CSS',
  'git-github': 'Git/GitHub',
  oop: 'OOP',
  dsa: 'DSA',
  aws: 'AWS',
  'generative-ai': 'Generative AI',
  'ai-agents': 'AI Agents',
  llm: 'LLM',
  rag: 'RAG',
  langchain: 'LangChain',
  'system-design': 'System Design',
  mern: 'Full Stack / MERN',
  mean: 'MEAN',
  'full-stack-web-development': 'Full Stack Web Development'
};

/**
 * Alias map for skill-based question matching.
 * Each key is a canonical skill; its value is an array of normalized text aliases
 * that the question text might contain.
 */
export const SKILL_MATCH_ALIASES: Record<string, string[]> = {
  javascript: ['javascript', 'js', 'ecmascript'],
  typescript: ['typescript', 'ts'],
  python: ['python', 'py'],
  java: ['java'],
  cpp: ['cpp', 'c++', 'cplusplus', 'c plus plus'],
  angular: ['angular', 'angularjs'],
  react: ['react', 'reactjs', 'react.js'],
  nodejs: ['nodejs', 'node', 'node.js', 'node js'],
  expressjs: ['expressjs', 'express', 'express.js', 'express js'],
  nextjs: ['nextjs', 'next', 'next.js', 'next js'],
  mongodb: ['mongodb', 'mongo', 'mongo db'],
  mysql: ['mysql', 'my sql'],
  postgresql: ['postgresql', 'postgres', 'postgresql db', 'postgres sql'],
  redis: ['redis'],
  'rest-apis': ['rest-apis', 'rest', 'rest api', 'restful api', 'restful apis'],
  graphql: ['graphql', 'graph ql'],
  html: ['html', 'hypertext markup language'],
  css: ['css', 'cascading style sheets'],
  'git-github': ['git-github', 'git', 'github', 'git github', 'git and github'],
  oop: ['oop', 'object oriented programming', 'object-oriented programming'],
  dsa: ['dsa', 'data structures and algorithms', 'data structures', 'algorithms'],
  aws: ['aws', 'amazon web services', 'amazon services', 'aws cloud'],
  'generative-ai': ['generative-ai', 'gen ai', 'genai', 'generative ai'],
  'ai-agents': ['ai-agents', 'agents', 'agentic ai', 'agent systems'],
  llm: ['llm', 'large language model', 'large language models', 'llms'],
  rag: ['rag', 'retrieval augmented generation', 'retrieval-augmented generation'],
  langchain: ['langchain', 'lang chain'],
  'system-design': ['system-design', 'system design', 'systems design', 'distributed systems'],
  mern: ['mern', 'mongo express react node', 'mern stack'],
  mean: ['mean', 'mongo express angular node', 'mean stack'],
  'full-stack-web-development': [
    'full-stack-web-development', 'fullstack', 'full stack',
    'full stack web', 'full stack development'
  ]
};

/**
 * Maps career stack keywords (matched as lowercase substrings) to interview skill keys.
 * Used to pre-select the skill dropdown from the user's career profile.
 * Keys must match what CareerStack values look like in lowercase.
 * Returns '' for unknown stacks — avoids forcing the wrong skill.
 */
export const CAREER_STACK_TO_SKILL: Record<string, string> = {
  'frontend': 'react',
  'backend': 'nodejs',
  'full stack': 'mern',
  'ai/ml': 'generative-ai',
  // extra aliases for flexibility
  'fullstack': 'mern',
  'full-stack': 'mern',
  'python': 'python',
  'java': 'java',
  'devops': 'aws',
  'angular': 'angular',
  'react': 'react',
  'node': 'nodejs'
};
