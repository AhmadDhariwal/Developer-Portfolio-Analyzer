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

export type NewsSource = 'All' | 'NewsAPI' | 'GNews' | 'Hacker News' | 'Dev.to' | 'Reddit';
export type NewsDateFilter = 'today' | 'week' | 'month';
export type NewsPopularityFilter = 'all' | 'high';

export interface NewsItem {
  id: string;
  title: string;
  description: string;
  source: NewsSource | string;
  url: string;
  image: string;
  publishedAt: string;
  category: NewsCategory | string;
  popularity: number;
  relevanceScore: number;
  rankScore: number;
  tags: string[];
}

export interface NewsFilters {
  tab: NewsTab;
  category: NewsCategory;
  source: NewsSource;
  date: NewsDateFilter;
  search: string;
  popularity: NewsPopularityFilter;
}

export interface PersonalizedNewsContext {
  careerStack: string;
  detectedSkills: string[];
  skillGaps: string[];
  activeFilters: {
    tab: NewsTab;
    category: NewsCategory;
    source: NewsSource;
    date: NewsDateFilter;
    search: string;
    popularity: NewsPopularityFilter;
  };
  lastUpdated: string;
  sourceStatus: string;
  fromCache?: boolean;
  summary: string;
}

export interface NewsTelemetry {
  cacheHit: boolean;
  providerFailureCount: number;
  providerUsed: string[];
  responseTimeMs: number;
}

export interface NewsResponse {
  items: NewsItem[];
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

export interface ActiveNewsFilterChip {
  key: keyof NewsFilters;
  label: string;
  value: string;
}

export const NEWS_TABS: { label: string; value: NewsTab }[] = [
  { label: 'For You', value: 'for-you' },
  { label: 'Trending', value: 'trending' },
  { label: 'Latest', value: 'latest' }
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
  'Web3'
];

export const NEWS_SOURCES: NewsSource[] = ['All', 'NewsAPI', 'GNews', 'Hacker News', 'Dev.to', 'Reddit'];

export const DEFAULT_NEWS_FILTERS: NewsFilters = {
  tab: 'for-you',
  category: 'All',
  source: 'All',
  date: 'week',
  search: '',
  popularity: 'all'
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
  const search = String(filters.search || '').trim().replace(/\s+/g, ' ').slice(0, 80);

  return {
    tab,
    category,
    source,
    date,
    search,
    popularity
  };
}
