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
  isConfigured:    false
};
