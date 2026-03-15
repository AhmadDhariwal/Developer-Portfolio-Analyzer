// ─── Course model ─────────────────────────────────────────────────────────────

export type CoursePlatform = 'Udemy' | 'Coursera' | 'YouTube' | 'edX' | 'freeCodeCamp' | 'All' | 'Other';
export type CourseLevel    = 'Beginner' | 'Intermediate' | 'Advanced' | 'All Levels' | 'All';
export type CourseDuration = '0-2' | '2-10' | '10+' | 'All';

export interface PlatformColor {
  bg:   string;
  text: string;
}

export interface Course {
  id:             string;
  title:          string;
  description:    string;
  platform:       CoursePlatform;
  instructor:     string;
  rating:         number;
  reviewCount:    number;
  duration:       string;
  durationHours:  number;
  level:          CourseLevel;
  thumbnail:      string;
  url:            string;
  topics:         string[];
  popularity:     number;
  relevanceScore?: number;
  finalScore?:     number;
  platformColor?:  PlatformColor;
}

export interface CourseFilters {
  platform: CoursePlatform | 'All';
  rating:   string;
  level:    CourseLevel | 'All';
  duration: CourseDuration | 'All';
  topic:    string;
}

export interface CoursesResponse {
  courses:    Course[];
  total:      number;
  page:       number;
  totalPages: number;
  hasMore:    boolean;
  fromCache?: boolean;
}

export const DEFAULT_FILTERS: CourseFilters = {
  platform: 'All',
  rating:   '',
  level:    'All',
  duration: 'All',
  topic:    ''
};

export const PLATFORM_OPTIONS: { value: CoursePlatform | 'All'; label: string }[] = [
  { value: 'All',          label: 'All Platforms' },
  { value: 'Udemy',        label: 'Udemy' },
  { value: 'Coursera',     label: 'Coursera' },
  { value: 'YouTube',      label: 'YouTube' },
  { value: 'Other',        label: 'Other (edX, freeCodeCamp)' }
];

export const RATING_OPTIONS: { value: string; label: string }[] = [
  { value: '',    label: 'Any Rating' },
  { value: '4',   label: '4.0 & above' },
  { value: '4.5', label: '4.5 & above' },
  { value: '5',   label: '5.0 only' }
];

export const LEVEL_OPTIONS: { value: CourseLevel | 'All'; label: string }[] = [
  { value: 'All',          label: 'All Levels' },
  { value: 'Beginner',     label: 'Beginner' },
  { value: 'Intermediate', label: 'Intermediate' },
  { value: 'Advanced',     label: 'Advanced' }
];

export const DURATION_OPTIONS: { value: CourseDuration | 'All'; label: string }[] = [
  { value: 'All',  label: 'Any Duration' },
  { value: '0-2',  label: '0 – 2 hours' },
  { value: '2-10', label: '2 – 10 hours' },
  { value: '10+',  label: '10+ hours' }
];

export const TOPIC_OPTIONS: string[] = [
  'Angular', 'React', 'Vue', 'Node.js', 'Express', 'MongoDB', 'PostgreSQL',
  'Python', 'Django', 'FastAPI', 'TypeScript', 'JavaScript', 'Docker',
  'Kubernetes', 'AWS', 'System Design', 'Testing', 'GraphQL', 'Machine Learning',
  'Data Structures', 'Algorithms', 'Git', 'CI/CD', 'Linux', 'Redis'
];

export const PLATFORM_COLOR_MAP: Record<string, { bg: string; text: string; accent: string }> = {
  Udemy:        { bg: '#a435f0', text: '#fff', accent: '#7c1fba' },
  Coursera:     { bg: '#0056d2', text: '#fff', accent: '#003e99' },
  edX:          { bg: '#02262b', text: '#fff', accent: '#013a43' },
  freeCodeCamp: { bg: '#006400', text: '#fff', accent: '#004b00' },
  YouTube:      { bg: '#ff0000', text: '#fff', accent: '#c00000' }
};
