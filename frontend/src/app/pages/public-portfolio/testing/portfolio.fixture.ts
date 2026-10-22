import { PublicProfilePayload } from '../../../shared/services/public-profile.service';
import { emptyPortfolioSections } from '../../../shared/utils/public-profile.utils';

export const portfolioFixture = (
  overrides: Partial<PublicProfilePayload> = {},
): PublicProfilePayload => ({
  slug: 'maya-chen',
  isPublic: true,
  headline: 'Product engineer',
  summary: 'Building accessible software.',
  seoTitle: 'Maya Chen — Portfolio',
  seoDescription: 'Selected engineering projects.',
  skills: [{ name: 'TypeScript', score: 0 }],
  projects: [
    {
      title: 'Signal',
      description: 'A useful project with accessible navigation.',
      url: 'https://example.com/project',
      tech: ['TypeScript'],
    },
  ],
  upcomingProjects: [],
  testimonials: [],
  workExperiences: [],
  completedCourses: [],
  sections: emptyPortfolioSections(),
  socialLinks: { linkedin: 'https://example.com/profile' },
  user: {
    name: 'Maya Chen',
    jobTitle: 'Product engineer',
    location: 'Remote',
    avatar: '',
    githubUsername: 'maya',
  },
  ...overrides,
});
