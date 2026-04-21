/**
 * Task template catalog.
 * Used by aiTaskService when no AI API is available.
 * Each template maps a technology/stack to a structured task list.
 */

const PRIORITY = { HIGH: 'high', MEDIUM: 'medium', LOW: 'low' };
const CATEGORY = { LEARNING: 'learning', PROJECT: 'project', PRACTICE: 'practice' };

// ── Generic level-based templates ────────────────────────────────────────

const BEGINNER_GENERIC = (stack) => [
  { title: `Learn ${stack} fundamentals`, description: `Study the core concepts, syntax, and mental model of ${stack}. Follow the official documentation and complete at least one beginner tutorial. Take notes on key concepts.`, points: 5, priority: PRIORITY.HIGH, category: CATEGORY.LEARNING },
  { title: `Complete a ${stack} tutorial project`, description: `Follow an end-to-end beginner tutorial that builds a real project. Focus on understanding each step rather than just copying code. Rebuild it from scratch afterward.`, points: 3, priority: PRIORITY.HIGH, category: CATEGORY.LEARNING },
  { title: `Build a simple ${stack} project from scratch`, description: `Apply what you learned by building a small project independently. Choose something you can finish in 1–2 days. Focus on clean code and proper structure.`, points: 5, priority: PRIORITY.MEDIUM, category: CATEGORY.PROJECT },
  { title: `Read ${stack} official documentation`, description: `Explore the official docs for the most-used APIs and patterns. Bookmark key reference pages. Read at least 3 in-depth guides beyond the getting-started section.`, points: 1, priority: PRIORITY.LOW, category: CATEGORY.LEARNING },
  { title: `Practice ${stack} with coding exercises`, description: `Solve 10 coding exercises focused on ${stack} fundamentals. Use platforms like LeetCode, Exercism, or Codewars. Review solutions and understand alternative approaches.`, points: 3, priority: PRIORITY.MEDIUM, category: CATEGORY.PRACTICE },
  { title: `Join a ${stack} community and ask questions`, description: `Join the official Discord, Reddit, or Stack Overflow community. Ask at least one question and answer one. Reading others' questions is one of the fastest ways to learn.`, points: 1, priority: PRIORITY.LOW, category: CATEGORY.LEARNING },
  { title: `Deploy your first ${stack} project`, description: `Get your project live on the internet. Use a free hosting platform like Vercel, Netlify, or Railway. Share the link and get feedback from peers.`, points: 3, priority: PRIORITY.MEDIUM, category: CATEGORY.PROJECT },
  { title: `Review and refactor your ${stack} code`, description: `Go back to your first project and improve it. Apply what you've learned: better naming, smaller functions, error handling, and code organization.`, points: 3, priority: PRIORITY.LOW, category: CATEGORY.PRACTICE },
];

const INTERMEDIATE_GENERIC = (stack) => [
  { title: `Build a full ${stack} project`, description: `Create a complete project with real features: authentication, data persistence, and a polished UI. Deploy it publicly and add it to your portfolio with a detailed README.`, points: 5, priority: PRIORITY.HIGH, category: CATEGORY.PROJECT },
  { title: `Write tests for your ${stack} code`, description: `Add unit and integration tests to an existing project. Aim for 70%+ code coverage. Use the standard testing framework for ${stack} and practice TDD on at least one new feature.`, points: 3, priority: PRIORITY.HIGH, category: CATEGORY.PRACTICE },
  { title: `Optimize ${stack} performance`, description: `Profile your application to find bottlenecks. Apply at least 3 optimizations (caching, lazy loading, query optimization). Measure and document the before/after improvement.`, points: 3, priority: PRIORITY.MEDIUM, category: CATEGORY.PRACTICE },
  { title: `Contribute to a ${stack} open-source project`, description: `Find a project on GitHub, read the contributing guide, and submit a meaningful PR. Start with a bug fix or documentation improvement. Engage with maintainer feedback.`, points: 5, priority: PRIORITY.MEDIUM, category: CATEGORY.PROJECT },
  { title: `Study advanced ${stack} patterns`, description: `Learn 3 design patterns commonly used in ${stack}: understand the problem each solves, implement a small example, and identify where you could apply them in your existing projects.`, points: 3, priority: PRIORITY.LOW, category: CATEGORY.LEARNING },
  { title: `Set up CI/CD for a ${stack} project`, description: `Configure GitHub Actions to run tests, linting, and deployment automatically on every push. Add status badges to your README and set up branch protection rules.`, points: 5, priority: PRIORITY.HIGH, category: CATEGORY.PROJECT },
  { title: `Code review and refactor an existing project`, description: `Review your oldest project with fresh eyes. Identify code smells, apply SOLID principles, extract reusable utilities, and improve error handling. Document the changes you made.`, points: 3, priority: PRIORITY.MEDIUM, category: CATEGORY.PRACTICE },
  { title: `Write a technical blog post about ${stack}`, description: `Share something you learned recently about ${stack}. Explain a concept, walk through a problem you solved, or compare two approaches. Publish on Dev.to or your personal blog.`, points: 3, priority: PRIORITY.LOW, category: CATEGORY.PRACTICE },
];

const ADVANCED_GENERIC = (stack) => [
  { title: `Architect a scalable ${stack} system`, description: `Design a production-grade architecture for a complex ${stack} system. Document the architecture with diagrams (C4 model), justify technology choices, and identify potential failure points.`, points: 5, priority: PRIORITY.HIGH, category: CATEGORY.PROJECT },
  { title: `Implement CI/CD and DevOps for ${stack}`, description: `Set up a complete DevOps pipeline: automated testing, Docker containerization, staging environment, and production deployment with rollback capability. Add monitoring and alerting.`, points: 5, priority: PRIORITY.HIGH, category: CATEGORY.PROJECT },
  { title: `Mentor others in ${stack}`, description: `Write a comprehensive tutorial or record a video series on an advanced ${stack} topic. Review code from junior developers and provide constructive feedback. Host a knowledge-sharing session.`, points: 3, priority: PRIORITY.MEDIUM, category: CATEGORY.PRACTICE },
  { title: `Review and refactor legacy ${stack} code`, description: `Take a legacy codebase and systematically improve it: add types, extract modules, improve test coverage, update dependencies, and document architectural decisions.`, points: 3, priority: PRIORITY.MEDIUM, category: CATEGORY.PRACTICE },
  { title: `Implement observability for a ${stack} system`, description: `Add structured logging, distributed tracing, and metrics to a production system. Set up dashboards in Grafana, configure alerts, and practice debugging with traces.`, points: 5, priority: PRIORITY.HIGH, category: CATEGORY.PROJECT },
  { title: `Conduct a security audit of a ${stack} project`, description: `Review a project for OWASP Top 10 vulnerabilities. Run automated security scanners, fix identified issues, add security headers, and document the security posture.`, points: 3, priority: PRIORITY.HIGH, category: CATEGORY.PRACTICE },
  { title: `Explore ${stack} ecosystem updates`, description: `Research the latest major releases and RFC proposals in the ${stack} ecosystem. Evaluate 2–3 new tools or libraries. Write a summary of what's changing and how it affects your projects.`, points: 1, priority: PRIORITY.LOW, category: CATEGORY.LEARNING },
  { title: `Build a developer tool or library in ${stack}`, description: `Create a reusable library, CLI tool, or developer utility that solves a real problem. Publish it to npm/PyPI/GitHub. Write documentation and add automated tests.`, points: 5, priority: PRIORITY.MEDIUM, category: CATEGORY.PROJECT },
];

// ── Technology-specific templates (8–9 tasks each, rich descriptions) ────

const TECH_TEMPLATES = {
  react: [
    { title: 'Learn React hooks (useState, useEffect)', description: 'Study the two most essential React hooks. Build 3 small components using useState for local state and useEffect for data fetching. Understand the dependency array and cleanup functions to avoid memory leaks.', points: 5, priority: PRIORITY.HIGH, category: CATEGORY.LEARNING },
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
