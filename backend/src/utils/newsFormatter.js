const DEFAULT_IMAGE =
  'https://images.unsplash.com/photo-1518773553398-650c184e0bb3?auto=format&fit=crop&w=1200&q=80';

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

const cleanText = (value = '') => String(value).replace(/\s+/g, ' ').trim();

const normalizeDate = (value) => {
  const ts = value ? new Date(value) : new Date();
  return Number.isNaN(ts.getTime()) ? new Date() : ts;
};

const inferCategory = (headline = '', summary = '') => {
  const text = `${headline} ${summary}`.toLowerCase();
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some((keyword) => text.includes(keyword))) return category;
  }
  return 'Backend';
};

const normalizeItem = (item = {}) => {
  const title = cleanText(item.title);
  const description = cleanText(item.description);
  return {
    title: title || 'Untitled',
    description,
    source: cleanText(item.source) || 'Unknown',
    url: cleanText(item.url),
    image: cleanText(item.image) || DEFAULT_IMAGE,
    publishedAt: normalizeDate(item.publishedAt),
    category: cleanText(item.category) || inferCategory(title, description),
    popularity: Number(item.popularity || 0),
    tags: Array.isArray(item.tags) ? item.tags.map((tag) => cleanText(tag)).filter(Boolean) : []
  };
};

const fromNewsAPI = (payload) => {
  const articles = Array.isArray(payload?.articles) ? payload.articles : [];
  return articles.map((article) =>
    normalizeItem({
      title: article.title,
      description: article.description || article.content,
      source: article?.source?.name || 'NewsAPI',
      url: article.url,
      image: article.urlToImage,
      publishedAt: article.publishedAt,
      category: inferCategory(article.title, article.description)
    })
  );
};

const fromGNews = (payload) => {
  const articles = Array.isArray(payload?.articles) ? payload.articles : [];
  return articles.map((article) =>
    normalizeItem({
      title: article.title,
      description: article.description || article.content,
      source: article?.source?.name || 'GNews',
      url: article.url,
      image: article.image,
      publishedAt: article.publishedAt,
      category: inferCategory(article.title, article.description)
    })
  );
};

const fromHackerNews = (payload) => {
  const hits = Array.isArray(payload?.hits) ? payload.hits : [];
  return hits.map((hit) =>
    normalizeItem({
      title: hit.title || hit.story_title,
      description: hit.story_text || hit.comment_text || '',
      source: 'Hacker News',
      url: hit.url || hit.story_url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
      image: '',
      publishedAt: hit.created_at,
      popularity: Number(hit.points || 0),
      category: inferCategory(hit.title || hit.story_title, hit.story_text)
    })
  );
};

const fromDevTo = (payload) => {
  const articles = Array.isArray(payload) ? payload : [];
  return articles.map((article) =>
    normalizeItem({
      title: article.title,
      description: article.description,
      source: 'Dev.to',
      url: article.url,
      image: article.social_image,
      publishedAt: article.published_at,
      popularity: Number(article.public_reactions_count || 0) + Number(article.comments_count || 0),
      tags: Array.isArray(article.tag_list) ? article.tag_list : [],
      category: inferCategory(article.title, article.description)
    })
  );
};

const fromReddit = (payload) => {
  const posts = Array.isArray(payload?.data?.children) ? payload.data.children : [];
  return posts.map((child) => {
    const data = child?.data || {};
    return normalizeItem({
      title: data.title,
      description: data.selftext,
      source: 'Reddit',
      url: data.url,
      image: data.thumbnail && data.thumbnail.startsWith('http') ? data.thumbnail : '',
      publishedAt: Number(data.created_utc) ? new Date(data.created_utc * 1000).toISOString() : undefined,
      popularity: Number(data.ups || 0) + Number(data.num_comments || 0),
      tags: [data.subreddit_name_prefixed || 'r/programming'],
      category: inferCategory(data.title, data.selftext)
    });
  });
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
