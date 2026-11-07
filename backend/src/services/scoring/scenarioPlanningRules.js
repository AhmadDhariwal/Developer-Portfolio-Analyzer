'use strict';
const deepFreeze = (value) => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
};
const roleWeights = deepFreeze({
  frontend: {
    react: 1.6,
    'react.js': 1.6,
    angular: 1.5,
    vue: 1.4,
    'vue.js': 1.4,
    javascript: 1.5,
    typescript: 1.4,
    css: 1.3,
    html: 1.2,
    sass: 1.1,
    tailwind: 1.2,
    graphql: 1.1,
    'next.js': 1.3,
    nuxt: 1.2,
    webpack: 1,
    vite: 1.1,
    jest: 1,
    'web performance': 1.2,
    accessibility: 1.1,
    default: 0.7,
  },
  backend: {
    'node.js': 1.6,
    node: 1.6,
    express: 1.4,
    python: 1.5,
    django: 1.4,
    fastapi: 1.3,
    flask: 1.2,
    java: 1.4,
    'spring boot': 1.4,
    mongodb: 1.3,
    postgresql: 1.3,
    mysql: 1.2,
    redis: 1.2,
    graphql: 1.2,
    'rest api': 1.3,
    microservices: 1.3,
    docker: 1.2,
    kubernetes: 1.1,
    aws: 1.2,
    typescript: 1.2,
    golang: 1.3,
    default: 0.7,
  },
  'full stack': {
    react: 1.4,
    angular: 1.3,
    vue: 1.3,
    'node.js': 1.4,
    node: 1.4,
    express: 1.3,
    javascript: 1.5,
    typescript: 1.4,
    mongodb: 1.2,
    postgresql: 1.2,
    docker: 1.2,
    graphql: 1.2,
    'next.js': 1.4,
    'rest api': 1.2,
    default: 0.8,
  },
  'ai/ml': {
    python: 1.7,
    tensorflow: 1.5,
    pytorch: 1.5,
    'machine learning': 1.6,
    'deep learning': 1.5,
    'scikit-learn': 1.4,
    pandas: 1.3,
    numpy: 1.3,
    'data science': 1.4,
    nlp: 1.4,
    'computer vision': 1.4,
    mlops: 1.3,
    'model deployment': 1.3,
    sql: 1.1,
    statistics: 1.3,
    default: 0.6,
  },
  devops: {
    docker: 1.6,
    kubernetes: 1.6,
    aws: 1.5,
    azure: 1.4,
    gcp: 1.4,
    terraform: 1.5,
    ansible: 1.3,
    'ci/cd': 1.5,
    'github actions': 1.4,
    jenkins: 1.3,
    linux: 1.4,
    bash: 1.3,
    prometheus: 1.2,
    grafana: 1.2,
    elk: 1.2,
    python: 1.1,
    golang: 1.2,
    default: 0.7,
  },
  default: {
    default: 1,
  },
});
const skillDifficulty = deepFreeze({
  html: 0.6,
  css: 0.65,
  git: 0.6,
  markdown: 0.5,
  javascript: 0.8,
  typescript: 0.82,
  react: 0.78,
  angular: 0.82,
  vue: 0.76,
  'node.js': 0.78,
  node: 0.78,
  express: 0.72,
  python: 0.75,
  sql: 0.72,
  mongodb: 0.72,
  postgresql: 0.75,
  docker: 0.78,
  graphql: 0.8,
  'rest api': 0.7,
  jest: 0.72,
  sass: 0.65,
  tailwind: 0.65,
  kubernetes: 0.92,
  terraform: 0.9,
  aws: 0.88,
  azure: 0.87,
  gcp: 0.87,
  'machine learning': 0.92,
  'deep learning': 0.95,
  pytorch: 0.9,
  tensorflow: 0.9,
  'system design': 0.92,
  microservices: 0.88,
  'spring boot': 0.85,
  golang: 0.85,
  rust: 0.95,
  java: 0.82,
  mlops: 0.9,
  nlp: 0.9,
  'computer vision': 0.9,
  'web performance': 0.8,
  accessibility: 0.75,
  default: 0.75,
});
const marketDemand = deepFreeze({
  react: 1.5,
  'react.js': 1.5,
  python: 1.4,
  typescript: 1.4,
  'node.js': 1.4,
  node: 1.4,
  aws: 1.4,
  docker: 1.3,
  kubernetes: 1.3,
  'machine learning': 1.4,
  'data science': 1.3,
  'system design': 1.4,
  microservices: 1.3,
  angular: 1.2,
  'next.js': 1.2,
  vue: 1.1,
  postgresql: 1.2,
  mongodb: 1.1,
  redis: 1.1,
  graphql: 1.2,
  terraform: 1.2,
  javascript: 1.2,
  golang: 1.2,
  pytorch: 1.2,
  tensorflow: 1.1,
  express: 1,
  flask: 0.95,
  django: 1,
  mysql: 0.95,
  sql: 1,
  java: 1,
  jest: 0.95,
  css: 0.9,
  html: 0.85,
  default: 0.9,
});
/**
 * Estimates effort in weeks for skills and projects.
 * Used to detect overloaded plans and apply penalties.
 */

const SKILL_EFFORT = {
  // Easy (0.5 weeks)
  html: 0.5,
  css: 0.5,
  markdown: 0.3,
  git: 0.5,
  tailwind: 0.5,
  sass: 0.5,
  // Medium (1–1.5 weeks)
  javascript: 1.5,
  react: 1.5,
  vue: 1.5,
  angular: 2.0,
  'node.js': 1.5,
  node: 1.5,
  express: 1.0,
  python: 1.5,
  mongodb: 1.0,
  postgresql: 1.0,
  sql: 1.0,
  redis: 0.8,
  docker: 1.0,
  graphql: 1.0,
  typescript: 1.0,
  // Hard (2–3 weeks)
  kubernetes: 2.5,
  terraform: 2.0,
  aws: 2.0,
  azure: 2.0,
  gcp: 2.0,
  'machine learning': 3.0,
  'deep learning': 3.0,
  pytorch: 2.5,
  tensorflow: 2.5,
  'system design': 2.0,
  microservices: 2.0,
  golang: 2.0,
  java: 2.0,
  mlops: 2.5,
  nlp: 2.5,
  'computer vision': 2.5,
  default: 1.0,
};

/**
 * Estimate total effort in weeks for a list of skills.
 */
const estimateSkillsEffort = (skills = [], safe = false) => {
  return skills.reduce((total, skill) => {
    const key = String(skill || '')
      .toLowerCase()
      .trim();
    return (
      total +
      ((safe && !Object.hasOwn(SKILL_EFFORT, key) ? undefined : SKILL_EFFORT[key]) ?? SKILL_EFFORT.default)
    );
  }, 0);
};

/**
 * Estimate total effort in weeks for a list of projects.
 * Projects already have a `weeks` field — we use that directly.
 */
const estimateProjectsEffort = (projects = []) => {
  return projects.reduce((total, p) => total + Number(p.weeks || 3), 0);
};

/**
 * Calculate overload penalty.
 * Returns a penalty score (0 = no penalty, higher = more penalty).
 * Also returns a human-readable warning string.
 */
const calcOverloadPenalty = (skillsEffort, projectsEffort, durationWeeks) => {
  const capacity = durationWeeks * 0.8; // 80% utilization is realistic
  const totalEffort = skillsEffort + projectsEffort;
  const overloadRatio = totalEffort / Math.max(1, capacity);

  if (overloadRatio <= 1.0) {
    return { penalty: 0, warning: null, overloadRatio };
  }
  if (overloadRatio <= 1.3) {
    return {
      penalty: Math.round((overloadRatio - 1.0) * 10),
      warning: 'Your plan is slightly ambitious for the given timeframe.',
      overloadRatio,
    };
  }
  if (overloadRatio <= 1.7) {
    return {
      penalty: Math.round((overloadRatio - 1.0) * 14),
      warning: 'This plan is overloaded — consider reducing skills or extending the timeline.',
      overloadRatio,
    };
  }
  return {
    penalty: Math.round(Math.min(20, (overloadRatio - 1.0) * 18)),
    warning: 'This plan is too aggressive. Scores will be significantly reduced.',
    overloadRatio,
  };
};

module.exports = Object.freeze({
  roleWeights,
  skillDifficulty,
  marketDemand,
  estimateSkillsEffort,
  estimateProjectsEffort,
  calcOverloadPenalty,
});
