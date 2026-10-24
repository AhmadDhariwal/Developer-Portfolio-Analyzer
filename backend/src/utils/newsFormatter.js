const crypto = require('node:crypto');

const DEFAULT_IMAGE =
  'https://images.unsplash.com/photo-1518773553398-650c184e0bb3?auto=format&fit=crop&w=1200&q=80';

const FALLBACK_IMAGES = {
  Frontend: [
    'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=1200&q=80',
    'https://images.unsplash.com/photo-1461749280684-dccba630e2f6?auto=format&fit=crop&w=1200&q=80'
  ],
  Backend: [
    'https://images.unsplash.com/photo-1558494949-ef010cbdcc31?auto=format&fit=crop&w=1200&q=80',
    'https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&w=1200&q=80'
  ],
  'Full Stack': [
    'https://images.unsplash.com/photo-1516382799247-87df95d790b7?auto=format&fit=crop&w=1200&q=80',
    'https://images.unsplash.com/photo-1498050108023-c5249f4df085?auto=format&fit=crop&w=1200&q=80'
  ],
  'AI / ML': [
    'https://images.unsplash.com/photo-1550751827-4bd374c3f58b?auto=format&fit=crop&w=1200&q=80',
    'https://images.unsplash.com/photo-1620712943543-bcc4688e7485?auto=format&fit=crop&w=1200&q=80'
  ],
  DevOps: [
    'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=1200&q=80',
    'https://images.unsplash.com/photo-1558494949-ef010cbdcc31?auto=format&fit=crop&w=1200&q=80'
  ],
  Mobile: [
    'https://images.unsplash.com/photo-1512941937669-90a1b58e7e9c?auto=format&fit=crop&w=1200&q=80',
    'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?auto=format&fit=crop&w=1200&q=80'
  ],
  Cybersecurity: [
    'https://images.unsplash.com/photo-1563986768609-322da13575f3?auto=format&fit=crop&w=1200&q=80',
    'https://images.unsplash.com/photo-1510511233900-1c8b3dfbe8f5?auto=format&fit=crop&w=1200&q=80'
  ],
  Web3: [
    'https://images.unsplash.com/photo-1639762681485-074b7f938ba0?auto=format&fit=crop&w=1200&q=80',
    'https://images.unsplash.com/photo-1622630998477-20aa696ecb05?auto=format&fit=crop&w=1200&q=80'
  ],
  Default: [
    DEFAULT_IMAGE,
    'https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=1200&q=80'
  ]
};

const CATEGORY_KEYWORDS = {
  Frontend: ['frontend', 'react', 'angular', 'vue', 'css', 'javascript', 'typescript', 'web ui'],
  Backend: ['backend', 'api', 'node', 'express', 'database', 'server', 'microservice', 'golang', 'java'],
  'Full Stack': ['full stack', 'architecture', 'web app', 'saas', 'end-to-end'],
  'AI / ML': ['ai', 'ml', 'machine learning', 'llm', 'generative', 'neural', 'python', 'data science'],
  DevOps: ['devops', 'docker', 'kubernetes', 'ci/cd', 'observability', 'cloud', 'terraform'],
  Mobile: ['android', 'ios', 'react native', 'flutter', 'mobile app', 'swift', 'kotlin'],
  Cybersecurity: ['security', 'vulnerability', 'cyber', 'encryption', 'auth', 'exploit', 'zero trust'],
  Web3: ['web3', 'blockchain', 'solidity', 'ethereum', 'smart contract', 'defi', 'crypto']
};

const cleanText = (value = '') =>
  String(value || '')
    .replaceAll(/\s+/g, ' ')
    .trim();

const { safeNewsUrl: sanitizeHttpUrl } = require('./newsUrl');

const hashText = (value = '') =>
  Number.parseInt(
    crypto
      .createHash('sha256')
      .update(String(value || ''))
      .digest('hex')
      .slice(0, 8),
    16
  );

const stableId = (...parts) =>
  crypto
    .createHash('sha1')
    .update(parts.map((part) => cleanText(part).toLowerCase()).join('|'))
    .digest('hex')
    .slice(0, 16);

const pickFallbackImage = (category, title, description, source) => {
  const candidates = FALLBACK_IMAGES[category] || FALLBACK_IMAGES.Default;
  const seed = `${category}|${title}|${description}|${source}`;
  return candidates[hashText(seed) % candidates.length] || DEFAULT_IMAGE;
};

const normalizeDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  const timestamp = date.getTime();
  return Number.isFinite(timestamp) &&
    timestamp <= Date.now() + 300000 &&
    timestamp >= Date.now() - 35 * 86400000
    ? date
    : null;
};

const uniqueStrings = (values = [], limit = 6) => {
  const seen = new Set();
  const output = [];
  for (const value of values) {
    const normalized = cleanText(value);
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    output.push(normalized);
    if (output.length >= limit) break;
  }
  return output;
};

const inferCategory = (headline = '', summary = '') => {
  const text = `${headline} ${summary}`.toLowerCase();
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (
      keywords.some((keyword) =>
        new RegExp(`(^|[^a-z0-9])${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^a-z0-9])`, 'i').test(
          text
        )
      )
    )
      return category;
  }
  return 'Backend';
};

const normalizeItem = (item = {}) => {
  const title = cleanText(item.title).slice(0, 220);
  const description = cleanText(item.description).slice(0, 300);
  const source = cleanText(item.source) || 'Unknown';
  const url = sanitizeHttpUrl(item.url);
  const publishedAt = normalizeDate(item.publishedAt);
  if (
    title.length < 8 ||
    !url ||
    !publishedAt ||
    ![
      'NewsAPI',
      'GNews',
      'Hacker News',
      'Dev.to',
      'Reddit',
      'GitHub Releases',
      'GitHub Security Advisories',
      'Lobsters',
      'Kubernetes Blog',
      'Cloudflare Changelog'
    ].includes(source) ||
    /^\[(removed|deleted)\]$/i.test(title)
  )
    return null;
  const category = Object.hasOwn(CATEGORY_KEYWORDS, item.category)
    ? item.category
    : inferCategory(title, description);
  const tags = uniqueStrings(Array.isArray(item.tags) ? item.tags : [], 6);

  return {
    id: stableId(url || title, title, source),
    title,
    description,
    source,
    publisher: cleanText(item.publisher).slice(0, 120),
    attributionUrl: sanitizeHttpUrl(item.attributionUrl) || url,
    license: item.license === 'CC-BY-4.0' ? item.license : '',
    licenseUrl: item.license === 'CC-BY-4.0' ? 'https://creativecommons.org/licenses/by/4.0/' : '',
    url,
    image: sanitizeHttpUrl(item.image) || pickFallbackImage(category, title, description, source),
    publishedAt,
    category,
    popularity: Number.isFinite(Number(item.popularity))
      ? Math.max(0, Math.min(10000000, Number(item.popularity)))
      : 0,
    relevanceScore: Number(item.relevanceScore || 0),
    rankScore: Number(item.rankScore || 0),
    tags
  };
};

const fromNewsAPI = (payload) => {
  const articles = Array.isArray(payload?.articles) ? payload.articles.slice(0, 100) : [];
  return articles
    .filter((article) => article && typeof article === 'object')
    .map((article) =>
      normalizeItem({
        title: article.title,
        description: article.description,
        source: 'NewsAPI',
        publisher: article.source?.name,
        url: article.url,
        image: article.urlToImage,
        publishedAt: article.publishedAt,
        category: inferCategory(article.title, article.description)
      })
    )
    .filter(Boolean);
};

const fromGNews = (payload) => {
  const articles = Array.isArray(payload?.articles) ? payload.articles.slice(0, 100) : [];
  return articles
    .filter((article) => article && typeof article === 'object')
    .map((article) =>
      normalizeItem({
        title: article.title,
        description: article.description,
        source: 'GNews',
        publisher: article.source?.name,
        url: article.url,
        image: article.image,
        publishedAt: article.publishedAt,
        category: inferCategory(article.title, article.description)
      })
    )
    .filter(Boolean);
};

const fromHackerNews = (payload) => {
  const hits = Array.isArray(payload?.hits) ? payload.hits.slice(0, 100) : [];
  return hits
    .filter((hit) => hit && typeof hit === 'object')
    .map((hit) => {
      const discussionUrl = /^\d+$/.test(String(hit.objectID || ''))
        ? `https://news.ycombinator.com/item?id=${hit.objectID}`
        : '';
      return normalizeItem({
        title: hit.title || hit.story_title,
        description: '',
        source: 'Hacker News',
        attributionUrl: discussionUrl || hit.url || hit.story_url,
        url: hit.url || hit.story_url || discussionUrl,
        image: '',
        publishedAt: hit.created_at,
        popularity: Number(hit.points || 0),
        category: inferCategory(hit.title || hit.story_title, hit.story_text),
        tags: ['Hacker News']
      });
    })
    .filter(Boolean);
};

const fromDevTo = (payload) => {
  const articles = Array.isArray(payload) ? payload.slice(0, 100) : [];
  return articles
    .filter((article) => article && typeof article === 'object')
    .map((article) =>
      normalizeItem({
        title: article.title,
        description: article.description,
        source: 'Dev.to',
        publisher: article.user?.name,
        url: article.url,
        image: article.social_image,
        publishedAt: article.published_at,
        popularity: Number(article.public_reactions_count || 0) + Number(article.comments_count || 0),
        tags: Array.isArray(article.tag_list) ? article.tag_list : [],
        category: inferCategory(article.title, article.description)
      })
    )
    .filter(Boolean);
};

const fromReddit = (payload) => {
  const posts = Array.isArray(payload?.data?.children) ? payload.data.children.slice(0, 100) : [];
  return posts
    .filter(
      (child) =>
        child?.data &&
        !child.data.removed_by_category &&
        !/^\[(removed|deleted)\]$/i.test(String(child.data.selftext || ''))
    )
    .map((child) => {
      const data = child?.data || {};
      return normalizeItem({
        title: data.title,
        description: '',
        source: 'Reddit',
        attributionUrl: data.permalink ? `https://www.reddit.com${data.permalink}` : '',
        url: data.url,
        image: data.thumbnail?.startsWith('http') ? data.thumbnail : '',
        publishedAt: Number(data.created_utc) ? new Date(data.created_utc * 1000).toISOString() : undefined,
        popularity: Number(data.ups || 0) + Number(data.num_comments || 0),
        tags: [data.subreddit_name_prefixed || 'r/programming'],
        category: inferCategory(data.title, data.selftext)
      });
    })
    .filter(Boolean);
};

module.exports = {
  normalizeItem,
  inferCategory,
  fromNewsAPI,
  fromGNews,
  fromHackerNews,
  fromDevTo,
  fromReddit
};
