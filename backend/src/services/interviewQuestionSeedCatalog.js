const { listImportantTopics, normalizeTopicInput } = require('./interviewTopicNormalizer');
const {
  normalizeComparableText,
  normalizeQuestionText,
  normalizeAnswerText,
  sanitizeTags
} = require('./interviewQuestionQualityService');

const SEED_VERSION = 'v5-expanded-top30';
const MIN_VERIFIED_SEED_COUNT = 31;

const TOPIC_GUIDES = {
  javascript: {
    label: 'JavaScript',
    example: 'const makeCounter = () => { let count = 0; return () => ++count; };',
    useCase: 'frontend state updates, browser event handling, and Node.js services',
    interviewTip: 'Name the runtime behavior, then explain one concrete tradeoff or bug pattern.'
  },
  typescript: {
    label: 'TypeScript',
    example: 'function identity<T>(value: T): T { return value; }',
    useCase: 'shared API contracts, safer refactors, and reusable component libraries',
    interviewTip: 'Show how the type system prevents a real bug instead of describing syntax only.'
  },
  python: {
    label: 'Python',
    example: 'with open("report.txt") as file: data = file.read()',
    useCase: 'automation, backend services, data pipelines, and AI application code',
    interviewTip: 'Explain the language feature, then relate it to readability, runtime behavior, or production tooling.'
  },
  java: {
    label: 'Java',
    example: 'List<String> names = users.stream().map(User::getName).toList();',
    useCase: 'enterprise backends, JVM services, and strongly typed application design',
    interviewTip: 'Anchor the answer in JVM behavior, strong typing, or concurrency tradeoffs.'
  },
  cpp: {
    label: 'C++',
    example: 'std::unique_ptr<Node> node = std::make_unique<Node>();',
    useCase: 'systems programming, performance-critical components, and low-level resource management',
    interviewTip: 'Call out ownership, performance, and correctness tradeoffs clearly.'
  },
  angular: {
    label: 'Angular',
    example: 'this.results$ = this.search.valueChanges.pipe(debounceTime(300), switchMap(q => this.api.search(q)));',
    useCase: 'enterprise dashboards, forms, and modular SPA architectures',
    interviewTip: 'Connect the answer to components, templates, RxJS, and dependency injection.'
  },
  react: {
    label: 'React',
    example: 'const [value, setValue] = useState(""); useEffect(() => { document.title = value; }, [value]);',
    useCase: 'interactive UIs, design systems, and data-heavy dashboards',
    interviewTip: 'Explain render behavior, state flow, and how you keep components predictable.'
  },
  nodejs: {
    label: 'Node.js',
    example: 'app.get("/health", async (_req, res) => res.json({ ok: true }));',
    useCase: 'I/O-heavy APIs, background workers, and realtime services',
    interviewTip: 'Describe event-loop impact and what happens under production load.'
  },
  expressjs: {
    label: 'Express.js',
    example: 'router.get("/users/:id", auth, asyncHandler(async (req, res) => res.json(await repo.get(req.params.id))));',
    useCase: 'REST APIs, middleware-driven backends, and backend-for-frontend layers',
    interviewTip: 'Talk about middleware order, validation, and centralized error handling.'
  },
  nextjs: {
    label: 'Next.js',
    example: 'export const revalidate = 60; export default async function Page() { const data = await getData(); return <Dashboard data={data} />; }',
    useCase: 'SEO-friendly React apps, hybrid rendering, and full-stack frontend delivery',
    interviewTip: 'Tie the answer to the correct rendering mode and the data freshness tradeoff.'
  },
  mongodb: {
    label: 'MongoDB',
    example: 'db.orders.createIndex({ userId: 1, createdAt: -1 });',
    useCase: 'document-driven applications, event data, and fast iteration on evolving schemas',
    interviewTip: 'Answer from access patterns first, then justify schema or index choices.'
  },
  mysql: {
    label: 'MySQL',
    example: 'SELECT u.id, COUNT(o.id) AS order_count FROM users u LEFT JOIN orders o ON o.user_id = u.id GROUP BY u.id;',
    useCase: 'transactional systems, reporting queries, and relational integrity',
    interviewTip: 'Mention indexing, joins, and how SQL choices affect latency and consistency.'
  },
  postgresql: {
    label: 'PostgreSQL',
    example: 'CREATE INDEX idx_events_payload_gin ON events USING gin (payload jsonb_path_ops);',
    useCase: 'transactional systems that need strong SQL features, analytics, or JSONB flexibility',
    interviewTip: 'Lean into the feature set that makes PostgreSQL different from generic SQL answers.'
  },
  redis: {
    label: 'Redis',
    example: 'SETEX dashboard:user:42 120 "{...cached json...}"',
    useCase: 'caching, rate limiting, queues, and low-latency shared state',
    interviewTip: 'Explain the data structure choice and what happens when Redis is stale or unavailable.'
  },
  'rest-apis': {
    label: 'REST APIs',
    example: 'GET /users?cursor=abc123 returns data plus nextCursor metadata for the next page.',
    useCase: 'web and mobile integrations, internal services, and partner-facing platforms',
    interviewTip: 'Frame your answer around contracts, HTTP semantics, and operational concerns.'
  },
  graphql: {
    label: 'GraphQL',
    example: 'type Query { user(id: ID!): User } type User { id: ID! name: String! posts: [Post!]! }',
    useCase: 'client-driven data fetching, multi-platform frontends, and gateway layers',
    interviewTip: 'Balance the developer experience benefits with resolver and operations complexity.'
  },
  html: {
    label: 'HTML',
    example: '<button type="button" aria-expanded="false">Menu</button>',
    useCase: 'accessible document structure, forms, and semantic foundations for CSS and JavaScript',
    interviewTip: 'Anchor answers in semantics and accessibility, not only in visual output.'
  },
  css: {
    label: 'CSS',
    example: '.layout { display: grid; grid-template-columns: 240px 1fr; gap: 1rem; }',
    useCase: 'responsive layouts, theming systems, and polished UI states',
    interviewTip: 'Explain how the browser calculates layout instead of listing properties from memory.'
  },
  'git-github': {
    label: 'Git and GitHub',
    example: 'git checkout -b feature/search && git commit -m "Add search filters" && git push origin feature/search',
    useCase: 'team workflows, code review, release management, and incident recovery',
    interviewTip: 'Show you understand both local Git mechanics and collaborative GitHub workflow.'
  },
  oop: {
    label: 'Object-Oriented Programming',
    example: 'class PaymentService { constructor(gateway) { this.gateway = gateway; } charge(order) { return this.gateway.charge(order); } }',
    useCase: 'domain modeling, extensible business logic, and testable abstractions',
    interviewTip: 'Use examples that show why an abstraction improves changeability or clarity.'
  },
  dsa: {
    label: 'Data Structures and Algorithms',
    example: 'Use a hash map to count frequencies in O(n) time instead of nested loops.',
    useCase: 'performance-critical logic, search features, and large-scale data processing',
    interviewTip: 'Always state time and space complexity after explaining the approach.'
  },
  aws: {
    label: 'AWS',
    example: 'An API Gateway endpoint triggers a Lambda function that reads metadata from DynamoDB and files from S3.',
    useCase: 'cloud infrastructure, serverless systems, and scalable production deployments',
    interviewTip: 'Frame the answer around service boundaries, security, and operational tradeoffs.'
  },
  'generative-ai': {
    label: 'Generative AI',
    example: 'Use embeddings for retrieval, a prompt template for task framing, and evaluation checks before returning the answer.',
    useCase: 'AI assistants, content generation, and workflow augmentation with foundation models',
    interviewTip: 'Discuss quality, safety, latency, and cost together instead of only model hype.'
  },
  'ai-agents': {
    label: 'AI Agents',
    example: 'An agent plans steps, calls a search tool, writes a draft, and asks for human approval before execution.',
    useCase: 'multi-step automation, tool use, and long-running AI workflows',
    interviewTip: 'Explain how you constrain agent behavior and measure whether the workflow is actually reliable.'
  },
  llm: {
    label: 'LLM',
    example: 'Set temperature near zero for deterministic extraction and allow a larger context window only when the task truly needs it.',
    useCase: 'natural language interfaces, reasoning workflows, and model-backed application features',
    interviewTip: 'Show you understand tokens, latency, hallucinations, and evaluation rather than only prompt wording.'
  },
  rag: {
    label: 'RAG',
    example: 'Split source docs into chunks, embed them, retrieve top matches, rerank them, and cite the snippets in the final answer.',
    useCase: 'grounded AI answers over proprietary knowledge with fresher context than base model weights',
    interviewTip: 'Talk about retrieval quality and evaluation, not just storing embeddings in a vector database.'
  },
  langchain: {
    label: 'LangChain',
    example: 'const chain = prompt.pipe(model).pipe(parser);',
    useCase: 'LLM orchestration, retrieval flows, and tool-enabled application pipelines',
    interviewTip: 'Explain what LangChain helps you compose and what you would still keep framework-agnostic.'
  },
  'system-design': {
    label: 'System Design',
    example: 'Client -> load balancer -> stateless API -> cache -> database -> queue -> workers',
    useCase: 'high-scale services, reliability planning, and architecture reviews',
    interviewTip: 'Start with requirements and bottlenecks before naming technologies.'
  },
  mern: {
    label: 'MERN',
    example: 'React submits a form to an Express route, Node validates it, and MongoDB persists the document.',
    useCase: 'full-stack JavaScript products with shared language and rapid iteration',
    interviewTip: 'Describe how data flows end-to-end across the stack, not just each tool in isolation.'
  },
  mean: {
    label: 'MEAN',
    example: 'Angular calls an Express API, Node coordinates validation, and MongoDB stores the resulting document.',
    useCase: 'full-stack JavaScript applications centered on Angular and MongoDB',
    interviewTip: 'Show how Angular-specific frontend architecture changes the full-stack tradeoffs.'
  },
  'full-stack-web-development': {
    label: 'Full Stack Web Development',
    example: 'A browser form sends a request to an API, the backend validates it, the database persists it, and the UI updates from the response.',
    useCase: 'end-to-end product delivery across UI, APIs, persistence, and deployment',
    interviewTip: 'Explain boundaries between frontend, backend, data, and operations instead of treating the stack as one blob.'
  }
};

const seed = (difficulty, question, shortAnswer, tags, options = {}) => ({
  difficulty,
  question,
  shortAnswer,
  tags,
  explanation: options.explanation || '',
  example: options.example || '',
  realWorldUseCase: options.realWorldUseCase || '',
  commonMistakes: Array.isArray(options.commonMistakes) ? options.commonMistakes : [],
  interviewTip: options.interviewTip || '',
  category: options.category || '',
  confidenceScore: Number(options.confidenceScore || 95)
});

const buildExplanation = (topicKey, spec) => {
  const guide = TOPIC_GUIDES[topicKey] || { label: topicKey, useCase: 'production software', interviewTip: '' };
  const focusTags = (spec.tags || []).slice(0, 3).join(', ');
  const base = spec.explanation
    || `${spec.shortAnswer} In ${guide.label}, this matters because interviewers want to know how the concept changes implementation decisions, debugging, and production behavior. A strong answer should connect the idea to real tradeoffs instead of repeating a definition.`;
  return normalizeAnswerText(`${base} Mention ${focusTags || guide.label} explicitly so the answer stays technology-specific.`);
};

const buildKeyPoints = (topicKey, spec) => {
  const guide = TOPIC_GUIDES[topicKey] || { label: topicKey, useCase: 'production software' };
  const tagList = sanitizeTags(spec.tags || []).filter((tag) => tag !== topicKey).slice(0, 3);
  return [
    normalizeAnswerText(spec.shortAnswer),
    normalizeAnswerText(`Explain how ${guide.label} handles ${tagList[0] || 'this concept'} in practice.`),
    normalizeAnswerText(`Connect the answer to ${spec.realWorldUseCase || guide.useCase}.`)
  ].filter(Boolean);
};

const buildExample = (topicKey, spec) => normalizeAnswerText(spec.example || TOPIC_GUIDES[topicKey]?.example || '');

const buildUseCase = (topicKey, spec) => normalizeAnswerText(spec.realWorldUseCase || `This comes up in ${TOPIC_GUIDES[topicKey]?.useCase || 'production applications'} where teams need reliable ${TOPIC_GUIDES[topicKey]?.label || topicKey} behavior.`);

const buildCommonMistakes = (topicKey, spec) => {
  const defaults = [
    `Giving a generic answer without naming concrete ${TOPIC_GUIDES[topicKey]?.label || topicKey} behavior.`,
    'Ignoring the main tradeoff or failure mode that the interviewer is testing.'
  ];
  return [...new Set([...(spec.commonMistakes || []), ...defaults].map((item) => normalizeAnswerText(item)).filter(Boolean))].slice(0, 4);
};

const buildInterviewTip = (topicKey, spec) => normalizeAnswerText(spec.interviewTip || TOPIC_GUIDES[topicKey]?.interviewTip || 'Answer directly, then support it with one concrete example.');

const inferCategory = (tags = []) => {
  const text = sanitizeTags(tags).join(' ');
  if (/design|architecture|scalability|distributed|capacity/.test(text)) return 'system_design';
  if (/best-practice|security|testing|accessibility|workflow/.test(text)) return 'best_practice';
  if (/scenario|debugging|incident|optimization|migration/.test(text)) return 'scenario_based';
  if (/code|query|algorithm|example/.test(text)) return 'code_output';
  return 'conceptual';
};

const toAnswerSections = (topicKey, spec) => {
  const shortAnswer = normalizeAnswerText(spec.shortAnswer);
  const keyPoints = buildKeyPoints(topicKey, spec);
  const explanation = buildExplanation(topicKey, spec);
  const example = buildExample(topicKey, spec);
  const realWorldUseCase = buildUseCase(topicKey, spec);
  const commonMistakes = buildCommonMistakes(topicKey, spec);
  const interviewTip = buildInterviewTip(topicKey, spec);

  return {
    shortAnswer,
    summary: shortAnswer,
    keyPoints,
    bulletPoints: keyPoints,
    explanation,
    example,
    codeExample: example,
    realWorldUseCase,
    realWorldContext: realWorldUseCase,
    commonMistakes,
    interviewTip
  };
};

const structuredAnswerToText = (sections = {}) => normalizeAnswerText([
  sections.shortAnswer ? `Short answer: ${sections.shortAnswer}` : '',
  Array.isArray(sections.keyPoints) && sections.keyPoints.length
    ? `Key points:\n${sections.keyPoints.map((point) => `- ${point}`).join('\n')}`
    : '',
  sections.explanation ? `Explanation: ${sections.explanation}` : '',
  sections.example ? `Example:\n${sections.example}` : '',
  sections.realWorldUseCase ? `Real-world use case: ${sections.realWorldUseCase}` : '',
  Array.isArray(sections.commonMistakes) && sections.commonMistakes.length
    ? `Common mistakes:\n${sections.commonMistakes.map((point) => `- ${point}`).join('\n')}`
    : '',
  sections.interviewTip ? `Interview tip: ${sections.interviewTip}` : ''
].filter(Boolean).join('\n\n'));

const buildGeneratedTopicSeeds = ({ topicKey, concepts = [] } = {}) => {
  const guide = TOPIC_GUIDES[topicKey] || { label: topicKey, useCase: 'production systems', interviewTip: '' };
  const specs = [];

  concepts.forEach((concept) => {
    const conceptLabel = concept.concept;
    const conceptDisplay = `${conceptLabel.charAt(0).toUpperCase()}${conceptLabel.slice(1)}`;
    const isPluralConcept = /\b(and|collections|comprehensions|primitives|boundaries|flows|queries|actions)\b/i.test(conceptLabel)
      || /s$/i.test(conceptLabel);
    const definitionVerb = isPluralConcept ? 'are' : 'is';
    const matterVerb = isPluralConcept ? 'matter' : 'matters';
    const doVerb = isPluralConcept ? 'do' : 'does';
    const baseTags = sanitizeTags([...(concept.tags || []), topicKey, conceptLabel]);
    const baseUseCase = concept.useCase || guide.useCase;
    const example = concept.example || guide.example || '';
    const exampleSnippet = example ? example.replace(/[.\s]+$/g, '') : '';
    const commonMistakes = concept.commonMistakes || [
      `Defining ${conceptDisplay} without explaining how it changes real ${guide.label} implementation decisions.`,
      `Skipping the main tradeoff, limitation, or operational risk tied to ${conceptLabel}.`,
      example
        ? `Not backing the answer with a concrete ${guide.label} example such as ${exampleSnippet}.`
        : `Keeping the answer generic instead of tying ${conceptDisplay} to a real production workflow.`
    ];
    const interviewTip = concept.interviewTip
      || `State what ${conceptDisplay} ${doVerb} in ${guide.label}, then connect it to ${baseUseCase}.`;
    const fundamentalsQuestion = concept.fundamentalsQuestion
      || `What ${definitionVerb} ${conceptLabel} in ${guide.label}, and when should a team reach for ${isPluralConcept ? 'them' : 'it'}?`;
    const fundamentalsAnswer = concept.fundamentalsAnswer
      || `${conceptDisplay} ${matterVerb} in ${guide.label} because ${isPluralConcept ? 'they' : 'it'} directly affect${isPluralConcept ? '' : 's'} ${baseUseCase}. A strong answer should define the concept clearly, name when ${isPluralConcept ? 'they are' : 'it is'} a good fit, and explain the practical outcome ${isPluralConcept ? 'they improve' : 'it improves'}.`;
    const practicalQuestion = concept.practicalQuestion
      || `How would you use ${conceptLabel} for ${baseUseCase} in a real ${guide.label} project?`;
    const practicalAnswer = concept.practicalAnswer
      || `In a real ${guide.label} project, you would use ${conceptLabel} to support ${baseUseCase}. The best answer explains how ${isPluralConcept ? 'they are' : 'it is'} wired into the codebase, what benefit ${isPluralConcept ? 'they provide' : 'it provides'}, and what guardrails keep the implementation maintainable in production.`;
    const advancedQuestion = concept.advancedQuestion
      || `What mistakes, tradeoffs, or follow-up interview points matter when discussing ${conceptLabel} in ${guide.label}?`;
    const advancedAnswer = concept.advancedAnswer
      || `Interviewers expect you to discuss the upside of ${conceptLabel} in ${guide.label} along with ${isPluralConcept ? 'their' : 'its'} limits, debugging cost, and operational tradeoffs. Strong answers compare ${isPluralConcept ? 'them' : 'it'} with simpler alternatives and explain when the extra complexity is justified.`;

    specs.push(seed(
      concept.fundamentalsDifficulty || 'medium',
      fundamentalsQuestion,
      fundamentalsAnswer,
      baseTags,
      {
        example,
        realWorldUseCase: baseUseCase,
        commonMistakes,
        explanation: `${conceptDisplay} ${isPluralConcept ? 'come up' : 'comes up'} in ${guide.label} interviews because teams use ${isPluralConcept ? 'them' : 'it'} for ${baseUseCase}. A strong explanation should cover what ${isPluralConcept ? 'they do' : 'it does'}, when ${isPluralConcept ? 'they help' : 'it helps'}, and what can go wrong if ${isPluralConcept ? 'they are' : 'it is'} used without clear boundaries.`,
        interviewTip,
        category: concept.category || 'conceptual'
      }
    ));

    specs.push(seed(
      concept.practicalDifficulty || 'medium',
      practicalQuestion,
      practicalAnswer,
      sanitizeTags([...baseTags, 'production']),
      {
        example,
        realWorldUseCase: baseUseCase,
        commonMistakes,
        explanation: `This question tests whether you can move from definition to delivery. In ${guide.label}, ${conceptLabel} should be explained in terms of how ${isPluralConcept ? 'they are' : 'it is'} introduced into the code, what problem ${isPluralConcept ? 'they solve' : 'it solves'} for ${baseUseCase}, and how you would validate that the implementation is behaving correctly.`,
        interviewTip,
        category: concept.category || 'scenario_based'
      }
    ));

    specs.push(seed(
      concept.advancedDifficulty || 'hard',
      advancedQuestion,
      advancedAnswer,
      sanitizeTags([...baseTags, 'tradeoffs']),
      {
        example,
        realWorldUseCase: baseUseCase,
        commonMistakes,
        explanation: `Advanced ${guide.label} questions on ${conceptLabel} are really checking judgment. You should name the benefit, the main tradeoff, the debugging or scaling risk, and the point where a simpler design would be the better call.`,
        interviewTip,
        category: concept.category || 'best_practice'
      }
    ));
  });

  return specs;
};

const verifiedSeedCatalog = {
  javascript: [
    seed('medium', 'How do closures work in JavaScript?', 'A closure lets a function keep access to variables from its lexical scope after the outer function has returned.', ['closures', 'scope']),
    seed('medium', 'What is the difference between var, let, and const in JavaScript?', 'var is function-scoped and hoisted differently, while let and const are block-scoped and help avoid accidental redeclaration bugs.', ['variables', 'scope', 'hoisting']),
    seed('medium', 'How does the JavaScript event loop process asynchronous tasks?', 'The event loop runs synchronous code first, then drains microtasks before moving to timer or I/O callbacks in the macrotask queues.', ['event-loop', 'async', 'microtasks']),
    seed('medium', 'What is the difference between == and === in JavaScript?', '=== compares both type and value, while == performs coercion that can hide bugs in production code.', ['equality', 'type-coercion']),
    seed('medium', 'How do promises differ from callbacks in JavaScript?', 'Promises model future values and compose cleanly with chaining and error propagation, while callbacks are easier to nest and harder to coordinate.', ['promises', 'callbacks', 'async']),
    seed('medium', 'What does async/await change in JavaScript code?', 'async/await keeps promise-based logic asynchronous but makes control flow read like synchronous code with standard try/catch error handling.', ['async-await', 'promises']),
    seed('hard', 'How does prototypal inheritance work in JavaScript?', 'Objects delegate property lookup through a prototype chain, and JavaScript classes are syntax layered on top of that prototype model.', ['prototype', 'inheritance']),
    seed('medium', 'What are lexical scope and the scope chain in JavaScript?', 'Lexical scope means a function can access variables defined in its own scope and outer scopes according to where the function was declared.', ['scope', 'lexical-scope']),
    seed('hard', 'How do you prevent memory leaks in long-running JavaScript applications?', 'You prevent leaks by releasing timers, event listeners, caches, and closures that keep objects reachable longer than intended.', ['memory', 'performance', 'debugging']),
    seed('medium', 'What is the difference between shallow copy and deep copy in JavaScript?', 'A shallow copy duplicates the top-level container, while nested objects still share references unless you create a true deep copy.', ['objects', 'immutability']),
    seed('medium', 'How do map, filter, and reduce differ in JavaScript?', 'map transforms each item, filter keeps matching items, and reduce combines a collection into one accumulated result.', ['array-methods', 'functional']),
    seed('hard', 'What are microtasks and macrotasks in JavaScript?', 'Microtasks such as promise callbacks run before the runtime continues to the next macrotask like setTimeout or I/O callbacks.', ['microtasks', 'macrotasks', 'event-loop']),
    seed('medium', 'What is hoisting in JavaScript?', 'Hoisting is the runtime behavior where declarations are processed before execution, but only var gets initialized to undefined while let and const stay in the temporal dead zone.', ['hoisting', 'variables']),
    seed('hard', 'How do this, call, apply, and bind work in JavaScript?', 'this depends on invocation context, and call, apply, and bind let you control the function context explicitly.', ['this', 'bind', 'functions']),
    seed('medium', 'What is the spread operator used for in JavaScript?', 'Spread expands iterable values or object properties so you can copy, merge, or pass values more concisely.', ['spread', 'arrays', 'objects']),
    seed('hard', 'How do generators and iterators work in JavaScript?', 'Iterators expose a next method, and generator functions produce iterators that can pause and resume execution with yield.', ['generators', 'iterators']),
    seed('medium', 'What is destructuring in JavaScript and why is it useful?', 'Destructuring pulls values out of arrays or objects into named variables, which makes data access and parameter handling clearer.', ['destructuring', 'syntax']),
    seed('hard', 'How do modules work in modern JavaScript?', 'ES modules use explicit imports and exports so bundlers and runtimes can build dependency graphs, isolate scope, and optimize delivery.', ['modules', 'imports', 'exports']),
    seed('medium', 'What is the difference between null and undefined in JavaScript?', 'undefined usually means a value was not assigned, while null is an explicit empty value chosen by the developer.', ['null', 'undefined']),
    seed('hard', 'How do you optimize JavaScript execution in the browser?', 'Profile real bottlenecks, reduce main-thread work, avoid layout thrashing, batch DOM updates, and keep large computations off hot user interactions.', ['performance', 'browser', 'optimization']),
    seed('medium', 'What are higher-order functions in JavaScript?', 'A higher-order function takes another function as an argument, returns one, or both, which enables reuse and composition patterns.', ['higher-order-functions', 'functional']),
    seed('hard', 'How do you handle errors in asynchronous JavaScript?', 'Use try/catch with async/await, attach catch handlers to promises, and make sure rejected work surfaces through a single consistent path.', ['errors', 'async']),
    seed('medium', 'What is optional chaining in JavaScript?', 'Optional chaining safely stops property access or function calls when an intermediate value is null or undefined.', ['optional-chaining', 'syntax']),
    seed('medium', 'How does Array.prototype.sort behave in JavaScript?', 'sort mutates the array and compares elements as strings unless you provide a comparator that expresses the intended ordering.', ['arrays', 'sorting']),
    seed('hard', 'How do debounce and throttle differ in JavaScript?', 'Debounce delays execution until calls stop, while throttle limits how often a function can run during rapid events.', ['debounce', 'throttle', 'events']),
    seed('medium', 'What is event delegation in JavaScript?', 'Event delegation attaches one listener high in the DOM tree and handles child interactions by inspecting the event target.', ['dom', 'events']),
    seed('hard', 'How do you compare Map and Object in JavaScript?', 'Map is designed for dynamic keyed collections with predictable iteration and any key type, while Object is better for fixed record-like shapes.', ['map', 'object', 'collections']),
    seed('medium', 'What are pure functions and why do they matter in JavaScript?', 'Pure functions avoid side effects and return the same result for the same inputs, which makes code easier to test and reason about.', ['pure-functions', 'testing']),
    seed('hard', 'How does garbage collection affect JavaScript performance?', 'Garbage collection reclaims unreachable memory, but excessive allocation churn or accidental references can create pauses and memory pressure.', ['garbage-collection', 'performance']),
    seed('medium', 'How do you decide when to use classes versus functions in JavaScript?', 'Use classes when object lifecycle and shared instance behavior are central, and use functions when composition or stateless transformations are clearer.', ['classes', 'functions', 'architecture'])
  ],
  typescript: [
    seed('medium', 'What is the difference between interface and type in TypeScript?', 'Interfaces describe object shapes and support declaration merging, while type aliases also model unions, intersections, tuples, and mapped types.', ['interfaces', 'types']),
    seed('medium', 'How do generics improve reusable TypeScript code?', 'Generics preserve the relationship between input and output types so reusable code stays type-safe without falling back to any.', ['generics', 'type-safety']),
    seed('medium', 'What is type narrowing in TypeScript?', 'Type narrowing refines a union into a safer subtype by using runtime checks such as typeof, in, or discriminant fields.', ['narrowing', 'unions']),
    seed('hard', 'What are discriminated unions in TypeScript?', 'Discriminated unions use a shared literal field to let the compiler safely narrow variants in complex application state.', ['discriminated-unions', 'state-modeling']),
    seed('medium', 'What is the difference between any, unknown, and never in TypeScript?', 'any turns off checking, unknown forces you to validate before use, and never represents code paths that should be impossible.', ['any', 'unknown', 'never']),
    seed('medium', 'How do enums compare with union literal types in TypeScript?', 'Union literal types are lighter and compose better in modern code, while enums generate runtime artifacts and are best used intentionally.', ['enums', 'union-types']),
    seed('hard', 'How do mapped types work in TypeScript?', 'Mapped types transform every property in an existing type so you can build variants like readonly, partial, or required shapes consistently.', ['mapped-types', 'utility-types']),
    seed('hard', 'What are conditional types in TypeScript?', 'Conditional types pick one type or another based on assignability, which powers many expressive library-level abstractions.', ['conditional-types', 'advanced-types']),
    seed('medium', 'How do utility types like Partial, Pick, and Omit help in TypeScript?', 'Utility types let you reshape existing contracts instead of duplicating nearly identical type definitions across a codebase.', ['utility-types', 'partial', 'pick', 'omit']),
    seed('medium', 'What is the purpose of readonly in TypeScript?', 'readonly communicates that a property should not be reassigned after creation and helps enforce immutable data flow.', ['readonly', 'immutability']),
    seed('hard', 'How do function overloads work in TypeScript?', 'Overloads expose multiple callable signatures to consumers while one implementation handles the runtime branching internally.', ['functions', 'overloads']),
    seed('medium', 'What is structural typing in TypeScript?', 'TypeScript compares shapes rather than explicit inheritance, so compatible structures can satisfy the same contract.', ['structural-typing', 'compatibility']),
    seed('hard', 'How do declaration files and DefinitelyTyped fit into TypeScript projects?', 'Declaration files describe library APIs to the compiler, and DefinitelyTyped distributes community-maintained types for JavaScript packages.', ['declaration-files', 'ecosystem']),
    seed('medium', 'What is strictNullChecks and why should teams enable it?', 'strictNullChecks forces nullable values to be modeled honestly so null-reference bugs are caught during development instead of production.', ['strict-mode', 'null-safety']),
    seed('hard', 'How do infer and conditional types work together in TypeScript?', 'infer lets conditional types extract inner pieces of a type so advanced helpers can preserve intent through transformations.', ['infer', 'conditional-types']),
    seed('medium', 'How do classes and access modifiers work in TypeScript?', 'Classes support public, private, and protected members so you can express intent and implementation boundaries more clearly.', ['classes', 'access-modifiers']),
    seed('medium', 'What is the difference between extends and implements in TypeScript?', 'extends builds on an existing class or interface hierarchy, while implements checks that a class satisfies an interface contract.', ['extends', 'implements']),
    seed('hard', 'How do intersection types differ from union types in TypeScript?', 'A union accepts one of several variants, while an intersection combines multiple type requirements into a single shape.', ['intersection', 'union-types']),
    seed('medium', 'How do type guards improve runtime-safe TypeScript code?', 'Type guards combine runtime checks with compile-time narrowing so code can safely use fields that exist only on certain variants.', ['type-guards', 'runtime-validation']),
    seed('hard', 'How do template literal types help model string-based APIs?', 'Template literal types let teams encode route keys, event names, or configuration strings with compile-time safety.', ['template-literal-types', 'api-design']),
    seed('medium', 'What is the difference between optional properties and unioning with undefined in TypeScript?', 'Optional properties can be omitted entirely, while a required property unioned with undefined must exist but may hold an undefined value.', ['optional-properties', 'undefined']),
    seed('hard', 'How do recursive types work in TypeScript?', 'Recursive types reference themselves so you can model trees, nested configuration, or deeply composed domain structures.', ['recursive-types', 'data-modeling']),
    seed('medium', 'How do index signatures work in TypeScript?', 'Index signatures describe dynamic object keys, but they should be used carefully because they can weaken type precision.', ['index-signatures', 'objects']),
    seed('hard', 'How do TypeScript project references help large codebases?', 'Project references break large repos into typed build units so teams get faster incremental builds and clearer dependency boundaries.', ['project-references', 'monorepo']),
    seed('medium', 'What is the satisfies operator in TypeScript?', 'satisfies checks that a value conforms to a contract without widening away the more specific inferred literal information.', ['satisfies', 'inference']),
    seed('hard', 'How do you type API responses safely in TypeScript?', 'Use explicit DTOs, validation at the boundary, and narrow trusted application types from untrusted external payloads.', ['api', 'validation', 'types']),
    seed('medium', 'How does TypeScript help with React or Angular component props and inputs?', 'TypeScript documents the component contract, catches missing or invalid fields, and improves editor feedback for callers.', ['components', 'frontend']),
    seed('hard', 'When should you use branded types in TypeScript?', 'Branded types add nominal-like safety for values such as IDs, currencies, or validated strings that share the same runtime shape.', ['branded-types', 'domain-modeling']),
    seed('medium', 'How does noImplicitAny improve code quality in TypeScript?', 'noImplicitAny forces teams to model unknown intent explicitly instead of silently losing type safety in important code paths.', ['compiler-options', 'strict-mode']),
    seed('hard', 'How do you migrate a large JavaScript codebase to TypeScript incrementally?', 'Adopt TypeScript in slices, type the boundaries first, enable stricter compiler rules over time, and avoid a big-bang conversion.', ['migration', 'architecture', 'incremental'])
  ],
  angular: [
    seed('medium', 'How does Angular change detection work?', 'Angular checks templates after asynchronous work, input updates, and framework-triggered events so bindings stay in sync with component state.', ['change-detection', 'components']),
    seed('medium', 'When should you use ChangeDetectionStrategy.OnPush in Angular?', 'Use OnPush when inputs are treated immutably and you want Angular to skip unnecessary checks unless a clear signal marks the component dirty.', ['onpush', 'performance']),
    seed('medium', 'How do Angular services and dependency injection work together?', 'Services hold shared logic or state, and dependency injection decides how and where instances are created and reused.', ['services', 'dependency-injection']),
    seed('hard', 'How do RxJS observables shape data flow in Angular applications?', 'Observables let Angular model async streams such as HTTP responses, form value changes, and route params in a composable way.', ['rxjs', 'observables']),
    seed('medium', 'What is the difference between template-driven forms and reactive forms in Angular?', 'Template-driven forms are simpler for small cases, while reactive forms are more explicit, testable, and scalable for complex validation.', ['forms', 'reactive-forms']),
    seed('medium', 'How do Angular guards protect routes?', 'Route guards decide whether navigation can proceed, redirect, or preload based on authentication, role, or feature state.', ['route-guards', 'routing', 'security']),
    seed('medium', 'What do HTTP interceptors do in Angular?', 'Interceptors wrap every HTTP request and response so cross-cutting concerns like auth headers, retries, and logging stay centralized.', ['interceptors', 'http']),
    seed('hard', 'How would you structure a large Angular application?', 'Structure Angular apps around feature modules or route domains with clear boundaries between presentation components, services, and shared utilities.', ['architecture', 'modularity']),
    seed('medium', 'How do standalone components change Angular architecture?', 'Standalone components reduce NgModule ceremony and make feature composition, lazy loading, and local imports more direct.', ['standalone-components', 'architecture']),
    seed('medium', 'What is the difference between Subject, BehaviorSubject, and ReplaySubject?', 'Subject emits future values only, BehaviorSubject also exposes the latest value, and ReplaySubject replays a configurable history to new subscribers.', ['rxjs', 'subject']),
    seed('hard', 'Why is switchMap commonly used in Angular search flows?', 'switchMap cancels stale inner streams so slow responses from older searches do not overwrite newer user input.', ['switchmap', 'rxjs', 'search']),
    seed('medium', 'How do Angular lifecycle hooks work?', 'Lifecycle hooks run at known points such as initialization, input change detection, view creation, and teardown.', ['lifecycle-hooks', 'components']),
    seed('hard', 'How do you prevent memory leaks in Angular components?', 'Unsubscribe automatically with async pipe or destroy-aware operators and clean up long-lived event or service references on teardown.', ['memory', 'rxjs', 'cleanup']),
    seed('medium', 'How do Angular pipes differ from methods in templates?', 'Pure pipes are cached by Angular and are usually cheaper than running methods repeatedly during change detection.', ['pipes', 'performance']),
    seed('medium', 'What is lazy loading in Angular routing?', 'Lazy loading splits route bundles so users download only the code needed for the current navigation path.', ['lazy-loading', 'routing', 'performance']),
    seed('hard', 'How do you share state across Angular features responsibly?', 'Use services or a store with clear ownership, keep ephemeral component state local, and avoid turning every value into global shared state.', ['state-management', 'architecture']),
    seed('medium', 'How does the async pipe help Angular templates?', 'The async pipe subscribes, renders the latest value, and unsubscribes automatically, which reduces manual subscription code and leaks.', ['async-pipe', 'templates']),
    seed('hard', 'How do Angular signals compare with observable-based state?', 'Signals simplify synchronous reactive state in components, while observables stay stronger for async streams and complex operator chains.', ['signals', 'state-management']),
    seed('medium', 'How do content projection and ng-content work in Angular?', 'Content projection lets a container component accept caller-provided markup while preserving styling and composition boundaries.', ['content-projection', 'components']),
    seed('medium', 'How do you test Angular components effectively?', 'Test components through inputs, outputs, DOM behavior, and mocked services so the contract stays stable without overcoupling to internals.', ['testing', 'components']),
    seed('hard', 'How do you optimize Angular rendering performance?', 'Use OnPush, trackBy, lazy loading, pure pipes, and measurable profiling before introducing extra complexity.', ['performance', 'trackby']),
    seed('medium', 'What is trackBy in Angular ngFor and why does it matter?', 'trackBy gives Angular stable identity for list items so DOM nodes and component state are reused correctly during reorders.', ['trackby', 'lists']),
    seed('medium', 'How do Angular resolvers differ from guards?', 'Resolvers fetch route data before activation, while guards decide whether navigation is allowed at all.', ['resolvers', 'guards', 'routing']),
    seed('hard', 'How do you design reusable Angular libraries or shared components?', 'Shared Angular libraries should expose stable APIs, avoid leaking app-specific state, and document styling and dependency assumptions clearly.', ['design-system', 'libraries']),
    seed('medium', 'How does Angular DI scope affect service instances?', 'Providing a service in root creates a singleton, while route or component providers can create feature-scoped or local instances.', ['dependency-injection', 'service-scope']),
    seed('hard', 'How do you handle API errors consistently in Angular apps?', 'Map transport errors centrally, expose user-safe messages, preserve retry context, and keep feature components focused on UX decisions.', ['errors', 'http', 'best-practice']),
    seed('medium', 'What are Angular directives and when should you create one?', 'Directives package repeated DOM behavior or structural rendering logic so templates stay consistent and readable.', ['directives', 'templates']),
    seed('medium', 'How do environment configuration and build targets work in Angular?', 'Angular build targets let teams swap environment values and optimization settings without hardcoding deployment-specific behavior into feature code.', ['build', 'configuration']),
    seed('hard', 'How do you migrate Angular apps safely across major versions?', 'Upgrade in steps, use official migrations, keep tests green, and isolate framework changes from unrelated feature work.', ['migration', 'upgrade']),
    seed('medium', 'Why is AOT compilation useful in Angular?', 'Ahead-of-time compilation catches template issues earlier and ships smaller, faster bundles than relying only on runtime compilation.', ['aot', 'build', 'performance'])
  ],
  react: [
    seed('medium', 'How does React reconciliation use keys to update lists efficiently?', 'React uses keys to match sibling elements across renders so it can update the right component instances instead of remounting the wrong ones.', ['reconciliation', 'keys', 'lists']),
    seed('medium', 'What problem do hooks solve in React?', 'Hooks let function components use state, effects, refs, and reusable behavior without class components.', ['hooks', 'state', 'effects']),
    seed('hard', 'When should you use useMemo, useCallback, or React.memo?', 'Use memoization only when profiling shows real render cost, because each optimization adds comparison and complexity overhead.', ['performance', 'memoization']),
    seed('medium', 'How does Context API affect rendering and state architecture?', 'Context removes prop drilling, but every consumer can re-render when the provider value changes unless the state is partitioned carefully.', ['context-api', 'state-management']),
    seed('hard', 'How do you prevent stale closures in React effects and event handlers?', 'Use correct dependencies, functional state updates, and refs for mutable current values so handlers do not read outdated state.', ['closures', 'effects', 'debugging']),
    seed('medium', 'What is the difference between controlled and uncontrolled components in React?', 'Controlled inputs keep the source of truth in React state, while uncontrolled inputs let the DOM hold the current value.', ['forms', 'controlled-components']),
    seed('medium', 'How do useEffect dependencies work in React?', 'The dependency array tells React when the effect must rerun because a referenced value changed across renders.', ['useeffect', 'dependencies']),
    seed('hard', 'How does React rendering differ from committing to the DOM?', 'Rendering computes the next tree, while the commit phase applies the approved changes to the real DOM and runs layout-affecting lifecycle work.', ['rendering', 'commit-phase']),
    seed('medium', 'What problem does lifting state up solve in React?', 'Lifting state up gives multiple children a shared source of truth so they can stay synchronized through props and callbacks.', ['state', 'architecture']),
    seed('hard', 'How do Suspense and lazy loading work in React?', 'Suspense lets React coordinate fallback UI around async boundaries, and lazy loading delays code download until a component is actually needed.', ['suspense', 'lazy-loading']),
    seed('medium', 'How do refs differ from state in React?', 'Refs store mutable values without triggering re-renders, while state changes schedule a new render with updated UI output.', ['refs', 'state']),
    seed('medium', 'What is prop drilling and when is it a real problem?', 'Prop drilling is passing data through intermediate components that do not use it, and it becomes a problem when it hurts clarity or changeability.', ['props', 'architecture']),
    seed('hard', 'How do you optimize large list rendering in React?', 'Use stable keys, windowing, split expensive child work, and avoid re-rendering every row when only a small part of the list changes.', ['performance', 'virtualization', 'lists']),
    seed('medium', 'How do custom hooks improve React codebases?', 'Custom hooks package stateful logic behind a reusable API so duplicated effect and state wiring stays consistent.', ['custom-hooks', 'reuse']),
    seed('hard', 'How do error boundaries work in React?', 'Error boundaries catch render-time errors in child trees and display fallback UI so one broken feature does not blank the whole interface.', ['error-boundaries', 'resilience']),
    seed('medium', 'What is the difference between server state and client state in React apps?', 'Server state comes from remote systems and needs caching and refetch rules, while client state represents local UI or user workflow state.', ['state-management', 'server-state']),
    seed('medium', 'How do forms and derived state interact in React?', 'Derived values should usually be computed from source state during render instead of duplicated into extra state that can drift out of sync.', ['forms', 'derived-state']),
    seed('hard', 'How does React Strict Mode help development?', 'Strict Mode intentionally replays certain behaviors in development to surface side effects, unsafe assumptions, and cleanup bugs earlier.', ['strict-mode', 'debugging']),
    seed('medium', 'How does event handling work in React?', 'React normalizes browser events and lets components respond through declarative handlers tied to rendered elements.', ['events', 'synthetic-events']),
    seed('hard', 'How do you manage side effects in React without creating accidental loops?', 'Keep effects focused on external synchronization, list real dependencies, and move pure calculations back into render or event handlers.', ['effects', 'side-effects']),
    seed('medium', 'What are fragments in React?', 'Fragments group sibling elements without adding an extra DOM wrapper, which keeps markup cleaner and layout safer.', ['fragments', 'jsx']),
    seed('medium', 'How do conditional rendering patterns work in React?', 'React components can branch with standard JavaScript expressions, but the branch should keep state ownership and readability predictable.', ['conditional-rendering', 'jsx']),
    seed('hard', 'How do transitions improve perceived performance in React?', 'Transitions mark non-urgent updates so urgent interactions stay responsive while lower-priority UI work finishes in the background.', ['transitions', 'performance']),
    seed('medium', 'What is the role of state immutability in React?', 'Immutable updates give React reliable change boundaries and make debugging, memoization, and time-based tooling more predictable.', ['immutability', 'state']),
    seed('hard', 'How do you structure data fetching in modern React applications?', 'Choose clear boundaries for fetching, caching, and invalidation so components stay focused on UI rather than transport concerns.', ['data-fetching', 'architecture']),
    seed('medium', 'What are render props and when would you still use them?', 'Render props let a component share behavior by calling a function child, though hooks often provide a cleaner option in modern React.', ['render-props', 'patterns']),
    seed('medium', 'How do portals work in React?', 'Portals render a subtree into a different DOM container while keeping it inside the same React ownership and event system.', ['portals', 'ui']),
    seed('hard', 'How do you avoid unnecessary re-renders in React without over-optimizing?', 'Stabilize the right boundaries, measure the hot paths, and prefer simpler state placement before adding broad memoization everywhere.', ['rerenders', 'performance']),
    seed('medium', 'How does composition compare with inheritance in React?', 'React encourages composition so behavior and layout are assembled from smaller pieces instead of deep inheritance hierarchies.', ['composition', 'architecture']),
    seed('hard', 'How do you design a scalable component architecture in React?', 'Scalable React architectures separate domain state, reusable presentation, side effects, and route-level composition so changes stay localized.', ['component-architecture', 'scalability'])
  ],
  nodejs: [
    seed('medium', 'How does the Node.js event loop handle asynchronous work?', 'Node.js uses an event loop and libuv so one JavaScript thread can coordinate many concurrent I/O operations efficiently.', ['event-loop', 'async', 'libuv']),
    seed('hard', 'When should you use Node.js streams?', 'Streams are best when you want to process large data incrementally instead of loading everything into memory at once.', ['streams', 'memory', 'performance']),
    seed('hard', 'How do clustering and worker threads differ in Node.js?', 'Clustering scales request handling across processes, while worker threads offload CPU-heavy JavaScript work inside a process.', ['clustering', 'worker-threads', 'performance']),
    seed('medium', 'How should errors be handled in a Node.js API?', 'Node APIs should centralize error handling, preserve HTTP intent, avoid leaking internals, and log enough context for diagnosis.', ['errors', 'api', 'best-practice']),
    seed('hard', 'How do you protect a Node.js API from overload?', 'Protect Node services with rate limits, timeouts, backpressure, request size limits, and clear observability around latency and queue depth.', ['scalability', 'rate-limiting', 'resilience']),
    seed('medium', 'What is the difference between process.nextTick and setImmediate?', 'process.nextTick runs before the event loop continues, while setImmediate queues work for a later phase after I/O polling.', ['event-loop', 'timers']),
    seed('medium', 'How do CommonJS and ES modules differ in Node.js?', 'CommonJS is require-based and historically default in Node, while ES modules use import/export and align with modern JavaScript tooling.', ['modules', 'commonjs', 'esm']),
    seed('hard', 'How do you debug event-loop blocking in Node.js?', 'Measure event-loop delay, inspect hot CPU paths, and move expensive work out of latency-sensitive request handlers.', ['debugging', 'performance', 'event-loop']),
    seed('medium', 'How does Node.js handle file system I/O?', 'File system calls are usually delegated to libuv-managed worker threads so the main JavaScript thread can keep serving other work.', ['fs', 'io']),
    seed('hard', 'What is backpressure in Node.js streams?', 'Backpressure is the mechanism that slows producers down when consumers cannot keep up, which protects memory and throughput.', ['streams', 'backpressure']),
    seed('medium', 'How do environment variables fit into Node.js applications?', 'Environment variables configure runtime behavior and secrets per deployment without hardcoding environment-specific values into source files.', ['configuration', 'deployment']),
    seed('medium', 'What is the purpose of middleware-style request pipelines in Node.js frameworks?', 'Middleware-style pipelines let teams layer cross-cutting concerns such as auth, logging, and validation without duplicating code in every route.', ['middleware', 'architecture']),
    seed('hard', 'How do you design background job processing with Node.js?', 'Use queues and worker processes for retries, scheduling, and isolation so long-running work does not block request handling.', ['queues', 'background-jobs', 'architecture']),
    seed('medium', 'How do you validate input in Node.js services?', 'Validate at the boundary so downstream code can rely on consistent shapes and business rules instead of guessing at input quality.', ['validation', 'api']),
    seed('hard', 'How do you scale WebSocket services in Node.js?', 'Scale WebSockets with stateless connection routing, shared pub/sub, heartbeat management, and careful handling of reconnect and fanout behavior.', ['websockets', 'scalability']),
    seed('medium', 'What is the difference between synchronous and asynchronous APIs in Node.js?', 'Synchronous APIs block the event loop, while asynchronous APIs let Node continue serving other work while waiting on I/O or completion callbacks.', ['sync', 'async']),
    seed('medium', 'How do you structure configuration for multiple Node.js environments?', 'Keep defaults in code, override environment-specific values externally, and fail fast when required configuration is missing.', ['configuration', 'best-practice']),
    seed('hard', 'How do you secure a Node.js API in production?', 'Production security requires auth, authorization, input validation, dependency hygiene, secure headers, and secrets handling that survives incident review.', ['security', 'api']),
    seed('medium', 'How do timers work in Node.js?', 'Timers schedule callbacks for future phases of the event loop, but execution timing still depends on current workload and blocking code.', ['timers', 'event-loop']),
    seed('hard', 'How do you tune a Node.js service for high memory pressure?', 'Profile allocations, stream large payloads, cap caches, and separate memory-heavy work so latency-sensitive paths stay stable.', ['memory', 'performance']),
    seed('medium', 'How does Node.js handle child processes?', 'Child processes let Node run external commands or separate programs when work should be isolated from the main runtime.', ['child-process', 'integration']),
    seed('hard', 'How do you implement graceful shutdown in Node.js?', 'Graceful shutdown stops new work, drains in-flight requests, closes connections, and gives observability enough context to confirm a clean exit.', ['graceful-shutdown', 'operations']),
    seed('medium', 'What is the difference between Buffer and streams in Node.js?', 'Buffer holds a chunk already in memory, while streams move many chunks through a pipeline without materializing the whole payload at once.', ['buffer', 'streams']),
    seed('hard', 'How do you monitor a Node.js service effectively?', 'Track latency, error rate, throughput, event-loop delay, memory usage, and business-level symptoms so runtime issues become actionable quickly.', ['observability', 'monitoring']),
    seed('medium', 'How does package versioning affect Node.js applications?', 'Loose dependency management can introduce breaking runtime changes, so teams pin or constrain versions and review upgrades deliberately.', ['dependencies', 'versioning']),
    seed('hard', 'How do you design idempotent Node.js handlers for retries?', 'Idempotent handlers recognize duplicate operations and return a safe consistent result even when clients or queues retry the same request.', ['idempotency', 'api', 'retries']),
    seed('medium', 'How do async iterators fit into Node.js?', 'Async iterators let you consume asynchronous sequences with for await...of, which can simplify stream-like control flows.', ['async-iterators', 'language']),
    seed('medium', 'How do you choose between Node.js and a thread-per-request runtime?', 'Choose Node when the workload is I/O-heavy and high-concurrency with lightweight coordination, not when every request burns CPU for long periods.', ['architecture', 'runtime-choice']),
    seed('hard', 'How do you isolate CPU-heavy work in Node.js?', 'Move CPU-heavy work to worker threads, separate services, or queue-backed jobs so the main event loop remains responsive.', ['cpu-bound', 'worker-threads']),
    seed('medium', 'How do you keep Node.js code testable as APIs grow?', 'Separate transport concerns from business logic, inject dependencies cleanly, and keep side effects at the edges of the system.', ['testing', 'architecture'])
  ],
  expressjs: [
    seed('medium', 'How does Express.js middleware execution order work?', 'Express runs middleware in the order it is registered, so authentication, parsing, validation, and error handling must be composed intentionally.', ['middleware', 'routing']),
    seed('medium', 'How should you structure routes, controllers, and services in an Express.js app?', 'Keep routes thin, move request orchestration into controllers, and isolate business logic in services so the API stays maintainable.', ['architecture', 'services', 'controllers']),
    seed('medium', 'How do you handle errors centrally in Express.js?', 'Forward route errors to one error-handling middleware so status codes, logging, and safe client responses are consistent.', ['errors', 'middleware']),
    seed('hard', 'How do you validate request input in Express.js?', 'Validate body, params, and query data before business logic so downstream code can rely on trusted shapes and meaningful error messages.', ['validation', 'api']),
    seed('medium', 'What is the difference between app.use and app.METHOD in Express.js?', 'app.use mounts middleware for a path or all paths, while app.METHOD handles a specific HTTP verb such as GET or POST.', ['routing', 'middleware']),
    seed('medium', 'How do route parameters differ from query parameters in Express.js?', 'Route params identify a resource path segment, while query params refine how the resource is filtered, sorted, or paginated.', ['routing', 'http']),
    seed('hard', 'How do you build authentication middleware in Express.js?', 'Authentication middleware should verify credentials or tokens once, attach trusted identity to the request, and fail fast when access is invalid.', ['authentication', 'security', 'middleware']),
    seed('medium', 'How do you design pagination in Express.js endpoints?', 'Keep pagination contracts explicit and stable so clients understand limits, cursors or offsets, and how to request the next slice safely.', ['pagination', 'api-design']),
    seed('hard', 'How do you prevent duplicate business logic across Express.js endpoints?', 'Factor shared workflows into services or domain functions so handlers stay small and changeable as the API surface grows.', ['architecture', 'best-practice']),
    seed('medium', 'What is the purpose of next in Express.js middleware?', 'next passes control to the next matching middleware or route handler and is how the pipeline stays composable.', ['middleware', 'control-flow']),
    seed('medium', 'How do you serve static assets with Express.js safely?', 'Serve static assets from explicit directories and keep caching, compression, and upload paths controlled rather than implicit.', ['static-assets', 'security']),
    seed('hard', 'How do you secure Express.js APIs against common attacks?', 'Use validation, safe headers, rate limits, auth checks, and clear request size limits to reduce easy attack surfaces.', ['security', 'api']),
    seed('medium', 'How do cookies and sessions fit into Express.js?', 'Cookies store client-visible session identifiers, while server-side session storage or signed tokens determine how identity is actually trusted.', ['cookies', 'sessions']),
    seed('hard', 'How do you design reusable Express.js middleware?', 'Reusable middleware should focus on one concern, avoid hidden response behavior, and expose clear assumptions about required request context.', ['middleware', 'reuse']),
    seed('medium', 'How do you handle async route handlers in Express.js?', 'Wrap async handlers so rejected promises still reach the error middleware instead of causing hung requests or noisy unhandled rejections.', ['async', 'errors']),
    seed('medium', 'How do routers improve Express.js applications?', 'Routers group related endpoints and middleware so larger APIs can scale by feature area instead of one giant app file.', ['routers', 'architecture']),
    seed('hard', 'How do you implement request logging and tracing in Express.js?', 'Central request logging should capture identifiers, latency, and error metadata without leaking secrets or duplicating logic per route.', ['logging', 'observability']),
    seed('medium', 'How do you test Express.js endpoints effectively?', 'Test the contract at the HTTP layer and mock service dependencies so route behavior stays stable without full environment coupling.', ['testing', 'api']),
    seed('hard', 'How do you support API versioning in Express.js?', 'Version only where contracts truly diverge, keep shared internals centralized, and avoid creating permanent parallel APIs without ownership.', ['versioning', 'api-design']),
    seed('medium', 'How do response helpers like res.json and res.status work in Express.js?', 'These helpers make intent explicit by pairing payload format with the correct HTTP status before the response is sent.', ['responses', 'http']),
    seed('hard', 'How do you design idempotent Express.js write endpoints?', 'Use stable identifiers and duplicate-request handling so retries do not create extra side effects or inconsistent state.', ['idempotency', 'retries']),
    seed('medium', 'How do you use express.json safely?', 'Limit body size, validate parsed input, and understand that parsing trusted JSON is only one step in making a request safe to process.', ['body-parser', 'security']),
    seed('medium', 'What is CORS and how do you configure it in Express.js?', 'CORS controls which origins may call browser-exposed endpoints, and configuration should reflect the actual frontend and credential rules.', ['cors', 'browser']),
    seed('hard', 'How do you design file upload handling in Express.js?', 'Stream uploads when possible, constrain file size and type, and avoid buffering large or untrusted payloads in memory.', ['uploads', 'streams', 'security']),
    seed('medium', 'How do 401 and 403 responses differ in Express.js APIs?', '401 means the caller is not authenticated, while 403 means they are authenticated but not authorized for the requested action.', ['authorization', 'http']),
    seed('hard', 'How do you manage transactions across Express.js request handlers?', 'Keep transaction boundaries in the service layer so multi-step business operations remain atomic without leaking persistence details into routes.', ['transactions', 'architecture']),
    seed('medium', 'How do you structure environment-specific configuration in Express.js apps?', 'Separate deploy-time configuration from application logic and fail fast when required settings are missing or inconsistent.', ['configuration', 'deployment']),
    seed('hard', 'How do you add rate limiting to an Express.js service?', 'Rate limiting belongs close to the edge so abusive patterns are stopped early and legitimate clients still receive clear retry guidance.', ['rate-limiting', 'security']),
    seed('medium', 'How do you expose health checks in Express.js?', 'Health endpoints should report the service state quickly and safely without performing expensive business work on every probe.', ['health-checks', 'operations']),
    seed('hard', 'How do you prepare an Express.js app for production deployment?', 'Production readiness means graceful shutdown, secure config, observability, error handling, and performance limits that are proven before incidents happen.', ['deployment', 'operations', 'best-practice'])
  ],
  mongodb: [
    seed('medium', 'How do MongoDB indexes improve query performance?', 'Indexes let MongoDB avoid scanning every document by storing frequently queried fields in searchable structures.', ['indexing', 'query-performance']),
    seed('hard', 'How does the MongoDB aggregation pipeline work?', 'The aggregation pipeline transforms documents through ordered stages such as match, group, project, lookup, and sort.', ['aggregation', 'pipeline']),
    seed('hard', 'When should you embed versus reference data in MongoDB?', 'Embed data that is read together and bounded in size, and reference data that is shared, large, or updated independently.', ['schema-design', 'embedding', 'referencing']),
    seed('hard', 'What is sharding in MongoDB and when is it needed?', 'Sharding distributes data across multiple shards when one replica set cannot handle the required storage or throughput.', ['sharding', 'scaling']),
    seed('medium', 'How do transactions work in MongoDB?', 'MongoDB supports multi-document transactions for workflows where related writes must commit or roll back together.', ['transactions', 'acid']),
    seed('medium', 'What is the difference between a collection and a document in MongoDB?', 'A collection groups similar documents, and each document is a BSON record representing one stored entity.', ['documents', 'collections']),
    seed('hard', 'How do compound indexes affect MongoDB queries?', 'Compound indexes support filters and sorts efficiently when their field order matches the real query patterns your application uses.', ['compound-indexes', 'query-performance']),
    seed('medium', 'How do replica sets improve MongoDB reliability?', 'Replica sets keep multiple copies of data and support automatic failover so a single node outage does not mean total data loss or downtime.', ['replica-sets', 'reliability']),
    seed('hard', 'How do you choose a good shard key in MongoDB?', 'A good shard key balances writes, supports targeted reads, and avoids creating hot partitions or scatter-gather traffic.', ['shard-key', 'scaling']),
    seed('medium', 'What is BSON and how does it differ from JSON?', 'BSON is MongoDBs binary document format and supports extra types such as ObjectId and Date that plain JSON does not encode natively.', ['bson', 'data-types']),
    seed('hard', 'How do you optimize slow MongoDB queries?', 'Use explain plans, adjust indexes, push selective filters earlier, and verify that the query shape matches the intended access pattern.', ['optimization', 'explain', 'indexes']),
    seed('medium', 'How do update operators like $set and $inc work in MongoDB?', 'Update operators change only the targeted fields so you can modify part of a document without replacing the whole record.', ['updates', 'operators']),
    seed('hard', 'How do you model one-to-many relationships in MongoDB?', 'Model one-to-many relationships based on access patterns, update frequency, and document growth instead of starting from relational normalization rules.', ['relationships', 'schema-design']),
    seed('medium', 'How do projections help MongoDB queries?', 'Projections return only the fields the caller needs, which reduces payload size and can sometimes improve query efficiency.', ['projections', 'performance']),
    seed('hard', 'What are covered queries in MongoDB?', 'A covered query can be satisfied entirely from the index without reading the full documents from storage.', ['covered-queries', 'indexes']),
    seed('medium', 'How do TTL indexes work in MongoDB?', 'TTL indexes automatically remove documents after a configured expiration, which is useful for ephemeral data such as sessions or logs.', ['ttl', 'indexes']),
    seed('hard', 'How does $lookup compare with embedding in MongoDB?', 'lookup can join related collections when needed, but embedding often wins for read-heavy access patterns that repeatedly need the same child data.', ['lookup', 'schema-design']),
    seed('medium', 'What is the role of ObjectId in MongoDB?', 'ObjectId is the default primary identifier type and carries ordering-friendly uniqueness without requiring a centralized sequence.', ['objectid', 'primary-key']),
    seed('hard', 'How do you handle schema evolution in MongoDB?', 'Schema evolution works best when documents are version-aware, writes are backward compatible, and readers tolerate older shapes during rollout.', ['schema-evolution', 'migration']),
    seed('medium', 'How do unique indexes protect data quality in MongoDB?', 'Unique indexes enforce identity rules such as one email per user and prevent duplicate writes from racing into the same logical record.', ['unique-indexes', 'data-quality']),
    seed('hard', 'How do you think about write concern and read concern in MongoDB?', 'Write concern and read concern define how durable writes must be and how consistent reads need to be for the business operation.', ['consistency', 'write-concern', 'read-concern']),
    seed('medium', 'How do you paginate data safely in MongoDB?', 'Cursor-like pagination built on stable sort keys is usually safer and more efficient than large offsets on frequently changing datasets.', ['pagination', 'query-design']),
    seed('hard', 'How do you monitor MongoDB health in production?', 'Monitor replication lag, slow queries, cache pressure, connection behavior, and disk usage so operational issues show up before user-visible failures.', ['monitoring', 'operations']),
    seed('medium', 'What is the difference between find and aggregate in MongoDB?', 'find handles straightforward retrieval, while aggregate is better when you need multi-stage shaping, grouping, or joining behavior.', ['find', 'aggregate']),
    seed('hard', 'How do you design indexes for sort-heavy MongoDB endpoints?', 'Design the index so filter fields and sort order align, otherwise MongoDB may sort in memory and lose the performance benefit.', ['sorting', 'indexes']),
    seed('medium', 'How do partial indexes help in MongoDB?', 'Partial indexes cover only documents that match a filter, which saves space and write cost for targeted access patterns.', ['partial-indexes', 'optimization']),
    seed('hard', 'How do MongoDB change streams work?', 'Change streams let applications observe real-time data changes without polling, as long as the deployment supports the required replication features.', ['change-streams', 'realtime']),
    seed('medium', 'How do bulk writes improve MongoDB operations?', 'Bulk writes reduce round trips and let related write operations be submitted together for better throughput.', ['bulk-writes', 'performance']),
    seed('hard', 'How do you prepare MongoDB for multi-tenant workloads?', 'Multi-tenant MongoDB design needs careful index strategy, noisy-neighbor controls, and clear boundaries around data isolation and scaling.', ['multi-tenant', 'architecture']),
    seed('medium', 'How do you decide whether a field should be indexed in MongoDB?', 'Index fields that are frequently filtered, sorted, or joined logically by lookup patterns, but avoid indexing everything because writes and memory are not free.', ['index-strategy', 'performance'])
  ],
  mysql: [
    seed('medium', 'What is the difference between INNER JOIN and LEFT JOIN in MySQL?', 'INNER JOIN keeps only matching rows from both sides, while LEFT JOIN keeps all rows from the left side even when no match exists on the right.', ['joins', 'sql']),
    seed('medium', 'How do indexes improve MySQL query performance?', 'Indexes reduce the number of rows MySQL must inspect by storing searchable key orderings for common filter and sort patterns.', ['indexes', 'performance']),
    seed('hard', 'What is normalization and when should you denormalize in MySQL?', 'Normalization reduces redundancy and update anomalies, while denormalization is chosen deliberately when read patterns justify the extra storage and write complexity.', ['normalization', 'denormalization', 'schema-design']),
    seed('medium', 'How do transactions work in MySQL?', 'Transactions group related statements so they commit together or roll back together when part of the workflow fails.', ['transactions', 'acid']),
    seed('hard', 'How does the InnoDB storage engine affect MySQL behavior?', 'InnoDB provides row-level locking, crash recovery, and transactional consistency, which is why it is the default choice for most production workloads.', ['innodb', 'storage-engine']),
    seed('medium', 'What is the difference between WHERE and HAVING in MySQL?', 'WHERE filters rows before grouping, while HAVING filters grouped results after aggregate calculations are available.', ['sql', 'aggregation']),
    seed('medium', 'How do composite indexes work in MySQL?', 'Composite indexes support queries that filter on the leftmost indexed columns and can also help with sorting when the query shape aligns.', ['composite-indexes', 'performance']),
    seed('hard', 'How do you troubleshoot a slow MySQL query?', 'Use execution plans, inspect indexes, reduce unnecessary row scans, and verify that the query shape matches the data distribution and access pattern.', ['optimization', 'explain']),
    seed('medium', 'What is the purpose of foreign keys in MySQL?', 'Foreign keys enforce relational integrity so child rows cannot point at missing parents without the database noticing.', ['foreign-keys', 'integrity']),
    seed('hard', 'How do locking and isolation levels affect MySQL concurrency?', 'Isolation level choices trade consistency guarantees against contention, blocking behavior, and the kinds of anomalies your workload can tolerate.', ['locking', 'isolation-levels']),
    seed('medium', 'How do GROUP BY and aggregate functions work in MySQL?', 'GROUP BY forms result buckets, and aggregate functions such as COUNT or SUM compute one value per bucket.', ['group-by', 'aggregates']),
    seed('medium', 'How do LIMIT and OFFSET affect pagination in MySQL?', 'They are simple to use, but large offsets can become slow and unstable on changing datasets compared with cursor-style pagination.', ['pagination', 'limit-offset']),
    seed('hard', 'How do you design schema for many-to-many relationships in MySQL?', 'Use a junction table with proper keys so both sides stay normalized and the relationship can carry its own metadata when needed.', ['many-to-many', 'schema-design']),
    seed('medium', 'What is the difference between CHAR and VARCHAR in MySQL?', 'CHAR stores fixed-length values, while VARCHAR stores variable-length values and is usually more space-efficient for uneven text.', ['data-types', 'storage']),
    seed('hard', 'How do covering indexes help MySQL queries?', 'A covering index lets MySQL answer a query directly from indexed columns without reading the full table rows.', ['covering-index', 'performance']),
    seed('medium', 'How do UNIQUE constraints differ from PRIMARY KEY in MySQL?', 'Both enforce uniqueness, but the primary key is the main row identifier and a table can have only one of them.', ['constraints', 'primary-key']),
    seed('hard', 'How do you handle replication lag in MySQL?', 'Replication lag requires monitoring, read routing discipline, and an understanding of whether the workload can tolerate slightly stale reads.', ['replication', 'operations']),
    seed('medium', 'How do subqueries compare with joins in MySQL?', 'Both can express valid logic, but joins are often clearer and more optimizable when relating tables directly.', ['subqueries', 'joins']),
    seed('hard', 'How do you plan MySQL backups and recovery?', 'Reliable recovery means tested backups, restore drills, transaction log strategy, and documented recovery time expectations.', ['backup', 'recovery', 'operations']),
    seed('medium', 'How do AUTO_INCREMENT keys work in MySQL?', 'AUTO_INCREMENT assigns increasing numeric identifiers automatically, which is convenient but must be understood in multi-writer or import workflows.', ['auto-increment', 'keys']),
    seed('hard', 'What are deadlocks in MySQL and how do you reduce them?', 'Deadlocks happen when concurrent transactions lock resources in conflicting order, and they are reduced by shorter transactions and consistent access patterns.', ['deadlocks', 'transactions']),
    seed('medium', 'How do CHECK constraints help in modern MySQL?', 'CHECK constraints push simple validation rules into the database so obviously invalid rows are rejected before they spread.', ['constraints', 'validation']),
    seed('hard', 'How do partitioning strategies help large MySQL tables?', 'Partitioning can improve manageability and some query patterns, but only when the partition key matches how data is filtered and maintained.', ['partitioning', 'scalability']),
    seed('medium', 'How do views work in MySQL?', 'Views package reusable query logic behind a named interface so callers can read consistent projections without duplicating SQL.', ['views', 'sql']),
    seed('hard', 'How do you optimize write-heavy MySQL workloads?', 'Tune indexes carefully, batch writes where safe, keep transactions short, and measure storage-engine contention instead of guessing.', ['write-performance', 'optimization']),
    seed('medium', 'How do indexes affect insert and update performance in MySQL?', 'Every extra index helps some reads but adds maintenance cost to writes, so index selection must reflect the real workload.', ['indexes', 'write-cost']),
    seed('hard', 'How do you migrate MySQL schema changes safely in production?', 'Safe migrations separate destructive steps, backfill gradually, and avoid long locks that can freeze a live service.', ['migration', 'operations']),
    seed('medium', 'What is the difference between DELETE and TRUNCATE in MySQL?', 'DELETE removes matching rows transactionally, while TRUNCATE clears the whole table more directly and resets related storage metadata.', ['delete', 'truncate']),
    seed('hard', 'How do you design read replicas into a MySQL architecture?', 'Read replicas scale reads, but you must handle lag, failover, and which operations still require the primary for correct freshness guarantees.', ['read-replicas', 'architecture']),
    seed('medium', 'How do you choose between TEXT and VARCHAR in MySQL?', 'Choose based on expected length, indexing needs, and how often the column participates in filters or sorting logic.', ['data-types', 'schema-design'])
  ],
  postgresql: [
    seed('medium', 'How does PostgreSQL differ from generic SQL database answers?', 'PostgreSQL stands out because it combines strong transactional behavior with advanced SQL features such as JSONB, window functions, and powerful indexing options.', ['postgresql', 'features']),
    seed('medium', 'What are window functions in PostgreSQL and when are they useful?', 'Window functions compute values across a set of related rows without collapsing them the way GROUP BY does.', ['window-functions', 'analytics']),
    seed('hard', 'How does PostgreSQL MVCC affect concurrency?', 'MVCC lets readers and writers proceed with less blocking by keeping row versions instead of overwriting data in place immediately.', ['mvcc', 'concurrency']),
    seed('medium', 'What is the difference between JSON and JSONB in PostgreSQL?', 'JSON preserves the original text representation, while JSONB stores a parsed binary format that is usually better for querying and indexing.', ['jsonb', 'data-types']),
    seed('hard', 'How do PostgreSQL indexes differ from basic B-tree-only thinking?', 'PostgreSQL supports B-tree, GIN, GiST, BRIN, and other index types so the right choice depends on the data and operator patterns.', ['indexes', 'gin', 'gist']),
    seed('medium', 'How do CTEs work in PostgreSQL?', 'Common table expressions let you name intermediate query steps so complex SQL becomes easier to read and reason about.', ['cte', 'sql']),
    seed('hard', 'How do you use EXPLAIN ANALYZE in PostgreSQL?', 'EXPLAIN ANALYZE shows the actual execution plan and timing so you can compare what the planner expected with what really happened.', ['explain', 'optimization']),
    seed('medium', 'How do PostgreSQL transactions and savepoints work?', 'Savepoints let you partially roll back sections of a transaction without losing the whole unit of work.', ['transactions', 'savepoints']),
    seed('hard', 'When should you use partial indexes in PostgreSQL?', 'Partial indexes are valuable when only a subset of rows is queried often enough to justify a focused, smaller index.', ['partial-indexes', 'performance']),
    seed('medium', 'How do sequences differ from serial and identity columns in PostgreSQL?', 'Serial and identity columns wrap a sequence for convenience, while explicit sequences offer finer control when you need it.', ['sequences', 'identity']),
    seed('hard', 'How do you handle PostgreSQL query performance on large tables?', 'Measure plans, choose the right index type, avoid unnecessary row expansion, and maintain healthy statistics so the planner makes better decisions.', ['performance', 'statistics', 'indexes']),
    seed('medium', 'What are PostgreSQL schemas and why do they matter?', 'Schemas namespace database objects so large systems can organize ownership, permissions, and search path behavior more clearly.', ['schemas', 'organization']),
    seed('hard', 'How do PostgreSQL locking modes affect application behavior?', 'Different lock modes protect different operations, and understanding them helps teams avoid surprise blocking in live systems.', ['locking', 'concurrency']),
    seed('medium', 'How do upserts work in PostgreSQL?', 'INSERT ... ON CONFLICT lets PostgreSQL create a row or update the existing one when a uniqueness rule would be violated.', ['upsert', 'sql']),
    seed('hard', 'How do materialized views help PostgreSQL workloads?', 'Materialized views precompute expensive query results so read-heavy reporting can trade freshness for much faster access.', ['materialized-views', 'analytics']),
    seed('medium', 'How do PostgreSQL enums compare with lookup tables?', 'Enums are convenient for small stable sets, while lookup tables are more flexible when values, metadata, or translations may evolve.', ['enums', 'schema-design']),
    seed('hard', 'How do GIN indexes help PostgreSQL search or JSONB queries?', 'GIN indexes are optimized for composite membership lookups such as arrays, full-text search terms, or JSONB containment operators.', ['gin', 'jsonb', 'search']),
    seed('medium', 'How do foreign keys and cascading actions work in PostgreSQL?', 'Foreign keys enforce relational integrity, and cascading rules define how related rows react to updates or deletes.', ['foreign-keys', 'integrity']),
    seed('hard', 'How do PostgreSQL isolation levels change transaction behavior?', 'Isolation levels determine which concurrency anomalies are prevented and what locking or retry behavior your application must expect.', ['isolation-levels', 'transactions']),
    seed('medium', 'What are PostgreSQL extensions and when should you use them?', 'Extensions add focused capabilities such as UUID generation or full-text helpers without requiring a new database product.', ['extensions', 'ecosystem']),
    seed('hard', 'How do logical replication and physical replication differ in PostgreSQL?', 'Physical replication copies the underlying data changes closely, while logical replication publishes row-level changes more flexibly.', ['replication', 'architecture']),
    seed('medium', 'How do CHECK constraints and generated columns help PostgreSQL design?', 'They push simple invariants and derived data rules into the database where they are enforced consistently for every writer.', ['constraints', 'generated-columns']),
    seed('hard', 'How do you design multi-tenant data models in PostgreSQL?', 'Multi-tenant PostgreSQL design balances isolation, indexing, and operational simplicity around tenant-aware access patterns.', ['multi-tenant', 'architecture']),
    seed('medium', 'How does PostgreSQL full-text search work?', 'PostgreSQL tokenizes text into searchable vectors so applications can rank and search content without a separate engine for simple cases.', ['full-text-search', 'search']),
    seed('hard', 'How do VACUUM and autovacuum affect PostgreSQL health?', 'VACUUM reclaims dead tuples and keeps table statistics healthy, while autovacuum automates that maintenance to prevent bloat and degraded planning.', ['vacuum', 'maintenance']),
    seed('medium', 'How do arrays work in PostgreSQL and when are they appropriate?', 'Arrays are useful for bounded ordered values, but they should not replace relational design when independent querying and integrity matter.', ['arrays', 'data-modeling']),
    seed('hard', 'How do you plan PostgreSQL schema migrations in production?', 'Safe PostgreSQL migrations avoid long locks, split incompatible changes, and verify both performance and rollback options.', ['migration', 'operations']),
    seed('medium', 'How do views differ from materialized views in PostgreSQL?', 'Views run the underlying query each time, while materialized views store a snapshot that must be refreshed.', ['views', 'materialized-views']),
    seed('hard', 'How do you monitor PostgreSQL effectively?', 'Track connections, long queries, replication state, vacuum health, disk usage, and lock contention so operational issues become visible early.', ['monitoring', 'operations']),
    seed('medium', 'How do you decide whether JSONB belongs in a PostgreSQL schema?', 'Use JSONB when some fields are flexible or document-like, but keep frequently queried relational data in normal columns.', ['jsonb', 'schema-design'])
  ],
  'rest-apis': [
    seed('medium', 'What makes a REST API well-designed?', 'A well-designed REST API uses resource-oriented URLs, correct HTTP methods, stable contracts, and predictable status and error semantics.', ['api-design', 'http']),
    seed('hard', 'How do you design pagination for a high-volume REST API?', 'High-volume APIs usually benefit from cursor pagination because it scales better and avoids unstable offsets on changing datasets.', ['pagination', 'cursor', 'scalability']),
    seed('medium', 'How should REST APIs handle errors?', 'REST APIs should return appropriate status codes plus a consistent machine-readable error body that clients can act on safely.', ['errors', 'status-codes']),
    seed('medium', 'What is the difference between PUT and PATCH in REST APIs?', 'PUT replaces the full resource representation conceptually, while PATCH applies partial updates to part of the resource.', ['http-methods', 'updates']),
    seed('hard', 'How do you design idempotent REST endpoints?', 'Idempotent endpoints return the same effect after repeated equivalent requests, which is critical for retries and distributed reliability.', ['idempotency', 'retries']),
    seed('medium', 'How do HTTP status codes communicate API outcomes?', 'Status codes separate successful work, client mistakes, and server failures so integrations can respond correctly without reading prose only.', ['http', 'status-codes']),
    seed('hard', 'How do rate limiting and quotas fit into REST APIs?', 'Rate limits protect shared infrastructure and shape client behavior, while quotas communicate longer-term allocation or commercial boundaries.', ['rate-limiting', 'api-governance']),
    seed('medium', 'What is the difference between authentication and authorization in a REST API?', 'Authentication proves who the caller is, while authorization decides what that caller may do on a given resource.', ['security', 'auth']),
    seed('hard', 'How do you version REST APIs responsibly?', 'Version only when compatibility truly breaks, and prefer additive changes plus deprecation planning over constant endpoint churn.', ['versioning', 'api-design']),
    seed('medium', 'How do filtering and sorting fit into REST API query design?', 'Filtering and sorting belong in clear query parameters with documented defaults so list endpoints stay consistent and composable.', ['filtering', 'sorting', 'query-params']),
    seed('hard', 'How do you design REST APIs for eventual consistency?', 'Document freshness guarantees, expose operation state clearly, and make retries or follow-up reads safe when writes do not become visible instantly.', ['consistency', 'distributed-systems']),
    seed('medium', 'What is HATEOAS and why is it rarely the main interview focus?', 'HATEOAS is the idea that responses expose navigable links, but most interviews care more about resource modeling, contracts, and practical operations.', ['hateoas', 'api-design']),
    seed('hard', 'How do you make REST APIs observable in production?', 'Capture request identifiers, latency, status classes, error codes, and business signals so incidents can be traced across services and clients.', ['observability', 'operations']),
    seed('medium', 'How do caching headers help REST APIs?', 'Headers such as Cache-Control and ETag let clients and intermediaries reuse responses safely and reduce unnecessary server work.', ['caching', 'http']),
    seed('hard', 'How do you handle large file uploads in REST APIs?', 'Large uploads should stream, validate metadata early, and avoid buffering untrusted payloads fully in memory.', ['uploads', 'streaming']),
    seed('medium', 'How do ETags support optimistic concurrency in REST APIs?', 'ETags let a client prove it edited the version it last read so conflicting updates can be detected instead of silently overwritten.', ['etag', 'concurrency']),
    seed('hard', 'How do you secure public-facing REST APIs?', 'Security means auth, authorization, validation, abuse protection, safe logging, and clear handling of sensitive data at every layer.', ['security', 'public-api']),
    seed('medium', 'How do resource naming conventions affect REST API clarity?', 'Consistent plural nouns and predictable nesting reduce ambiguity and help both humans and tools understand endpoint intent quickly.', ['resource-modeling', 'naming']),
    seed('hard', 'How do you design asynchronous REST workflows?', 'Long-running operations should return an accepted response plus a status resource so clients can poll or receive completion updates safely.', ['async-workflows', 'architecture']),
    seed('medium', 'How do REST APIs expose validation errors usefully?', 'Validation errors should point to the failing field or rule so clients can correct requests without guessing.', ['validation', 'errors']),
    seed('hard', 'How do you manage backward compatibility in REST APIs?', 'Backward compatibility requires discipline around additive changes, tolerant readers, and explicit sunset planning for truly breaking contracts.', ['compatibility', 'api-governance']),
    seed('medium', 'How do you model relationships between resources in REST?', 'Model relationships through resource identifiers, sub-resources, or links while keeping ownership and lifecycle rules understandable.', ['relationships', 'resource-modeling']),
    seed('hard', 'How do retries influence REST API design?', 'Retries require idempotency, safe timeouts, and request tracing so duplicates do not corrupt state or confuse clients.', ['retries', 'resilience']),
    seed('medium', 'How do 401, 403, and 404 differ in REST APIs?', '401 means not authenticated, 403 means authenticated but forbidden, and 404 means the resource is not found or intentionally concealed.', ['status-codes', 'security']),
    seed('hard', 'How do you design API documentation that stays accurate?', 'Treat docs as part of the contract, generate examples where possible, and version or test documentation alongside implementation changes.', ['documentation', 'best-practice']),
    seed('medium', 'How do REST APIs support partial responses?', 'Partial responses let clients request only needed fields when payload size and latency matter, but they must stay well documented and consistent.', ['partial-response', 'performance']),
    seed('hard', 'How do you design multi-tenant REST APIs?', 'Multi-tenant APIs must isolate data access, enforce tenant-scoped authorization, and expose rate or usage policies that reflect tenant boundaries.', ['multi-tenant', 'security', 'architecture']),
    seed('medium', 'How do webhooks complement REST APIs?', 'Webhooks push event notifications to clients so they do not have to poll continuously for every change.', ['webhooks', 'integration']),
    seed('hard', 'How do you decide when REST is the wrong API style?', 'REST is a strong default, but streaming, graph-shaped reads, or tightly interactive protocols can justify a different interface style.', ['architecture', 'tradeoffs']),
    seed('medium', 'How do REST APIs communicate deprecation to clients?', 'Communicate deprecation early through docs, headers, changelogs, and migration guidance so clients have time to move safely.', ['deprecation', 'api-governance'])
  ],
  graphql: [
    seed('medium', 'How does GraphQL solve over-fetching and under-fetching?', 'GraphQL lets clients request exactly the fields they need from a typed schema instead of relying on fixed server response shapes.', ['queries', 'schema']),
    seed('hard', 'What is the N+1 problem in GraphQL and how do you fix it?', 'The N+1 problem appears when resolvers fetch child data one parent at a time, and batching tools such as DataLoader are the standard fix.', ['n-plus-one', 'dataloader', 'performance']),
    seed('medium', 'How do mutations work in GraphQL?', 'Mutations are schema fields that change server state and return typed payloads describing the result.', ['mutations', 'schema']),
    seed('medium', 'What are resolvers in GraphQL?', 'Resolvers are the functions that compute the value for each field in the schema when a query or mutation runs.', ['resolvers', 'execution']),
    seed('hard', 'How do you secure GraphQL APIs?', 'Secure GraphQL by enforcing auth at the right field boundaries, validating inputs, and limiting abusive query depth or complexity.', ['security', 'authorization']),
    seed('medium', 'What is the role of the GraphQL schema?', 'The schema is the contract that defines available types, fields, inputs, and operations for clients and tooling.', ['schema', 'contracts']),
    seed('hard', 'How do query complexity and depth limits protect GraphQL servers?', 'Complexity rules stop clients from submitting operations that are technically valid but operationally too expensive to execute safely.', ['query-complexity', 'security', 'performance']),
    seed('medium', 'How do fragments help GraphQL clients?', 'Fragments let clients reuse field selections consistently across queries, components, or teams.', ['fragments', 'client']),
    seed('hard', 'How do GraphQL subscriptions work?', 'Subscriptions keep clients updated over long-lived connections so they can receive server-side events as data changes.', ['subscriptions', 'realtime']),
    seed('medium', 'How do variables improve GraphQL operations?', 'Variables separate the query shape from runtime values so operations can be reused, cached, and tested more cleanly.', ['variables', 'client']),
    seed('hard', 'How do you design GraphQL schemas for evolvability?', 'Favor additive changes, explicit deprecation, and stable field naming so clients can move gradually without constant breaking changes.', ['schema-design', 'evolution']),
    seed('medium', 'What is introspection in GraphQL?', 'Introspection lets tooling inspect the schema itself, which powers autocomplete, validation, and generated documentation.', ['introspection', 'tooling']),
    seed('hard', 'How do GraphQL and REST differ operationally?', 'GraphQL gives flexible reads but shifts complexity toward resolver orchestration, caching, and runtime safeguards compared with simpler REST edges.', ['graphql-vs-rest', 'tradeoffs']),
    seed('medium', 'How do input types differ from output types in GraphQL?', 'Input types model data the client can send, while output types model data the server can return.', ['input-types', 'schema']),
    seed('hard', 'How do you cache GraphQL effectively?', 'Cache by operation shape and entity identity carefully because GraphQL responses vary by field selection and authorization context.', ['caching', 'performance']),
    seed('medium', 'How do aliases work in GraphQL?', 'Aliases rename fields in the response so the same field can be requested more than once with different arguments.', ['aliases', 'queries']),
    seed('hard', 'How do you organize resolvers in a large GraphQL codebase?', 'Separate schema definition, domain services, and field resolvers so graph shape does not leak business logic everywhere.', ['architecture', 'resolvers']),
    seed('medium', 'What is a scalar in GraphQL?', 'A scalar is a leaf value type such as String or Int, and custom scalars let APIs model validated domain values.', ['scalars', 'schema']),
    seed('hard', 'How do you avoid tightly coupling GraphQL resolvers to the database?', 'Resolvers should call domain or repository services so schema changes and persistence changes can evolve more independently.', ['architecture', 'best-practice']),
    seed('medium', 'How do unions and interfaces work in GraphQL?', 'Unions and interfaces let GraphQL model polymorphic results while still preserving strong typing for clients.', ['interfaces', 'unions']),
    seed('hard', 'How do you observe and debug GraphQL performance issues?', 'Measure operation cost, resolver latency, and downstream query counts so you can see which fields or access patterns are actually expensive.', ['observability', 'performance']),
    seed('medium', 'How do pagination patterns work in GraphQL?', 'GraphQL commonly uses cursor-based connection patterns so clients can page reliably through changing datasets.', ['pagination', 'connections']),
    seed('hard', 'How do you manage authorization at field level in GraphQL?', 'Field-level authorization enforces the real data boundary even when different clients ask for different shapes in the same API.', ['authorization', 'field-level']),
    seed('medium', 'What is the difference between nullable and non-nullable fields in GraphQL?', 'Non-nullable fields promise a value and cause parent fields to fail upward when that promise cannot be met.', ['nullability', 'schema']),
    seed('hard', 'How do federated GraphQL schemas work?', 'Federation lets multiple services own parts of a graph while composing a unified schema for clients to consume.', ['federation', 'architecture']),
    seed('medium', 'How do directives fit into GraphQL?', 'Directives add metadata or behavior hints to schema elements or operations in a standardized way.', ['directives', 'schema']),
    seed('hard', 'How do you decide when a GraphQL gateway should call downstream services in parallel?', 'Parallel fan-out helps latency when dependencies are independent, but it must be balanced against downstream cost and failure handling.', ['gateway', 'performance', 'architecture']),
    seed('medium', 'How do GraphQL errors appear in responses?', 'GraphQL often returns partial data with an errors array, so clients must handle both payload content and execution problems together.', ['errors', 'responses']),
    seed('hard', 'How do you design GraphQL for mobile clients?', 'Mobile-focused GraphQL design balances smaller payloads and fewer round trips with strict control over expensive nested queries.', ['mobile', 'performance']),
    seed('medium', 'How do GraphQL code generation tools help teams?', 'Code generation turns schema contracts into typed client and server artifacts so drift is caught earlier and developer ergonomics improve.', ['tooling', 'codegen'])
  ],
  html: [
    seed('medium', 'Why is semantic HTML important?', 'Semantic HTML gives structure and meaning to content so browsers, assistive technology, SEO tools, and developers all understand the page better.', ['semantic-html', 'accessibility']),
    seed('medium', 'What is the difference between block, inline, and inline-block elements?', 'These display behaviors affect how elements flow, size, and sit next to one another in the document layout.', ['display', 'layout']),
    seed('medium', 'How do forms work in HTML?', 'HTML forms collect named input values and submit them through a chosen method and action unless JavaScript intercepts the flow.', ['forms', 'inputs']),
    seed('hard', 'How do accessibility attributes such as aria-* complement semantic HTML?', 'ARIA adds missing accessibility metadata when native semantics alone cannot fully describe the interactive behavior.', ['aria', 'accessibility']),
    seed('medium', 'What is the difference between id and class in HTML?', 'id uniquely identifies one element, while class is intended for reusable grouping across many elements.', ['selectors', 'structure']),
    seed('medium', 'How do labels improve form usability in HTML?', 'Labels connect user-visible text to a control so clicking the text focuses the right input and screen readers announce context properly.', ['forms', 'accessibility']),
    seed('hard', 'How does the browser build the DOM from HTML?', 'The browser tokenizes HTML, constructs a DOM tree, and then uses that structure with CSS and scripts to build the rendered page.', ['dom', 'browser']),
    seed('medium', 'What is the purpose of the alt attribute on images?', 'alt text provides equivalent meaning when an image cannot be seen and should describe purpose rather than file appearance alone.', ['images', 'accessibility']),
    seed('medium', 'How do script tags affect page loading?', 'Scripts can block parsing unless deferred or loaded asynchronously, so placement and loading strategy affect perceived performance.', ['scripts', 'performance']),
    seed('hard', 'What is the difference between defer and async in HTML script loading?', 'defer preserves document order after parsing, while async loads and executes independently as soon as the file is ready.', ['scripts', 'loading']),
    seed('medium', 'Why do headings matter in HTML?', 'Heading levels give the document a navigable outline for readers, search tools, and assistive technology.', ['headings', 'semantics']),
    seed('medium', 'How do lists differ from generic div structures in HTML?', 'Lists carry built-in meaning about grouped ordered or unordered items that generic containers do not communicate.', ['lists', 'semantics']),
    seed('hard', 'How do you build accessible modal markup in HTML?', 'Accessible modal markup needs focus management, proper labelling, escape behavior, and a structure that communicates dialog state clearly.', ['dialog', 'accessibility']),
    seed('medium', 'What is the purpose of the meta viewport tag?', 'The viewport tag tells mobile browsers how to size and scale the page so responsive layouts behave as intended.', ['responsive', 'mobile']),
    seed('medium', 'How do data-* attributes work in HTML?', 'data attributes attach custom metadata to elements without inventing invalid attributes or overloading classes.', ['data-attributes', 'dom']),
    seed('hard', 'How do HTML landmarks improve navigation?', 'Landmarks such as header, nav, main, and footer give assistive technology quick jump points through the page structure.', ['landmarks', 'accessibility']),
    seed('medium', 'What is the difference between button and anchor elements?', 'Buttons trigger actions, while anchors navigate to locations or resources, and using the right element matters for accessibility and behavior.', ['buttons', 'links', 'semantics']),
    seed('medium', 'How do tables differ from grid layouts in HTML?', 'Tables are for tabular relationships between headers and cells, not for page layout or purely visual alignment.', ['tables', 'semantics']),
    seed('hard', 'How do you reduce layout shift with HTML decisions?', 'Reserve space for images and embeds, use stable markup structures, and avoid inserting critical content late without placeholders.', ['performance', 'cls']),
    seed('medium', 'How do autocomplete attributes help forms?', 'Autocomplete hints let browsers assist users with repeated personal data entry when the field purpose is named accurately.', ['forms', 'usability']),
    seed('medium', 'What is the difference between section and article in HTML?', 'section groups related content within a page, while article represents a standalone self-contained composition.', ['sectioning', 'semantics']),
    seed('hard', 'How do HTML dialogs and native interactive elements affect accessibility work?', 'Native controls provide expected keyboard and accessibility behavior that is expensive to recreate correctly with generic divs.', ['native-elements', 'accessibility']),
    seed('medium', 'How do iframes fit into HTML pages?', 'iframes embed another browsing context, which is useful for isolation but adds security, performance, and communication considerations.', ['iframes', 'security']),
    seed('medium', 'How do required, pattern, and type attributes help forms?', 'These attributes give browsers first-layer validation and better input affordances before custom validation logic runs.', ['validation', 'forms']),
    seed('hard', 'How do content order and DOM order affect accessibility?', 'Assistive technology follows DOM order, so visual rearrangement must not break the logical reading and tab flow of the document.', ['accessibility', 'reading-order']),
    seed('medium', 'Why should div and span not replace every semantic element?', 'Generic containers carry no meaning, so overusing them throws away built-in semantics, browser defaults, and accessibility value.', ['div', 'span', 'semantics']),
    seed('medium', 'How do figure and figcaption improve HTML content?', 'They associate supporting descriptions directly with media or examples so meaning stays tied together in the document.', ['media', 'semantics']),
    seed('hard', 'How does HTML support progressive enhancement?', 'Start with a working semantic document first, then add CSS and JavaScript so the experience improves without breaking the core task.', ['progressive-enhancement', 'best-practice']),
    seed('medium', 'What is the difference between hidden, aria-hidden, and display none from an HTML perspective?', 'They all affect visibility differently, and the right choice depends on whether content should remain available to assistive technology or layout.', ['visibility', 'accessibility']),
    seed('medium', 'How does HTML set the foundation for SEO?', 'Clean titles, headings, semantic structure, descriptive links, and meaningful content help search engines understand the page intent better.', ['seo', 'semantics'])
  ],
  css: [
    seed('medium', 'What is the difference between Flexbox and CSS Grid?', 'Flexbox is strongest for one-dimensional layout, while Grid is designed for two-dimensional row and column control.', ['flexbox', 'grid', 'layout']),
    seed('medium', 'How does the CSS box model work?', 'The box model defines how content, padding, border, and margin contribute to an elements rendered size and spacing.', ['box-model', 'layout']),
    seed('medium', 'How does specificity affect CSS overrides?', 'Specificity determines which matching rule wins when selectors target the same property on the same element.', ['specificity', 'cascade']),
    seed('hard', 'How does the cascade differ from specificity in CSS?', 'The cascade also considers origin, importance, and source order, so specificity is only one part of how a final style wins.', ['cascade', 'specificity']),
    seed('medium', 'What is the difference between relative, absolute, fixed, and sticky positioning?', 'These positioning modes change how an element is placed relative to normal flow, ancestors, the viewport, or scroll thresholds.', ['positioning', 'layout']),
    seed('medium', 'How do rem, em, px, and percentages differ in CSS sizing?', 'Each unit scales from a different reference point, so the best choice depends on typography, responsiveness, and nesting behavior.', ['units', 'responsive']),
    seed('hard', 'How do you avoid layout shift in CSS?', 'Reserve stable dimensions, avoid late font or media surprises, and prefer layout patterns that do not reflow unpredictably during load.', ['performance', 'layout']),
    seed('medium', 'How do media queries support responsive design?', 'Media queries apply different rules when viewport or device characteristics meet specific conditions such as width or preference.', ['media-queries', 'responsive']),
    seed('medium', 'What is the difference between visibility hidden and display none?', 'visibility hidden keeps layout space but hides painting, while display none removes the element from layout entirely.', ['visibility', 'layout']),
    seed('hard', 'How do stacking contexts affect z-index behavior?', 'z-index only compares elements within the same stacking context, so transforms or positioned ancestors can change which layers interact.', ['z-index', 'stacking-context']),
    seed('medium', 'How do pseudo-classes and pseudo-elements differ in CSS?', 'Pseudo-classes target a state such as hover, while pseudo-elements style a generated part such as ::before or ::selection.', ['pseudo-classes', 'pseudo-elements']),
    seed('medium', 'How do CSS custom properties help design systems?', 'Custom properties centralize theme values and let components adapt across themes or contexts without duplicating literal values.', ['css-variables', 'design-system']),
    seed('hard', 'How do you debug a CSS layout issue methodically?', 'Inspect computed styles, box sizes, containing blocks, and overflow behavior so you solve the actual layout cause instead of trial and error.', ['debugging', 'layout']),
    seed('medium', 'What is the difference between min-width, width, and max-width?', 'These properties define lower, ideal, and upper bounds for sizing so layouts can stay fluid without collapsing or exploding.', ['sizing', 'layout']),
    seed('medium', 'How do transforms differ from layout-affecting properties?', 'Transforms change how an element is painted without triggering normal document reflow, which can be useful for animation performance.', ['transforms', 'performance']),
    seed('hard', 'How do you structure maintainable CSS in a large codebase?', 'Use consistent naming, clear component boundaries, and shared design tokens so styles scale without override wars.', ['architecture', 'maintainability']),
    seed('medium', 'How do overflow and scroll containers work in CSS?', 'Overflow decides whether extra content is clipped, visible, or scrollable and which element becomes the scrolling container.', ['overflow', 'scrolling']),
    seed('medium', 'How do align-items and justify-content differ?', 'justify-content aligns along the main axis, while align-items aligns along the cross axis of a flex or grid container.', ['alignment', 'flexbox', 'grid']),
    seed('hard', 'How does browser painting and compositing affect CSS animation choices?', 'Animating transforms and opacity is often cheaper because browsers can composite layers without recalculating full layout each frame.', ['animation', 'performance']),
    seed('medium', 'What are logical properties in CSS?', 'Logical properties describe layout in terms of block and inline directions so styles adapt better across writing modes and locales.', ['logical-properties', 'internationalization']),
    seed('medium', 'How do transitions differ from keyframe animations in CSS?', 'Transitions animate between states when a property changes, while keyframes define a full multi-step animation timeline.', ['transitions', 'animations']),
    seed('hard', 'How do container queries change responsive CSS design?', 'Container queries let components respond to the size of their own container instead of only the full viewport.', ['container-queries', 'responsive']),
    seed('medium', 'How does object-fit work for images and video?', 'object-fit controls how replaced content such as images fills its box without distorting the aspect ratio unexpectedly.', ['object-fit', 'media']),
    seed('medium', 'How do gap, margin, and padding differ in CSS spacing?', 'gap spaces children inside layout containers, margin separates elements from neighbors, and padding creates inner space within a box.', ['spacing', 'layout']),
    seed('hard', 'How do you keep CSS accessible for users with motion or contrast preferences?', 'Respect user media preferences and avoid styling choices that make information unreadable or disorienting for key user groups.', ['accessibility', 'media-queries']),
    seed('medium', 'What is the difference between inline styles, CSS modules, and global CSS approaches?', 'Each approach changes how styles are scoped, overridden, and shared across a codebase, so the right choice depends on system size and reuse.', ['scoping', 'architecture']),
    seed('medium', 'How do inherited properties behave in CSS?', 'Some properties such as font and color inherit naturally, while box-model and layout properties usually do not.', ['inheritance', 'cascade']),
    seed('hard', 'How do you tune CSS for large applications with many components?', 'Prefer predictable scoping, trim unused selectors, and keep design tokens centralized so the cascade stays manageable at scale.', ['performance', 'architecture']),
    seed('medium', 'What is the difference between auto-fill and auto-fit in CSS Grid?', 'Both work with repeat and minmax, but auto-fit collapses empty tracks while auto-fill keeps the explicit track structure.', ['grid', 'responsive']),
    seed('medium', 'How do aspect-ratio and intrinsic sizing help responsive UI?', 'They let the browser reserve consistent media or card shapes before content fully loads, which improves visual stability.', ['aspect-ratio', 'responsive'])
  ],
  'git-github': [
    seed('medium', 'What is the difference between git merge and git rebase?', 'merge preserves branch history as a join, while rebase rewrites commits onto a new base to create a cleaner linear history.', ['merge', 'rebase', 'workflow']),
    seed('medium', 'How does git commit history help teams debug changes?', 'Commit history provides a searchable timeline of intent, which makes regressions, ownership, and release reconstruction far easier.', ['commits', 'history', 'debugging']),
    seed('medium', 'What is the difference between git fetch and git pull?', 'fetch downloads remote updates without changing the current branch, while pull fetches and then integrates those updates into your branch.', ['fetch', 'pull']),
    seed('hard', 'How do you resolve merge conflicts responsibly?', 'Read both sides carefully, preserve the intended behavior, retest the result, and avoid resolving conflicts by blindly taking one side.', ['merge-conflicts', 'workflow']),
    seed('medium', 'What is the purpose of git branching?', 'Branches isolate lines of work so teams can experiment, review, and release changes without blocking one another.', ['branching', 'workflow']),
    seed('medium', 'How do staged changes differ from working tree changes in Git?', 'The staging area lets you choose exactly what goes into the next commit instead of committing every local edit at once.', ['staging', 'commits']),
    seed('hard', 'How do you recover from an accidental bad commit in Git?', 'Choose the recovery tool that matches the situation, such as revert for shared history or reset and reflog for local unpublished mistakes.', ['recovery', 'reflog', 'revert']),
    seed('medium', 'What is the difference between git reset, git revert, and git restore?', 'reset moves history or branch state, revert creates a new inverse commit, and restore focuses on file content recovery.', ['reset', 'revert', 'restore']),
    seed('medium', 'How do pull requests improve code quality on GitHub?', 'Pull requests create a review checkpoint where tests, discussion, and diff context catch issues before code reaches shared branches.', ['pull-requests', 'review']),
    seed('hard', 'How do protected branches help team workflows?', 'Protected branches enforce review, status checks, and restricted direct pushes so critical branches stay stable under team pressure.', ['protected-branches', 'governance']),
    seed('medium', 'What is cherry-pick and when should you use it?', 'cherry-pick copies specific commits onto another branch when you need a targeted change without merging unrelated history.', ['cherry-pick', 'workflow']),
    seed('medium', 'How do tags differ from branches in Git?', 'A branch moves as new commits are added, while a tag is intended to mark a fixed point such as a release.', ['tags', 'releases']),
    seed('hard', 'How do you design a healthy Git branching strategy?', 'A healthy strategy matches release cadence, keeps integration frequent, and avoids long-lived isolation that causes painful rebases later.', ['branching-strategy', 'architecture']),
    seed('medium', 'What is the purpose of .gitignore?', 'gitignore keeps generated, local, or secret files out of version control so repositories stay clean and portable.', ['gitignore', 'hygiene']),
    seed('medium', 'How does GitHub Actions fit into a delivery workflow?', 'GitHub Actions automates tests, builds, and deployment checks so changes are validated consistently on every important event.', ['github-actions', 'ci-cd']),
    seed('hard', 'How do you handle secrets safely in GitHub workflows?', 'Use managed secrets, least privilege, and careful logging because CI systems can accidentally expose sensitive data at scale.', ['secrets', 'security', 'github-actions']),
    seed('medium', 'What is the difference between origin and upstream on GitHub?', 'origin usually points to your fork or primary remote, while upstream often points to the original shared repository.', ['remotes', 'github']),
    seed('medium', 'How does git stash work?', 'stash temporarily shelves working directory changes so you can switch context without committing incomplete work.', ['stash', 'workflow']),
    seed('hard', 'How do you use reflog to recover lost work?', 'reflog records recent HEAD movements, which makes it possible to find commits or states that no longer appear in normal branch history.', ['reflog', 'recovery']),
    seed('medium', 'What is a fast-forward merge?', 'A fast-forward merge simply moves the target branch pointer because no divergent history needs a separate merge commit.', ['merge', 'history']),
    seed('hard', 'How do you keep pull requests reviewable in fast-moving teams?', 'Keep PRs scoped, describe intent clearly, and avoid bundling unrelated refactors with behavioral changes that reviewers cannot evaluate quickly.', ['pull-requests', 'teamwork']),
    seed('medium', 'How do GitHub issues and pull requests work together?', 'Issues capture the problem or task, while pull requests show the code and discussion that resolves it.', ['issues', 'pull-requests']),
    seed('medium', 'What is the purpose of CODEOWNERS on GitHub?', 'CODEOWNERS automatically requests review from the right maintainers so ownership stays explicit for critical parts of the repo.', ['codeowners', 'governance']),
    seed('hard', 'How do you handle a production hotfix in Git and GitHub?', 'A hotfix should be isolated, reviewed quickly, released safely, and then merged or cherry-picked back into the main development line.', ['hotfix', 'release-management']),
    seed('medium', 'How do you decide whether to squash commits before merging?', 'Squashing can keep history concise, but preserving commits can help when the intermediate steps matter for debugging or audit.', ['squash', 'history']),
    seed('medium', 'What is the purpose of semantic commit messages?', 'Consistent commit messages make history easier to scan, automate, and reason about during releases or incident response.', ['commits', 'conventions']),
    seed('hard', 'How do you reduce Git conflicts in large teams?', 'Integrate frequently, coordinate ownership, and break changes into smaller branches so divergence never grows too large.', ['teamwork', 'merge-conflicts']),
    seed('medium', 'How do forks differ from branches on GitHub?', 'A fork is a full repository copy under another account or organization, while a branch is another line of history inside one repo.', ['forks', 'branches']),
    seed('hard', 'How do you audit repository health on GitHub?', 'Look at branch protection, secret scanning, dependency alerts, stale review queues, and automation reliability to understand operational risk.', ['repository-health', 'governance']),
    seed('medium', 'How do release notes and GitHub releases help teams?', 'They summarize shipped changes and upgrade guidance so users and internal teams know what changed without reading raw commit history.', ['releases', 'communication'])
  ],
  oop: [
    seed('medium', 'What are the four core pillars of object-oriented programming?', 'The classic OOP pillars are encapsulation, abstraction, inheritance, and polymorphism, each of which helps manage complexity differently.', ['encapsulation', 'abstraction', 'inheritance', 'polymorphism']),
    seed('medium', 'What is encapsulation in OOP?', 'Encapsulation hides internal state behind a controlled public interface so objects can enforce their own invariants.', ['encapsulation', 'design']),
    seed('medium', 'What is abstraction in OOP?', 'Abstraction exposes the behavior a caller needs without forcing every consumer to know the implementation details.', ['abstraction', 'design']),
    seed('medium', 'How does inheritance work in OOP?', 'Inheritance lets a type reuse and extend behavior from a parent type, but it should represent a real behavioral relationship.', ['inheritance', 'design']),
    seed('hard', 'When is composition better than inheritance in OOP?', 'Composition is better when behavior should be assembled flexibly without creating brittle class hierarchies or fake is-a relationships.', ['composition', 'inheritance', 'architecture']),
    seed('medium', 'What is polymorphism in OOP?', 'Polymorphism lets different objects respond to the same operation through their own implementations while callers depend on the common contract.', ['polymorphism', 'interfaces']),
    seed('medium', 'What is the difference between a class and an object?', 'A class defines a blueprint or contract, while an object is a concrete runtime instance with actual state.', ['classes', 'objects']),
    seed('hard', 'How do interfaces improve OOP design?', 'Interfaces separate what a collaborator can do from how it does it, which improves substitution, testing, and long-term maintainability.', ['interfaces', 'architecture']),
    seed('medium', 'What is the difference between overloading and overriding?', 'Overloading uses different signatures under one name, while overriding replaces inherited behavior with a subtype-specific implementation.', ['overloading', 'overriding']),
    seed('hard', 'What does the SOLID principle Dependency Inversion mean in practice?', 'High-level policies should depend on abstractions rather than concrete details so important code stays stable while implementation choices evolve.', ['solid', 'dependency-inversion']),
    seed('medium', 'How do constructors fit into OOP?', 'Constructors establish the initial valid state of an object and wire in any required collaborators or configuration.', ['constructors', 'state']),
    seed('medium', 'What is method overriding used for?', 'Method overriding lets a subtype specialize behavior while preserving the shared contract expected by callers.', ['overriding', 'polymorphism']),
    seed('hard', 'How do you identify a bad inheritance hierarchy?', 'A hierarchy is usually wrong when subclasses violate parent assumptions, need unsupported methods, or mainly reuse code rather than represent behavior.', ['inheritance', 'design-smells']),
    seed('medium', 'What is the Single Responsibility Principle in OOP?', 'A class should have one clear reason to change so its responsibilities stay cohesive and easier to modify safely.', ['solid', 'single-responsibility']),
    seed('hard', 'How does the Open/Closed Principle guide extensibility?', 'Software should be open to extension but closed to risky modification by isolating behavior behind stable contracts.', ['solid', 'open-closed']),
    seed('medium', 'What is the purpose of access modifiers in OOP?', 'Access modifiers signal which members are part of the public contract and which are internal implementation details.', ['access-modifiers', 'encapsulation']),
    seed('medium', 'How do abstract classes differ from interfaces?', 'Abstract classes can share partial implementation and state, while interfaces primarily define behavior contracts.', ['abstract-classes', 'interfaces']),
    seed('hard', 'How does Liskov Substitution Principle affect OOP APIs?', 'Subtypes should behave in ways that do not surprise code written for the base contract, or the abstraction becomes unsafe to depend on.', ['solid', 'liskov']),
    seed('medium', 'How do value objects differ from entities in OOP design?', 'Entities are defined by identity over time, while value objects are defined entirely by their attributes.', ['domain-modeling', 'value-objects']),
    seed('hard', 'How do you model domain rules in OOP without anemic classes?', 'Push meaningful behavior next to the state it protects so objects enforce invariants instead of acting like passive data bags.', ['domain-modeling', 'behavior']),
    seed('medium', 'What is method overloading best used for?', 'Overloading is best when one concept has multiple valid call shapes that remain intuitive and consistent for the caller.', ['overloading', 'api-design']),
    seed('medium', 'How do getters and setters relate to encapsulation?', 'They can preserve encapsulation when they enforce rules or derived behavior, but blind pass-through accessors often expose internals without benefit.', ['getters-setters', 'encapsulation']),
    seed('hard', 'How do design patterns fit into OOP without overengineering?', 'Patterns are useful when they solve a real recurring design problem, not when they are applied just to sound sophisticated.', ['design-patterns', 'architecture']),
    seed('medium', 'What is coupling in OOP and why should it stay low?', 'Tightly coupled classes are harder to change, test, and replace because many details ripple through the design.', ['coupling', 'maintainability']),
    seed('hard', 'How does cohesion influence class design?', 'High cohesion means a classs data and behavior belong together, which usually leads to clearer responsibilities and safer changes.', ['cohesion', 'design']),
    seed('medium', 'How do factories help OOP code?', 'Factories centralize object creation when construction is complex or should be abstracted away from the caller.', ['factory', 'creation']),
    seed('medium', 'What is immutability and how does it interact with OOP?', 'Immutable objects do not change after creation, which simplifies reasoning about shared state and concurrency.', ['immutability', 'state']),
    seed('hard', 'How do you test polymorphic behavior in OOP systems?', 'Test the shared contract across implementations so any subtype can be swapped in without violating caller expectations.', ['testing', 'polymorphism']),
    seed('medium', 'How do dependency injection and OOP complement each other?', 'Dependency injection helps OOP classes depend on abstractions and collaborators without constructing everything themselves.', ['dependency-injection', 'architecture']),
    seed('hard', 'How do you know when OOP is the wrong default abstraction style?', 'If the problem is mostly data transformation or composition-oriented, forcing everything into class hierarchies can add more ceremony than value.', ['architecture', 'tradeoffs'])
  ],
  dsa: [
    seed('medium', 'What is the difference between an array and a linked list?', 'Arrays provide fast indexed access, while linked lists make insertion and deletion at known nodes cheaper but sacrifice random access.', ['arrays', 'linked-list']),
    seed('medium', 'How does a hash table work?', 'A hash table maps keys to buckets through a hash function so average-case lookups, inserts, and deletes are usually constant time.', ['hash-table', 'complexity']),
    seed('medium', 'What is Big O notation?', 'Big O describes how an algorithms time or space usage grows relative to input size as that size becomes large.', ['big-o', 'complexity']),
    seed('hard', 'How do you analyze time and space complexity together?', 'A strong answer explains both runtime growth and memory cost because an algorithm that is faster may still be impractical if it consumes too much space.', ['complexity', 'analysis']),
    seed('medium', 'What is the difference between a stack and a queue?', 'A stack is last-in-first-out, while a queue is first-in-first-out.', ['stack', 'queue']),
    seed('medium', 'How do binary search and linear search differ?', 'Linear search scans items one by one, while binary search cuts the search space in half on sorted data.', ['search', 'binary-search']),
    seed('hard', 'When is recursion a poor choice?', 'Recursion is a poor choice when depth can explode, stack limits matter, or the iterative form is simpler and easier to reason about.', ['recursion', 'tradeoffs']),
    seed('medium', 'How does a binary tree differ from a binary search tree?', 'A binary tree only limits child count, while a binary search tree also keeps an ordering invariant between left and right subtrees.', ['trees', 'bst']),
    seed('medium', 'What is the difference between BFS and DFS?', 'Breadth-first search explores level by level, while depth-first search follows one path deeply before backtracking.', ['bfs', 'dfs', 'graphs']),
    seed('hard', 'How do heaps support priority queues?', 'Heaps maintain the highest- or lowest-priority element at the root so insertion and extraction stay efficient.', ['heap', 'priority-queue']),
    seed('medium', 'Why are sets useful in algorithm design?', 'Sets make membership checks and deduplication fast, which often turns nested loops into linear-time solutions.', ['set', 'optimization']),
    seed('medium', 'How do sliding window techniques work?', 'Sliding windows keep a moving range of elements and update aggregate state incrementally instead of recomputing the whole range each time.', ['sliding-window', 'optimization']),
    seed('hard', 'What is dynamic programming and when does it apply?', 'Dynamic programming applies when a problem has overlapping subproblems and optimal substructure that can be reused instead of recomputed.', ['dynamic-programming', 'optimization']),
    seed('medium', 'How does two-pointer technique help array problems?', 'Two pointers let algorithms scan from one or both ends while maintaining invariants more efficiently than nested loops.', ['two-pointers', 'arrays']),
    seed('hard', 'How do graph representations affect algorithm performance?', 'Adjacency lists usually save space for sparse graphs, while adjacency matrices can simplify dense graph operations at higher memory cost.', ['graphs', 'representation']),
    seed('medium', 'What is the difference between stable and unstable sorting algorithms?', 'A stable sort preserves the relative order of equal elements, which matters when previous ordering carries meaning.', ['sorting', 'stability']),
    seed('medium', 'How do merge sort and quicksort differ?', 'Merge sort guarantees O(n log n) time with extra space, while quicksort is often faster in practice but can degrade badly without care.', ['sorting', 'merge-sort', 'quicksort']),
    seed('hard', 'How do you choose the right data structure for a problem?', 'Choose based on the operations that dominate the workload, their frequency, and the constraints on time, space, and mutability.', ['data-structures', 'problem-solving']),
    seed('medium', 'What is a trie and when is it useful?', 'A trie stores keys by prefix and is useful for autocomplete, dictionary lookup, and prefix-based searching.', ['trie', 'strings']),
    seed('medium', 'How do prefix sums improve range query problems?', 'Prefix sums let range totals be answered quickly by reusing cumulative work instead of rescanning each segment.', ['prefix-sum', 'arrays']),
    seed('hard', 'How does memoization differ from tabulation?', 'Memoization fills results on demand through recursion, while tabulation builds them iteratively in dependency order.', ['dynamic-programming', 'memoization', 'tabulation']),
    seed('medium', 'What is the purpose of a monotonic stack?', 'A monotonic stack keeps values in sorted order so nearest-greater or nearest-smaller relationships can be found efficiently.', ['monotonic-stack', 'optimization']),
    seed('medium', 'How do union-find or disjoint set structures work?', 'Disjoint set tracks connected components with parent pointers and optimizes merges and lookups through path compression and rank heuristics.', ['union-find', 'graphs']),
    seed('hard', 'How do you reason about algorithm tradeoffs under interview time pressure?', 'State the simplest correct solution first, then improve it while explaining exactly which bottleneck the optimization addresses.', ['interview-strategy', 'tradeoffs']),
    seed('medium', 'What is topological sorting used for?', 'Topological sorting orders nodes in a directed acyclic graph so dependencies are processed before dependents.', ['topological-sort', 'graphs']),
    seed('medium', 'How do queues support BFS shortest path in unweighted graphs?', 'A queue ensures nodes are explored in increasing distance order, which is why the first time you reach a node is the shortest path.', ['bfs', 'shortest-path']),
    seed('hard', 'How do greedy algorithms differ from dynamic programming?', 'Greedy algorithms make locally optimal choices and rely on a proof that those choices lead to a global optimum, while dynamic programming explores broader state reuse.', ['greedy', 'dynamic-programming']),
    seed('medium', 'What is the difference between amortized and worst-case complexity?', 'Worst-case measures a single bad operation, while amortized complexity spreads expensive occasional operations across many cheap ones.', ['amortized-analysis', 'complexity']),
    seed('hard', 'How do you handle very large inputs in algorithm design?', 'For very large inputs, memory layout, streaming, approximation, and parallelism can matter as much as the textbook Big O formula.', ['scalability', 'large-inputs']),
    seed('medium', 'Why should you always state complexity in interviews?', 'Complexity shows you can evaluate not just correctness but also whether the solution meets realistic constraints.', ['interview-strategy', 'complexity'])
  ],
  'system-design': [
    seed('hard', 'How would you design a rate limiter for a public API?', 'A practical rate limiter needs a clear algorithm, shared state, and a plan for burst handling, distributed enforcement, and client feedback.', ['rate-limiter', 'redis', 'architecture']),
    seed('hard', 'How would you design a URL shortener?', 'A URL shortener needs key generation, durable mapping storage, fast redirects, abuse controls, and simple analytics.', ['url-shortener', 'architecture']),
    seed('hard', 'How would you design a notification system?', 'A notification system separates event ingestion from channel delivery so retries, templates, and user preferences remain manageable.', ['notifications', 'queues', 'architecture']),
    seed('hard', 'How would you design a real-time chat system?', 'A chat system needs connection management, ordered message flow, persistence, presence, and recovery for reconnecting clients.', ['chat', 'websockets', 'architecture']),
    seed('hard', 'How would you design marketplace search?', 'Marketplace search must balance indexing, filtering, ranking, freshness, and operational sync with the source-of-truth data store.', ['search', 'ranking', 'architecture']),
    seed('hard', 'How do you estimate capacity in a system design interview?', 'Capacity planning translates traffic, payload size, and growth assumptions into storage, bandwidth, and compute requirements.', ['capacity-planning', 'estimation']),
    seed('hard', 'How do caches improve large-scale system performance?', 'Caches reduce repeated expensive work, but they also introduce invalidation, consistency, and hot-key failure concerns.', ['caching', 'performance']),
    seed('hard', 'How do queues and event-driven systems improve architecture?', 'Queues decouple producers from consumers so workloads can absorb spikes, retry failures, and scale processing independently.', ['queues', 'event-driven', 'architecture']),
    seed('hard', 'What is the difference between vertical scaling and horizontal scaling?', 'Vertical scaling grows a single machine, while horizontal scaling spreads load across more machines and coordination complexity.', ['scalability', 'capacity']),
    seed('hard', 'How do you design for high availability?', 'High availability requires redundant components, health-aware failover, and operational practices that keep failures isolated rather than global.', ['availability', 'resilience']),
    seed('hard', 'How do load balancers fit into distributed systems?', 'Load balancers spread traffic, enforce health checks, and often terminate connections or route requests to the right pool of instances.', ['load-balancer', 'distributed-systems']),
    seed('hard', 'How do you design idempotent distributed write workflows?', 'Distributed writes need request identity and retry-safe semantics so network failures do not create duplicate side effects.', ['idempotency', 'distributed-systems']),
    seed('hard', 'How do consistency and availability trade off in distributed systems?', 'Systems frequently trade stronger immediate consistency for higher availability or lower latency depending on business risk tolerance.', ['consistency', 'availability', 'tradeoffs']),
    seed('hard', 'How do you choose between SQL and NoSQL in system design?', 'Choose based on access patterns, consistency requirements, schema flexibility, and the operational burden each model introduces.', ['storage', 'tradeoffs']),
    seed('hard', 'How do you design observability into a system from the start?', 'Observability needs logs, metrics, traces, and clear identifiers so incidents can be diagnosed across service boundaries quickly.', ['observability', 'operations']),
    seed('hard', 'How do you handle file storage and delivery at scale?', 'Large file systems usually separate metadata from object storage and use CDNs or signed delivery paths to control access and latency.', ['storage', 'cdn', 'architecture']),
    seed('hard', 'How do you design a feed or timeline system?', 'Feed systems must balance fanout strategy, ranking, freshness, storage cost, and how much personalization is computed ahead of read time.', ['feed', 'architecture', 'ranking']),
    seed('hard', 'How do databases and caches interact in write-heavy systems?', 'Write-heavy systems need a clear source of truth and a disciplined invalidation or update strategy so caches do not amplify stale data.', ['database', 'cache', 'write-heavy']),
    seed('hard', 'How do you reason about single points of failure?', 'A single point of failure is any component whose outage breaks the full user path, so design work should identify and eliminate them systematically.', ['spof', 'resilience']),
    seed('hard', 'How do you design a job scheduler?', 'A scheduler needs durable jobs, timing guarantees, worker coordination, retries, and safe handling of duplicate execution attempts.', ['scheduler', 'workers', 'architecture']),
    seed('hard', 'How do you use partitioning or sharding at system level?', 'Partitioning spreads storage and traffic, but the partition key must support both scale and the dominant read and write patterns.', ['partitioning', 'sharding']),
    seed('hard', 'How do you support zero-downtime deployments?', 'Zero-downtime deployments require backward-compatible contracts, traffic shaping, and health validation while old and new versions overlap.', ['deployment', 'operations']),
    seed('hard', 'How do CDN strategies improve web architecture?', 'CDNs move content closer to users, absorb edge traffic, and reduce origin load, but only when cacheability and invalidation are modeled correctly.', ['cdn', 'performance']),
    seed('hard', 'How do you design a metrics pipeline?', 'Metrics pipelines need lightweight ingestion, aggregation, retention strategy, and query paths that stay useful during high-cardinality spikes.', ['metrics', 'observability']),
    seed('hard', 'How do retries, timeouts, and circuit breakers work together?', 'They protect distributed callers from hanging indefinitely and stop cascading failure when dependencies are unhealthy.', ['resilience', 'timeouts', 'circuit-breaker']),
    seed('hard', 'How do you design for multi-region deployments?', 'Multi-region design adds latency, replication, failover, and consistency decisions that must match the actual business continuity requirement.', ['multi-region', 'architecture']),
    seed('hard', 'How do you protect large systems from abuse and traffic spikes?', 'Protecting large systems requires edge filtering, rate limits, queueing, load shedding, and clear priorities for what must stay available.', ['abuse-prevention', 'scalability']),
    seed('hard', 'How do you communicate tradeoffs in a system design interview?', 'The best answers show why a design is good enough for the stated requirements instead of pretending every axis can be maximized at once.', ['interview-strategy', 'tradeoffs']),
    seed('hard', 'How do you evolve architecture as traffic grows?', 'Architecture should evolve through measured bottlenecks, not premature complexity, with each stage justified by a clear scaling pain point.', ['evolution', 'scalability']),
    seed('hard', 'How do you start a system design answer effectively?', 'Start by clarifying functional and non-functional requirements so the rest of the design is grounded in the right success criteria.', ['interview-strategy', 'requirements'])
  ],
  mern: [
    seed('medium', 'How does data flow through a typical MERN application?', 'A MERN app usually moves data from a React UI through an Express and Node API into MongoDB and back as JSON.', ['mern', 'data-flow']),
    seed('medium', 'Why is MERN attractive for full-stack teams?', 'MERN lets teams use JavaScript across the client and server, which can speed onboarding, reuse, and cross-layer debugging.', ['mern', 'full-stack']),
    seed('hard', 'How do you structure a scalable MERN codebase?', 'Scalable MERN codebases separate UI, API, domain logic, and persistence concerns so one layer can evolve without destabilizing the others.', ['architecture', 'mern']),
    seed('medium', 'How do React and Express communicate in a MERN app?', 'React typically calls HTTP endpoints or websockets exposed by Express, which translates requests into domain logic and database operations.', ['react', 'express', 'api']),
    seed('medium', 'How do you handle authentication in a MERN stack?', 'Authentication usually combines secure credential handling, token or session management, and client-side route or request guards.', ['authentication', 'security', 'mern']),
    seed('hard', 'How do you design shared validation across the MERN stack?', 'Validate at the server boundary first and reuse shared schemas where practical so client feedback is helpful but the backend remains authoritative.', ['validation', 'architecture']),
    seed('medium', 'How do you manage environment configuration in MERN apps?', 'Keep frontend-safe variables separate from backend secrets and make each deployment environment explicit rather than implicit.', ['configuration', 'deployment']),
    seed('hard', 'How do you optimize perceived performance in a MERN dashboard?', 'Optimize both frontend rendering and backend latency so the experience improves end to end instead of only in one layer.', ['performance', 'full-stack']),
    seed('medium', 'How do you model API errors for a MERN frontend?', 'Use consistent server error shapes so React components can map technical failures into stable user messages and retry paths.', ['errors', 'api', 'react']),
    seed('hard', 'How do you keep React state and MongoDB documents aligned safely?', 'Define stable DTOs and update rules so frontend assumptions about identity, optional fields, and timestamps match backend behavior.', ['data-modeling', 'contracts']),
    seed('medium', 'How do you support file uploads in a MERN application?', 'Uploads should stream or move through controlled endpoints and store only the metadata the frontend and backend actually need.', ['uploads', 'architecture']),
    seed('hard', 'How do you add realtime features to a MERN stack?', 'Realtime MERN features need websocket or pub/sub coordination, state reconciliation on the client, and a source of truth for persistence.', ['realtime', 'websockets', 'mern']),
    seed('medium', 'How do you paginate large datasets in MERN products?', 'Stable pagination contracts on the API and predictable client cache behavior keep large lists usable without full reloads.', ['pagination', 'api', 'react']),
    seed('hard', 'How do you secure a MERN app beyond login?', 'Production MERN security also needs validation, authorization, dependency hygiene, safe logging, and browser hardening such as CORS and secure cookies.', ['security', 'full-stack']),
    seed('medium', 'How do you deploy frontend and backend pieces of a MERN app?', 'You can deploy them together or separately, but whichever model you choose should make routing, secrets, and observability clear.', ['deployment', 'architecture']),
    seed('hard', 'How do you design background jobs in a MERN system?', 'Jobs should be handled outside request-response flows so the user path stays fast while expensive work remains durable and retryable.', ['background-jobs', 'architecture']),
    seed('medium', 'How do caching decisions affect MERN apps?', 'Cache choices impact both API latency and frontend freshness, so expiration and invalidation rules must be explicit across layers.', ['caching', 'performance']),
    seed('hard', 'How do you avoid duplicating business logic in MERN apps?', 'Keep domain rules on the backend or in truly shared libraries so React UI code does not become a second inconsistent business engine.', ['architecture', 'best-practice']),
    seed('medium', 'How do you test a MERN feature end to end?', 'Strong MERN testing covers component behavior, API contracts, and the persistence path for the feature being delivered.', ['testing', 'full-stack']),
    seed('hard', 'How do you design observability for a MERN application?', 'Use correlated request identifiers, frontend error tracking, backend logs, and database visibility so one user problem can be traced across the stack.', ['observability', 'operations']),
    seed('medium', 'How do you think about schema evolution in a MERN app?', 'Frontend and backend changes should be backward compatible during rollout so new UI and old API or vice versa do not break users.', ['migration', 'contracts']),
    seed('hard', 'How do you choose REST versus GraphQL for a MERN product?', 'Choose based on client flexibility needs, caching complexity, team skills, and how much operational overhead the product can tolerate.', ['api-style', 'tradeoffs']),
    seed('medium', 'How do you keep a MERN monorepo maintainable?', 'Clear package boundaries, shared tooling, and explicit ownership keep a monorepo from turning into a tangled dependency graph.', ['monorepo', 'architecture']),
    seed('hard', 'How do you scale a MERN application as usage grows?', 'Scale the bottleneck that is actually failing first, whether that is frontend rendering, API throughput, background work, or database access.', ['scalability', 'full-stack']),
    seed('medium', 'How do you handle optimistic UI updates in MERN apps?', 'Optimistic updates improve responsiveness, but they need rollback paths when the server rejects or reshapes the request.', ['optimistic-ui', 'react', 'api']),
    seed('hard', 'How do you manage search features in a MERN stack?', 'Search often needs a dedicated index or search engine rather than forcing complex ranking into the main CRUD database path.', ['search', 'architecture']),
    seed('medium', 'How do you decide what belongs in React state versus backend state?', 'Keep transient interaction state in React and persistent business state in backend systems with explicit APIs and validation.', ['state-management', 'contracts']),
    seed('hard', 'How do you plan zero-downtime releases for a MERN stack?', 'Zero-downtime MERN releases depend on compatible API changes, safe frontend rollout, and migration sequencing that tolerates mixed versions.', ['deployment', 'operations']),
    seed('medium', 'What common mistakes make MERN apps fragile?', 'Fragile MERN apps often mix business rules into the UI, skip input validation, and let contracts drift between React, Express, and MongoDB.', ['best-practice', 'full-stack']),
    seed('hard', 'How do you explain MERN tradeoffs honestly in an interview?', 'A strong answer acknowledges the speed and shared-language benefits of MERN while also naming the scaling, typing, and operational tradeoffs clearly.', ['interview-strategy', 'tradeoffs', 'mern'])
  ]
};

const generatedTopicConfigs = {
  python: [
    { concept: 'decorators', tags: ['decorators', 'functions'], useCase: 'cross-cutting concerns such as logging, validation, and instrumentation in Python services', example: '@cache\n def get_user(user_id):\n   return repo.load(user_id)' },
    { concept: 'generators', tags: ['generators', 'iteration'], useCase: 'streaming large datasets without loading everything into memory', example: 'def read_lines(path):\n  with open(path) as f:\n    for line in f:\n      yield line' },
    { concept: 'context managers', tags: ['context-managers', 'resource-management'], useCase: 'safe file, network, and transaction cleanup in backend code', example: 'with session.begin():\n  save_user(user)' },
    { concept: 'asyncio', tags: ['asyncio', 'concurrency'], useCase: 'I/O-heavy Python APIs and task workers', example: 'results = await asyncio.gather(fetch_users(), fetch_orders())' },
    { concept: 'the GIL', tags: ['gil', 'performance'], useCase: 'deciding when threads, processes, or native extensions fit a Python workload', example: 'Use multiprocessing for CPU-heavy work and asyncio for I/O-heavy tasks.' },
    { concept: 'virtual environments', tags: ['packaging', 'venv'], useCase: 'isolating dependencies across Python services and experiments', example: 'python -m venv .venv && .venv\\Scripts\\activate' },
    { concept: 'typing', tags: ['typing', 'maintainability'], useCase: 'documenting service contracts and catching bugs earlier in larger Python codebases', example: 'def normalize(items: list[str]) -> list[str]:\n  return [item.strip() for item in items]' },
    { concept: 'pytest', tags: ['testing', 'pytest'], useCase: 'reliable unit and integration testing in Python projects', example: 'def test_total_price():\n  assert total_price([2, 3]) == 5' },
    { concept: 'list and dictionary comprehensions', tags: ['comprehensions', 'syntax'], useCase: 'expressive data shaping in API and ETL code', example: 'lookup = {user.id: user.name for user in users}' },
    { concept: 'packaging and imports', tags: ['imports', 'packaging'], useCase: 'shipping maintainable Python libraries and deployable services', example: 'python -m pip install -e .' }
  ],
  java: [
    { concept: 'the JVM', tags: ['jvm', 'runtime'], useCase: 'understanding startup, memory, and performance behavior in Java services', example: 'java -Xms512m -Xmx512m -jar app.jar' },
    { concept: 'Java collections', tags: ['collections', 'data-structures'], useCase: 'choosing the right collection for lookup, ordering, and concurrency needs', example: 'Map<String, User> usersById = new HashMap<>();' },
    { concept: 'streams', tags: ['streams', 'functional'], useCase: 'transforming collections cleanly in modern Java services', example: 'users.stream().filter(User::isActive).map(User::getEmail).toList();' },
    { concept: 'generics', tags: ['generics', 'type-safety'], useCase: 'building reusable strongly typed APIs and libraries', example: 'class Repository<T> { T findById(String id) { ... } }' },
    { concept: 'exceptions', tags: ['exceptions', 'errors'], useCase: 'clear error handling between controllers, services, and persistence layers', example: 'throw new IllegalArgumentException("email is required");' },
    { concept: 'garbage collection', tags: ['garbage-collection', 'performance'], useCase: 'tuning memory behavior and diagnosing latency spikes in JVM services', example: 'Analyze heap usage before changing GC flags in production.' },
    { concept: 'multithreading', tags: ['threads', 'concurrency'], useCase: 'parallel work and coordination in backend Java systems', example: 'ExecutorService pool = Executors.newFixedThreadPool(4);' },
    { concept: 'immutability', tags: ['immutability', 'design'], useCase: 'safer concurrent and domain modeling code in Java applications', example: 'public record Money(BigDecimal amount, Currency currency) {}' },
    { concept: 'Spring dependency injection', tags: ['spring', 'dependency-injection'], useCase: 'modular service design in enterprise Java backends', example: '@Service\nclass UserService { UserService(UserRepository repo) { ... } }' },
    { concept: 'the Java memory model', tags: ['memory-model', 'concurrency'], useCase: 'reasoning about visibility and thread safety in shared-state Java code', example: 'Use volatile or synchronized only when they solve the actual visibility problem.' }
  ],
  cpp: [
    { concept: 'RAII', tags: ['raii', 'resource-management'], useCase: 'safe cleanup of memory, locks, and file handles in C++ systems', example: 'std::lock_guard<std::mutex> lock(mu);' },
    { concept: 'smart pointers', tags: ['smart-pointers', 'memory'], useCase: 'explicit ownership management in modern C++ code', example: 'auto service = std::make_unique<Service>();' },
    { concept: 'move semantics', tags: ['move-semantics', 'performance'], useCase: 'avoiding unnecessary copies in performance-sensitive C++ code', example: 'std::vector<Item> items = std::move(buffer);' },
    { concept: 'templates', tags: ['templates', 'generic-programming'], useCase: 'zero-cost abstractions and reusable library code', example: 'template<typename T>\nT clamp(T value, T min, T max) { ... }' },
    { concept: 'STL containers', tags: ['stl', 'containers'], useCase: 'choosing the right standard container for throughput and correctness', example: 'std::unordered_map<std::string, int> counts;' },
    { concept: 'references versus pointers', tags: ['references', 'pointers'], useCase: 'API design and ownership clarity in low-level code', example: 'void update(Config& config);' },
    { concept: 'virtual functions', tags: ['virtual-functions', 'polymorphism'], useCase: 'runtime polymorphism in extensible C++ designs', example: 'struct Shape { virtual double area() const = 0; };' },
    { concept: 'copy control', tags: ['copy-control', 'rule-of-five'], useCase: 'preventing accidental resource bugs in classes that own state', example: 'Delete copy operations when a type owns a file descriptor.' },
    { concept: 'concurrency primitives', tags: ['concurrency', 'mutex'], useCase: 'safe multithreaded coordination in systems software', example: 'std::condition_variable cv;' },
    { concept: 'compile-time optimization', tags: ['compile-time', 'optimization'], useCase: 'shifting checks or computations out of hot runtime paths', example: 'constexpr int buffer_size = 1024;' }
  ],
  nextjs: [
    { concept: 'the App Router', tags: ['app-router', 'routing'], useCase: 'structuring modern Next.js applications with layouts and nested routes', example: 'app/dashboard/page.tsx and app/dashboard/layout.tsx define a route tree.' },
    { concept: 'server components', tags: ['server-components', 'rendering'], useCase: 'reducing client bundle size and fetching data near the server boundary', example: 'export default async function ProductsPage() { const products = await getProducts(); ... }' },
    { concept: 'server actions', tags: ['server-actions', 'mutations'], useCase: 'handling secure form submissions and mutations in Next.js apps', example: 'export async function saveProfile(formData: FormData) { "use server"; ... }' },
    { concept: 'SSR', tags: ['ssr', 'rendering'], useCase: 'fresh per-request rendering for user-specific pages', example: 'Use SSR for dashboards that depend on authenticated request data.' },
    { concept: 'SSG', tags: ['ssg', 'rendering'], useCase: 'fast static delivery for marketing or documentation pages', example: 'Prebuild docs pages at deploy time when content rarely changes.' },
    { concept: 'ISR', tags: ['isr', 'caching'], useCase: 'balancing static speed with periodic data freshness in content-heavy products', example: 'export const revalidate = 300;' },
    { concept: 'route handlers and API routes', tags: ['api-routes', 'backend'], useCase: 'building backend-for-frontend logic inside a Next.js application', example: 'app/api/users/route.ts exports GET and POST handlers.' },
    { concept: 'caching and revalidation', tags: ['caching', 'revalidation'], useCase: 'keeping Next.js data fresh without losing performance benefits', example: 'revalidateTag("products") after a catalog update.' },
    { concept: 'middleware', tags: ['middleware', 'security'], useCase: 'request-time auth, redirects, and locale handling at the edge', example: 'middleware.ts checks a session cookie before protected routes.' },
    { concept: 'image and metadata optimization', tags: ['images', 'seo'], useCase: 'performance and SEO improvements in production Next.js apps', example: 'Use next/image and generateMetadata for product pages.' }
  ],
  redis: [
    { concept: 'caching with TTL', tags: ['caching', 'ttl'], useCase: 'reducing database load on read-heavy endpoints', example: 'SETEX profile:42 60 "{...json...}"' },
    { concept: 'cache invalidation', tags: ['cache-invalidation', 'consistency'], useCase: 'keeping cached responses aligned with source-of-truth updates', example: 'Delete or refresh cache keys after profile mutations.' },
    { concept: 'eviction policies', tags: ['eviction', 'memory'], useCase: 'protecting Redis under memory pressure in production', example: 'Choose allkeys-lru only when cache churn matches product access patterns.' },
    { concept: 'sorted sets', tags: ['sorted-sets', 'ranking'], useCase: 'leaderboards and ranking features that need ordered retrieval', example: 'ZADD leaderboard 420 "user:42"' },
    { concept: 'pub/sub', tags: ['pubsub', 'messaging'], useCase: 'lightweight fanout of transient events between services', example: 'PUBLISH notifications "user 42 updated"' },
    { concept: 'streams', tags: ['streams', 'event-processing'], useCase: 'persistent event processing and consumer group workflows', example: 'XADD orders * status created' },
    { concept: 'distributed locks', tags: ['locks', 'coordination'], useCase: 'coordinating shared work across multiple workers', example: 'SET job:123 lock NX PX 30000' },
    { concept: 'persistence modes', tags: ['persistence', 'operations'], useCase: 'deciding whether Redis is only a cache or also part of durable workflows', example: 'RDB snapshots and AOF serve different durability and recovery goals.' },
    { concept: 'rate limiting', tags: ['rate-limiting', 'security'], useCase: 'shared API protection across many application instances', example: 'INCR login:ip:1.2.3.4 with EXPIRE for a fixed window.' },
    { concept: 'Redis Cluster and Sentinel', tags: ['cluster', 'high-availability'], useCase: 'operating Redis reliably as traffic and failure risk grow', example: 'Use Sentinel for failover and Cluster for sharding at larger scale.' }
  ],
  aws: [
    { concept: 'IAM', tags: ['iam', 'security'], useCase: 'least-privilege access control across AWS accounts and services', example: 'Grant Lambda only s3:GetObject on a specific bucket prefix.' },
    { concept: 'S3', tags: ['s3', 'storage'], useCase: 'durable object storage for files, assets, and data exports', example: 'Store uploads in S3 and serve them through presigned URLs or CloudFront.' },
    { concept: 'EC2', tags: ['ec2', 'compute'], useCase: 'running configurable virtual machines for legacy or customizable workloads', example: 'Use an Auto Scaling group behind an Application Load Balancer.' },
    { concept: 'Lambda', tags: ['lambda', 'serverless'], useCase: 'event-driven compute without managing servers directly', example: 'API Gateway triggers Lambda for a lightweight JSON endpoint.' },
    { concept: 'RDS', tags: ['rds', 'databases'], useCase: 'managed relational databases with backups, monitoring, and failover support', example: 'Use RDS PostgreSQL for transactional data with automated snapshots.' },
    { concept: 'VPC networking', tags: ['vpc', 'networking'], useCase: 'isolating cloud resources and controlling traffic between subnets and services', example: 'Place databases in private subnets and expose only load balancers publicly.' },
    { concept: 'CloudWatch', tags: ['cloudwatch', 'monitoring'], useCase: 'metrics, logs, and alarms for production AWS systems', example: 'Alarm on Lambda error rate and queue depth together.' },
    { concept: 'ECS and containers', tags: ['ecs', 'containers'], useCase: 'running containerized services on AWS with managed orchestration', example: 'Deploy a Node API on ECS Fargate behind an ALB.' },
    { concept: 'API Gateway', tags: ['api-gateway', 'api'], useCase: 'managing request routing, auth, and throttling for serverless APIs', example: 'Use API Gateway usage plans to protect a public integration.' },
    { concept: 'SQS', tags: ['sqs', 'queues'], useCase: 'buffering asynchronous work and smoothing traffic spikes', example: 'Send image-processing jobs to SQS and consume them with worker services.' }
  ],
  'generative-ai': [
    { concept: 'prompt design', tags: ['prompting', 'quality'], useCase: 'making model outputs more reliable for real user workflows', example: 'Give the model role, goal, constraints, and output format expectations.' },
    { concept: 'model selection', tags: ['model-selection', 'tradeoffs'], useCase: 'matching quality, latency, and cost to the product requirement', example: 'Use a smaller model for classification and a stronger model for complex reasoning.' },
    { concept: 'embeddings', tags: ['embeddings', 'retrieval'], useCase: 'semantic search and retrieval-backed AI features', example: 'Embed support articles and retrieve nearest chunks for grounding.' },
    { concept: 'evaluation', tags: ['evaluation', 'quality'], useCase: 'measuring whether a GenAI feature is actually improving outcomes', example: 'Track factuality, task success, and user correction rates.' },
    { concept: 'hallucination control', tags: ['hallucinations', 'safety'], useCase: 'building trustworthy AI experiences over business-critical workflows', example: 'Require citations or abstain when retrieval confidence is weak.' },
    { concept: 'fine-tuning versus RAG', tags: ['fine-tuning', 'rag'], useCase: 'choosing the right adaptation method for behavior versus knowledge', example: 'Use RAG for fresh documents and fine-tuning for style or structured task behavior.' },
    { concept: 'context window management', tags: ['context-window', 'latency'], useCase: 'keeping prompts within model limits without dropping essential information', example: 'Summarize long histories before sending the next completion request.' },
    { concept: 'latency and cost optimization', tags: ['cost', 'latency'], useCase: 'scaling GenAI features without runaway inference bills', example: 'Cache stable prompts and route easier tasks to cheaper models.' },
    { concept: 'safety and guardrails', tags: ['guardrails', 'safety'], useCase: 'reducing harmful, policy-violating, or brand-damaging outputs', example: 'Add policy checks before and after the model call for sensitive workflows.' },
    { concept: 'production deployment', tags: ['deployment', 'operations'], useCase: 'shipping GenAI features that can be monitored and improved over time', example: 'Log prompts, outputs, user feedback, and model versions for debugging.' }
  ],
  'ai-agents': [
    { concept: 'tool calling', tags: ['tool-calling', 'agents'], useCase: 'letting agents interact with trusted systems instead of only producing text', example: 'The agent calls a search tool, a calculator, and a CRM lookup tool in one workflow.' },
    { concept: 'planning', tags: ['planning', 'workflow'], useCase: 'breaking complex goals into multi-step actions that can be executed safely', example: 'Generate a plan first, then execute or ask for approval.' },
    { concept: 'memory', tags: ['memory', 'state'], useCase: 'keeping relevant context across longer-running agent tasks', example: 'Store normalized task state separately from raw chat history.' },
    { concept: 'guardrails', tags: ['guardrails', 'safety'], useCase: 'constraining what an agent may do with tools and user data', example: 'Require human approval before any external side-effecting action.' },
    { concept: 'human-in-the-loop', tags: ['human-in-the-loop', 'operations'], useCase: 'ensuring risky or high-value decisions are reviewed before execution', example: 'Escalate payment changes or account deletions for approval.' },
    { concept: 'observability', tags: ['observability', 'debugging'], useCase: 'understanding why an agent succeeded, failed, or chose the wrong tool', example: 'Trace tool calls, intermediate reasoning summaries, and final outcomes.' },
    { concept: 'retry and recovery behavior', tags: ['retries', 'resilience'], useCase: 'keeping agent workflows reliable when tools or APIs fail intermittently', example: 'Retry idempotent tool calls but avoid duplicating side effects.' },
    { concept: 'multi-agent coordination', tags: ['multi-agent', 'architecture'], useCase: 'splitting specialist responsibilities across cooperating agents when one generalist is not enough', example: 'A researcher agent gathers facts and a writer agent synthesizes the report.' },
    { concept: 'evaluation', tags: ['evaluation', 'quality'], useCase: 'measuring whether an agent system is better than a simpler workflow', example: 'Compare task completion rate and correction burden against a baseline.' },
    { concept: 'workflow orchestration', tags: ['orchestration', 'architecture'], useCase: 'deciding when a deterministic workflow should wrap or replace free-form agent loops', example: 'Use a state machine for payment workflows and an agent only for bounded analysis steps.' }
  ],
  llm: [
    { concept: 'transformer attention', tags: ['transformers', 'attention'], useCase: 'reasoning about what LLMs are good at and where they struggle', example: 'Attention lets the model weigh relationships between tokens across the sequence.' },
    { concept: 'tokens and context windows', tags: ['tokens', 'context-window'], useCase: 'controlling prompt size, latency, and truncation risk in LLM products', example: 'A 20-page document may need chunking before it fits a prompt budget.' },
    { concept: 'temperature and sampling', tags: ['sampling', 'temperature'], useCase: 'matching output determinism to the task requirement', example: 'Use low temperature for extraction and higher temperature for brainstorming.' },
    { concept: 'instruction tuning', tags: ['instruction-tuning', 'alignment'], useCase: 'getting LLMs to follow user requests more reliably', example: 'Instruction-tuned models usually behave better on chat and task workflows.' },
    { concept: 'function or tool calling', tags: ['tool-calling', 'integration'], useCase: 'connecting an LLM to business systems or deterministic tools', example: 'Return structured arguments that a backend can validate before execution.' },
    { concept: 'hallucinations', tags: ['hallucinations', 'quality'], useCase: 'building trustworthy LLM-powered features', example: 'Ask the model to cite retrieved evidence and abstain when evidence is weak.' },
    { concept: 'evaluation', tags: ['evaluation', 'quality'], useCase: 'checking whether an LLM workflow improves correctness and user outcomes', example: 'Measure task success, factuality, and manual correction rate.' },
    { concept: 'fine-tuning', tags: ['fine-tuning', 'adaptation'], useCase: 'specializing an LLM for style, format, or narrow tasks when prompting alone is insufficient', example: 'Fine-tune for domain-specific classification labels with clear examples.' },
    { concept: 'latency and cost', tags: ['latency', 'cost'], useCase: 'operating LLM features sustainably in production', example: 'Cache repeated results and route simple tasks to lighter models.' },
    { concept: 'quantization and deployment', tags: ['deployment', 'quantization'], useCase: 'serving LLMs efficiently when infrastructure or on-device limits matter', example: 'Quantized models can reduce memory cost at some quality tradeoff.' }
  ],
  rag: [
    { concept: 'chunking strategy', tags: ['chunking', 'retrieval'], useCase: 'improving retrieval relevance and citation quality in RAG systems', example: 'Split docs by semantic sections instead of fixed tokens only.' },
    { concept: 'embedding selection', tags: ['embeddings', 'vector-search'], useCase: 'matching retrieval behavior to the domain and query style', example: 'Evaluate embedding models on your own support questions, not only benchmark claims.' },
    { concept: 'vector databases', tags: ['vector-db', 'storage'], useCase: 'storing and querying semantic document representations efficiently', example: 'Use metadata filters to scope retrieval by tenant or document type.' },
    { concept: 'hybrid search', tags: ['hybrid-search', 'ranking'], useCase: 'combining lexical and semantic signals for better recall and precision', example: 'Blend BM25 with vector similarity for acronym-heavy enterprise docs.' },
    { concept: 'reranking', tags: ['reranking', 'quality'], useCase: 'improving the final context shown to the LLM after broad retrieval', example: 'Retrieve 20 chunks, then rerank and send only the top 5.' },
    { concept: 'citation grounding', tags: ['citations', 'trust'], useCase: 'making RAG answers auditable for internal or customer-facing use', example: 'Return source passages with each answer section.' },
    { concept: 'freshness and indexing', tags: ['freshness', 'pipelines'], useCase: 'keeping RAG systems useful when source documents change often', example: 'Re-embed only changed documents instead of rebuilding the whole corpus.' },
    { concept: 'evaluation', tags: ['evaluation', 'quality'], useCase: 'measuring retrieval precision and answer faithfulness in RAG products', example: 'Track retrieval hit rate separately from final answer quality.' },
    { concept: 'latency optimization', tags: ['latency', 'performance'], useCase: 'keeping RAG experiences fast enough for real user workflows', example: 'Parallelize retrieval and metadata fetch when the architecture allows it.' },
    { concept: 'security and access control', tags: ['security', 'multi-tenant'], useCase: 'ensuring RAG does not leak tenant or role-restricted information', example: 'Filter retrieval by user or document permissions before ranking.' }
  ],
  langchain: [
    { concept: 'chains and LCEL', tags: ['chains', 'lcel'], useCase: 'composing prompts, models, and parsers predictably in LangChain apps', example: 'const chain = prompt.pipe(model).pipe(parser);' },
    { concept: 'agents', tags: ['agents', 'tool-calling'], useCase: 'tool-enabled workflows built with LangChain primitives', example: 'Bind tools to the model and route the call through an agent executor.' },
    { concept: 'prompt templates', tags: ['prompts', 'templates'], useCase: 'keeping prompts reusable and parameterized across multiple application flows', example: 'new ChatPromptTemplate([...])' },
    { concept: 'retrievers', tags: ['retrievers', 'rag'], useCase: 'wrapping retrieval logic cleanly inside a larger LLM workflow', example: 'const retriever = vectorStore.asRetriever(5);' },
    { concept: 'document loaders and splitters', tags: ['documents', 'chunking'], useCase: 'preparing real source content for LangChain-powered retrieval flows', example: 'Split a PDF into semantically sized chunks before embedding.' },
    { concept: 'memory patterns', tags: ['memory', 'state'], useCase: 'persisting conversational or workflow context in LangChain-based apps', example: 'Store summaries rather than the entire raw chat forever.' },
    { concept: 'output parsers', tags: ['output-parsers', 'structured-output'], useCase: 'turning LLM output into safer structured data for application code', example: 'Use a JSON or schema-aware parser after the model call.' },
    { concept: 'callbacks and tracing', tags: ['callbacks', 'observability'], useCase: 'debugging token usage, latency, and chain behavior in production', example: 'Capture execution traces for every chain run.' },
    { concept: 'LangSmith evaluation', tags: ['langsmith', 'evaluation'], useCase: 'measuring workflow quality and regression risk in LangChain projects', example: 'Compare prompt versions on a saved dataset before release.' },
    { concept: 'framework tradeoffs', tags: ['architecture', 'tradeoffs'], useCase: 'deciding when LangChain accelerates delivery versus adding unnecessary abstraction', example: 'Use LangChain for orchestration, but keep core business logic outside the framework.' }
  ],
  mean: [
    { concept: 'Angular frontend architecture', tags: ['angular', 'frontend'], useCase: 'structuring the frontend side of a MEAN application', example: 'Use feature modules or route-level areas for major Angular flows.' },
    { concept: 'Express middleware', tags: ['express', 'middleware'], useCase: 'centralizing auth, validation, and logging in the MEAN backend', example: 'Run validation before controller logic in each protected route.' },
    { concept: 'Node.js event-loop behavior', tags: ['nodejs', 'async'], useCase: 'keeping MEAN APIs responsive under concurrent I/O load', example: 'Move CPU-heavy scoring to workers rather than request handlers.' },
    { concept: 'MongoDB schema design', tags: ['mongodb', 'schema-design'], useCase: 'storing application data for common MEAN access patterns', example: 'Model aggregates around how Angular views actually read the data.' },
    { concept: 'full-stack authentication', tags: ['auth', 'security'], useCase: 'protecting Angular routes and Express APIs consistently', example: 'Attach tokens on API calls and validate them server-side on every protected route.' },
    { concept: 'shared validation', tags: ['validation', 'contracts'], useCase: 'keeping Angular forms and API boundaries consistent without trusting the client', example: 'Use frontend validation for UX and backend validation for correctness.' },
    { concept: 'state flow between Angular and APIs', tags: ['state-management', 'api'], useCase: 'keeping UI state aligned with backend truth in a MEAN product', example: 'Refresh the Angular view from the mutation response rather than assuming success blindly.' },
    { concept: 'deployment topology', tags: ['deployment', 'operations'], useCase: 'serving Angular assets and Node APIs reliably in production', example: 'Separate static asset delivery from API scaling when traffic patterns differ.' },
    { concept: 'performance bottlenecks', tags: ['performance', 'full-stack'], useCase: 'finding whether MEAN slowness comes from Angular rendering, API latency, or MongoDB queries', example: 'Profile each layer before optimizing the wrong bottleneck.' },
    { concept: 'testing across the stack', tags: ['testing', 'integration'], useCase: 'keeping full-stack MEAN features reliable as the product grows', example: 'Test Angular behavior, Express contracts, and Mongo-backed workflows together for critical paths.' }
  ],
  'full-stack-web-development': [
    { concept: 'frontend and backend boundaries', tags: ['architecture', 'frontend', 'backend'], useCase: 'separating responsibilities cleanly in full-stack projects', example: 'Keep rendering in the UI and business invariants on the server.' },
    { concept: 'authentication flows', tags: ['auth', 'security'], useCase: 'building secure login and session experiences across the stack', example: 'Use secure cookies or validated tokens and enforce access server-side.' },
    { concept: 'API design', tags: ['api', 'contracts'], useCase: 'connecting browsers, mobile apps, and backend systems predictably', example: 'Design response shapes that frontends can evolve with safely.' },
    { concept: 'database modeling', tags: ['database', 'schema-design'], useCase: 'persisting product data in a way that matches actual access patterns', example: 'Start from user flows before choosing the schema shape.' },
    { concept: 'state management', tags: ['state-management', 'frontend'], useCase: 'deciding what state lives in the UI versus the backend', example: 'Keep ephemeral UI state local and business truth on the server.' },
    { concept: 'testing strategy', tags: ['testing', 'quality'], useCase: 'combining unit, integration, and end-to-end testing across a web product', example: 'Cover the critical business paths at the integration or e2e level.' },
    { concept: 'performance optimization', tags: ['performance', 'web'], useCase: 'improving latency, rendering speed, and payload size across the stack', example: 'Measure Core Web Vitals together with API response times.' },
    { concept: 'accessibility', tags: ['accessibility', 'frontend'], useCase: 'making full-stack products usable by a broader set of users and devices', example: 'Semantic HTML and keyboard support are part of feature completeness.' },
    { concept: 'deployment and CI/CD', tags: ['deployment', 'ci-cd'], useCase: 'releasing full-stack changes safely and repeatedly', example: 'Run builds, tests, and migrations through a repeatable pipeline.' },
    { concept: 'observability', tags: ['observability', 'operations'], useCase: 'diagnosing user issues that cross browser, API, and database layers', example: 'Correlate frontend errors with backend logs using request identifiers.' }
  ]
};

const moreConcept = (concept, tags, useCase, example) => ({ concept, tags, useCase, example });

const additionalGeneratedTopicConcepts = {
  python: [
    moreConcept('dataclasses', ['dataclasses', 'modeling'], 'building lightweight typed data containers without verbose classes', 'Use @dataclass for DTO-style objects with generated init and repr methods.'),
    moreConcept('iterators and iterables', ['iterators', 'iteration'], 'creating memory-efficient custom loops and pipelines', 'Implement __iter__ when an object should be consumed in a for loop.'),
    moreConcept('lambda functions', ['lambda', 'functional'], 'writing short callback or transformation functions when readability stays clear', 'sorted(users, key=lambda user: user.created_at)'),
    moreConcept('exception handling', ['exceptions', 'errors'], 'communicating recoverable failures cleanly across Python layers', 'Catch specific exceptions instead of swallowing every Exception.'),
    moreConcept('modules and packages', ['modules', 'packages'], 'organizing Python code so imports and deployment remain predictable', 'Place reusable code in a package with __init__.py and clear public modules.'),
    moreConcept('dependency management', ['dependencies', 'packaging'], 'pinning and upgrading Python packages safely across environments', 'Use lock files or constraints to avoid surprise dependency changes.'),
    moreConcept('multiprocessing', ['multiprocessing', 'performance'], 'running CPU-heavy Python work outside the GIL bottleneck', 'Use a process pool for image processing or numeric batch jobs.'),
    moreConcept('threading', ['threading', 'concurrency'], 'coordinating I/O-bound work that waits on external systems', 'Use threads for blocking network calls only when the shared state is controlled.'),
    moreConcept('type hints', ['typing', 'type-hints'], 'documenting contracts and helping tools catch Python bugs earlier', 'def get_user(user_id: str) -> User | None: ...'),
    moreConcept('Pydantic models', ['pydantic', 'validation'], 'validating API payloads and configuration in Python services', 'Use BaseModel to parse and validate request bodies.'),
    moreConcept('FastAPI basics', ['fastapi', 'api'], 'building typed Python APIs with validation and documentation support', 'Declare request models and response models on FastAPI routes.'),
    moreConcept('Django ORM', ['django', 'orm'], 'mapping relational data into Python application models', 'Use select_related to avoid avoidable database queries.'),
    moreConcept('Flask applications', ['flask', 'api'], 'building lightweight Python web services with explicit routing', 'Register blueprints for feature-level route organization.'),
    moreConcept('SQLAlchemy sessions', ['sqlalchemy', 'database'], 'managing database unit-of-work boundaries in Python apps', 'Open a session per request and commit or roll back deliberately.'),
    moreConcept('logging', ['logging', 'observability'], 'capturing production diagnostics without relying on print statements', 'Use structured logs with request identifiers.'),
    moreConcept('fixtures', ['pytest', 'fixtures'], 'reusing test setup cleanly across Python test suites', 'Use pytest fixtures for database records or mocked services.'),
    moreConcept('monkeypatching', ['testing', 'mocks'], 'isolating external dependencies in Python tests', 'Patch an environment variable or client method in a focused test.'),
    moreConcept('serialization', ['json', 'serialization'], 'moving Python objects across APIs, queues, and storage boundaries', 'Convert datetime and Decimal values deliberately before JSON output.'),
    moreConcept('performance profiling', ['profiling', 'performance'], 'finding real Python bottlenecks before optimizing code', 'Use cProfile or sampling profilers on the slow path.'),
    moreConcept('PEP 8 and readability', ['style', 'maintainability'], 'keeping Python code consistent across teams', 'Prefer clear names and simple functions over clever one-liners.'),
    moreConcept('dependency injection in Python', ['dependency-injection', 'architecture'], 'making Python services testable without global state', 'Pass collaborators into classes or functions instead of constructing them everywhere.')
  ],
  java: [
    moreConcept('records', ['records', 'immutability'], 'modeling immutable data carriers in modern Java', 'public record UserDto(String id, String email) {}'),
    moreConcept('sealed classes', ['sealed-classes', 'domain-modeling'], 'restricting allowed subtype hierarchies for safer domain modeling', 'Use sealed interfaces when only known variants should exist.'),
    moreConcept('Optional', ['optional', 'null-safety'], 'representing possibly missing values without returning raw null', 'return Optional.ofNullable(user);'),
    moreConcept('CompletableFuture', ['completablefuture', 'async'], 'composing asynchronous Java work without blocking request threads', 'CompletableFuture.allOf(profileFuture, ordersFuture)'),
    moreConcept('synchronized blocks', ['synchronized', 'concurrency'], 'protecting shared mutable state in Java code', 'Synchronize only the critical section that touches shared state.'),
    moreConcept('volatile', ['volatile', 'memory-model'], 'ensuring visibility for shared state across Java threads', 'Use volatile for simple visibility, not compound atomic operations.'),
    moreConcept('ExecutorService', ['executorservice', 'threads'], 'controlling thread pools for background or parallel work', 'Submit bounded tasks to a fixed thread pool.'),
    moreConcept('Spring Boot starters', ['spring-boot', 'configuration'], 'bootstrapping common Java service capabilities quickly', 'Add spring-boot-starter-web for MVC API support.'),
    moreConcept('Spring profiles', ['spring', 'configuration'], 'switching environment-specific Java configuration safely', 'Use profiles for local, test, and production settings.'),
    moreConcept('JPA entity lifecycle', ['jpa', 'orm'], 'understanding how Java persistence objects are loaded and saved', 'Know when an entity is transient, managed, detached, or removed.'),
    moreConcept('Hibernate lazy loading', ['hibernate', 'performance'], 'avoiding unnecessary database reads while preventing runtime surprises', 'Fetch needed associations before leaving the transaction boundary.'),
    moreConcept('equals and hashCode', ['objects', 'collections'], 'making Java objects behave correctly in sets and maps', 'Keep equals and hashCode consistent for value-like objects.'),
    moreConcept('try-with-resources', ['resource-management', 'exceptions'], 'closing Java resources reliably even when failures occur', 'try (var stream = Files.lines(path)) { ... }'),
    moreConcept('checked versus unchecked exceptions', ['exceptions', 'api-design'], 'choosing how Java APIs communicate failure to callers', 'Use checked exceptions only when callers can reasonably recover.'),
    moreConcept('Maven versus Gradle', ['build-tools', 'dependencies'], 'managing Java builds and dependencies predictably', 'Choose the build tool that matches team conventions and automation needs.'),
    moreConcept('unit testing with JUnit', ['junit', 'testing'], 'verifying Java behavior with focused repeatable tests', 'Use assertions around behavior rather than implementation details.'),
    moreConcept('Mockito mocks', ['mockito', 'testing'], 'isolating Java collaborators in service tests', 'Mock external gateways and keep domain logic real.'),
    moreConcept('dependency injection scopes', ['spring', 'dependency-injection'], 'controlling Java object lifetime and shared state', 'Understand singleton beans versus request-scoped beans.'),
    moreConcept('REST controllers', ['spring-mvc', 'api'], 'exposing Java service behavior through HTTP contracts', 'Map DTOs at the controller boundary.'),
    moreConcept('transaction management', ['transactions', 'spring'], 'keeping multi-step Java persistence operations atomic', 'Put transaction boundaries around service methods that change related data.'),
    moreConcept('JVM tuning', ['jvm', 'operations'], 'adjusting Java runtime behavior based on measured production needs', 'Inspect heap, GC pauses, and thread usage before changing flags.')
  ],
  cpp: [
    moreConcept('the rule of zero', ['rule-of-zero', 'resource-management'], 'designing C++ types that avoid manual ownership code', 'Prefer standard containers and smart pointers so special members are unnecessary.'),
    moreConcept('the rule of three', ['rule-of-three', 'copy-control'], 'managing resources safely in older C++ ownership patterns', 'If a class owns a raw resource, define copy constructor, assignment, and destructor carefully.'),
    moreConcept('the rule of five', ['rule-of-five', 'move-semantics'], 'supporting correct copy and move behavior for resource-owning C++ types', 'Add move constructor and move assignment when ownership can transfer.'),
    moreConcept('const correctness', ['const', 'api-design'], 'communicating mutation guarantees in C++ APIs', 'Mark methods const when they do not modify observable object state.'),
    moreConcept('std::vector performance', ['vector', 'performance'], 'choosing contiguous storage for cache-friendly C++ collections', 'Reserve capacity when the final size is known.'),
    moreConcept('std::map versus std::unordered_map', ['maps', 'containers'], 'choosing ordered or hash-based lookups in C++', 'Use unordered_map for average fast lookup and map when ordering matters.'),
    moreConcept('operator overloading', ['operators', 'api-design'], 'making C++ types expressive without surprising callers', 'Overload operators only when the behavior matches normal expectations.'),
    moreConcept('exception safety', ['exceptions', 'reliability'], 'keeping C++ objects valid when operations fail', 'Use RAII so cleanup still happens during stack unwinding.'),
    moreConcept('undefined behavior', ['undefined-behavior', 'correctness'], 'avoiding C++ code paths the compiler may optimize unpredictably', 'Do not read out-of-bounds memory or use dangling references.'),
    moreConcept('memory alignment', ['memory', 'performance'], 'understanding layout constraints in low-level C++ systems', 'Alignment can affect SIMD, structs, and hardware interaction.'),
    moreConcept('constexpr', ['constexpr', 'compile-time'], 'moving safe computations to compile time in C++', 'Use constexpr for constants and functions that can be evaluated during compilation.'),
    moreConcept('template specialization', ['templates', 'generic-programming'], 'customizing C++ generic behavior for specific types', 'Specialize only when the generic implementation is truly wrong for a type.'),
    moreConcept('SFINAE and concepts', ['templates', 'concepts'], 'constraining C++ templates to meaningful type capabilities', 'Use concepts in modern C++ for clearer constraints.'),
    moreConcept('virtual destructors', ['polymorphism', 'destructors'], 'destroying derived C++ objects correctly through base pointers', 'Make base destructors virtual when deleting through a base pointer.'),
    moreConcept('object slicing', ['inheritance', 'correctness'], 'avoiding loss of derived state when copying polymorphic C++ objects by value', 'Pass polymorphic objects by reference or pointer.'),
    moreConcept('mutex deadlocks', ['mutex', 'concurrency'], 'preventing stuck C++ programs caused by conflicting lock order', 'Acquire locks in a consistent order or use scoped_lock.'),
    moreConcept('atomic operations', ['atomic', 'concurrency'], 'coordinating simple shared state without full mutexes', 'Use std::atomic for counters and flags when the memory semantics are understood.'),
    moreConcept('condition variables', ['condition-variable', 'threads'], 'waiting efficiently for state changes between C++ threads', 'Always wait with a predicate to handle spurious wakeups.'),
    moreConcept('linking errors', ['linking', 'build'], 'diagnosing unresolved symbols and one-definition-rule problems', 'Check declarations, definitions, and linked libraries together.'),
    moreConcept('CMake targets', ['cmake', 'build'], 'organizing C++ builds around libraries and executable targets', 'Prefer target_link_libraries and target_include_directories over global flags.'),
    moreConcept('profiling native code', ['profiling', 'performance'], 'finding real C++ hot paths before low-level optimization', 'Use a profiler before rewriting code for performance.')
  ],
  nextjs: [
    moreConcept('layout nesting', ['layouts', 'app-router'], 'sharing UI and data boundaries across related Next.js routes', 'Use nested layouts for dashboard shells and section navigation.'),
    moreConcept('loading and error files', ['loading-ui', 'errors'], 'handling async route states directly in the Next.js route tree', 'Create loading.tsx and error.tsx beside the route segment.'),
    moreConcept('dynamic routes', ['routing', 'dynamic-routes'], 'rendering pages from URL parameters in Next.js', 'Use app/products/[id]/page.tsx for product detail pages.'),
    moreConcept('generateStaticParams', ['ssg', 'routing'], 'prebuilding dynamic Next.js pages when known paths are available', 'Return product slugs at build time for static catalog pages.'),
    moreConcept('metadata API', ['metadata', 'seo'], 'managing titles, descriptions, and social previews in Next.js', 'Use generateMetadata for data-driven detail pages.'),
    moreConcept('client components', ['client-components', 'interactivity'], 'adding browser-only interactivity to Next.js screens', 'Mark interactive components with use client.'),
    moreConcept('hydration mismatches', ['hydration', 'debugging'], 'debugging differences between server-rendered and client-rendered output', 'Avoid rendering Date.now differently on server and client.'),
    moreConcept('fetch caching', ['fetch', 'caching'], 'controlling data freshness in Next.js server-side requests', 'Use cache options or revalidate based on the data source.'),
    moreConcept('revalidatePath', ['revalidation', 'mutations'], 'refreshing cached Next.js routes after mutations', 'Call revalidatePath after a form updates visible data.'),
    moreConcept('route segment config', ['configuration', 'rendering'], 'controlling runtime and rendering behavior per route', 'Set dynamic or runtime only where the route needs it.'),
    moreConcept('edge runtime', ['edge', 'runtime'], 'running lightweight Next.js logic closer to users', 'Use edge middleware for simple auth or redirect checks.'),
    moreConcept('cookies and headers', ['cookies', 'headers'], 'reading request context safely in Next.js server code', 'Use cookies() for session-aware server components.'),
    moreConcept('forms with server actions', ['forms', 'server-actions'], 'submitting data without building a separate client API call', 'Bind a server action directly to a form action.'),
    moreConcept('optimistic updates', ['optimistic-ui', 'ux'], 'making Next.js mutations feel fast while the server confirms changes', 'Use optimistic UI only with clear rollback behavior.'),
    moreConcept('parallel routes', ['parallel-routes', 'routing'], 'rendering multiple route areas at the same time in Next.js', 'Use slots for dashboards with independent panels.'),
    moreConcept('intercepting routes', ['intercepting-routes', 'modals'], 'showing route-backed modal experiences in Next.js', 'Open photo detail as a modal while preserving the feed route.'),
    moreConcept('bundle analysis', ['bundle-size', 'performance'], 'finding client JavaScript cost in Next.js apps', 'Use bundle analyzer before moving code to the client.'),
    moreConcept('server-only modules', ['server-only', 'security'], 'preventing secrets or backend code from entering client bundles', 'Import server-only in modules that must never run in the browser.'),
    moreConcept('environment variables', ['configuration', 'deployment'], 'separating public and server-only configuration in Next.js', 'Use NEXT_PUBLIC only for values safe to expose to browsers.'),
    moreConcept('deployment on Vercel', ['deployment', 'vercel'], 'shipping Next.js apps with platform-aware rendering and caching', 'Understand how functions, static assets, and revalidation are deployed.'),
    moreConcept('Next.js testing', ['testing', 'quality'], 'covering routing, data fetching, and component behavior in Next.js apps', 'Test server logic separately from client interactions.')
  ],
  redis: [
    moreConcept('strings', ['strings', 'data-structures'], 'storing simple counters, flags, and cached values in Redis', 'Use GET and SET for compact key-value data.'),
    moreConcept('hashes', ['hashes', 'data-structures'], 'storing small object-like records without many separate keys', 'HSET user:42 name Ahmad role admin'),
    moreConcept('lists', ['lists', 'queues'], 'building simple ordered queues or recent activity feeds in Redis', 'LPUSH events and LRANGE the newest items.'),
    moreConcept('sets', ['sets', 'membership'], 'tracking unique membership efficiently in Redis', 'SADD online-users user:42'),
    moreConcept('HyperLogLog', ['hyperloglog', 'analytics'], 'estimating large unique counts with small memory cost', 'PFADD visitors user:42'),
    moreConcept('bitmaps', ['bitmaps', 'analytics'], 'tracking compact boolean activity over many users or days', 'SETBIT active:2026-06-03 42 1'),
    moreConcept('geospatial indexes', ['geo', 'location'], 'querying location-based data with Redis commands', 'GEOADD stores longitude latitude store:42'),
    moreConcept('pipelines', ['pipelines', 'performance'], 'reducing Redis round trips for batches of commands', 'Pipeline many GET calls instead of awaiting each one.'),
    moreConcept('Lua scripts', ['lua', 'atomicity'], 'running multi-step Redis logic atomically on the server', 'Use Lua for check-and-set workflows that must not race.'),
    moreConcept('transactions with MULTI', ['transactions', 'multi'], 'grouping Redis commands so they execute together', 'MULTI, INCR, EXPIRE, EXEC for simple rate counters.'),
    moreConcept('key naming conventions', ['keys', 'best-practice'], 'keeping Redis data understandable and maintainable', 'Use service:entity:id:field style prefixes.'),
    moreConcept('memory fragmentation', ['memory', 'operations'], 'diagnosing Redis memory pressure beyond raw dataset size', 'Watch used_memory and fragmentation ratio together.'),
    moreConcept('hot keys', ['hot-keys', 'scalability'], 'avoiding overloaded Redis keys that receive too much traffic', 'Shard very hot counters or cache entries when needed.'),
    moreConcept('cache stampede', ['cache-stampede', 'resilience'], 'preventing many callers from rebuilding the same expired cache', 'Use jitter, locks, or stale-while-revalidate patterns.'),
    moreConcept('write-through caching', ['caching', 'consistency'], 'keeping Redis updated as writes happen', 'Update cache and database through a consistent service path.'),
    moreConcept('write-behind caching', ['caching', 'durability'], 'buffering writes for speed while accepting durability tradeoffs', 'Use only when delayed persistence is acceptable.'),
    moreConcept('session storage', ['sessions', 'auth'], 'sharing login state across stateless application instances', 'Store session IDs with TTLs and secure cookie references.'),
    moreConcept('leaderboards', ['sorted-sets', 'ranking'], 'using Redis sorted sets for ordered scores', 'ZREVRANGE leaderboard 0 9 WITHSCORES'),
    moreConcept('consumer groups', ['streams', 'consumer-groups'], 'coordinating stream processing across multiple workers', 'Use XREADGROUP to distribute events among consumers.'),
    moreConcept('Sentinel failover', ['sentinel', 'high-availability'], 'automating Redis primary failover for high availability', 'Sentinel monitors Redis nodes and promotes replicas.'),
    moreConcept('Redis security', ['security', 'operations'], 'protecting Redis from accidental or hostile access', 'Use private networking, ACLs, and no public exposure.')
  ],
  aws: [
    moreConcept('CloudFront', ['cloudfront', 'cdn'], 'serving cached content globally with lower latency', 'Put CloudFront in front of S3 assets or APIs.'),
    moreConcept('Route 53', ['route53', 'dns'], 'managing DNS and traffic routing for AWS-hosted systems', 'Use weighted records for controlled traffic shifting.'),
    moreConcept('Elastic Load Balancing', ['elb', 'load-balancing'], 'distributing traffic across healthy AWS compute targets', 'Use an ALB for HTTP services behind multiple tasks.'),
    moreConcept('Auto Scaling', ['autoscaling', 'scalability'], 'adjusting AWS capacity based on demand', 'Scale ECS tasks or EC2 instances from CPU or queue depth.'),
    moreConcept('DynamoDB', ['dynamodb', 'nosql'], 'building low-latency key-value and document workloads on AWS', 'Model tables from access patterns, not relational joins.'),
    moreConcept('SNS', ['sns', 'messaging'], 'faning out event notifications to multiple subscribers', 'Publish order events to SNS for independent consumers.'),
    moreConcept('EventBridge', ['eventbridge', 'events'], 'routing application and AWS events between services', 'Use event rules to trigger workflows from domain events.'),
    moreConcept('Step Functions', ['step-functions', 'workflows'], 'orchestrating multi-step AWS workflows with retries and state', 'Coordinate Lambda tasks with explicit failure handling.'),
    moreConcept('EKS', ['eks', 'kubernetes'], 'running Kubernetes workloads on AWS-managed control planes', 'Use EKS when Kubernetes portability or ecosystem tooling matters.'),
    moreConcept('Fargate', ['fargate', 'containers'], 'running containers without managing EC2 hosts', 'Run ECS tasks on Fargate for simpler operations.'),
    moreConcept('Secrets Manager', ['secrets-manager', 'security'], 'storing and rotating sensitive credentials in AWS', 'Load database credentials from Secrets Manager at runtime.'),
    moreConcept('KMS', ['kms', 'encryption'], 'managing encryption keys and access policies in AWS', 'Use KMS keys for S3, RDS, and application encryption needs.'),
    moreConcept('WAF', ['waf', 'security'], 'filtering malicious HTTP traffic before it reaches applications', 'Attach WAF rules to CloudFront or an ALB.'),
    moreConcept('CloudTrail', ['cloudtrail', 'audit'], 'auditing AWS API activity across accounts', 'Use CloudTrail logs for security investigations.'),
    moreConcept('CloudFormation', ['cloudformation', 'iac'], 'defining AWS infrastructure as repeatable templates', 'Review infrastructure changes before stack updates.'),
    moreConcept('CDK', ['cdk', 'iac'], 'modeling AWS infrastructure with programming languages', 'Use CDK constructs to package reusable infrastructure patterns.'),
    moreConcept('multi-account strategy', ['accounts', 'governance'], 'separating AWS environments and blast radius', 'Use separate accounts for production, staging, and security tooling.'),
    moreConcept('Well-Architected Framework', ['well-architected', 'architecture'], 'reviewing AWS systems against reliability, security, and cost pillars', 'Use pillar reviews to find operational risks.'),
    moreConcept('cost optimization', ['cost', 'finops'], 'controlling AWS spend without hurting reliability', 'Right-size resources and remove idle infrastructure.'),
    moreConcept('backup and disaster recovery', ['backup', 'dr'], 'recovering AWS workloads after failures or data loss', 'Define RTO and RPO before choosing backup patterns.'),
    moreConcept('observability across AWS', ['observability', 'operations'], 'connecting logs, metrics, traces, and alarms in cloud systems', 'Correlate Lambda logs, API Gateway metrics, and X-Ray traces.')
  ],
  'generative-ai': [
    moreConcept('structured outputs', ['structured-output', 'json'], 'making model responses safer for application code to parse', 'Ask for schema-shaped JSON and validate it before use.'),
    moreConcept('system prompts', ['system-prompts', 'prompting'], 'setting stable behavior and boundaries for AI applications', 'Keep system instructions separate from user-provided content.'),
    moreConcept('few-shot examples', ['few-shot', 'prompting'], 'showing the model the desired pattern through examples', 'Include two or three representative input-output examples.'),
    moreConcept('zero-shot prompting', ['zero-shot', 'prompting'], 'asking a model to perform a task without examples', 'Use zero-shot only when the task is simple and unambiguous.'),
    moreConcept('prompt injection', ['prompt-injection', 'security'], 'protecting AI apps from malicious user or document instructions', 'Treat retrieved text as data, not trusted instructions.'),
    moreConcept('grounding', ['grounding', 'trust'], 'anchoring generated answers in supplied evidence', 'Require answers to cite retrieved context.'),
    moreConcept('multimodal generation', ['multimodal', 'images'], 'using models that process or produce text, images, audio, or video', 'Send image context with text instructions for visual QA.'),
    moreConcept('function calling', ['function-calling', 'tools'], 'letting a model request structured actions through trusted code', 'Validate tool arguments before executing any action.'),
    moreConcept('agentic workflows', ['agents', 'workflows'], 'combining generation with planning and tool use', 'Use bounded steps and checkpoints for risky actions.'),
    moreConcept('human review', ['human-in-the-loop', 'safety'], 'adding approval for high-risk generated outputs', 'Route legal, financial, or destructive actions to a reviewer.'),
    moreConcept('red teaming', ['red-teaming', 'safety'], 'testing AI systems against misuse and failure cases', 'Probe jailbreaks, data leakage, and unsafe completion patterns.'),
    moreConcept('content moderation', ['moderation', 'safety'], 'screening inputs or outputs for unsafe content', 'Run moderation checks around user-facing generation.'),
    moreConcept('data privacy', ['privacy', 'security'], 'protecting sensitive data sent to or produced by AI systems', 'Minimize PII in prompts and logs.'),
    moreConcept('prompt versioning', ['prompt-versioning', 'operations'], 'tracking prompt changes like product code', 'Store prompt versions with evaluation results.'),
    moreConcept('A/B testing AI outputs', ['experimentation', 'evaluation'], 'comparing prompt or model variants with real success metrics', 'Measure task success rather than only subjective preference.'),
    moreConcept('token budgeting', ['tokens', 'cost'], 'controlling prompt size, context quality, and inference cost', 'Trim irrelevant history before sending a model request.'),
    moreConcept('streaming responses', ['streaming', 'ux'], 'improving perceived latency for generated answers', 'Stream partial output while the final answer is still being produced.'),
    moreConcept('semantic caching', ['caching', 'embeddings'], 'reusing AI answers for similar requests when correctness allows', 'Cache stable support answers by normalized intent.'),
    moreConcept('synthetic data', ['synthetic-data', 'training'], 'creating generated examples for testing or training workflows', 'Review synthetic data for bias and leakage before use.'),
    moreConcept('model monitoring', ['monitoring', 'operations'], 'tracking AI quality, drift, latency, and cost after release', 'Alert on rising refusal, correction, or escalation rates.'),
    moreConcept('fallback behavior', ['fallbacks', 'reliability'], 'handling model failures without breaking the user workflow', 'Use deterministic fallback copy or escalation when generation fails.')
  ],
  'ai-agents': [
    moreConcept('agent loops', ['agent-loops', 'architecture'], 'running observe-plan-act cycles with clear stopping conditions', 'Cap the number of tool iterations per task.'),
    moreConcept('task decomposition', ['planning', 'decomposition'], 'breaking broad goals into executable subtasks', 'Split research, synthesis, and final formatting into separate steps.'),
    moreConcept('tool schemas', ['tools', 'schemas'], 'describing tool inputs so agents call them safely', 'Use strict JSON schemas for tool arguments.'),
    moreConcept('tool permissions', ['permissions', 'security'], 'limiting which actions an agent can perform', 'Allow read tools by default and gate write tools behind approval.'),
    moreConcept('state machines', ['state-machines', 'workflow'], 'controlling agent workflows with deterministic transitions', 'Use states for draft, review, approved, and executed.'),
    moreConcept('reflection steps', ['reflection', 'quality'], 'letting an agent review its own output before finalizing', 'Ask the agent to check missing requirements against the task.'),
    moreConcept('planner-executor pattern', ['planner-executor', 'agents'], 'separating planning from action execution', 'Have one step create a plan and another execute approved steps.'),
    moreConcept('retrieval-augmented agents', ['rag', 'agents'], 'giving agents grounded knowledge before tool decisions', 'Retrieve policy docs before the agent answers compliance questions.'),
    moreConcept('long-running jobs', ['long-running', 'operations'], 'managing agent tasks that outlive one request', 'Persist task state and resume from checkpoints.'),
    moreConcept('checkpoints', ['checkpoints', 'recovery'], 'saving progress so agent workflows can recover safely', 'Store completed tool calls before continuing to the next step.'),
    moreConcept('idempotent tool calls', ['idempotency', 'tools'], 'preventing duplicate side effects during retries', 'Use request IDs for payment or ticket creation tools.'),
    moreConcept('sandboxing', ['sandboxing', 'security'], 'running agent code or tools in constrained environments', 'Restrict filesystem and network access for code execution tools.'),
    moreConcept('approval gates', ['approval', 'human-in-the-loop'], 'pausing risky agent actions for user confirmation', 'Ask before sending emails, deleting records, or spending money.'),
    moreConcept('agent memory stores', ['memory', 'storage'], 'persisting useful context without leaking irrelevant chat history', 'Store preferences and task facts separately.'),
    moreConcept('multi-agent handoffs', ['multi-agent', 'handoffs'], 'passing work between specialized agents cleanly', 'A research agent hands structured notes to a writing agent.'),
    moreConcept('agent evaluation datasets', ['evaluation', 'datasets'], 'testing agent reliability on repeatable tasks', 'Run the same task suite before changing prompts or tools.'),
    moreConcept('cost controls', ['cost', 'operations'], 'keeping agent workflows from making too many expensive calls', 'Set per-task token and tool-call budgets.'),
    moreConcept('latency controls', ['latency', 'performance'], 'keeping agent workflows responsive enough for users', 'Run independent tool calls in parallel when safe.'),
    moreConcept('audit trails', ['audit', 'observability'], 'recording what an agent did and why', 'Log tool calls, inputs, outputs, approvals, and final state.'),
    moreConcept('failure escalation', ['failure-handling', 'operations'], 'moving unresolved agent tasks to a human or fallback path', 'Escalate when confidence or tool reliability is too low.'),
    moreConcept('agent product fit', ['product', 'tradeoffs'], 'deciding whether an agent is better than a simpler workflow', 'Use agents only when flexible multi-step reasoning is actually needed.')
  ],
  llm: [
    moreConcept('pretraining', ['pretraining', 'foundation-models'], 'understanding how LLMs learn broad language patterns', 'Pretraining predicts tokens over huge text corpora.'),
    moreConcept('RLHF', ['rlhf', 'alignment'], 'aligning model behavior with human preferences', 'Use preference feedback to tune response helpfulness and safety.'),
    moreConcept('context stuffing', ['context-window', 'anti-pattern'], 'recognizing when too much prompt context hurts quality and cost', 'Do not paste every document when retrieval can select the useful parts.'),
    moreConcept('prompt hierarchy', ['prompting', 'instructions'], 'understanding how system, developer, and user instructions interact', 'Keep durable behavior in higher-priority instructions.'),
    moreConcept('log probabilities', ['logprobs', 'confidence'], 'interpreting token likelihoods for classification or uncertainty signals', 'Use logprobs carefully because they are not full truth confidence.'),
    moreConcept('top-p sampling', ['sampling', 'top-p'], 'controlling randomness through nucleus sampling', 'Lower top-p when outputs need to stay focused.'),
    moreConcept('beam search', ['decoding', 'search'], 'comparing deterministic decoding strategies for text generation', 'Beam search is more common in translation-style tasks than chat UX.'),
    moreConcept('embedding models', ['embeddings', 'retrieval'], 'turning text into vectors for semantic comparison', 'Use embeddings for similarity search, clustering, and deduplication.'),
    moreConcept('cross-encoders', ['reranking', 'models'], 'scoring query-document pairs more precisely after retrieval', 'Rerank retrieved chunks before sending context to the LLM.'),
    moreConcept('distillation', ['distillation', 'optimization'], 'training smaller models to mimic larger model behavior', 'Distill a high-quality workflow into a faster model when volume grows.'),
    moreConcept('model routing', ['routing', 'cost'], 'choosing different LLMs for different task complexity', 'Send extraction to a small model and hard reasoning to a stronger one.'),
    moreConcept('guardrail models', ['guardrails', 'safety'], 'using separate checks around the main model output', 'Run a policy classifier before displaying sensitive output.'),
    moreConcept('context compression', ['compression', 'context-window'], 'summarizing or filtering context before an LLM call', 'Compress old chat history into task-relevant facts.'),
    moreConcept('long-context tradeoffs', ['long-context', 'latency'], 'using large context windows without assuming they solve retrieval quality', 'Long context can increase cost and still bury the key evidence.'),
    moreConcept('JSON mode', ['json-mode', 'structured-output'], 'getting machine-readable LLM responses', 'Validate JSON output before trusting it in code.'),
    moreConcept('tool-use reliability', ['tools', 'reliability'], 'making LLM tool calls predictable enough for products', 'Constrain tools and validate arguments server-side.'),
    moreConcept('safety refusals', ['safety', 'refusals'], 'handling cases where an LLM should not comply', 'Design user messaging for rejected or redirected requests.'),
    moreConcept('benchmark limitations', ['benchmarks', 'evaluation'], 'knowing why public scores do not guarantee product performance', 'Evaluate models on your own tasks and data.'),
    moreConcept('data leakage', ['privacy', 'security'], 'preventing sensitive prompt or training data exposure', 'Avoid logging secrets and role-restricted content.'),
    moreConcept('prompt regression testing', ['testing', 'prompts'], 'catching quality drops when prompts or models change', 'Run a saved evaluation set before release.'),
    moreConcept('LLM observability', ['observability', 'operations'], 'tracking prompts, outputs, latency, cost, and quality signals', 'Log model version and prompt version with each request.')
  ],
  rag: [
    moreConcept('query rewriting', ['query-rewriting', 'retrieval'], 'improving retrieval by transforming user questions', 'Rewrite vague follow-up questions into standalone search queries.'),
    moreConcept('metadata filtering', ['metadata', 'security'], 'scoping retrieval by tenant, role, type, or freshness', 'Filter documents by account ID before vector search.'),
    moreConcept('document ingestion', ['ingestion', 'pipelines'], 'turning raw files into searchable RAG content', 'Extract text, clean it, chunk it, embed it, and store metadata.'),
    moreConcept('deduplication', ['dedupe', 'quality'], 'removing repeated chunks that waste context budget', 'Hash normalized chunks before embedding.'),
    moreConcept('semantic chunking', ['chunking', 'quality'], 'splitting documents by meaning instead of arbitrary length alone', 'Chunk by headings, paragraphs, or sections when possible.'),
    moreConcept('overlap strategy', ['chunk-overlap', 'retrieval'], 'preserving context across chunk boundaries', 'Use moderate overlap so answers do not lose surrounding definitions.'),
    moreConcept('top-k tuning', ['top-k', 'retrieval'], 'choosing how many retrieved chunks to send forward', 'Tune top-k from evaluation instead of guessing.'),
    moreConcept('similarity thresholds', ['thresholds', 'quality'], 'deciding when retrieved context is too weak to answer', 'Abstain or ask for clarification when scores are low.'),
    moreConcept('answer faithfulness', ['faithfulness', 'evaluation'], 'checking whether answers stay supported by retrieved evidence', 'Compare final claims against source snippets.'),
    moreConcept('lost-in-the-middle', ['context-window', 'quality'], 'handling models missing important evidence in long prompts', 'Put the most relevant chunks near important instruction boundaries.'),
    moreConcept('knowledge freshness', ['freshness', 'indexing'], 'keeping retrieved content current after source updates', 'Track source version and reindex changed documents.'),
    moreConcept('access-controlled retrieval', ['access-control', 'security'], 'preventing users from retrieving unauthorized content', 'Apply permission filters before ranking and generation.'),
    moreConcept('multi-vector retrieval', ['multi-vector', 'retrieval'], 'representing documents with multiple embeddings for better recall', 'Embed title, summary, and body chunks separately.'),
    moreConcept('parent-child retrieval', ['parent-child', 'retrieval'], 'retrieving small chunks but returning larger source context', 'Search child chunks and pass parent sections to the model.'),
    moreConcept('knowledge graphs with RAG', ['knowledge-graph', 'hybrid'], 'combining structured relationships with semantic retrieval', 'Use graph edges for entities and vector search for unstructured detail.'),
    moreConcept('RAG versus fine-tuning', ['fine-tuning', 'tradeoffs'], 'choosing retrieval for knowledge and training for behavior', 'Use RAG for changing policy docs and fine-tuning for style.'),
    moreConcept('citation UX', ['citations', 'ux'], 'presenting sources so users can verify generated answers', 'Link answer claims to exact source snippets.'),
    moreConcept('retrieval latency', ['latency', 'performance'], 'keeping search plus generation fast enough for users', 'Cache embeddings and parallelize independent lookups.'),
    moreConcept('vector index updates', ['indexing', 'operations'], 'updating embeddings without breaking search availability', 'Use rolling index updates or versioned indexes.'),
    moreConcept('RAG hallucinations', ['hallucinations', 'quality'], 'recognizing that retrieval reduces but does not eliminate false claims', 'Require the model to say when sources do not answer the question.'),
    moreConcept('RAG production monitoring', ['monitoring', 'operations'], 'tracking retrieval and answer quality after launch', 'Monitor no-answer rate, citation clicks, and user corrections.')
  ],
  langchain: [
    moreConcept('runnables', ['runnables', 'lcel'], 'building composable LangChain execution units', 'Use runnable sequences for predictable chain composition.'),
    moreConcept('RunnableParallel', ['parallelism', 'lcel'], 'running independent LangChain steps at the same time', 'Fetch profile and orders in parallel before summarizing.'),
    moreConcept('configurable runnables', ['configuration', 'lcel'], 'switching models or parameters without rewriting chains', 'Expose model choice through runtime configuration.'),
    moreConcept('vector store integrations', ['vector-store', 'rag'], 'connecting LangChain retrieval to vector databases', 'Create a retriever from a vector store integration.'),
    moreConcept('text splitters', ['text-splitters', 'chunking'], 'preparing documents for retrieval workflows', 'Use recursive splitters for mixed markdown or prose.'),
    moreConcept('tool calling agents', ['tool-calling', 'agents'], 'letting LangChain agents call external functions', 'Define clear tool names, descriptions, and argument schemas.'),
    moreConcept('agent executors', ['agent-executor', 'agents'], 'running agent loops with tools and stopping rules', 'Set max iterations for agent executors.'),
    moreConcept('conversation memory', ['memory', 'chat'], 'carrying relevant chat context across turns', 'Summarize history before it becomes too large.'),
    moreConcept('retrieval chains', ['retrieval-chain', 'rag'], 'combining document retrieval with answer generation', 'Use createRetrievalChain for grounded QA flows.'),
    moreConcept('structured output chains', ['structured-output', 'parsers'], 'returning validated objects instead of free text', 'Pair prompts with schema-aware output parsing.'),
    moreConcept('fallbacks', ['fallbacks', 'reliability'], 'recovering when one model or chain step fails', 'Use a cheaper fallback only when quality remains acceptable.'),
    moreConcept('retry policies', ['retries', 'resilience'], 'handling transient model or API failures', 'Retry idempotent model calls with backoff.'),
    moreConcept('streaming callbacks', ['streaming', 'callbacks'], 'showing partial LangChain output to users', 'Stream tokens into the UI while tracing the run.'),
    moreConcept('tracing metadata', ['tracing', 'observability'], 'making LangChain runs debuggable in production', 'Attach user, session, and feature metadata to runs.'),
    moreConcept('LangSmith datasets', ['langsmith', 'datasets'], 'saving test cases for repeatable LLM workflow evaluation', 'Run prompt changes against a dataset before release.'),
    moreConcept('prompt hub usage', ['prompt-hub', 'prompts'], 'reusing or versioning prompts in LangChain workflows', 'Pull known prompts but review them before production use.'),
    moreConcept('custom tools', ['custom-tools', 'integration'], 'wrapping application capabilities for LangChain agents', 'Expose only safe narrow operations as tools.'),
    moreConcept('retriever evaluation', ['evaluation', 'retrievers'], 'checking whether LangChain retrieval finds the right context', 'Measure hit rate before tuning generation prompts.'),
    moreConcept('framework boundaries', ['architecture', 'boundaries'], 'keeping business logic outside LangChain glue code', 'Call domain services from chains rather than embedding rules in prompts.'),
    moreConcept('migration risk', ['migration', 'maintenance'], 'managing LangChain version changes in production systems', 'Pin versions and regression test chains before upgrading.'),
    moreConcept('LangChain alternatives', ['tradeoffs', 'architecture'], 'knowing when direct SDK calls are simpler than LangChain', 'Use direct model calls for one-step workflows.')
  ],
  mean: [
    moreConcept('Angular routing in MEAN', ['angular', 'routing'], 'organizing feature navigation in MEAN applications', 'Lazy load admin or dashboard routes.'),
    moreConcept('Angular reactive forms in MEAN', ['angular', 'forms'], 'collecting and validating user input before API submission', 'Mirror server validation errors back into form controls.'),
    moreConcept('RxJS API streams', ['rxjs', 'api'], 'coordinating async frontend data flow in MEAN apps', 'Use switchMap for cancellable search calls.'),
    moreConcept('HTTP interceptors', ['angular', 'http'], 'adding auth headers and error handling to Angular API calls', 'Attach tokens through an interceptor rather than every service method.'),
    moreConcept('Express controllers', ['express', 'controllers'], 'keeping MEAN route handling organized', 'Move request orchestration into controllers and domain work into services.'),
    moreConcept('service layer design', ['services', 'architecture'], 'centralizing business logic in the Node side of a MEAN app', 'Keep MongoDB calls behind service or repository boundaries.'),
    moreConcept('Mongoose schemas', ['mongoose', 'mongodb'], 'modeling MongoDB documents in MEAN applications', 'Define indexes and validation in schema definitions.'),
    moreConcept('aggregation pipelines', ['mongodb', 'aggregation'], 'building reporting or dashboard queries in MEAN products', 'Use $match early to reduce pipeline work.'),
    moreConcept('JWT handling', ['jwt', 'auth'], 'securing stateless MEAN API requests', 'Validate token signature and claims on every protected request.'),
    moreConcept('role-based access control', ['authorization', 'security'], 'protecting MEAN routes and backend actions by permission', 'Check roles on the server, not only in Angular guards.'),
    moreConcept('CORS configuration', ['cors', 'security'], 'allowing Angular and Express to communicate safely across origins', 'Permit only known frontend origins and credential rules.'),
    moreConcept('file uploads', ['uploads', 'api'], 'moving files from Angular forms through Express safely', 'Limit file size and store metadata separately.'),
    moreConcept('pagination contracts', ['pagination', 'api'], 'keeping large MEAN lists fast and predictable', 'Return items with cursor or page metadata.'),
    moreConcept('error response shapes', ['errors', 'contracts'], 'letting Angular render backend failures consistently', 'Use stable error codes and messages from Express.'),
    moreConcept('environment variables', ['configuration', 'deployment'], 'separating browser-safe config from server secrets', 'Never expose database credentials in Angular builds.'),
    moreConcept('Dockerizing MEAN apps', ['docker', 'deployment'], 'packaging Angular, Node, and Mongo-backed services consistently', 'Build Angular assets separately from the API image.'),
    moreConcept('CI pipelines', ['ci-cd', 'quality'], 'testing and building MEAN changes before deployment', 'Run Angular tests, API tests, and lint checks in CI.'),
    moreConcept('logging and tracing', ['observability', 'operations'], 'debugging requests that cross Angular, Express, and MongoDB', 'Propagate request IDs from frontend to backend logs.'),
    moreConcept('caching MEAN APIs', ['caching', 'performance'], 'reducing repeated backend and database work', 'Cache read-heavy endpoints with explicit invalidation.'),
    moreConcept('websocket updates', ['websockets', 'realtime'], 'pushing live changes into Angular views', 'Use socket events plus server-side authorization checks.'),
    moreConcept('MEAN scalability tradeoffs', ['scalability', 'tradeoffs'], 'explaining how each layer scales under growth', 'Scale API instances separately from MongoDB capacity.')
  ],
  'full-stack-web-development': [
    moreConcept('HTTP request lifecycle', ['http', 'web'], 'understanding how browser requests reach backend code and return responses', 'Trace DNS, TLS, request routing, handler logic, and response rendering.'),
    moreConcept('RESTful resource design', ['rest', 'api'], 'building clear backend contracts for frontend clients', 'Use nouns for resources and verbs through HTTP methods.'),
    moreConcept('GraphQL tradeoffs', ['graphql', 'api'], 'choosing client-shaped data fetching when it is worth the operational cost', 'Use GraphQL when multiple clients need flexible data shapes.'),
    moreConcept('database transactions', ['transactions', 'database'], 'keeping related writes consistent in full-stack features', 'Wrap order creation and payment state updates in a transaction when needed.'),
    moreConcept('ORM tradeoffs', ['orm', 'database'], 'balancing developer speed with SQL visibility', 'Use ORM abstractions but inspect generated queries for hot paths.'),
    moreConcept('server-side validation', ['validation', 'security'], 'protecting data integrity beyond frontend form checks', 'Reject invalid payloads even if the UI already validated them.'),
    moreConcept('client-side validation', ['forms', 'ux'], 'giving users fast feedback before submitting data', 'Show inline errors while keeping backend validation authoritative.'),
    moreConcept('session versus token auth', ['auth', 'security'], 'choosing how identity is stored and verified across requests', 'Use secure cookies or tokens based on product and deployment constraints.'),
    moreConcept('CSRF protection', ['csrf', 'security'], 'protecting authenticated browser actions from forged requests', 'Use SameSite cookies and CSRF tokens where appropriate.'),
    moreConcept('XSS prevention', ['xss', 'security'], 'stopping untrusted content from executing in users browsers', 'Escape output and avoid dangerously injecting HTML.'),
    moreConcept('CORS', ['cors', 'browser'], 'controlling browser access to backend APIs across origins', 'Allow only trusted origins and required headers.'),
    moreConcept('responsive design', ['responsive', 'frontend'], 'making full-stack products usable across screen sizes', 'Use fluid layouts and test real mobile breakpoints.'),
    moreConcept('accessibility testing', ['accessibility', 'quality'], 'ensuring UI flows work for keyboard and assistive technology users', 'Check labels, focus order, contrast, and semantic structure.'),
    moreConcept('frontend performance', ['performance', 'frontend'], 'reducing load time and interaction delays', 'Measure bundle size, render cost, and Core Web Vitals.'),
    moreConcept('backend performance', ['performance', 'backend'], 'reducing API latency and resource usage', 'Profile database queries, serialization, and external calls.'),
    moreConcept('caching layers', ['caching', 'architecture'], 'using browser, CDN, API, and database caches appropriately', 'Cache static assets differently from user-specific data.'),
    moreConcept('queues and background jobs', ['queues', 'background-jobs'], 'moving slow work out of request-response flows', 'Send email or report generation to workers.'),
    moreConcept('feature flags', ['feature-flags', 'deployment'], 'releasing full-stack features gradually', 'Gate a new checkout flow by account or percentage rollout.'),
    moreConcept('database migrations', ['migrations', 'database'], 'changing schemas without breaking running applications', 'Deploy additive changes before code that depends on them.'),
    moreConcept('monitoring and alerting', ['monitoring', 'operations'], 'detecting user-facing failures across the stack', 'Alert on error rate, latency, and business-critical failures.'),
    moreConcept('incident debugging', ['debugging', 'operations'], 'tracing bugs across frontend, backend, and persistence layers', 'Follow one request ID through browser logs, API logs, and database queries.')
  ]
};

Object.assign(
  verifiedSeedCatalog,
  Object.fromEntries(
    Object.entries(generatedTopicConfigs).map(([topicKey, concepts]) => [
      topicKey,
      buildGeneratedTopicSeeds({
        topicKey,
        concepts: [...concepts, ...(additionalGeneratedTopicConcepts[topicKey] || [])]
      })
    ])
  )
);

listImportantTopics().forEach((topic) => {
  const topicSeeds = verifiedSeedCatalog[topic.key] || [];
  if (topicSeeds.length >= MIN_VERIFIED_SEED_COUNT) return;

  const label = TOPIC_GUIDES[topic.key]?.label || topic.label || topic.key;
  topicSeeds.push(seed(
    'hard',
    `How do you explain ${label} architecture decisions in a senior interview?`,
    `A strong ${label} answer connects the technology choice to requirements, tradeoffs, operational risk, and the point where a simpler option would be better.`,
    [topic.key, 'architecture', 'interview-strategy', 'tradeoffs'],
    {
      explanation: `This question checks whether the candidate can reason beyond definitions. The answer should cover why ${label} is being used, what alternatives exist, and how the decision affects reliability, cost, maintainability, and delivery.`,
      example: `Compare a ${label} design with one simpler alternative and explain why the tradeoff is acceptable for the product constraints.`,
      realWorldUseCase: `Senior-level interview discussions where ${label} choices must be justified against product and production constraints.`,
      commonMistakes: [
        `Only defining ${label} without explaining the decision behind using it.`,
        'Ignoring operational tradeoffs such as cost, latency, debugging, ownership, or scaling.'
      ],
      interviewTip: 'Start with requirements, name the tradeoff, and finish with how you would validate the decision in production.',
      category: 'system_design'
    }
  ));
  verifiedSeedCatalog[topic.key] = topicSeeds;
});

const validateVerifiedSeedCoverage = () => {
  const missingCoverage = listImportantTopics()
    .map((topic) => ({ key: topic.key, count: verifiedSeedCatalog[topic.key]?.length || 0 }))
    .filter((topic) => topic.count < MIN_VERIFIED_SEED_COUNT);

  if (missingCoverage.length > 0) {
    const summary = missingCoverage.map((topic) => `${topic.key}:${topic.count}`).join(', ');
    throw new Error(`Interview verified seed coverage is incomplete. Expected at least ${MIN_VERIFIED_SEED_COUNT} questions for every topic. Missing: ${summary}`);
  }
};

validateVerifiedSeedCoverage();

const getTopicSeedItems = (topicKey = '') => verifiedSeedCatalog[String(topicKey || '').trim().toLowerCase()] || [];

const buildTopicDimensions = (topic) => ({
  stack: topic.type === 'stack' ? [topic.key] : [],
  technology: topic.type === 'technology' ? [topic.key] : [],
  language: topic.type === 'language' ? [topic.key] : [],
  framework: topic.type === 'framework' ? [topic.key] : []
});

const buildPopularity = (index) => 100 - (index % 30);

const buildSeedRecordsForTopic = (topic) => {
  return getTopicSeedItems(topic.key).map((spec, index) => {
    const question = normalizeQuestionText(spec.question);
    const answerSections = toAnswerSections(topic.key, spec);
    const answer = structuredAnswerToText(answerSections);
    const confidenceScore = Number(spec.confidenceScore || 95);

    return {
      topicKey: topic.key,
      topicType: topic.type,
      topicDimensions: buildTopicDimensions(topic),
      skill: normalizeTopicInput({ topic: topic.key }).skill,
      question,
      answer,
      answerSections,
      normalizedQuestion: normalizeComparableText(question),
      normalizedAnswer: normalizeComparableText(answer),
      difficulty: spec.difficulty,
      tags: sanitizeTags([topic.key, topic.type, 'verified_seed', SEED_VERSION, ...(spec.tags || [])]),
      source: 'verified_seed',
      sourceType: 'verified_seed',
      sourceMeta: {
        seedVersion: SEED_VERSION,
        seededAt: new Date().toISOString()
      },
      confidenceScore: confidenceScore > 1 ? Number((confidenceScore / 100).toFixed(2)) : confidenceScore,
      category: spec.category || inferCategory(spec.tags),
      qualityScore: 5,
      answerFormat: 'structured',
      isEnriched: true,
      qualityState: 'approved',
      popularity: buildPopularity(index),
      usageCount: 0,
      lastUsedAt: null,
      createdAt: new Date()
    };
  });
};

const getImportantTopicByKey = (topicKey = '') => {
  const normalized = String(topicKey || '').trim().toLowerCase();
  if (!normalized) return null;
  return listImportantTopics().find((topic) => topic.key === normalized) || null;
};

const comparableSeedIndex = new Map();

const ensureComparableSeedIndex = (topicKey = '') => {
  const normalizedTopicKey = String(topicKey || '').trim().toLowerCase();
  if (!normalizedTopicKey) return new Map();
  if (!comparableSeedIndex.has(normalizedTopicKey)) {
    const topic = getImportantTopicByKey(normalizedTopicKey);
    const records = topic ? buildSeedRecordsForTopic(topic) : [];
    comparableSeedIndex.set(
      normalizedTopicKey,
      new Map(records.map((record) => [record.normalizedQuestion, record]))
    );
  }
  return comparableSeedIndex.get(normalizedTopicKey) || new Map();
};

const findSeedRecordByQuestion = (topicKey = '', question = '') => {
  const normalizedQuestion = normalizeComparableText(question);
  if (!normalizedQuestion) return null;
  return ensureComparableSeedIndex(topicKey).get(normalizedQuestion) || null;
};

module.exports = {
  SEED_VERSION,
  MIN_VERIFIED_SEED_COUNT,
  verifiedSeedCatalog,
  getTopicSeedItems,
  buildSeedRecordsForTopic,
  getImportantTopicByKey,
  findSeedRecordByQuestion
};
