// Synthetic metadata contracts; no copied article bodies or production secrets.
function rss(title = 'Kubernetes security release update', extra = '') {
  return `<rss version="2.0"><channel><item><title>${title}</title><link>https://example.com/rss-story</link><comments>https://example.com/discussion</comments><pubDate>${new Date().toUTCString()}</pubDate>${extra}</item></channel></rss>`;
}
function payloads() {
  const publishedAt = new Date().toISOString();
  return {
    newsapi: {
      status: 'ok',
      articles: [
        null,
        {
          title: 'Kubernetes engineering release update',
          description: 'DevOps deployment metadata',
          source: { name: 'Fixture Publisher' },
          url: 'https://example.com/newsapi-story',
          publishedAt
        }
      ]
    },
    gnews: {
      articles: [
        null,
        {
          title: 'Kubernetes engineering release update',
          description: 'DevOps deployment metadata',
          source: { name: 'Fixture Publisher' },
          url: 'https://example.com/gnews-story',
          publishedAt
        }
      ]
    },
    hackernews: {
      hits: [
        null,
        {
          title: 'Kubernetes engineering release update',
          url: 'https://example.com/hn-story',
          objectID: '123',
          created_at: publishedAt,
          points: 3
        }
      ]
    },
    devto: [
      null,
      {
        title: 'Kubernetes engineering release update',
        description: 'DevOps deployment metadata',
        url: 'https://example.com/dev-story',
        user: { name: 'Fixture Author' },
        published_at: publishedAt,
        tag_list: ['kubernetes', 'devops'],
        public_reactions_count: 3
      }
    ],
    reddit: {
      data: {
        children: [
          {
            data: {
              title: 'Kubernetes engineering release update',
              url: 'https://example.com/reddit-story',
              permalink: '/r/devops/comments/fixture/story/',
              created_utc: Date.now() / 1000,
              subreddit_name_prefixed: 'r/devops',
              ups: 3
            }
          }
        ]
      }
    },
    githubreleases: [
      {
        name: 'Security release update',
        tag_name: 'v1.2.3',
        html_url: 'https://example.com/github-release',
        published_at: publishedAt
      }
    ],
    githubadvisories: [
      {
        summary: 'Kubernetes security vulnerability advisory',
        html_url: 'https://example.com/github-advisory',
        published_at: publishedAt
      }
    ],
    lobsters: rss().replaceAll('rss-story', 'lobsters-story'),
    kubernetesblog: rss().replaceAll('rss-story', 'kubernetes-story'),
    cloudflarechangelog: rss('Cloudflare Workers security release').replaceAll(
      'rss-story',
      'cloudflare-story'
    )
  };
}
function largeKubernetesFeed() {
  // Official generator emits 50 entries including full escaped .Content. Retain metadata only.
  return `<rss version="2.0"><channel>${Array.from(
    { length: 50 },
    (_, index) =>
      `<item><title> Kubernet&#101;s release ${index} </title><link>https://example.com/kube/${index}</link><pubDate>${new Date().toUTCString()}</pubDate><description>${'escaped body '.repeat(2400)}</description></item>`
  ).join('')}</channel></rss>`;
}
module.exports = { payloads, rss, largeKubernetesFeed };
