const { createHash } = require('node:crypto');
const { TOPICS, topicFor, matchesTopic } = require('./newsTopics');

// Public, explicit search text only. Never build queries from account evidence.
const SYNONYMS = {
  ai: ['ai', 'artificial intelligence'],
  security: ['security', 'vulnerability', 'vulnerabilities', 'cve', 'advisory'],
  vulnerability: ['security', 'vulnerability', 'vulnerabilities', 'cve', 'advisory'],
  async: ['async', 'asynchronous', 'asyncio'],
  aws: ['aws', 'amazon web services'],
  nextjs: ['next.js', 'nextjs', 'next js'],
  vulnerabilities: ['vulnerability', 'vulnerabilities', 'security', 'cve', 'advisory'],
  kubernetes: ['kubernetes', 'k8s']
};
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const contains = (text, term) => new RegExp(`(^|[^a-z0-9])${escape(term)}(?=$|[^a-z0-9])`, 'i').test(text);

function queryFor(value) {
  if (typeof value !== 'string' || value.length > 80 || /[\x00-\x1f\x7f]/.test(value)) return null;
  let text = value.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!text || !/^[a-z0-9.+# /-]+$/.test(text) || /(?:www\.|localhost\b)|\b(?:or|and|not)\b/i.test(text)) return null;
  if (
    /^[-+/#]|(?:[a-z0-9]+\.){2}[a-z]|\.(?:com|org|io|dev)(?: |$)|\d{8}|[a-f0-9]{8}-[a-f0-9-]{20,}|\/[^ ]*\/|\.\.|[-+/#.]{3}/.test(
      text
    )
  )
    return null;
  text = text
    .replace(/artificial intelligence/g, 'ai')
    .replace(/next\s+js/g, 'next.js')
    .replace(/\bgenai\b/g, 'generative ai');
  const tokens = text.split(' ');
  if (tokens.length > 6 || tokens.some((token) => token.length > 32) || (text.match(/[a-z]/g) || []).length < 2)
    return null;
  const topic = topicFor(text);
  if (topic) return { text: topic, topic, key: topic, groups: [] };
  const significant = tokens.filter(
    (token) => !['news', 'updates', 'update', 'latest', 'the', 'for', 'in'].includes(token)
  );
  if (!significant.length) return null;
  const groups = significant.map((token) => SYNONYMS[token === 'next.js' ? 'nextjs' : token] || [token]);
  return { text, topic: null, key: `q-${createHash('sha256').update(text).digest('hex').slice(0, 32)}`, groups };
}

function matchesQuery(item, value) {
  const query = queryFor(value);
  if (!query) return false;
  if (query.topic) return matchesTopic(item, query.topic);
  const text = `${item.title || ''} ${item.description || ''} ${(item.tags || []).join(' ')}`;
  return query.groups.every((group) => group.some((term) => contains(text, term)));
}

function relatedTopic(value) {
  const query = queryFor(value);
  if (!query) return null;
  return query.topic || Object.keys(TOPICS).find((topic) => contains(query.text, topic)) || null;
}

module.exports = { queryFor, matchesQuery, relatedTopic };
