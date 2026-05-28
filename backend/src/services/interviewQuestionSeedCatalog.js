const { listImportantTopics, normalizeTopicInput } = require('./interviewTopicNormalizer');
const {
  normalizeComparableText,
  normalizeQuestionText,
  normalizeAnswerText,
  sanitizeTags
} = require('./interviewQuestionQualityService');

const SEED_VERSION = 'v3-topic-specific';

const topicSeeds = {
  react: [
    ['medium', 'How does React reconciliation use keys to update lists efficiently?', 'React reconciliation compares the previous and next virtual tree, then uses keys to match stable list items across renders. Good keys prevent React from reusing the wrong component state when items are inserted, removed, or reordered. In production, use durable IDs from data instead of array indexes for dynamic lists. Example: rendering todos with key={todo.id} keeps each row state attached to the correct todo. Interview tip: mention that keys are about identity among siblings, not a prop passed to the child.', ['reconciliation', 'keys', 'virtual-dom']],
    ['medium', 'What problem do React hooks solve, and what rules must you follow?', 'Hooks let function components use state, lifecycle-like effects, refs, and shared logic without class components. They must be called unconditionally at the top level so React can preserve hook order between renders. A real-world pattern is extracting useDebouncedSearch or useAuthSession to share behavior. Common mistake: calling hooks inside loops or conditional branches. Interview tip: explain both reuse and predictable call order.', ['hooks', 'state', 'effects']],
    ['hard', 'When should you use useMemo, React.memo, or useCallback in React?', 'Use memoization when render work or prop identity changes are measurably expensive. useMemo caches calculated values, useCallback stabilizes function references, and React.memo skips child re-rendering when props are equal. In production, profile first because memoization adds complexity and comparison cost. Example: memoize a filtered table model only after profiling slow filters. Interview tip: emphasize measurement over blanket optimization.', ['performance', 'memoization']],
    ['medium', 'How does Context API affect rendering and state architecture?', 'Context avoids prop drilling by making values available to a subtree, but every consumer can re-render when the provider value changes. Production apps split contexts by update frequency, memoize provider values carefully, or use external stores for high-frequency state. Example: auth context is fine; rapidly changing cursor position is not. Interview tip: discuss context as dependency injection, not a replacement for all state management.', ['context-api', 'state-management']],
    ['hard', 'How do you prevent stale closures in React effects and event handlers?', 'A stale closure happens when a function captures old state or props. Fix it with accurate dependency arrays, functional state updates, refs for mutable values, or event-specific patterns. Example: setCount(current => current + 1) avoids stale interval updates. Common mistake: suppressing exhaustive-deps without understanding the data flow. Interview tip: connect the bug to JavaScript closures, not only React.', ['effects', 'closures']]
  ],
  angular: [
    ['medium', 'How does Angular change detection work, and when should you use OnPush?', 'Angular change detection checks component templates after async events, input changes, and framework-triggered tasks. OnPush limits checks to input reference changes, events in the component, async pipe emissions, or manual marks. Production apps use OnPush with immutable data and async pipes to reduce unnecessary checks. Interview tip: explain the difference between mutating an object and replacing its reference.', ['change-detection', 'onpush']],
    ['medium', 'What is the role of Angular services and dependency injection?', 'Angular services hold shared logic and state, while dependency injection controls how instances are created and scoped. A service provided in root acts like an app-wide singleton; component providers create scoped instances. Real-world use cases include API clients, auth state, and feature facades. Interview tip: mention provider scope and testability, not just code reuse.', ['services', 'dependency-injection']],
    ['hard', 'How do RxJS observables improve Angular data flows?', 'Observables model async streams such as HTTP responses, form changes, route params, and websocket updates. Operators like switchMap cancel stale requests, debounceTime reduces noisy input, and catchError keeps streams resilient. In production search UIs, switchMap prevents older responses from overwriting newer results. Interview tip: explain unsubscribe strategy through async pipe or takeUntilDestroyed.', ['rxjs', 'observables']],
    ['medium', 'How do Angular guards and interceptors support production apps?', 'Guards protect routes by deciding whether navigation can proceed, while interceptors transform or handle HTTP requests globally. A production app uses guards for authenticated pages and interceptors for auth headers, retry policy, error mapping, and observability. Common mistake: putting business logic into every component instead of centralizing cross-cutting behavior. Interview tip: distinguish route concerns from transport concerns.', ['guards', 'interceptors']],
    ['hard', 'How would you structure a large Angular application?', 'A large Angular app should organize features around routes and domains, keep shared UI separate from business services, and lazy-load heavy areas. Use smart container components, typed API services, route-level providers where useful, and consistent state boundaries. Example: admin, dashboard, and interview-prep modules should not leak local state into each other. Interview tip: discuss maintainability and bundle size together.', ['architecture', 'lazy-loading']]
  ],
  nodejs: [
    ['medium', 'How does the Node.js event loop handle asynchronous work?', 'Node.js uses a single JavaScript thread with an event loop that coordinates timers, I/O callbacks, promises, and other phases while libuv handles many async operations. This lets Node serve many concurrent I/O-heavy requests without one thread per connection. Production risk appears when CPU-heavy work blocks the loop. Interview tip: mention microtasks, macrotasks, and why blocking JSON parsing can hurt latency.', ['event-loop', 'async']],
    ['hard', 'When should you use Node.js streams?', 'Streams process data in chunks instead of loading everything into memory. They are ideal for file uploads, logs, CSV exports, video responses, and proxying large API payloads. Backpressure prevents producers from overwhelming consumers. Example: piping a large report to the response avoids a memory spike. Interview tip: define readable, writable, transform streams, and backpressure.', ['streams', 'backpressure']],
    ['hard', 'How do clustering and worker threads differ in Node.js?', 'Clustering runs multiple Node processes to use multiple CPU cores for request handling, while worker threads run CPU-heavy JavaScript in separate threads inside a process. Use clustering for web throughput and worker threads for CPU-bound tasks like image processing or scoring. Common mistake: expecting async I/O to need worker threads. Interview tip: connect the choice to CPU vs I/O bottlenecks.', ['clustering', 'worker-threads']],
    ['medium', 'How should errors be handled in an Express or Node API?', 'Production Node APIs should centralize error handling, preserve status codes, avoid leaking internals, and log enough context for diagnosis. Async route errors should be forwarded to middleware or wrapped consistently. Example: validation errors return 400, auth errors return 401 or 403, and unexpected failures return a generic 500. Interview tip: distinguish operational errors from programmer bugs.', ['error-handling', 'express']],
    ['hard', 'How do you protect a Node.js API from overload?', 'Use rate limiting, request size limits, timeouts, connection limits, queueing, circuit breakers, and observability. Cache expensive reads and move CPU-heavy work to jobs or worker threads. In production, monitor event-loop delay and p95 latency to detect overload early. Interview tip: mention graceful degradation instead of only scaling horizontally.', ['scalability', 'rate-limiting']]
  ],
  mongodb: [
    ['medium', 'How do MongoDB indexes improve query performance?', 'MongoDB indexes store searchable fields in a structure that avoids scanning every document. Good indexes match frequent filters, sort patterns, and cardinality. In production, use explain plans to verify IXSCAN instead of COLLSCAN. Example: an index on { userId: 1, createdAt: -1 } supports a user activity feed. Interview tip: discuss write overhead and index selectivity.', ['indexing', 'query-performance']],
    ['hard', 'How does the MongoDB aggregation pipeline work?', 'The aggregation pipeline processes documents through ordered stages such as $match, $group, $lookup, $project, and $sort. Put selective $match stages early to reduce work, and index fields used before blocking stages. Real-world use cases include analytics dashboards, reports, and denormalized summaries. Interview tip: explain memory limits and when to precompute results.', ['aggregation', 'pipeline']],
    ['hard', 'When should you use embedding versus referencing in MongoDB schema design?', 'Embed data that is read together and has bounded growth; reference data that is shared, large, or changes independently. An order can embed line items, while users and organizations are often referenced. Production tradeoffs include atomic updates, document size, duplication, and query patterns. Interview tip: schema design in MongoDB starts from access patterns, not normalization rules.', ['schema-design', 'embedding']],
    ['hard', 'What is MongoDB sharding and when is it needed?', 'Sharding distributes data across multiple shards using a shard key so a cluster can scale storage and throughput. It is needed when a single replica set cannot handle data size or traffic. A poor shard key can create hot shards or scatter-gather queries. Interview tip: discuss cardinality, write distribution, and query targeting.', ['sharding', 'scaling']],
    ['medium', 'How do transactions work in MongoDB?', 'MongoDB supports multi-document ACID transactions for cases where related writes must commit or roll back together. They are useful for financial or inventory flows, but they add overhead and should not replace good document modeling. In production, keep transactions short and retry transient failures. Interview tip: mention that single-document writes are already atomic.', ['transactions', 'acid']]
  ],
  'system-design': [
    ['hard', 'How would you design a rate limiter for a public API?', 'A production rate limiter tracks request counts per identity across a time window using algorithms like token bucket, leaky bucket, or sliding window. Redis is commonly used for shared counters with TTLs or Lua scripts for atomicity. Consider burst handling, distributed nodes, headers, and abuse detection. Interview tip: state the algorithm and why it fits the traffic pattern.', ['rate-limiting', 'redis']],
    ['hard', 'How would you design a URL shortener?', 'A URL shortener needs key generation, redirect reads, URL storage, analytics, abuse controls, and high availability. Use base62 IDs or generated slugs, cache hot redirects, and store mappings in a durable database. Consider collision handling, expiration, custom aliases, and read-heavy scaling. Interview tip: lead with requirements and traffic estimates before choosing storage.', ['url-shortener', 'scalability']],
    ['hard', 'How do you design a notification system?', 'A notification system accepts events, stores preferences, fans out messages through queues, and delivers through email, push, SMS, or in-app channels. Production concerns include retries, idempotency, templates, user opt-outs, provider failures, and observability. Interview tip: separate event ingestion from delivery workers.', ['queues', 'notifications']],
    ['hard', 'How would you design a real-time chat system?', 'A chat system needs connection management, message persistence, delivery acknowledgements, presence, ordering, and offline sync. WebSockets handle real-time delivery, while queues and databases provide durability and fanout. Production design should address reconnects, multi-device state, and horizontal scaling. Interview tip: clarify one-to-one vs group chat early.', ['websockets', 'chat']],
    ['hard', 'How would you design search for a marketplace?', 'Marketplace search combines indexing, ranking, filtering, typo tolerance, and freshness. A search engine such as Elasticsearch or OpenSearch stores searchable documents while the primary database remains source of truth. Production systems sync changes through events and handle stale indexes gracefully. Interview tip: separate retrieval from ranking and personalization.', ['search', 'ranking']]
  ]
};

topicSeeds.javascript = [
  ['medium', 'How do closures work in JavaScript?', 'A closure is created when a function remembers variables from its lexical scope after that outer function has returned. Closures power callbacks, module privacy, and factory functions. In production, they are useful for encapsulating state but can accidentally retain memory if large objects stay referenced. Interview tip: explain lexical scope with a small counter or event-handler example.', ['closures', 'scope']],
  ['medium', 'What is the difference between promises, async/await, and callbacks in JavaScript?', 'Callbacks pass a function to run later, promises represent a future value, and async/await is syntax that makes promise flows easier to read. Production code prefers promises and async/await for error handling and composition. Example: await fetchData() inside try/catch is clearer than nested callbacks. Interview tip: mention that async functions always return promises.', ['promises', 'async-await']],
  ['hard', 'How does prototypal inheritance work in JavaScript?', 'Objects in JavaScript can delegate property lookup to another object through their prototype chain. Classes are syntax over this prototype model. Production relevance appears in shared methods, object creation, and debugging unexpected inherited properties. Interview tip: distinguish prototype from __proto__ and constructor.prototype.', ['prototypes', 'inheritance']]
];
topicSeeds.typescript = [
  ['medium', 'How do interfaces and type aliases differ in TypeScript?', 'Interfaces are extendable object shape declarations, while type aliases can represent unions, intersections, primitives, tuples, and mapped types. Interfaces can merge declarations; type aliases cannot. Production teams often use interfaces for public object contracts and types for composition-heavy models. Interview tip: show that both can type object shapes, then explain where they diverge.', ['interfaces', 'types']],
  ['hard', 'How do generics improve reusable TypeScript code?', 'Generics let functions, classes, and types preserve relationships between inputs and outputs without using any. Example: function identity<T>(value: T): T keeps the returned type tied to the argument. Production use cases include API response wrappers, repository helpers, and reusable UI components. Interview tip: explain constraints such as T extends { id: string }.', ['generics', 'type-safety']],
  ['hard', 'What is type narrowing in TypeScript?', 'Type narrowing refines a union type using runtime checks like typeof, in, discriminant fields, or custom type guards. It lets code safely access fields after proving which variant is present. Production APIs often use discriminated unions for status-specific payloads. Interview tip: connect compile-time safety to runtime checks.', ['narrowing', 'unions']]
];
topicSeeds.expressjs = topicSeeds.nodejs;
topicSeeds.nextjs = [
  ['medium', 'How does Next.js routing differ from a client-only React app?', 'Next.js provides filesystem-based routing, server rendering options, layouts, and API/server functionality depending on the router. Unlike a client-only React app, it can render pages on the server for faster first load and SEO. Production design considers static generation, server rendering, and caching per route. Interview tip: clarify App Router versus Pages Router when relevant.', ['routing', 'ssr']],
  ['hard', 'When should you use SSR, SSG, or ISR in Next.js?', 'SSR renders per request for highly dynamic data, SSG builds static pages ahead of time, and ISR regenerates static pages after a configured interval. Use SSG for docs or marketing, SSR for personalized dashboards, and ISR for catalog pages that change periodically. Interview tip: tie rendering mode to freshness, performance, and infrastructure cost.', ['ssr', 'ssg', 'isr']],
  ['medium', 'How do API routes or server actions fit into a Next.js application?', 'They let a Next.js app execute trusted server-side code for mutations, data access, or backend-for-frontend logic. Production code must validate input, protect secrets, and avoid mixing heavy backend domains into UI code. Interview tip: distinguish server-side execution from browser code and explain security benefits.', ['server-actions', 'api-routes']]
];
topicSeeds.redis = [
  ['medium', 'How is Redis used for caching in production systems?', 'Redis stores frequently accessed data in memory to reduce database load and latency. Production caching needs key design, TTLs, invalidation strategy, serialization, and monitoring hit rate. Example: cache dashboard summaries per user with a short TTL. Interview tip: always discuss stale data and cache invalidation tradeoffs.', ['caching', 'ttl']],
  ['hard', 'How do you prevent a cache stampede with Redis?', 'A cache stampede happens when many requests rebuild the same expired value at once. Mitigations include request coalescing, distributed locks, stale-while-revalidate, jittered TTLs, and background refresh. Production systems often serve slightly stale data while one worker refreshes. Interview tip: mention both locking and avoiding synchronized expiration.', ['cache-stampede', 'locks']],
  ['medium', 'What Redis data structures are useful beyond strings?', 'Redis supports hashes, lists, sets, sorted sets, streams, bitmaps, and HyperLogLog. Sorted sets are useful for leaderboards, streams for event processing, and sets for membership checks. Production design should choose structures based on access patterns and memory cost. Interview tip: give a concrete use case for at least two structures.', ['data-structures', 'streams']]
];
topicSeeds.graphql = [
  ['medium', 'How does GraphQL solve over-fetching and under-fetching?', 'GraphQL lets clients request exactly the fields they need from a typed schema, reducing extra payloads and multiple round trips. Production APIs still need query complexity limits, caching strategy, and authorization per field or resolver. Interview tip: compare it with REST without claiming GraphQL is always better.', ['schema', 'queries']],
  ['hard', 'What is the N+1 problem in GraphQL and how do you fix it?', 'The N+1 problem occurs when resolvers issue one database query per parent row. Fix it with batching and caching tools such as DataLoader, better joins, or precomputed projections. Production monitoring should track resolver latency and query count. Interview tip: explain the issue with users and posts to make it concrete.', ['n-plus-one', 'dataloader']],
  ['medium', 'How do mutations work in GraphQL?', 'Mutations are schema fields intended to change server state and return typed payloads. Production mutations should validate input, enforce auth, handle idempotency when needed, and return useful error structures. Interview tip: mention that GraphQL does not remove backend transaction or authorization responsibilities.', ['mutations', 'validation']]
];
topicSeeds['rest-apis'] = [
  ['medium', 'What makes a REST API well-designed?', 'A good REST API uses resource-oriented URLs, correct HTTP methods, meaningful status codes, predictable error payloads, pagination, filtering, and versioning strategy. Production APIs also require auth, rate limits, observability, and documentation. Interview tip: explain idempotency for PUT and DELETE.', ['http', 'api-design']],
  ['hard', 'How do you design pagination for a high-volume REST API?', 'Offset pagination is simple but can become slow or inconsistent on changing datasets. Cursor pagination uses a stable sort key to page efficiently and reliably. Production feeds often use cursor pagination with createdAt and id. Interview tip: discuss tradeoffs rather than presenting one universal answer.', ['pagination', 'cursor']],
  ['medium', 'How should REST APIs handle errors?', 'REST APIs should return appropriate status codes with consistent machine-readable error bodies. Validation errors need field details, auth failures should not leak sensitive information, and unexpected errors should be logged server-side. Interview tip: distinguish 400, 401, 403, 404, 409, and 500.', ['errors', 'status-codes']]
];

const buildPopularity = (index) => 100 - (index % 30);

const buildTopicDimensions = (topic) => ({
  stack: topic.type === 'stack' ? [topic.key] : [],
  technology: topic.type === 'technology' ? [topic.key] : [],
  language: topic.type === 'language' ? [topic.key] : [],
  framework: topic.type === 'framework' ? [topic.key] : []
});

const getTopicSeedItems = (topicKey = '') => topicSeeds[String(topicKey || '').trim().toLowerCase()] || [];

const buildSeedRecordsForTopic = (topic) => {
  return getTopicSeedItems(topic.key).map(([difficulty, questionText, answerText, tags], index) => {
    const question = normalizeQuestionText(questionText);
    const answer = normalizeAnswerText(answerText);

    return {
      topicKey: topic.key,
      topicType: topic.type,
      topicDimensions: buildTopicDimensions(topic),
      skill: normalizeTopicInput({ topic: topic.key }).skill,
      question,
      answer,
      normalizedQuestion: normalizeComparableText(question),
      normalizedAnswer: normalizeComparableText(answer),
      difficulty,
      tags: sanitizeTags([topic.key, topic.type, 'seed', SEED_VERSION, ...(tags || [])]),
      source: 'prebuilt',
      sourceType: 'prebuilt',
      sourceMeta: {
        seedVersion: SEED_VERSION,
        seededAt: new Date().toISOString()
      },
      confidenceScore: 0.97,
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

module.exports = {
  SEED_VERSION,
  topicSeeds,
  getTopicSeedItems,
  buildSeedRecordsForTopic,
  getImportantTopicByKey
};
