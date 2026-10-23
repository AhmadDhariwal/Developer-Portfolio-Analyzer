// Reviewed public taxonomy for aliases, categorization, prewarming and fixed feeds.
// Free-text searches are validated separately in newsQuery; requests cannot add
// repositories, feed URLs or taxonomy entries. Keep this registry at most 64 topics.
const TOPICS = Object.freeze({
  javascript: { repo: 'tc39/ecma262', tag: 'javascript', ecosystem: 'npm', category: 'Frontend' },
  typescript: { repo: 'microsoft/TypeScript', tag: 'javascript', ecosystem: 'npm', category: 'Frontend' },
  react: { repo: 'facebook/react', tag: 'javascript', ecosystem: 'npm', category: 'Frontend' },
  angular: { repo: 'angular/angular', tag: 'javascript', ecosystem: 'npm', category: 'Frontend' },
  vue: { repo: 'vuejs/core', tag: 'javascript', ecosystem: 'npm', category: 'Frontend' },
  node: { repo: 'nodejs/node', tag: 'nodejs', ecosystem: 'npm', category: 'Backend', aliases: ['node.js', 'nodejs'] },
  python: { repo: 'python/cpython', tag: 'python', ecosystem: 'pip', category: 'AI / ML' },
  rust: { repo: 'rust-lang/rust', tag: 'rust', ecosystem: 'rust', category: 'Backend' },
  golang: { repo: 'golang/go', tag: 'go', ecosystem: 'go', category: 'Backend', aliases: ['go', 'go lang'] },
  docker: { repo: 'moby/moby', tag: 'devops', category: 'DevOps', terms: ['docker', 'moby'] },
  kubernetes: { repo: 'kubernetes/kubernetes', tag: 'devops', category: 'DevOps', aliases: ['k8s'] },
  devops: {
    tag: 'devops',
    category: 'DevOps',
    aliases: ['dev ops'],
    terms: ['devops', 'ci/cd', 'gitops', 'kubernetes', 'terraform', 'docker', 'observability']
  },
  cicd: {
    tag: 'devops',
    category: 'DevOps',
    aliases: ['ci/cd', 'ci cd', 'ci-cd', 'continuous integration', 'continuous delivery', 'continuous deployment'],
    terms: [
      'ci/cd',
      'ci cd',
      'ci-cd',
      'continuous integration',
      'continuous delivery',
      'continuous deployment',
      'github actions',
      'gitlab ci',
      'jenkins',
      'tekton'
    ]
  },
  cloud: {
    tag: 'devops',
    category: 'DevOps',
    aliases: ['cloud computing'],
    terms: ['cloud', 'aws', 'azure', 'gcp', 'amazon web services', 'google cloud']
  },
  aws: {
    tag: 'devops',
    category: 'DevOps',
    aliases: ['amazon web services'],
    terms: ['aws', 'amazon web services', 'amazon ec2', 'amazon eks', 'amazon s3']
  },
  azure: { tag: 'devops', category: 'DevOps', aliases: ['microsoft azure'] },
  gcp: { tag: 'devops', category: 'DevOps', aliases: ['google cloud', 'google cloud platform'] },
  terraform: { repo: 'hashicorp/terraform', tag: 'devops', category: 'DevOps' },
  gitops: {
    tag: 'devops',
    category: 'DevOps',
    aliases: ['git ops'],
    terms: ['gitops', 'argo cd', 'argocd', 'fluxcd', 'flux cd']
  },
  argocd: { repo: 'argoproj/argo-cd', tag: 'devops', category: 'DevOps', aliases: ['argo cd'] },
  ansible: { repo: 'ansible/ansible', tag: 'devops', category: 'DevOps' },
  observability: {
    tag: 'devops',
    category: 'DevOps',
    terms: ['observability', 'opentelemetry', 'prometheus', 'grafana']
  },
  linux: { tag: 'linux', category: 'DevOps' },
  security: {
    tag: 'security',
    category: 'Cybersecurity',
    aliases: ['cybersecurity', 'cyber security', 'infosec', 'information security'],
    terms: ['security', 'cybersecurity', 'vulnerability', 'advisory', 'cve']
  },
  devsecops: { tag: 'security', category: 'Cybersecurity', aliases: ['dev sec ops'] },
  ai: {
    tag: 'ai',
    category: 'AI / ML',
    aliases: ['artificial intelligence', 'ai/ml', 'ai / ml'],
    terms: ['artificial intelligence', 'ai', 'machine learning', 'llm', 'language model']
  },
  ml: { tag: 'ai', category: 'AI / ML', aliases: ['machine learning', 'deep learning'] },
  llm: {
    tag: 'ai',
    category: 'AI / ML',
    aliases: ['large language models', 'large language model'],
    terms: ['llm', 'language model']
  },
  pytorch: { repo: 'pytorch/pytorch', tag: 'ai', ecosystem: 'pip', category: 'AI / ML' },
  tensorflow: { repo: 'tensorflow/tensorflow', tag: 'ai', ecosystem: 'pip', category: 'AI / ML' },
  sql: { tag: 'databases', category: 'Backend' },
  postgres: { repo: 'postgres/postgres', tag: 'databases', category: 'Backend', aliases: ['postgresql'] },
  redis: { repo: 'redis/redis', tag: 'databases', category: 'Backend' },
  mongodb: { tag: 'databases', category: 'Backend', aliases: ['mongo db'] },
  kafka: { repo: 'apache/kafka', tag: 'distributed', category: 'Backend', aliases: ['apache kafka'] },
  java: { tag: 'java', ecosystem: 'maven', category: 'Backend' },
  dotnet: {
    repo: 'dotnet/runtime',
    tag: 'dotnet',
    ecosystem: 'nuget',
    category: 'Backend',
    aliases: ['.net', 'c#', 'csharp']
  },
  gitlab: { tag: 'devops', category: 'DevOps', aliases: ['gitlab ci', 'gitlab ci/cd'] },
  githubactions: {
    repo: 'actions/runner',
    tag: 'devops',
    ecosystem: 'actions',
    category: 'DevOps',
    aliases: ['github actions']
  },
  webassembly: { tag: 'wasm', category: 'Frontend', aliases: ['wasm'] }
});
if (Object.keys(TOPICS).length > 64) throw new Error('News topic registry exceeds its storage budget');
const normalize = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
const index = new Map();
for (const [topic, config] of Object.entries(TOPICS))
  for (const name of [topic, ...(config.aliases || [])]) index.set(normalize(name), topic);
function topicFor(value) {
  return index.get(normalize(value).replace(/\s+(news|updates)$/, '')) || null;
}
function matchesTopic(item, topic) {
  const config = TOPICS[topic];
  if (!config) return false;
  const text = `${item.title || ''} ${item.description || ''} ${(item.tags || []).join(' ')}`;
  return [topic, ...(config.aliases || []), ...(config.terms || [])].some((term) =>
    new RegExp(`(^|[^a-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^a-z0-9])`, 'i').test(text)
  );
}
module.exports = { TOPICS, topicFor, matchesTopic };
