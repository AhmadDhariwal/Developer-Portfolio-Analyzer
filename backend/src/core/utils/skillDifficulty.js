/**
 * Skill difficulty ratings (0–1).
 * Higher = harder to learn = more score impact when added.
 */
module.exports = {
  // Easy (0.6–0.7)
  html: 0.6, css: 0.65, git: 0.6, markdown: 0.5,
  // Medium (0.75–0.85)
  javascript: 0.8, typescript: 0.82, react: 0.78, angular: 0.82,
  vue: 0.76, 'node.js': 0.78, node: 0.78, express: 0.72,
  python: 0.75, sql: 0.72, mongodb: 0.72, postgresql: 0.75,
  docker: 0.78, graphql: 0.80, 'rest api': 0.70,
  jest: 0.72, sass: 0.65, tailwind: 0.65,
  // Hard (0.88–1.0)
  kubernetes: 0.92, terraform: 0.90, aws: 0.88, azure: 0.87, gcp: 0.87,
  'machine learning': 0.92, 'deep learning': 0.95, pytorch: 0.90, tensorflow: 0.90,
  'system design': 0.92, microservices: 0.88, 'spring boot': 0.85,
  golang: 0.85, rust: 0.95, java: 0.82,
  mlops: 0.90, nlp: 0.90, 'computer vision': 0.90,
  'web performance': 0.80, accessibility: 0.75,
  default: 0.75
};
