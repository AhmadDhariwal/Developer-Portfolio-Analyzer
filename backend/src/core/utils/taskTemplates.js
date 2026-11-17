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
    { title: 'Learn React hooks (useState, useEffect)', description: 'Study the two most essential React hooks. Build 3 small components using useState for local state and useEffect for data fetching. Understand the dependency array and cleanup functions to avoid memory leaks. Goal: Write functional components without class syntax.', points: 5, priority: PRIORITY.HIGH, category: CATEGORY.LEARNING },
    { title: 'Build a React UI component library', description: 'Create reusable components: Button (with variants), Input (with validation), Modal, and Card. Use TypeScript props interfaces and document each component with usage examples. Goal: Have a personal component kit you can reuse across projects.', points: 5, priority: PRIORITY.HIGH, category: CATEGORY.PROJECT },
    { title: 'Implement React Router navigation', description: 'Add multi-page routing using React Router v6. Implement nested routes, dynamic route params, and a 404 page. Use useNavigate and useParams hooks. Goal: Build a multi-page SPA with clean URL structure.', points: 3, priority: PRIORITY.MEDIUM, category: CATEGORY.PROJECT },
    { title: 'Manage state with Context API or Redux', description: 'Implement a global state solution using React Context and useReducer. Create an auth context that persists login state across page refreshes using localStorage. Goal: Understand when to use local vs global state.', points: 5, priority: PRIORITY.HIGH, category: CATEGORY.PRACTICE },
    { title: 'Deploy React app to Vercel/Netlify', description: 'Connect your GitHub repo to Vercel. Configure environment variables, set up preview deployments for PRs, and add a custom domain. Verify the production build works and Lighthouse scores are above 90. Goal: Ship a production-ready React app.', points: 3, priority: PRIORITY.MEDIUM, category: CATEGORY.PROJECT },
    { title: 'Write React component tests with Jest', description: 'Add unit tests for 5 components using React Testing Library. Test user interactions, async state updates, and conditional rendering. Mock API calls and aim for 80%+ coverage. Goal: Build confidence that your UI works as expected.', points: 3, priority: PRIORITY.LOW, category: CATEGORY.PRACTICE },
    { title: 'Fetch and display data from a REST API', description: 'Build a data-fetching layer using useEffect and useState. Handle loading, error, and success states with proper UI feedback. Implement pagination or infinite scroll for a list of items. Goal: Connect a React app to a real backend API.', points: 3, priority: PRIORITY.MEDIUM, category: CATEGORY.PRACTICE },
    { title: 'Optimize React performance with memoization', description: 'Profile a React app using React DevTools Profiler. Apply useMemo, useCallback, and React.memo to prevent unnecessary re-renders. Measure and document before/after performance improvements. Goal: Reduce render count by at least 30%.', points: 3, priority: PRIORITY.MEDIUM, category: CATEGORY.PRACTICE },
    { title: 'Build a full React CRUD application', description: 'Create a complete task manager or notes app with Create, Read, Update, Delete operations. Use a backend API or localStorage. Include form validation, optimistic UI updates, and error boundaries. Goal: Demonstrate end-to-end React proficiency.', points: 5, priority: PRIORITY.HIGH, category: CATEGORY.PROJECT },
  ],
  angular: [
    { title: 'Learn Angular standalone components', description: 'Build 3 standalone components without NgModule. Understand the imports array, component lifecycle hooks (ngOnInit, ngOnDestroy), and OnPush change detection strategy. Goal: Write modern Angular without legacy module boilerplate.', points: 5, priority: PRIORITY.HIGH, category: CATEGORY.LEARNING },
    { title: 'Implement Angular services with HttpClient', description: 'Create a data service that fetches from a REST API using HttpClient. Handle errors with catchError, add loading states, and use RxJS operators like map and switchMap. Goal: Build a reusable data layer for your Angular app.', points: 5, priority: PRIORITY.HIGH, category: CATEGORY.PRACTICE },
    { title: 'Build Angular reactive forms with validation', description: 'Create a registration form using FormBuilder and Validators. Add custom validators, cross-field validation (password match), and display error messages. Goal: Handle complex form logic cleanly with reactive patterns.', points: 3, priority: PRIORITY.MEDIUM, category: CATEGORY.PROJECT },
    { title: 'Set up Angular routing with guards', description: 'Implement feature-based routing with lazy-loaded modules. Add route guards (CanActivate) for auth protection and route resolvers for data pre-loading. Goal: Build a performant multi-page Angular app with protected routes.', points: 5, priority: PRIORITY.HIGH, category: CATEGORY.PROJECT },
    { title: 'Write Angular unit tests with Jasmine', description: 'Test 5 components and 3 services using TestBed. Mock HTTP calls with HttpClientTestingModule, test async operations with fakeAsync/tick, and verify template bindings. Goal: Ensure your Angular code is reliable and regression-free.', points: 3, priority: PRIORITY.LOW, category: CATEGORY.PRACTICE },
  ],
  vue: [
    { title: 'Learn Vue 3 Composition API', description: 'Rewrite 3 Options API components using the Composition API with setup(). Use ref(), reactive(), computed(), and watch(). Understand the difference between ref and reactive. Goal: Write modern Vue 3 code using the recommended Composition API.', points: 5, priority: PRIORITY.HIGH, category: CATEGORY.LEARNING },
    { title: 'Build a Vue SPA with Pinia', description: 'Create a full single-page application with Pinia stores. Implement actions, getters, and state. Add store persistence with pinia-plugin-persistedstate for auth state. Goal: Manage complex application state cleanly in Vue 3.', points: 5, priority: PRIORITY.HIGH, category: CATEGORY.PROJECT },
    { title: 'Implement Vue Router', description: 'Add multi-page routing with dynamic route params and nested routes. Implement beforeEach navigation guards for auth and use route meta fields for page titles. Goal: Build a multi-page Vue app with protected routes.', points: 3, priority: PRIORITY.MEDIUM, category: CATEGORY.PROJECT },
    { title: 'Deploy Vue app', description: 'Configure Vite build for production, set up environment variables, and deploy to Netlify with automatic deployments from GitHub. Configure SPA redirects and add a custom domain. Goal: Ship a production Vue app with automated deployments.', points: 3, priority: PRIORITY.LOW, category: CATEGORY.PROJECT },
    { title: 'Integrate Vue with a REST API', description: 'Build a CRUD interface communicating with a backend API using axios. Handle authentication headers, error responses, and implement optimistic updates. Goal: Connect a Vue app to a real backend and handle all edge cases.', points: 5, priority: PRIORITY.HIGH, category: CATEGORY.PROJECT },
    { title: 'Write Vue component tests with Vitest', description: 'Test 5 components using Vue Test Utils and Vitest. Test props, emits, slots, and async behavior. Mock Pinia stores and Vue Router in tests. Goal: Ensure your Vue components behave correctly under all conditions.', points: 3, priority: PRIORITY.LOW, category: CATEGORY.PRACTICE },
  ],
  nodejs: [
    { title: 'Build a REST API with Express', description: 'Create a full CRUD REST API with Express. Add request validation using Joi or Zod, implement proper HTTP status codes, and structure routes with Express Router. Goal: Build a clean, well-structured API that follows REST conventions.', points: 5, priority: PRIORITY.HIGH, category: CATEGORY.PROJECT },
    { title: 'Implement JWT authentication', description: 'Add a complete auth system: register, login, refresh tokens, and logout. Implement role-based access control (RBAC) with middleware. Store refresh tokens securely in httpOnly cookies. Goal: Secure your API with industry-standard authentication.', points: 5, priority: PRIORITY.HIGH, category: CATEGORY.PRACTICE },
    { title: 'Connect Node.js to MongoDB', description: 'Design 3 Mongoose schemas with relationships (populate), indexes, and validation. Implement a repository pattern to abstract database operations. Goal: Build a maintainable data layer with proper schema design.', points: 3, priority: PRIORITY.HIGH, category: CATEGORY.PRACTICE },
    { title: 'Add error handling middleware', description: 'Implement a global error handling middleware that catches all errors. Create custom error classes (ValidationError, NotFoundError, AuthError). Add structured logging with Winston. Goal: Make your API debuggable and production-ready.', points: 3, priority: PRIORITY.MEDIUM, category: CATEGORY.PRACTICE },
    { title: 'Write API tests with Jest/Supertest', description: 'Write integration tests for all API endpoints using Supertest. Use mongodb-memory-server for test isolation. Test auth flows, validation errors, and edge cases. Goal: Achieve 85%+ test coverage on your API.', points: 3, priority: PRIORITY.LOW, category: CATEGORY.PRACTICE },
    { title: 'Deploy Node.js app to Railway/Render', description: 'Containerize the API with Docker, set up GitHub Actions for automated testing and deployment. Configure health check endpoints and zero-downtime deploys. Goal: Ship your API to production with automated pipelines.', points: 3, priority: PRIORITY.MEDIUM, category: CATEGORY.PROJECT },
    { title: 'Implement security middleware and rate limiting', description: 'Add express-rate-limit for API protection, helmet for security headers, cors for cross-origin control, and express-mongo-sanitize to prevent NoSQL injection. Goal: Harden your API against common web attacks.', points: 3, priority: PRIORITY.HIGH, category: CATEGORY.PRACTICE },
    { title: 'Implement Redis caching', description: 'Add Redis caching to expensive API endpoints. Implement cache invalidation strategies and use Redis for session storage. Goal: Reduce database load and improve API response times by 50%+.', points: 5, priority: PRIORITY.MEDIUM, category: CATEGORY.PROJECT },
  ],
  python: [
    { title: 'Build a Python REST API with FastAPI', description: 'Create a full CRUD API using FastAPI with Pydantic models for request/response validation. Add automatic OpenAPI documentation, dependency injection for auth, and background tasks. Goal: Build a modern, self-documenting Python API.', points: 5, priority: PRIORITY.HIGH, category: CATEGORY.PROJECT },
    { title: 'Learn Python data structures', description: 'Practice lists, dicts, sets, and comprehensions. Implement 5 common algorithms (binary search, merge sort, BFS, DFS, dynamic programming). Solve 10 LeetCode problems and analyze time/space complexity. Goal: Write efficient Python code and ace technical interviews.', points: 3, priority: PRIORITY.HIGH, category: CATEGORY.LEARNING },
    { title: 'Write Python unit tests', description: 'Write unit and integration tests using pytest. Use fixtures for test setup, parametrize for data-driven tests, and unittest.mock for external dependencies. Achieve 90%+ code coverage. Goal: Build confidence that your Python code works correctly.', points: 3, priority: PRIORITY.MEDIUM, category: CATEGORY.PRACTICE },
    { title: 'Implement Python OOP patterns', description: 'Build a class hierarchy using inheritance, abstract classes, and mixins. Implement 3 design patterns: Singleton, Factory, and Observer. Use dataclasses for clean data models. Goal: Write maintainable, extensible Python code using proven patterns.', points: 3, priority: PRIORITY.MEDIUM, category: CATEGORY.LEARNING },
    { title: 'Deploy Python app to Heroku/Railway', description: 'Containerize a FastAPI app with Docker using multi-stage builds. Use docker-compose for local development with PostgreSQL, and deploy to Heroku or Railway with automated deployments. Goal: Ship a Python app to production with zero manual steps.', points: 3, priority: PRIORITY.LOW, category: CATEGORY.PROJECT },
    { title: 'Work with databases using SQLAlchemy', description: 'Design a database schema with SQLAlchemy ORM. Implement relationships (one-to-many, many-to-many), database migrations with Alembic, and async database operations with asyncpg. Goal: Build a robust, type-safe database layer in Python.', points: 5, priority: PRIORITY.HIGH, category: CATEGORY.PRACTICE },
    { title: 'Implement async Python with asyncio', description: 'Rewrite synchronous code using async/await. Use aiohttp for async HTTP requests, asyncio.gather for concurrent operations, and understand event loop management. Goal: Handle thousands of concurrent operations efficiently.', points: 5, priority: PRIORITY.MEDIUM, category: CATEGORY.PRACTICE },
    { title: 'Implement data processing with pandas', description: 'Load, clean, and analyze a real dataset using pandas. Handle missing values, perform aggregations, create visualizations with matplotlib/seaborn, and export results. Goal: Extract actionable insights from raw data using Python.', points: 3, priority: PRIORITY.MEDIUM, category: CATEGORY.PRACTICE },
  ],
  docker: [
    { title: 'Learn Docker basics', description: 'Understand the difference between images and containers. Learn essential commands: build, run, exec, logs, ps, stop, rm. Understand layers, caching, and how Docker uses the host kernel for isolation. Goal: Run any application in a container confidently.', points: 5, priority: PRIORITY.HIGH, category: CATEGORY.LEARNING },
    { title: 'Write a Dockerfile for your app', description: 'Containerize an existing app using multi-stage builds to minimize image size. Leverage layer caching for faster builds, use a non-root user for security, and add a .dockerignore file. Goal: Produce a lean, secure production Docker image.', points: 5, priority: PRIORITY.HIGH, category: CATEGORY.PROJECT },
    { title: 'Set up Docker Compose', description: 'Create a docker-compose.yml orchestrating your app, database (PostgreSQL/MongoDB), and Redis. Configure volumes for data persistence, health checks, and service dependencies. Goal: Spin up your entire dev environment with one command.', points: 5, priority: PRIORITY.HIGH, category: CATEGORY.PROJECT },
    { title: 'Push image to Docker Hub', description: 'Tag and push images to Docker Hub. Set up automated builds triggered by GitHub pushes using GitHub Actions. Use semantic versioning for image tags. Goal: Publish versioned Docker images automatically on every release.', points: 3, priority: PRIORITY.MEDIUM, category: CATEGORY.PRACTICE },
    { title: 'Learn Docker networking', description: 'Understand bridge, host, and overlay networks. Create custom networks to isolate services. Configure container-to-container communication using service names. Goal: Connect microservices securely without exposing unnecessary ports.', points: 3, priority: PRIORITY.LOW, category: CATEGORY.LEARNING },
    { title: 'Implement Docker security best practices', description: 'Scan images for vulnerabilities with Trivy or Snyk. Use read-only filesystems, drop Linux capabilities, and implement resource limits (CPU/memory). Goal: Harden your containers against common security threats.', points: 3, priority: PRIORITY.LOW, category: CATEGORY.PRACTICE },
    { title: 'Deploy Docker containers to production', description: 'Deploy a multi-container app to a VPS using Docker Compose. Set up Nginx as a reverse proxy, configure SSL with Let\'s Encrypt, and implement zero-downtime deployments. Goal: Run a production-grade containerized app on a real server.', points: 5, priority: PRIORITY.HIGH, category: CATEGORY.PROJECT },
  ],
  typescript: [
    { title: 'Learn TypeScript types and interfaces', description: 'Convert a JavaScript project to TypeScript. Define interfaces for all data shapes, use union types and type guards, and implement 3 generic utility functions like ApiResponse<T>. Goal: Eliminate runtime type errors with compile-time safety.', points: 5, priority: PRIORITY.HIGH, category: CATEGORY.LEARNING },
    { title: 'Implement TypeScript generics', description: 'Practice built-in utility types: Partial, Required, Pick, Omit, Record, Exclude, Extract, ReturnType, and Parameters. Build a type-safe API client using mapped types. Goal: Write expressive types that document your code automatically.', points: 3, priority: PRIORITY.MEDIUM, category: CATEGORY.PRACTICE },
    { title: 'Use TypeScript with a framework', description: 'Create a project using TypeScript with strict mode enabled. Define all API response types, use discriminated unions for state management, and eliminate all any types. Goal: Experience the full power of TypeScript\'s type system.', points: 5, priority: PRIORITY.HIGH, category: CATEGORY.PROJECT },
    { title: 'Configure strict TypeScript', description: 'Enable strict mode in tsconfig.json and fix all resulting errors. Understand strictNullChecks, noImplicitAny, and strictFunctionTypes. Document why each strict rule matters. Goal: Adopt TypeScript best practices from day one.', points: 3, priority: PRIORITY.MEDIUM, category: CATEGORY.PRACTICE },
    { title: 'Build a TypeScript library with proper exports', description: 'Create a reusable TypeScript library with proper type exports, declaration files (.d.ts), and a well-configured package.json. Publish to npm and verify the types work in a consumer project. Goal: Share typed code that other developers can use confidently.', points: 5, priority: PRIORITY.HIGH, category: CATEGORY.PROJECT },
    { title: 'Migrate a JavaScript codebase to TypeScript', description: 'Incrementally migrate a real JavaScript project to TypeScript. Start with allowJs, add types file by file, and gradually enable stricter settings. Document the migration strategy and lessons learned. Goal: Improve an existing project\'s reliability through gradual typing.', points: 5, priority: PRIORITY.MEDIUM, category: CATEGORY.PROJECT },
  ],
  'machine learning': [
    { title: 'Learn ML fundamentals', description: 'Study supervised vs unsupervised learning, bias-variance tradeoff, overfitting, and regularization. Complete Andrew Ng\'s ML course or fast.ai Practical Deep Learning. Goal: Understand the core concepts behind every ML algorithm.', points: 5, priority: PRIORITY.HIGH, category: CATEGORY.LEARNING },
    { title: 'Build a classification model', description: 'Train and evaluate a classification model on a real dataset. Try 3 algorithms (Logistic Regression, Random Forest, SVM), tune hyperparameters with GridSearchCV, and analyze the confusion matrix. Goal: Build and evaluate a complete ML pipeline from data to predictions.', points: 5, priority: PRIORITY.HIGH, category: CATEGORY.PROJECT },
    { title: 'Explore a Kaggle dataset', description: 'Load a Kaggle dataset and perform thorough EDA: check distributions, correlations, missing values, and outliers. Create 5 meaningful visualizations and document your findings. Goal: Extract insights from raw data before building any model.', points: 3, priority: PRIORITY.MEDIUM, category: CATEGORY.PRACTICE },
    { title: 'Deploy an ML model as API', description: 'Serialize a trained model with joblib or pickle. Build a FastAPI endpoint that accepts input, runs inference, and returns predictions. Add input validation and model versioning. Goal: Make your ML model accessible to real applications.', points: 5, priority: PRIORITY.HIGH, category: CATEGORY.PROJECT },
    { title: 'Learn neural network basics', description: 'Implement a neural network using TensorFlow/Keras or PyTorch. Train on MNIST or a custom dataset. Experiment with different architectures, activation functions, and optimizers. Goal: Understand how deep learning models learn from data.', points: 5, priority: PRIORITY.MEDIUM, category: CATEGORY.LEARNING },
    { title: 'Implement feature engineering pipeline', description: 'Build a scikit-learn Pipeline that handles missing values, encodes categorical features, scales numerical features, and selects the most important features. Goal: Improve model performance through systematic feature engineering.', points: 3, priority: PRIORITY.MEDIUM, category: CATEGORY.PRACTICE },
    { title: 'Implement model evaluation and monitoring', description: 'Set up MLflow or Weights & Biases to track experiments. Log metrics, parameters, and artifacts. Implement data drift detection and set up alerts when model performance degrades. Goal: Maintain model quality in production over time.', points: 3, priority: PRIORITY.MEDIUM, category: CATEGORY.PRACTICE },
  ],
  'full stack': [
    { title: 'Build a full-stack CRUD app', description: 'Create a complete app with Angular/React frontend, Node.js/Express backend, and MongoDB database. Implement all CRUD operations with proper error handling, loading states, and form validation. Goal: Demonstrate end-to-end full-stack development skills.', points: 5, priority: PRIORITY.HIGH, category: CATEGORY.PROJECT },
    { title: 'Implement authentication end-to-end', description: 'Build a complete JWT auth flow: register, login, refresh tokens, and protected routes. Implement on both frontend (route guards, interceptors) and backend (middleware, token rotation). Goal: Secure a full-stack app with production-grade authentication.', points: 5, priority: PRIORITY.HIGH, category: CATEGORY.PRACTICE },
    { title: 'Deploy full-stack app', description: 'Deploy frontend to Vercel/Netlify and backend to Railway/Render. Configure environment variables, set up a custom domain with SSL, and implement a CI/CD pipeline with automated tests. Goal: Ship a production-ready full-stack app accessible to real users.', points: 5, priority: PRIORITY.HIGH, category: CATEGORY.PROJECT },
    { title: 'Add real-time features', description: 'Implement real-time functionality using Socket.io or native WebSockets. Build a live notification system, chat feature, or collaborative editing. Handle reconnection and offline states gracefully. Goal: Add live interactivity to a full-stack application.', points: 3, priority: PRIORITY.MEDIUM, category: CATEGORY.PROJECT },
    { title: 'Write end-to-end tests', description: 'Write E2E tests covering the critical user journeys: registration, login, CRUD operations, and error states. Set up Cypress in CI/CD and add visual regression testing. Goal: Catch integration bugs before they reach production.', points: 3, priority: PRIORITY.LOW, category: CATEGORY.PRACTICE },
    { title: 'Design and implement a REST API', description: 'Design a RESTful API following best practices: proper HTTP methods, status codes, pagination, filtering, and sorting. Add OpenAPI/Swagger documentation and validate all inputs. Goal: Build an API that other developers can integrate with easily.', points: 5, priority: PRIORITY.HIGH, category: CATEGORY.PROJECT },
    { title: 'Add performance monitoring and error tracking', description: 'Integrate Sentry for error tracking on both frontend and backend. Add performance monitoring, set up alerts for critical errors, and implement a health check dashboard. Goal: Know about production issues before your users do.', points: 3, priority: PRIORITY.LOW, category: CATEGORY.PRACTICE },
  ],
  devops: [
    { title: 'Set up a CI/CD pipeline', description: 'Create a GitHub Actions workflow that runs tests, linting, and security scans on every PR. Add automated deployment to staging on merge to main, and production on release tags. Goal: Automate your entire software delivery process.', points: 5, priority: PRIORITY.HIGH, category: CATEGORY.PROJECT },
    { title: 'Learn Kubernetes basics', description: 'Deploy an app to a local k8s cluster using minikube or kind. Understand Pods, Deployments, Services, ConfigMaps, and Secrets. Practice scaling, rolling updates, and rollbacks. Goal: Orchestrate containerized applications at scale.', points: 5, priority: PRIORITY.HIGH, category: CATEGORY.LEARNING },
    { title: 'Configure monitoring with Prometheus', description: 'Set up Prometheus to scrape metrics from your application. Create Grafana dashboards for key metrics (latency, error rate, throughput). Configure alerting rules and notification channels. Goal: Gain full observability into your production systems.', points: 3, priority: PRIORITY.MEDIUM, category: CATEGORY.PRACTICE },
    { title: 'Implement infrastructure as code', description: 'Provision cloud infrastructure (VPC, EC2/ECS, RDS, S3) using Terraform. Use modules for reusability, remote state with S3 backend, and implement staging/production environment separation. Goal: Manage cloud infrastructure reproducibly and safely.', points: 5, priority: PRIORITY.MEDIUM, category: CATEGORY.PROJECT },
    { title: 'Implement secrets management', description: 'Migrate hardcoded secrets to HashiCorp Vault or AWS Secrets Manager. Implement secret rotation, audit logging, and least-privilege access policies. Update CI/CD to use dynamic secrets. Goal: Eliminate hardcoded credentials from your codebase forever.', points: 3, priority: PRIORITY.HIGH, category: CATEGORY.PRACTICE },
    { title: 'Implement log aggregation', description: 'Set up Elasticsearch, Logstash, and Kibana for centralized logging. Configure structured logging in your application, create Kibana dashboards, and set up log-based alerts. Goal: Debug production issues quickly with centralized, searchable logs.', points: 3, priority: PRIORITY.MEDIUM, category: CATEGORY.PROJECT },
  ],
};

// ── Missing skill → task mapping ──────────────────────────────────────────

const SKILL_TO_TASK = {
  docker:     { title: 'Learn Docker basics', description: 'Understand images, containers, and volumes. Learn essential Docker commands and containerize an existing project. Goal: Run any application in a container confidently.', points: 5, priority: PRIORITY.HIGH, category: CATEGORY.LEARNING },
  kubernetes: { title: 'Learn Kubernetes fundamentals', description: 'Deploy an app to a local k8s cluster using minikube. Understand Pods, Deployments, and Services. Practice scaling and rolling updates. Goal: Orchestrate containerized applications at scale.', points: 5, priority: PRIORITY.HIGH, category: CATEGORY.LEARNING },
  typescript: { title: 'Learn TypeScript', description: 'Convert a JavaScript project to TypeScript. Define interfaces for all data shapes and use union types and type guards. Goal: Eliminate runtime type errors with compile-time safety.', points: 5, priority: PRIORITY.HIGH, category: CATEGORY.LEARNING },
  graphql:    { title: 'Learn GraphQL', description: 'Build a GraphQL API with Apollo Server. Define a schema, implement resolvers, and query data from a frontend. Goal: Replace REST endpoints with a flexible, self-documenting GraphQL API.', points: 5, priority: PRIORITY.HIGH, category: CATEGORY.LEARNING },
  redis:      { title: 'Learn Redis caching', description: 'Add Redis caching to an existing API. Implement cache invalidation strategies and measure the performance improvement. Goal: Reduce database load and improve API response times by 50%+.', points: 3, priority: PRIORITY.MEDIUM, category: CATEGORY.LEARNING },
  aws:        { title: 'Learn AWS fundamentals', description: 'Deploy an app to EC2 or Lambda. Learn S3 for file storage, RDS for databases, and IAM for access control. Goal: Deploy and manage applications on the world\'s leading cloud platform.', points: 5, priority: PRIORITY.HIGH, category: CATEGORY.LEARNING },
  testing:    { title: 'Write automated tests', description: 'Add unit and integration tests to an existing project. Aim for 70%+ code coverage using the standard testing framework for your stack. Goal: Build confidence that your code works correctly and catch regressions early.', points: 3, priority: PRIORITY.HIGH, category: CATEGORY.PRACTICE },
  git:        { title: 'Master Git workflows', description: 'Practice branching strategies (Git Flow, trunk-based), rebasing, squashing commits, and creating clean PRs. Goal: Collaborate effectively on any team using professional Git workflows.', points: 3, priority: PRIORITY.HIGH, category: CATEGORY.PRACTICE },
  sql:        { title: 'Learn SQL fundamentals', description: 'Write complex queries with JOINs, subqueries, window functions, and aggregations. Practice on a real dataset. Goal: Query any relational database confidently and optimize slow queries.', points: 3, priority: PRIORITY.HIGH, category: CATEGORY.LEARNING },
  mongodb:    { title: 'Learn MongoDB', description: 'Design schemas with Mongoose, write aggregation pipelines, and add indexes for performance. Goal: Build a maintainable NoSQL data layer with proper schema design.', points: 3, priority: PRIORITY.MEDIUM, category: CATEGORY.LEARNING },
  ci_cd:      { title: 'Set up CI/CD pipeline', description: 'Configure GitHub Actions to run tests, linting, and deployment automatically on every push. Add status badges to your README and set up branch protection rules. Goal: Automate your entire software delivery process.', points: 5, priority: PRIORITY.HIGH, category: CATEGORY.PROJECT },
  security:   { title: 'Learn web security basics', description: 'Study OWASP Top 10 vulnerabilities: SQL injection, XSS, CSRF, and more. Implement fixes in an existing project and run a security scanner. Goal: Build applications that are secure by default.', points: 3, priority: PRIORITY.HIGH, category: CATEGORY.LEARNING },
};

// ── GitHub weakness → task mapping ────────────────────────────────────────

const GITHUB_WEAKNESS_TASKS = {
  low_commits:    { title: 'Increase commit frequency', description: 'Commit at least once daily for 2 weeks. Break large changes into small, focused commits with clear messages. Goal: Build a consistent contribution habit that shows up on your GitHub profile.', points: 3, priority: PRIORITY.HIGH, category: CATEGORY.PRACTICE },
  poor_readme:    { title: 'Improve project READMEs', description: 'Add description, setup instructions, usage examples, and screenshots to 3 repos. Follow the standard README template. Goal: Make your projects understandable to anyone who visits your GitHub profile.', points: 3, priority: PRIORITY.MEDIUM, category: CATEGORY.PRACTICE },
  no_tests:       { title: 'Add tests to a project', description: 'Write unit tests for an existing repo. Aim for 70%+ coverage on critical business logic. Use the standard testing framework for your stack. Goal: Demonstrate code quality and reliability to potential employers.', points: 5, priority: PRIORITY.HIGH, category: CATEGORY.PRACTICE },
  low_stars:      { title: 'Build a portfolio project', description: 'Create a project that solves a real problem or showcases a unique skill. Add a polished README, live demo, and screenshots. Goal: Build something worth starring that attracts attention from recruiters.', points: 5, priority: PRIORITY.HIGH, category: CATEGORY.PROJECT },
  no_description: { title: 'Add repo descriptions', description: 'Update all repos with clear, concise descriptions and relevant topic tags. This improves discoverability on GitHub. Goal: Make your GitHub profile look professional and organized.', points: 1, priority: PRIORITY.LOW, category: CATEGORY.PRACTICE },
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
