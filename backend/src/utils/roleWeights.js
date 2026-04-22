/**
 * Role-based skill relevance weights.
 * Higher = more valuable for that role.
 */
module.exports = {
  frontend: {
    react: 1.6, 'react.js': 1.6,
    angular: 1.5, vue: 1.4, 'vue.js': 1.4,
    javascript: 1.5, typescript: 1.4,
    css: 1.3, html: 1.2, sass: 1.1, tailwind: 1.2,
    graphql: 1.1, 'next.js': 1.3, nuxt: 1.2,
    webpack: 1.0, vite: 1.1, jest: 1.0,
    'web performance': 1.2, accessibility: 1.1,
    default: 0.7
  },
  backend: {
    'node.js': 1.6, node: 1.6, express: 1.4,
    python: 1.5, django: 1.4, fastapi: 1.3, flask: 1.2,
    java: 1.4, 'spring boot': 1.4,
    mongodb: 1.3, postgresql: 1.3, mysql: 1.2, redis: 1.2,
    graphql: 1.2, 'rest api': 1.3, microservices: 1.3,
    docker: 1.2, kubernetes: 1.1, aws: 1.2,
    typescript: 1.2, golang: 1.3,
    default: 0.7
  },
  'full stack': {
    react: 1.4, angular: 1.3, vue: 1.3,
    'node.js': 1.4, node: 1.4, express: 1.3,
    javascript: 1.5, typescript: 1.4,
    mongodb: 1.2, postgresql: 1.2,
    docker: 1.2, graphql: 1.2,
    'next.js': 1.4, 'rest api': 1.2,
    default: 0.8
  },
  'ai/ml': {
    python: 1.7, tensorflow: 1.5, pytorch: 1.5,
    'machine learning': 1.6, 'deep learning': 1.5,
    'scikit-learn': 1.4, pandas: 1.3, numpy: 1.3,
    'data science': 1.4, nlp: 1.4, 'computer vision': 1.4,
    mlops: 1.3, 'model deployment': 1.3,
    sql: 1.1, statistics: 1.3,
    default: 0.6
  },
  devops: {
    docker: 1.6, kubernetes: 1.6,
    aws: 1.5, azure: 1.4, gcp: 1.4,
    terraform: 1.5, ansible: 1.3,
    'ci/cd': 1.5, 'github actions': 1.4, jenkins: 1.3,
    linux: 1.4, bash: 1.3,
    prometheus: 1.2, grafana: 1.2, elk: 1.2,
    python: 1.1, golang: 1.2,
    default: 0.7
  },
  default: { default: 1.0 }
};
