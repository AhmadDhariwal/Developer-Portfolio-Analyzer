const BaseIntegrationAdapter = require('./baseAdapter');

/**
 * Bounded article observations from one explicitly selected source.
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
      helpText: 'Use devto@username for Dev.to. Each read observes at most 30 public posts.'
    };
  }

  async ingestData(connection = {}) {
    const identifier = String(connection.externalUsername || '').trim();
    if (!identifier) {
      throw new Error('Blog username is required.');
    }
    if (/^hashnode@/i.test(identifier)) {
      throw new Error('Hashnode support has been retired. Historical data is preserved.');
    }
    // Explicit selection avoids merging unrelated people who share a handle across platforms.
    // Legacy bare handles remain blocked rather than replacing a combined snapshot partially.
    const selection = /^(devto)@([a-zA-Z0-9_.-]+)$/.exec(identifier);
    if (!selection) {
      throw new Error('Select devto@username. Legacy combined handles are unavailable.');
    }
    const source = selection[1];
    const username = selection[2];
    const result = await this.fetchDevTo(username);
    if (result.failed) throw Error('Blog provider data unavailable.');
    const articles = result.articles || [];
    if (!articles.length)
      throw Error('No public Dev.to articles found for this author in the observed sample.');
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
        platforms: ['Dev.to'],
        recentArticles: articles.slice(0, 5).map((a) => ({
          title: a.title,
          reactions: a.reactions,
          publishedAt: a.publishedAt,
          platform: a.platform
        }))
      },
      inferredSkills: [...new Set(inferredSkills)].slice(0, 10),
      raw: { [source]: result }
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
    } catch (error) {
      if (error.status || error.code === 'ERR_CANCELED') throw error;
      return { articles: [], failed: true };
    }
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
