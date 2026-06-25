const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const docsDir = path.join(root, 'docs');
const requiredFeatureSections = [
  'Files To Modify',
  'Dependencies',
  'Request Flow',
  'Change Impact',
  'Testing Files',
  'Common Pitfalls'
];
const requiredDocs = [
  'docs/PROJECT_INDEX.md',
  'docs/DOCUMENTATION_POLICY.md',
  'docs/VERIFY_DOCUMENTATION.md',
  'docs/agent/AGENT_RULES.md',
  'docs/agent/CODING_AGENT_CONTEXT.md',
  'docs/agent/COMMON_TASKS.md',
  'docs/agent/CHANGE_IMPACT.md'
];

const failures = [];

const walk = (dir) => {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(fullPath) : [fullPath];
  });
};

const exists = (relativePath) => fs.existsSync(path.join(root, relativePath));

for (const doc of requiredDocs) {
  if (!exists(doc)) failures.push(`Missing required doc: ${doc}`);
}

const markdownFiles = [
  ...walk(docsDir).filter((file) => file.endsWith('.md')),
  path.join(root, 'README.md')
].filter((file) => fs.existsSync(file));

const linkPattern = /\[[^\]]+\]\(([^)]+)\)/g;
for (const file of markdownFiles) {
  const content = fs.readFileSync(file, 'utf8');
  const baseDir = path.dirname(file);
  for (const match of content.matchAll(linkPattern)) {
    const rawLink = match[1].trim();
    if (!rawLink || rawLink.startsWith('#') || /^[a-z]+:/i.test(rawLink) || rawLink.startsWith('mailto:')) {
      continue;
    }
    const [linkPath] = rawLink.split('#');
    if (!linkPath) continue;
    const target = path.resolve(baseDir, linkPath);
    if (!fs.existsSync(target)) {
      failures.push(`Broken link in ${path.relative(root, file)}: ${rawLink}`);
    }
  }
}

const indexPath = path.join(docsDir, 'PROJECT_INDEX.md');
const index = fs.readFileSync(indexPath, 'utf8');
const featureLinks = [...index.matchAll(/\]\((features\/[^)]+\.md)\)/g)].map((match) => match[1]);
if (!featureLinks.length) failures.push('PROJECT_INDEX.md has no feature document links.');
for (const link of featureLinks) {
  if (!fs.existsSync(path.join(docsDir, link))) {
    failures.push(`PROJECT_INDEX.md points to missing feature doc: ${link}`);
  }
}

const featureDocs = walk(path.join(docsDir, 'features')).filter((file) => file.endsWith('.md'));
for (const file of featureDocs) {
  const content = fs.readFileSync(file, 'utf8');
  for (const section of requiredFeatureSections) {
    if (!content.includes(`## ${section}`)) {
      failures.push(`${path.relative(root, file)} missing section: ${section}`);
    }
  }
}

if (failures.length) {
  console.error('Documentation verification failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Documentation verification passed (${markdownFiles.length} markdown files, ${featureDocs.length} feature docs).`);
