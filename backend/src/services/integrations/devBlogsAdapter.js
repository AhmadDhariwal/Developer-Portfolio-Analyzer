const BaseIntegrationAdapter = require('./baseAdapter');

/**
 * Dev Blogs Adapter — supports Dev.to, Medium, and Hashnode
 * Fetches public article count, reactions, and tags to measure developer branding.
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
      helpText: 'Enter your Dev.to username (e.g. "johndoe") to fetch your public articles, reactions, and top tags. Medium and Hashnode usernames are also supported.'
    };
  }

  async ingestData(connection = {}) {
    const username = String(connection.externalUsername || '').trim();
    if (!username) {
      throw new Error('Blog username is required.');
    }

    // Try Dev.to first (most reliable public API), then Hashnode
    const [devtoResult, hashnodeResult] = await Promise.all([
      this.fetchDevTo(username),
      this.fetchHashnode(username)
    ]);

    const articles = [
      ...(devtoResult.articles || []),
      ...(hashnodeResult.articles || [])
    ];

    const totalArticles = articles.length;
    const totalReactions = articles.reduce((sum, a) => sum + Number(a.reactions || 0), 0);
    const totalViews = articles.reduce((sum, a) => sum + Number(a.views || 0), 0);

    const allTags = articles.flatMap((a) => a.tags || []);
    const tagFreq = {};
    allTags.forEach((tag) => {
      const t = String(tag || '').trim().toLowerCase();
      if (t) tagFreq[t] = (tagFreq[t] || 0) + 1;
    });
    const topTags = Object.entries(tagFreq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([tag]) => tag);

    const inferredSkills = topTags.map((t) => this.tagToSkill(t)).filter(Boolean);

    const brandingScore = Math.min(100,
      (totalArticles * 5) +
      (Math.min(totalReactions, 500) * 0.1) +
      (Math.min(totalViews, 10000) * 0.002)
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
        platforms: [
          ...(devtoResult.articles?.length ? ['Dev.to'] : []),
          ...(hashnodeResult.articles?.length ? ['Hashnode'] : [])
        ],
        recentArticles: articles.slice(0, 5).map((a) => ({
          title: a.title,
          reactions: a.reactions,
          platform: a.platform
        }))
      },
      inferredSkills: [...new Set(inferredSkills)].slice(0, 10),
      raw: { devto: devtoResult, hashnode: hashnodeResult }
    };
  }

  async fetchDevTo(username) {
    try {
      const articles = await this.get(
        `https://dev.to/api/articles?username=${encodeURIComponent(username)}&per_page=30`,
        null,
        { headers: { Accept: 'application/json' } }
      );

      if (!Array.isArray(articles)) return { articles: [] };

      return {
        articles: articles.map((a) => ({
          title: String(a.title || ''),
          reactions: Number(a.positive_reactions_count || a.public_reactions_count || 0),
          views: Number(a.page_views_count || 0),
          tags: Array.isArray(a.tag_list) ? a.tag_list : String(a.tags || '').split(',').map((t) => t.trim()).filter(Boolean),
          platform: 'Dev.to'
        }))
      };
    } catch {
      return { articles: [] };
    }
  }

  async fetchHashnode(username) {
    try {
      const query = `
        query GetUserArticles($username: String!) {
          user(username: $username) {
            publications(first: 1) {
              edges {
                node {
                  posts(first: 20) {
                    edges {
                      node {
                        title
                        reactionCount
                        views
                        tags { name }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      `;

      const data = await this.post(
        'https://gql.hashnode.com',
        { query, variables: { username } },
        { headers: { 'Content-Type': 'application/json' } }
      );

      const posts = data?.data?.user?.publications?.edges?.[0]?.node?.posts?.edges || [];
      return {
        articles: posts.map(({ node: p }) => ({
          title: String(p.title || ''),
          reactions: Number(p.reactionCount || 0),
          views: Number(p.views || 0),
          tags: Array.isArray(p.tags) ? p.tags.map((t) => t.name) : [],
          platform: 'Hashnode'
        }))
      };
    } catch {
      return { articles: [] };
    }
  }

  tagToSkill(tag) {
    const map = {
      javascript: 'JavaScript', typescript: 'TypeScript', python: 'Python',
      react: 'React', angular: 'Angular', vue: 'Vue.js', node: 'Node.js',
      nodejs: 'Node.js', css: 'CSS', html: 'HTML', java: 'Java',
      go: 'Go', rust: 'Rust', kotlin: 'Kotlin', swift: 'Swift',
      docker: 'Docker', kubernetes: 'Kubernetes', aws: 'AWS',
      devops: 'DevOps', 'machine-learning': 'Machine Learning',
      ai: 'AI/ML', 'data-science': 'Data Science', sql: 'SQL',
      mongodb: 'MongoDB', graphql: 'GraphQL', nextjs: 'Next.js',
      webdev: 'Web Development', backend: 'Backend', frontend: 'Frontend',
      fullstack: 'Full Stack', security: 'Security', blockchain: 'Blockchain'
    };
    return map[tag.toLowerCase()] || null;
  }
}

module.exports = DevBlogsAdapter;
