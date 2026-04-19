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
