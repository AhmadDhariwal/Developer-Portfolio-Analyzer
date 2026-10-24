// Synthetic articles and metadata used only by controlled frontend verification.
const profile = {
  careerStack: 'Frontend',
  activeCareerStack: 'Frontend',
  experienceLevel: 'Student',
  activeExperienceLevel: 'Student',
  activeGithubUsername: 'fixture',
  isConfigured: true,
};
const titles = [
  'React rendering: a practical performance checklist',
  'TypeScript patterns for clearer application boundaries',
  'Building accessible interfaces with confidence',
  'Node.js services: understanding request cancellation',
  'A developer guide to dependable API design',
  'What observability can tell you about your frontend',
];
const catalog = Array.from({ length: 25 }, (_, index) => ({
  id: `fixture-${index + 1}`,
  title: titles[index % titles.length],
  description:
    'A controlled UI fixture illustrating developer news metadata. Open the original source for the full article.',
  source: index % 2 ? 'Hacker News' : 'Dev.to',
  publisher: index % 2 ? '' : 'DEV Community · fixture',
  attributionUrl: `https://news-fixture.example/source/${index}`,
  url: `https://news-fixture.example/article/${index}`,
  image: `https://news-fixture.example/images/${index % 3}`,
  publishedAt: new Date(Date.now() - (index + 1) * 3600000).toISOString(),
  category: index % 2 ? 'Backend' : 'Frontend',
  popularity: index === 0 ? 0 : 123,
  relevanceScore: index === 0 ? 0 : 72.5,
  rankScore: index === 0 ? 0 : 76.25,
  tags: ['React'],
  relevanceReasons: [
    'Matches your detected skills: React',
    'Supports current growth gaps: TypeScript',
  ],
  relatedSkills: ['React'],
  relatedSkillGaps: ['TypeScript'],
  demandTags: ['Accessibility'],
}));
function response(items, params, mode) {
  const page = Number(params.get('page') || 1),
    limit = Number(params.get('limit') || 12);
  return {
    items: items.slice((page - 1) * limit, page * limit),
    limit,
    total: items.length,
    page,
    totalPages: Math.max(1, Math.ceil(items.length / limit)),
    hasMore: page * limit < items.length,
    activeTab: params.get('tab') || 'for-you',
    fromCache: true,
    sourceSummary: { 'Dev.to': items.length },
    trendingTopics: ['react', 'typescript', 'accessibility'],
    recommendedBasedOn: {
      careerStack: 'Frontend',
      targetRole: 'Frontend Developer',
      detectedSkills: ['React', 'JavaScript'],
      skillGaps: ['TypeScript'],
      recommendationTechnologies: ['Accessibility'],
      jobDemandSkills: ['React'],
      activeFilters: {},
      signalHash: 'synthetic',
      summary:
        'Articles connect to your selected Frontend path, detected skills and current learning areas.',
      sourceStatus: 'Cached source coverage',
      lastUpdated: new Date(Date.now() - (mode === 'stale' ? 3600000 : 600000)).toISOString(),
    },
    telemetry: {
      cacheHit: true,
      freshness: mode === 'warming' ? 'warming' : mode === 'stale' ? 'stale' : 'fresh',
      providerUsed: ['Dev.to', 'Hacker News'],
      providerFailureCount: ['stale', 'partial'].includes(mode) ? 1 : 0,
      responseTimeMs: 12,
      providerDiagnostics: [
        {
          provider: 'Dev.to',
          enabled: true,
          configured: true,
          reachable: true,
          articlesFetched: 20,
          lastSuccess: new Date().toISOString(),
          lastFailure: null,
        },
        {
          provider: 'Hacker News',
          enabled: true,
          configured: true,
          reachable: !['stale', 'partial'].includes(mode),
          articlesFetched: 5,
          lastSuccess: new Date(Date.now() - 3600000).toISOString(),
          lastFailure: null,
        },
      ],
    },
  };
}
const artwork = (index) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="360" viewBox="0 0 800 360"><rect width="800" height="360" fill="${['#e0e7ff', '#e2e8f0', '#e0f2fe'][index]}"/><g fill="none" stroke="${['#6366f1', '#64748b', '#0284c7'][index]}" stroke-width="2" opacity=".45"><circle cx="570" cy="170" r="145"/><circle cx="570" cy="170" r="95"/><path d="M0 280L800 80M0 330L800 130M80 0L80 360M140 0L140 360"/></g><text x="55" y="160" fill="#312e81" font-family="sans-serif" font-size="40" font-weight="600">${['&lt; React /&gt;', 'TypeScript', 'Build thoughtfully.'][index]}</text><text x="58" y="202" fill="#475569" font-family="sans-serif" font-size="15" letter-spacing="4">SYNTHETIC UI FIXTURE</text></svg>`;
module.exports = { profile, catalog, response, artwork };
