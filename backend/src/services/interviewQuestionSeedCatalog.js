const { listImportantTopics, normalizeTopicInput } = require('./interviewTopicNormalizer');
const {
  normalizeComparableText,
  normalizeQuestionText,
  normalizeAnswerText,
  sanitizeTags
} = require('./interviewQuestionQualityService');

const QUESTION_TEMPLATES = [
  {
    difficulty: 'easy',
    question: (label) => `What is ${label}, and where is it typically used in production systems?`,
    answer: (label) => `${label} is used to solve a specific class of engineering problems. A strong answer should define its purpose, explain common use cases, and show a practical example from a real product flow.`
  },
  {
    difficulty: 'easy',
    question: (label) => `What are the core building blocks of ${label}?`,
    answer: (label) => `Break ${label} into its core primitives, explain each primitive responsibility, and show how they combine in a minimal implementation used by teams in production.`
  },
  {
    difficulty: 'easy',
    question: (label) => `How do you get started with ${label} in a maintainable way?`,
    answer: (label) => `Describe a setup strategy for ${label} that includes project structure, coding conventions, testing basics, and an incremental rollout approach to avoid architectural drift.`
  },
  {
    difficulty: 'easy',
    question: (label) => `What common mistakes do beginners make with ${label}, and how do you avoid them?`,
    answer: (label) => `Highlight common anti-patterns in ${label}, explain why they cause reliability or maintainability issues, and provide practical guardrails used by experienced teams.`
  },
  {
    difficulty: 'easy',
    question: (label) => `How do you explain ${label} to a non-technical stakeholder?`,
    answer: (label) => `Use a business-oriented explanation: what ${label} enables, how it reduces risk or increases delivery speed, and one measurable outcome a team can track.`
  },
  {
    difficulty: 'easy',
    question: (label) => `When should you choose ${label}, and when should you avoid it?`,
    answer: (label) => `Compare where ${label} delivers clear value versus where it introduces unnecessary complexity. Include constraints such as team skill, performance requirements, and operational overhead.`
  },
  {
    difficulty: 'medium',
    question: (label) => `How do you structure a scalable architecture around ${label}?`,
    answer: (label) => `Discuss boundaries, modularity, performance bottlenecks, and observability. Include concrete tactics for scaling ${label} under increasing traffic while preserving maintainability.`
  },
  {
    difficulty: 'medium',
    question: (label) => `How would you debug a production issue related to ${label}?`,
    answer: (label) => `Outline a systematic debugging workflow: reproduce, isolate, inspect telemetry, form hypotheses, test fixes safely, and validate with post-fix monitoring and regression checks.`
  },
  {
    difficulty: 'medium',
    question: (label) => `How do performance optimizations differ in ${label} between development and production?`,
    answer: (label) => `Explain why local benchmarks can be misleading, identify production-grade bottlenecks, and describe realistic optimization tactics with measurable KPIs and rollback plans.`
  },
  {
    difficulty: 'medium',
    question: (label) => `How do you design a testing strategy for systems built with ${label}?`,
    answer: (label) => `Cover unit, integration, and end-to-end testing responsibilities in ${label}-based systems. Include mocking boundaries, contract tests, and flake reduction practices.`
  },
  {
    difficulty: 'medium',
    question: (label) => `How do you handle version upgrades and migrations in ${label}?`,
    answer: (label) => `Describe compatibility checks, incremental rollout, feature flags, rollback readiness, and validation gates to safely upgrade ${label} in live environments.`
  },
  {
    difficulty: 'medium',
    question: (label) => `How would you secure an application that heavily uses ${label}?`,
    answer: (label) => `Discuss threat modeling, authentication and authorization controls, input validation, dependency hygiene, secret management, and incident response for ${label}-centric architectures.`
  },
  {
    difficulty: 'medium',
    question: (label) => `How do caching and invalidation strategies work with ${label}?`,
    answer: (label) => `Explain cache placement options, TTL versus event-based invalidation, consistency tradeoffs, and monitoring metrics used to validate cache effectiveness.`
  },
  {
    difficulty: 'medium',
    question: (label) => `How would you improve developer productivity in a large ${label} codebase?`,
    answer: (label) => `Address tooling, code review standards, CI feedback loops, automation, and architectural conventions that reduce cognitive load and accelerate delivery.`
  },
  {
    difficulty: 'medium',
    question: (label) => `What observability signals are most important for ${label}?`,
    answer: (label) => `Identify key logs, metrics, and traces for ${label}, define SLO-oriented dashboards, and explain how to use alerts to reduce mean time to detect and resolve incidents.`
  },
  {
    difficulty: 'hard',
    question: (label) => `How would you design a fault-tolerant system where ${label} is a critical dependency?`,
    answer: (label) => `Explain failure modes, graceful degradation, backpressure, retries with jitter, circuit breakers, and recovery playbooks that keep user-facing functionality resilient.`
  },
  {
    difficulty: 'hard',
    question: (label) => `What tradeoffs would you evaluate before introducing ${label} into an existing platform?`,
    answer: (label) => `Discuss operational cost, migration complexity, team skill readiness, performance characteristics, and long-term maintenance burden before introducing ${label}.`
  },
  {
    difficulty: 'hard',
    question: (label) => `How would you model and benchmark scalability limits of ${label}?`,
    answer: (label) => `Define throughput, latency, and resource saturation goals, then describe realistic load testing methodology, bottleneck isolation, and optimization iterations for ${label}.`
  },
  {
    difficulty: 'hard',
    question: (label) => `How do you design multi-tenant capabilities around ${label} without sacrificing performance?`,
    answer: (label) => `Compare isolation models, tenancy boundaries, noisy-neighbor mitigation, and data access controls. Explain how to monitor fairness and cost across tenants.`
  },
  {
    difficulty: 'hard',
    question: (label) => `If a major production incident is traced to ${label}, how do you run a high-quality postmortem?`,
    answer: (label) => `Include timeline reconstruction, contributing factors, remediation priorities, ownership, and preventative controls tied to measurable follow-up outcomes.`
  }
];

const buildPopularity = (index) => 90 - (index % 20);

const buildTopicDimensions = (topic) => ({
  stack: topic.type === 'stack' ? [topic.key] : [],
  technology: topic.type === 'technology' ? [topic.key] : [],
  language: topic.type === 'language' ? [topic.key] : [],
  framework: topic.type === 'framework' ? [topic.key] : []
});

const buildSeedRecordsForTopic = (topic) => {
  return QUESTION_TEMPLATES.map((template, index) => {
    const question = normalizeQuestionText(template.question(topic.label, topic.type));
    const answer = normalizeAnswerText(template.answer(topic.label, topic.type));

    return {
      topicKey: topic.key,
      topicType: topic.type,
      topicDimensions: buildTopicDimensions(topic),
      skill: normalizeTopicInput({ topic: topic.key }).skill,
      question,
      answer,
      normalizedQuestion: normalizeComparableText(question),
      normalizedAnswer: normalizeComparableText(answer),
      difficulty: template.difficulty,
      tags: sanitizeTags([topic.key, topic.type, 'prebuilt', `seed_set_${index + 1}`]),
      source: 'prebuilt',
      sourceType: 'prebuilt',
      sourceMeta: {
        seedVersion: 'v2',
        seededAt: new Date().toISOString()
      },
      confidenceScore: 0.95,
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
  QUESTION_TEMPLATES,
  buildSeedRecordsForTopic,
  getImportantTopicByKey
};
