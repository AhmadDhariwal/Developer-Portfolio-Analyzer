/**
 * Task template catalog.
 * Used by aiTaskService when no AI API is available.
 * Each template maps a technology/stack to a structured task list.
 */

const PRIORITY = { HIGH: 'high', MEDIUM: 'medium', LOW: 'low' };
const CATEGORY = { LEARNING: 'learning', PROJECT: 'project', PRACTICE: 'practice' };

// ── Generic level-based templates ────────────────────────────────────────

const BEGINNER_GENERIC = (stack) => [
  { title: `Learn ${stack} fundamentals`, description: 'Study core concepts and syntax', points: 5, priority: PRIORITY.HIGH, category: CATEGORY.LEARNING },
  { title: `Complete a ${stack} tutorial`, description: 'Follow an end-to-end beginner tutorial', points: 3, priority: PRIORITY.HIGH, category: CATEGORY.LEARNING },
  { title: `Build a simple ${stack} project`, description: 'Apply what you learned in a small project', points: 5, priority: PRIORITY.MEDIUM, category: CATEGORY.PROJECT },
  { title: `Read ${stack} documentation`, description: 'Explore official docs for key APIs', points: 1, priority: PRIORITY.LOW, category: CATEGORY.LEARNING },
  { title: `Practice ${stack} exercises`, description: 'Solve 5 coding exercises', points: 3, priority: PRIORITY.MEDIUM, category: CATEGORY.PRACTICE },
];

const INTERMEDIATE_GENERIC = (stack) => [
  { title: `Build a full ${stack} project`, description: 'Create a complete project with real features', points: 5, priority: PRIORITY.HIGH, category: CATEGORY.PROJECT },
  { title: `Write tests for ${stack} code`, description: 'Add unit and integration tests', points: 3, priority: PRIORITY.HIGH, category: CATEGORY.PRACTICE },
  { title: `Optimize ${stack} performance`, description: 'Profile and improve bottlenecks', points: 3, priority: PRIORITY.MEDIUM, category: CATEGORY.PRACTICE },
  { title: `Contribute to a ${stack} open-source project`, description: 'Submit a PR or fix an issue', points: 5, priority: PRIORITY.MEDIUM, category: CATEGORY.PROJECT },
  { title: `Study advanced ${stack} patterns`, description: 'Learn design patterns specific to this stack', points: 3, priority: PRIORITY.LOW, category: CATEGORY.LEARNING },
];

const ADVANCED_GENERIC = (stack) => [
  { title: `Architect a scalable ${stack} system`, description: 'Design a production-grade architecture', points: 5, priority: PRIORITY.HIGH, category: CATEGORY.PROJECT },
  { title: `Mentor others in ${stack}`, description: 'Write a blog post or record a tutorial', points: 3, priority: PRIORITY.MEDIUM, category: CATEGORY.PRACTICE },
  { title: `Implement CI/CD for ${stack} project`, description: 'Set up automated pipelines', points: 5, priority: PRIORITY.HIGH, category: CATEGORY.PROJECT },
  { title: `Review and refactor legacy ${stack} code`, description: 'Improve code quality and maintainability', points: 3, priority: PRIORITY.MEDIUM, category: CATEGORY.PRACTICE },
  { title: `Explore ${stack} ecosystem updates`, description: 'Stay current with latest releases', points: 1, priority: PRIORITY.LOW, category: CATEGORY.LEARNING },
];

// ── Technology-specific templates ─────────────────────────────────────────

const TECH_TEMPLATES = {
  react: [
    { title: 'Learn React hooks (useState, useEffect)', description: 'Build 3 components using hooks', points: 5, priority: PRIORITY.HIGH, category: CATEGORY.LEARNING },
    { title: 'Build a React UI component library', description: 'Create reusable Button, Input, Modal components', points: 5, priority: PRIORITY.HIGH, category: CATEGORY.PROJECT },
    { title: 'Implement React Router navigation', description: 'Add multi-page routing to a project', points: 3, priority: PRIORITY.MEDIUM, category: CATEGORY.PROJECT },
    { title: 'Manage state with Context API or Redux', description: 'Implement global state management', points: 5, priority: PRIORITY.HIGH, category: CATEGORY.PRACTICE },
    { title: 'Deploy React app to Vercel/Netlify', description: 'Set up CI/CD and deploy', points: 3, priority: PRIORITY.MEDIUM, category: CATEGORY.PROJECT },
    { title: 'Write React component tests with Jest', description: 'Add unit tests for 5 components', points: 3, priority: PRIORITY.LOW, category: CATEGORY.PRACTICE },
  ],
  angular: [
    { title: 'Learn Angular components and modules', description: 'Build 3 standalone components', points: 5, priority: PRIORITY.HIGH, category: CATEGORY.LEARNING },
    { title: 'Implement Angular services and DI', description: 'Create a data service with HTTP client', points: 5, priority: PRIORITY.HIGH, category: CATEGORY.PRACTICE },
    { title: 'Build Angular reactive forms', description: 'Create a validated form with FormBuilder', points: 3, priority: PRIORITY.MEDIUM, category: CATEGORY.PROJECT },
    { title: 'Set up Angular routing with guards', description: 'Implement auth guard and lazy loading', points: 5, priority: PRIORITY.HIGH, category: CATEGORY.PROJECT },
    { title: 'Write Angular unit tests with Jasmine', description: 'Test 5 components and services', points: 3, priority: PRIORITY.LOW, category: CATEGORY.PRACTICE },
  ],
  vue: [
    { title: 'Learn Vue 3 Composition API', description: 'Rewrite 3 components using setup()', points: 5, priority: PRIORITY.HIGH, category: CATEGORY.LEARNING },
    { title: 'Build a Vue SPA with Pinia', description: 'Create a full app with state management', points: 5, priority: PRIORITY.HIGH, category: CATEGORY.PROJECT },
    { title: 'Implement Vue Router', description: 'Add navigation with dynamic routes', points: 3, priority: PRIORITY.MEDIUM, category: CATEGORY.PROJECT },
    { title: 'Deploy Vue app', description: 'Deploy to Vercel or Netlify', points: 3, priority: PRIORITY.LOW, category: CATEGORY.PROJECT },
  ],
  nodejs: [
    { title: 'Build a REST API with Express', description: 'Create CRUD endpoints with validation', points: 5, priority: PRIORITY.HIGH, category: CATEGORY.PROJECT },
    { title: 'Implement JWT authentication', description: 'Add login/register with JWT tokens', points: 5, priority: PRIORITY.HIGH, category: CATEGORY.PRACTICE },
    { title: 'Connect Node.js to MongoDB', description: 'Use Mongoose for data modeling', points: 3, priority: PRIORITY.HIGH, category: CATEGORY.PRACTICE },
    { title: 'Add error handling middleware', description: 'Implement global error handler', points: 3, priority: PRIORITY.MEDIUM, category: CATEGORY.PRACTICE },
    { title: 'Write API tests with Jest/Supertest', description: 'Test all endpoints', points: 3, priority: PRIORITY.LOW, category: CATEGORY.PRACTICE },
    { title: 'Deploy Node.js app to Railway/Render', description: 'Set up production deployment', points: 3, priority: PRIORITY.MEDIUM, category: CATEGORY.PROJECT },
  ],
  python: [
    { title: 'Build a Python REST API with FastAPI', description: 'Create endpoints with Pydantic models', points: 5, priority: PRIORITY.HIGH, category: CATEGORY.PROJECT },
    { title: 'Learn Python data structures', description: 'Practice lists, dicts, sets, comprehensions', points: 3, priority: PRIORITY.HIGH, category: CATEGORY.LEARNING },
    { title: 'Write Python unit tests', description: 'Use pytest for 10 test cases', points: 3, priority: PRIORITY.MEDIUM, category: CATEGORY.PRACTICE },
    { title: 'Implement Python OOP patterns', description: 'Build a class hierarchy with inheritance', points: 3, priority: PRIORITY.MEDIUM, category: CATEGORY.LEARNING },
    { title: 'Deploy Python app to Heroku/Railway', description: 'Set up production environment', points: 3, priority: PRIORITY.LOW, category: CATEGORY.PROJECT },
  ],
  docker: [
    { title: 'Learn Docker basics', description: 'Understand images, containers, volumes', points: 5, priority: PRIORITY.HIGH, category: CATEGORY.LEARNING },
    { title: 'Write a Dockerfile for your app', description: 'Containerize an existing project', points: 5, priority: PRIORITY.HIGH, category: CATEGORY.PROJECT },
    { title: 'Set up Docker Compose', description: 'Orchestrate multi-container app', points: 5, priority: PRIORITY.HIGH, category: CATEGORY.PROJECT },
    { title: 'Push image to Docker Hub', description: 'Publish and version your container', points: 3, priority: PRIORITY.MEDIUM, category: CATEGORY.PRACTICE },
    { title: 'Learn Docker networking', description: 'Connect containers with custom networks', points: 3, priority: PRIORITY.LOW, category: CATEGORY.LEARNING },
  ],
  typescript: [
    { title: 'Learn TypeScript types and interfaces', description: 'Convert a JS project to TypeScript', points: 5, priority: PRIORITY.HIGH, category: CATEGORY.LEARNING },
    { title: 'Implement TypeScript generics', description: 'Build 3 generic utility functions', points: 3, priority: PRIORITY.MEDIUM, category: CATEGORY.PRACTICE },
    { title: 'Use TypeScript with a framework', description: 'Build a typed React or Node.js project', points: 5, priority: PRIORITY.HIGH, category: CATEGORY.PROJECT },
    { title: 'Configure strict TypeScript', description: 'Enable strict mode and fix all errors', points: 3, priority: PRIORITY.MEDIUM, category: CATEGORY.PRACTICE },
  ],
  'machine learning': [
    { title: 'Learn ML fundamentals', description: 'Study supervised vs unsupervised learning', points: 5, priority: PRIORITY.HIGH, category: CATEGORY.LEARNING },
    { title: 'Build a classification model', description: 'Train and evaluate with scikit-learn', points: 5, priority: PRIORITY.HIGH, category: CATEGORY.PROJECT },
    { title: 'Explore a Kaggle dataset', description: 'EDA and feature engineering', points: 3, priority: PRIORITY.MEDIUM, category: CATEGORY.PRACTICE },
    { title: 'Deploy an ML model as API', description: 'Serve predictions via FastAPI', points: 5, priority: PRIORITY.HIGH, category: CATEGORY.PROJECT },
    { title: 'Learn neural network basics', description: 'Build a simple NN with TensorFlow/PyTorch', points: 5, priority: PRIORITY.MEDIUM, category: CATEGORY.LEARNING },
  ],
  'full stack': [
    { title: 'Build a full-stack CRUD app', description: 'Frontend + backend + database', points: 5, priority: PRIORITY.HIGH, category: CATEGORY.PROJECT },
    { title: 'Implement authentication end-to-end', description: 'JWT login flow from UI to API', points: 5, priority: PRIORITY.HIGH, category: CATEGORY.PRACTICE },
    { title: 'Deploy full-stack app', description: 'Frontend on Vercel, backend on Railway', points: 5, priority: PRIORITY.HIGH, category: CATEGORY.PROJECT },
    { title: 'Add real-time features', description: 'Implement WebSocket or SSE', points: 3, priority: PRIORITY.MEDIUM, category: CATEGORY.PROJECT },
    { title: 'Write end-to-end tests', description: 'Use Cypress or Playwright', points: 3, priority: PRIORITY.LOW, category: CATEGORY.PRACTICE },
  ],
  devops: [
    { title: 'Set up a CI/CD pipeline', description: 'Use GitHub Actions for automated builds', points: 5, priority: PRIORITY.HIGH, category: CATEGORY.PROJECT },
    { title: 'Learn Kubernetes basics', description: 'Deploy an app to a local k8s cluster', points: 5, priority: PRIORITY.HIGH, category: CATEGORY.LEARNING },
    { title: 'Configure monitoring with Prometheus', description: 'Set up metrics and alerts', points: 3, priority: PRIORITY.MEDIUM, category: CATEGORY.PRACTICE },
    { title: 'Implement infrastructure as code', description: 'Use Terraform for cloud resources', points: 5, priority: PRIORITY.MEDIUM, category: CATEGORY.PROJECT },
  ],
};

// ── Missing skill → task mapping ──────────────────────────────────────────

const SKILL_TO_TASK = {
  docker:     { title: 'Learn Docker basics', description: 'Containerize an existing project', points: 5, priority: PRIORITY.HIGH, category: CATEGORY.LEARNING },
  kubernetes: { title: 'Learn Kubernetes fundamentals', description: 'Deploy to a local k8s cluster', points: 5, priority: PRIORITY.HIGH, category: CATEGORY.LEARNING },
  typescript: { title: 'Learn TypeScript', description: 'Convert a JS project to TypeScript', points: 5, priority: PRIORITY.HIGH, category: CATEGORY.LEARNING },
  graphql:    { title: 'Learn GraphQL', description: 'Build a GraphQL API with Apollo', points: 5, priority: PRIORITY.HIGH, category: CATEGORY.LEARNING },
  redis:      { title: 'Learn Redis caching', description: 'Add caching to an existing API', points: 3, priority: PRIORITY.MEDIUM, category: CATEGORY.LEARNING },
  aws:        { title: 'Learn AWS fundamentals', description: 'Deploy an app to EC2 or Lambda', points: 5, priority: PRIORITY.HIGH, category: CATEGORY.LEARNING },
  testing:    { title: 'Write automated tests', description: 'Add unit and integration tests', points: 3, priority: PRIORITY.HIGH, category: CATEGORY.PRACTICE },
  git:        { title: 'Master Git workflows', description: 'Practice branching, rebasing, PRs', points: 3, priority: PRIORITY.HIGH, category: CATEGORY.PRACTICE },
  sql:        { title: 'Learn SQL fundamentals', description: 'Write complex queries and joins', points: 3, priority: PRIORITY.HIGH, category: CATEGORY.LEARNING },
  mongodb:    { title: 'Learn MongoDB', description: 'Design schemas and write aggregations', points: 3, priority: PRIORITY.MEDIUM, category: CATEGORY.LEARNING },
  ci_cd:      { title: 'Set up CI/CD pipeline', description: 'Automate builds with GitHub Actions', points: 5, priority: PRIORITY.HIGH, category: CATEGORY.PROJECT },
  security:   { title: 'Learn web security basics', description: 'Study OWASP Top 10 vulnerabilities', points: 3, priority: PRIORITY.HIGH, category: CATEGORY.LEARNING },
};

// ── GitHub weakness → task mapping ────────────────────────────────────────

const GITHUB_WEAKNESS_TASKS = {
  low_commits:    { title: 'Increase commit frequency', description: 'Commit at least once daily for 2 weeks', points: 3, priority: PRIORITY.HIGH, category: CATEGORY.PRACTICE },
  poor_readme:    { title: 'Improve project READMEs', description: 'Add description, setup, and usage to 3 repos', points: 3, priority: PRIORITY.MEDIUM, category: CATEGORY.PRACTICE },
  no_tests:       { title: 'Add tests to a project', description: 'Write unit tests for an existing repo', points: 5, priority: PRIORITY.HIGH, category: CATEGORY.PRACTICE },
  low_stars:      { title: 'Build a portfolio project', description: 'Create a project worth starring', points: 5, priority: PRIORITY.HIGH, category: CATEGORY.PROJECT },
  no_description: { title: 'Add repo descriptions', description: 'Update all repos with clear descriptions', points: 1, priority: PRIORITY.LOW, category: CATEGORY.PRACTICE },
};

/**
 * Get tasks for a given technology key.
 * Falls back to generic templates based on experience level.
 */
const getTasksForTechnology = (technology, experienceLevel = 'Student') => {
  const key = String(technology || '').toLowerCase().trim();
  if (TECH_TEMPLATES[key]) return [...TECH_TEMPLATES[key]];

  // Partial match
  const partialKey = Object.keys(TECH_TEMPLATES).find(k => key.includes(k) || k.includes(key));
  if (partialKey) return [...TECH_TEMPLATES[partialKey]];

  // Fall back to level-based generic
  const level = String(experienceLevel || '').toLowerCase();
  if (level.includes('student') || level.includes('intern') || level.includes('0-1')) {
    return BEGINNER_GENERIC(technology || 'your chosen technology');
  }
  if (level.includes('5+') || level.includes('senior') || level.includes('staff')) {
    return ADVANCED_GENERIC(technology || 'your chosen technology');
  }
  return INTERMEDIATE_GENERIC(technology || 'your chosen technology');
};

/**
 * Convert a missing skill name to a task.
 */
const getTaskForMissingSkill = (skillName) => {
  const key = String(skillName || '').toLowerCase().replace(/[^a-z0-9_]/g, '_');
  return SKILL_TO_TASK[key] || {
    title: `Learn ${skillName}`,
    description: `Study ${skillName} fundamentals and build a small project`,
    points: 3,
    priority: PRIORITY.MEDIUM,
    category: CATEGORY.LEARNING,
  };
};

/**
 * Convert a GitHub weakness key to a task.
 */
const getTaskForGitHubWeakness = (weaknessKey) => {
  return GITHUB_WEAKNESS_TASKS[weaknessKey] || null;
};

module.exports = {
  getTasksForTechnology,
  getTaskForMissingSkill,
  getTaskForGitHubWeakness,
  TECH_TEMPLATES,
  SKILL_TO_TASK,
  GITHUB_WEAKNESS_TASKS,
};
