export type CoursePlatform =
  | 'Udemy'
  | 'Coursera'
  | 'YouTube'
  | 'edX'
  | 'freeCodeCamp'
  | 'All'
  | 'Other';
export type CourseLevel = 'Beginner' | 'Intermediate' | 'Advanced' | 'All Levels' | 'All';
export type CourseDuration = '0-2' | '2-10' | '10+' | 'All';

export interface PlatformColor {
  bg: string;
  text: string;
}

export interface Course {
  id: string;
  title: string;
  description?: string;
  platform: CoursePlatform;
  instructor?: string | null;
  rating?: number | null;
  reviewCount?: number | null;
  duration?: string | null;
  durationHours?: number | null;
  level?: CourseLevel | null;
  thumbnail?: string;
  url: string;
  topics: string[];
  popularity?: number | null;
  relevanceScore?: number;
  finalScore?: number;
  whyRecommended?: string;
  platformColor?: PlatformColor;
  engagementScore?: number | null;
  viewCount?: number | null;
  likeCount?: number | null;
  matchedRequiredTargets?: string[];
  matchedTargets?: string[];
  matchedCareerSkills?: string[];
  provenance?: CourseProvenance;
}

export interface CourseFilters {
  platform: CoursePlatform | 'All';
  rating: string;
  level: CourseLevel | 'All';
  duration: CourseDuration | 'All';
  topic: string;
}

export interface RecommendedBasedOn {
  careerStack: string;
  experienceLevel: string;
  skillGapsUsed: string[];
  activeFilters: CourseFilters;
  fromCache?: boolean;
  source?: 'mixed' | 'curated' | 'curated-fallback';
  youtubeStatus?: 'available' | 'cached' | 'unavailable' | 'circuit-open' | 'not-requested';
  fallbackUsed?: boolean;
  sourceMessage?: string;
  summary: string;
  personalization?: CoursePersonalization;
  requestedSkills?: string[];
}

export interface CoursesResponse {
  courses: Course[];
  total: number;
  page: number;
  totalPages: number;
  hasMore: boolean;
  fromCache?: boolean;
  fromFrontendCache?: boolean;
  recommendedBasedOn?: RecommendedBasedOn | null;
  personalization?: CoursePersonalization;
  requestedSkills?: string[];
  cacheMetadata?: {
    loadedFromCache: boolean;
    cacheLayer: 'memory' | 'redis' | 'mongo' | 'miss';
    signalHash?: string;
    analysisVersion?: string;
  };
}

export interface ActiveCourseFilterChip {
  key: keyof CourseFilters;
  label: string;
  value: string;
}

export const DEFAULT_FILTERS: CourseFilters = {
  platform: 'All',
  rating: '',
  level: 'All',
  duration: 'All',
  topic: '',
};

export const PLATFORM_OPTIONS: { value: CoursePlatform | 'All'; label: string }[] = [
  { value: 'All', label: 'All Platforms' },
  { value: 'Udemy', label: 'Udemy' },
  { value: 'Coursera', label: 'Coursera' },
  { value: 'YouTube', label: 'YouTube' },
  { value: 'Other', label: 'Other (edX, freeCodeCamp)' },
];

export const RATING_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Any Rating' },
  { value: '4', label: '4.0 & above' },
  { value: '4.5', label: '4.5 & above' },
  { value: '5', label: '5.0 only' },
];

export const LEVEL_OPTIONS: { value: CourseLevel | 'All'; label: string }[] = [
  { value: 'All', label: 'All Levels' },
  { value: 'Beginner', label: 'Beginner' },
  { value: 'Intermediate', label: 'Intermediate' },
  { value: 'Advanced', label: 'Advanced' },
];

export const DURATION_OPTIONS: { value: CourseDuration | 'All'; label: string }[] = [
  { value: 'All', label: 'Any Duration' },
  { value: '0-2', label: '0 - 2 hours' },
  { value: '2-10', label: '2 - 10 hours' },
  { value: '10+', label: '10+ hours' },
];

export const TOPIC_OPTIONS: string[] = [
  'Angular',
  'React',
  'Vue',
  'Node.js',
  'Express',
  'MongoDB',
  'PostgreSQL',
  'Python',
  'Django',
  'FastAPI',
  'TypeScript',
  'JavaScript',
  'Docker',
  'Kubernetes',
  'AWS',
  'System Design',
  'Testing',
  'GraphQL',
  'Machine Learning',
  'Data Structures',
  'Algorithms',
  'Git',
  'CI/CD',
  'Linux',
  'Redis',
];

export const PLATFORM_COLOR_MAP: Record<string, { bg: string; text: string; accent: string }> = {
  Udemy: { bg: '#a435f0', text: '#fff', accent: '#7c1fba' },
  Coursera: { bg: '#0056d2', text: '#fff', accent: '#003e99' },
  edX: { bg: '#02262b', text: '#fff', accent: '#013a43' },
  freeCodeCamp: { bg: '#006400', text: '#fff', accent: '#004b00' },
  YouTube: { bg: '#ff0000', text: '#fff', accent: '#c00000' },
};

export function normalizeCourseFilters(filters: Partial<CourseFilters> = {}): CourseFilters {
  const platform = PLATFORM_OPTIONS.some((option) => option.value === filters.platform)
    ? (filters.platform as CourseFilters['platform'])
    : 'All';
  const rating = RATING_OPTIONS.some((option) => option.value === filters.rating)
    ? String(filters.rating || '')
    : '';
  const level = LEVEL_OPTIONS.some((option) => option.value === filters.level)
    ? (filters.level as CourseFilters['level'])
    : 'All';
  const duration = DURATION_OPTIONS.some((option) => option.value === filters.duration)
    ? (filters.duration as CourseFilters['duration'])
    : 'All';
  const topic = String(filters.topic || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 60);

  return {
    platform,
    rating,
    level,
    duration,
    topic,
  };
}

export interface CourseProvenance {
  source: 'curated-catalog' | 'youtube-api' | 'provider';
  ratingSource?: 'unavailable' | 'provider-reviews';
  popularitySource?: 'unavailable' | 'derived-view-count' | 'provider';
  engagementSource?: 'unavailable' | 'derived-views-likes';
  metadataVerifiedAt: string | null;
  availability: 'observed' | 'unverified';
  durationSource?: string;
}

export interface CoursePersonalization {
  status: 'evidence-informed' | 'career-context-only';
  ruleVersion: string;
  limitation: string;
  targets?: { name: string; status: string; requirement: string }[];
}

export type LearningStatus = 'saved' | 'in_progress' | 'completed';
export interface CourseProgressUpdate {
  status: LearningStatus;
  notes?: string;
  progressPercent?: number | null;
}
export interface UserCourseProgress {
  courseId: string;
  course: Course;
  status: LearningStatus;
  notes: string;
  progressPercent: number | null;
  progressSource: 'user-entered';
  completionSource: 'self-reported';
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface MyLearningResponse {
  courses: UserCourseProgress[];
  total: number;
  page: number;
  totalPages: number;
}
export interface CourseSprintResponse {
  sprintId: string;
  courseId: string;
  targetSkill: string | null;
  alreadyAdded: boolean;
  route: '/app/career-sprint';
}
export interface CourseActionState {
  pending?: boolean;
  message?: string;
  error?: boolean;
  sprintAdded?: boolean;
}

/** Only HTTPS provider destinations can be opened from course results. */
export function safeCourseUrl(value: string, platform: CoursePlatform): string | null {
  try {
    if (value.includes('\\')) return null;
    const url = new URL(value);
    const domains: Partial<Record<CoursePlatform, string[]>> = {
      Udemy: ['udemy.com'],
      Coursera: ['coursera.org'],
      YouTube: ['youtube.com', 'youtu.be'],
      edX: ['edx.org'],
      freeCodeCamp: ['freecodecamp.org'],
    };
    return url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.port &&
      domains[platform]?.some(
        (domain) => url.hostname === domain || url.hostname.endsWith('.' + domain),
      )
      ? url.href
      : null;
  } catch {
    return null;
  }
}
