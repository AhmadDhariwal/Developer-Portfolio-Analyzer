const BaseIntegrationAdapter = require('./baseAdapter');

/**
 * Dev Blogs Adapter — bounded public Dev.to article observations.
 * Hashnode requires an approved paid API contract; Medium is not implemented.
 */
class DevBlogsAdapter extends BaseIntegrationAdapter {
  constructor() {
    super('devblogs');
  }

  getAuthMode() {
    return 'manual';
  }

  getManualAuthHints() {
    return {
      requiredFields: ['externalUsername'],
      helpText:
        'Use devto@username to fetch up to 30 public Dev.to articles, reactions, and tags. Hashnode requires approved Pro API access and is currently unavailable. Medium is not supported.'
    };
  }

  async ingestData(connection = {}) {
    const identifier = String(connection.externalUsername || '').trim();
    if (!identifier) {
      throw new Error('Blog username is required.');
    }
    // Explicit selection avoids merging unrelated people who share a handle across platforms.
    // Legacy bare handles remain blocked rather than replacing a combined snapshot partially.
    const selection = /^devto@([a-zA-Z0-9_.-]+)$/.exec(identifier);
    if (!selection) {
      throw new Error(
        'Hashnode API access requires an approved Pro publication. Use devto@username for Dev.to only.'
      );
    }
    const username = selection[1];
    const devtoResult = await this.fetchDevTo(username);
    if (devtoResult.failed) throw Error('Blog provider data unavailable.');
    const articles = devtoResult.articles || [];
    if (!articles.length) throw Error('No public Dev.to articles found.');
    const totalArticles = articles.length;
    const totalReactions = articles.reduce((sum, a) => sum + Number(a.reactions || 0), 0);
    const totalViews = articles.every((article) => Number.isFinite(article.views))
      ? articles.reduce((sum, article) => sum + article.views, 0)
      : null;

    const allTags = articles.flatMap((a) => a.tags || []);
    const tagFreq = {};
    allTags.forEach((tag) => {
      const t = String(tag || '')
        .trim()
        .toLowerCase();
      if (t) tagFreq[t] = (tagFreq[t] || 0) + 1;
    });
    const topTags = Object.entries(tagFreq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([tag]) => tag);

    const inferredSkills = topTags.map((t) => this.tagToSkill(t)).filter(Boolean);

    const brandingScore = Math.min(
      100,
      totalArticles * 5 + Math.min(totalReactions, 500) * 0.1 + Math.min(totalViews, 10000) * 0.002
    );

    return {
      provider: this.provider,
      profile: {
        username,
        totalArticles,
        totalReactions,
        totalViews,
        brandingScore: Math.round(brandingScore)
      },
      activity: {
        topTags,
        platforms: [...(devtoResult.articles?.length ? ['Dev.to'] : [])],
        recentArticles: articles.slice(0, 5).map((a) => ({
          title: a.title,
          reactions: a.reactions,
          publishedAt: a.publishedAt,
          platform: a.platform
        }))
      },
      inferredSkills: [...new Set(inferredSkills)].slice(0, 10),
      raw: { devto: devtoResult }
    };
  }

  async fetchDevTo(username) {
    try {
      const articles = await this.get(
        `https://dev.to/api/articles?username=${encodeURIComponent(username)}&per_page=30`,
        null,
        { headers: { Accept: 'application/json' } }
      );

      if (!Array.isArray(articles)) return { articles: [], failed: true };

      return {
        articles: articles.map((a) => ({
          title: String(a.title || ''),
          reactions: Number(a.positive_reactions_count || a.public_reactions_count || 0),
          views: Number.isFinite(a.page_views_count) ? a.page_views_count : null,
          publishedAt: a.published_at || a.published_timestamp || null,
          tags: Array.isArray(a.tag_list)
            ? a.tag_list
            : String(a.tags || '')
                .split(',')
                .map((t) => t.trim())
                .filter(Boolean),
          platform: 'Dev.to'
        }))
      };
    } catch {
      return { articles: [], failed: true };
    }
  }

  async fetchHashnode() {
    // Free GraphQL reads were retired on 13 May 2026. Never follow its marketing redirect
    // or switch to another endpoint to evade the paid publication requirement.
    return { articles: [], failed: true, unavailable: true };
  }

  tagToSkill(tag) {
    const map = {
      javascript: 'JavaScript',
      typescript: 'TypeScript',
      python: 'Python',
      react: 'React',
      angular: 'Angular',
      vue: 'Vue.js',
      node: 'Node.js',
      nodejs: 'Node.js',
      css: 'CSS',
      html: 'HTML',
      java: 'Java',
      go: 'Go',
      rust: 'Rust',
      kotlin: 'Kotlin',
      swift: 'Swift',
      docker: 'Docker',
      kubernetes: 'Kubernetes',
      aws: 'AWS',
      devops: 'DevOps',
      'machine-learning': 'Machine Learning',
      ai: 'AI/ML',
      'data-science': 'Data Science',
      sql: 'SQL',
      mongodb: 'MongoDB',
      graphql: 'GraphQL',
      nextjs: 'Next.js',
      webdev: 'Web Development',
      backend: 'Backend',
      frontend: 'Frontend',
      fullstack: 'Full Stack',
      security: 'Security',
      blockchain: 'Blockchain'
    };
    return map[tag.toLowerCase()] || null;
  }
}

module.exports = DevBlogsAdapter;
