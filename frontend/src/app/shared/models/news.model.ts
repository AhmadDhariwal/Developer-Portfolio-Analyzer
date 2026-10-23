export type NewsTab = 'for-you' | 'trending' | 'latest';

export type NewsCategory =
  | 'All'
  | 'Frontend'
  | 'Backend'
  | 'Full Stack'
  | 'AI / ML'
  | 'DevOps'
  | 'Mobile'
  | 'Cybersecurity'
  | 'Web3';

export type NewsSource =
  | 'All'
  | 'NewsAPI'
  | 'GNews'
  | 'Hacker News'
  | 'Dev.to'
  | 'Reddit'
  | 'GitHub Releases'
  | 'GitHub Security Advisories'
  | 'Kubernetes Blog'
  | 'Cloudflare Changelog'
  | 'Lobsters';
export type NewsDateFilter = 'today' | 'week' | 'month';
export type NewsPopularityFilter = 'all' | 'high';
export type NewsSavedType = 'bookmark' | 'read_later';
export type NewsHubView = NewsTab | 'explore' | 'bookmarks' | 'read_later';
export type NewsMode = 'personalized' | 'explore';

export type NewsSkillEvidenceStatus =
  | 'DEMONSTRATED'
  | 'PARTIAL'
  | 'CLAIMED_ONLY'
  | 'NOT_EVIDENCED'
  | 'UNKNOWN';

export interface NewsSkillEvidence {
  name: string;
  canonicalName: string | null;
  status: NewsSkillEvidenceStatus;
  evidenceConfidence: 'LOW' | 'MEDIUM' | 'HIGH' | 'INSUFFICIENT';
  evidence: {
    type: string;
    kind: string;
    id: string;
    artifact: string;
    timestamp: string | null;
    freshness: string;
  }[];
}

export interface NewsItem {
  id: string;
  title: string;
  description: string;
  source: NewsSource | string;
  publisher?: string;
  attributionUrl?: string;
  license?: string;
  licenseUrl?: string;
  url: string;
  image: string;
  publishedAt: string;
  category: NewsCategory | string;
  popularity: number | null;
  relevanceScore: number | null;
  rankScore: number | null;
  tags: string[];
  relevanceReasons?: string[];
  relatedSkills?: string[];
  relatedSkillEvidence?: NewsSkillEvidence[];
  relatedSkillGaps?: string[];
  relatedCareerGoals?: string[];
  demandTags?: string[];
}

export interface NewsFilters {
  mode?: NewsMode;
  tab: NewsTab;
  category: NewsCategory;
  source: NewsSource;
  date: NewsDateFilter;
  search: string;
  popularity: NewsPopularityFilter;
}

export interface PersonalizedNewsContext {
  careerStack: string;
  experienceLevel?: string;
  targetRole?: string;
  signalHash?: string;
  detectedSkills: string[];
  skillEvidence?: NewsSkillEvidence[];
  skillEvidenceRuleVersion?: string;
  skillGaps: string[];
  jobDemandSkills?: string[];
  recommendationTechnologies?: string[];
  activeFilters: {
    tab: NewsTab;
    category: NewsCategory;
    source: NewsSource;
    date: NewsDateFilter;
    search: string;
    popularity: NewsPopularityFilter;
  };
  lastUpdated: string | null;
  sourceStatus: string;
  fromCache?: boolean;
  summary: string;
}

export interface NewsTelemetry {
  queryFreshness?: 'missing' | 'empty' | 'fresh' | 'stale' | null;
  generalFreshness?: 'fresh' | 'stale' | 'warming';
  cacheVersion?: string | null;
  lastSuccessfulCheckAt?: string | null;
  freshness?: 'fresh' | 'stale' | 'warming';
  staleFallback?: boolean;
  lastUpdated?: string | null;
  cacheHit: boolean;
  providerFailureCount: number;
  providerUsed: string[];
  providerDiagnostics?: NewsProviderDiagnostic[];
  signalHash?: string;
  responseTimeMs: number;
}

export interface NewsProviderDiagnostic {
  provider: string;
  enabled: boolean;
  configured: boolean;
  reachable: boolean;
  articlesFetched: number;
  lastSuccess: string | null;
  lastFailure: string | null;
}

export interface NewsResponse {
  mode?: NewsMode;
  coverage?: NewsCoverage | null;
  enrichment?: NewsEnrichment | null;
  items: NewsItem[];
  limit?: number;
  total: number;
  page: number;
  totalPages: number;
  hasMore: boolean;
  sourceSummary: Record<string, number>;
  trendingTopics: string[];
  activeTab: NewsTab;
  fromCache?: boolean;
  recommendedBasedOn?: PersonalizedNewsContext | null;
  telemetry?: NewsTelemetry;
}

export interface SavedNewsItem {
  id: string;
  articleId: string;
  title: string;
  url: string;
  source: string;
  image: string;
  publishedAt: string | null;
  category: string;
  type: NewsSavedType;
  createdAt: string | null;
  readAt: string | null;
  firstReadAt?: string | null;
  lastReadAt?: string | null;
  readCount?: number | null;
}

export interface NewsCoverage {
  status:
    | 'sufficient'
    | 'general_pool'
    | 'unsupported_query'
    | 'restrictive_filters'
    | 'source_exhausted'
    | 'coverage_gap';
  topic: string | null;
  cachedMatches: number;
  minimum: number;
  broaderMatches?: number;
  dateExcludedMatches?: number;
  filterExcludedMatches?: number;
  suggestedDate?: NewsDateFilter | null;
}

export interface NewsEnrichment {
  status:
    | 'not_needed'
    | 'queued'
    | 'searching'
    | 'processing'
    | 'waiting'
    | 'no_newer'
    | 'ready'
    | 'exhausted'
    | 'quota_limited'
    | 'disabled'
    | 'unavailable'
    | 'source_unavailable'
    | 'worker_unavailable';
  reason: string;
  nextEligibleAt: string | null;
  lastAttemptAt?: string;
  lastSuccessfulCheckAt?: string;
  cacheVersion?: string;
  newArticles?: number;
  sourceHealth?: {
    provider: string;
    status: string;
    articlesFound: number;
    reason?: string | null;
    nextEligibleAt?: string | null;
  }[];
}

export interface ActiveNewsFilterChip {
  key: keyof NewsFilters;
  label: string;
  value: string;
}

export const NEWS_TABS: { label: string; value: NewsTab }[] = [
  { label: 'For You', value: 'for-you' },
  { label: 'Trending', value: 'trending' },
  { label: 'Latest', value: 'latest' },
];

export const NEWS_CATEGORIES: NewsCategory[] = [
  'All',
  'Frontend',
  'Backend',
  'Full Stack',
  'AI / ML',
  'DevOps',
  'Mobile',
  'Cybersecurity',
  'Web3',
];

export const NEWS_SOURCES: NewsSource[] = [
  'All',
  'NewsAPI',
  'GNews',
  'Hacker News',
  'Dev.to',
  'Reddit',
  'GitHub Releases',
  'GitHub Security Advisories',
  'Kubernetes Blog',
  'Cloudflare Changelog',
  'Lobsters',
];

export const DEFAULT_NEWS_FILTERS: NewsFilters = {
  mode: 'personalized',
  tab: 'for-you',
  category: 'All',
  source: 'All',
  date: 'week',
  search: '',
  popularity: 'all',
};

export function normalizeNewsFilters(filters: Partial<NewsFilters> = {}): NewsFilters {
  const tab = NEWS_TABS.some((option) => option.value === filters.tab)
    ? (filters.tab as NewsTab)
    : 'for-you';
  const category = NEWS_CATEGORIES.includes(filters.category as NewsCategory)
    ? (filters.category as NewsCategory)
    : 'All';
  const source = NEWS_SOURCES.includes(filters.source as NewsSource)
    ? (filters.source as NewsSource)
    : 'All';
  const date = ['today', 'week', 'month'].includes(String(filters.date || ''))
    ? (filters.date as NewsDateFilter)
    : 'week';
  const popularity = ['all', 'high'].includes(String(filters.popularity || ''))
    ? (filters.popularity as NewsPopularityFilter)
    : 'all';
  const search = String(filters.search || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 80);

  return {
    mode: filters.mode === 'explore' ? 'explore' : 'personalized',
    tab,
    category,
    source,
    date,
    search,
    popularity,
  };
}

export interface SavedNewsResponse {
  items: SavedNewsItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasMore: boolean;
}
