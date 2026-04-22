/**
 * Market demand multipliers (0.8–1.5).
 * Based on job posting frequency and hiring trends.
 */
module.exports = {
  // Very high demand (1.3–1.5)
  react: 1.5, 'react.js': 1.5,
  python: 1.4, typescript: 1.4,
  'node.js': 1.4, node: 1.4,
  aws: 1.4, docker: 1.3, kubernetes: 1.3,
  'machine learning': 1.4, 'data science': 1.3,
  'system design': 1.4, microservices: 1.3,
  // High demand (1.1–1.2)
  angular: 1.2, 'next.js': 1.2, vue: 1.1,
  postgresql: 1.2, mongodb: 1.1, redis: 1.1,
  graphql: 1.2, terraform: 1.2,
  javascript: 1.2, golang: 1.2,
  pytorch: 1.2, tensorflow: 1.1,
  // Medium demand (0.9–1.0)
  express: 1.0, flask: 0.95, django: 1.0,
  mysql: 0.95, sql: 1.0, java: 1.0,
  jest: 0.95, css: 0.9, html: 0.85,
  // Lower demand (0.8)
  default: 0.9
};
