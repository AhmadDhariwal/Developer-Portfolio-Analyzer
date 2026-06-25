export type CareerStack =
  | 'Frontend'
  | 'Backend'
  | 'Full Stack'
  | 'AI/ML';

export type ExperienceLevel =
  | 'Student'
  | 'Intern'
  | '0-1 years'
  | '1-2 years'
  | '2-3 years'
  | '3-5 years'
  | '5+ years';

export type CareerGoal =
  | 'Get first job'
  | 'Improve portfolio'
  | 'Prepare for interviews'
  | 'Switch tech stack'
  | '';

export interface CareerProfile {
  careerStack:     CareerStack;
  experienceLevel: ExperienceLevel;
  careerGoal:      CareerGoal;
  activeGithubUsername?: string;
  activeCareerStack?: CareerStack;
  activeExperienceLevel?: ExperienceLevel;
  targetTimeline?: string;
  learningPreference?: string;
  profileHash?: string;
  isConfigured:    boolean;
}

export const CAREER_STACKS: CareerStack[] = [
  'Frontend',
  'Backend',
  'Full Stack',
  'AI/ML'
];

export const EXPERIENCE_LEVELS: ExperienceLevel[] = [
  'Student',
  'Intern',
  '0-1 years',
  '1-2 years',
  '2-3 years',
  '3-5 years',
  '5+ years'
];

export const CAREER_GOALS: CareerGoal[] = [
  'Get first job',
  'Improve portfolio',
  'Prepare for interviews',
  'Switch tech stack'
];

export const DEFAULT_CAREER_PROFILE: CareerProfile = {
  careerStack:     'Full Stack',
  experienceLevel: 'Student',
  careerGoal:      '',
  activeGithubUsername: '',
  activeCareerStack: 'Full Stack',
  activeExperienceLevel: 'Student',
  targetTimeline: '',
  learningPreference: '',
  profileHash: '',
  isConfigured:    false
};

export const buildCareerProfileSignature = (profile: Partial<CareerProfile> | null | undefined): string => JSON.stringify({
  activeGithubUsername: String(profile?.activeGithubUsername || '').trim().toLowerCase(),
  activeCareerStack: String(profile?.activeCareerStack || profile?.careerStack || 'Full Stack').trim(),
  activeExperienceLevel: String(profile?.activeExperienceLevel || profile?.experienceLevel || 'Student').trim(),
  careerGoal: String(profile?.careerGoal || '').trim(),
  targetTimeline: String(profile?.targetTimeline || '').trim(),
  learningPreference: String(profile?.learningPreference || '').trim(),
  profileHash: String(profile?.profileHash || '').trim()
});
