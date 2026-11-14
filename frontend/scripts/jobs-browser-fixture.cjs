// Synthetic browser-only data. Never imported into the application or backend.
const profile = {
  careerStack: 'Full Stack',
  experienceLevel: '1-2 years',
  careerGoal: 'Get first job',
  isConfigured: true,
};
const names = [
  'Frontend Engineer',
  'Full Stack Developer',
  'Platform Engineer',
  'TypeScript Developer',
  'Software Engineer',
  'UI Engineer',
];
const sources = ['Remotive', 'Arbeitnow', 'RemoteOK', 'JSearch', 'Jooble', 'Adzuna'];
const catalog = Array.from({ length: 12 }, (_, index) => ({
  id: `fixture-job-${index + 1}`,
  title: names[index % 6],
  company: ['Northstar Labs', 'Orbit Studio', 'Fieldwork'][index % 3],
  companyLogo: '',
  location: 'Remote',
  salary: '',
  jobType: 'Full Time',
  skills: ['TypeScript', 'Angular', 'Node.js', 'PostgreSQL'],
  postedDate: '2026-10-18T10:00:00Z',
  lastSynced: '2026-10-19T09:00:00Z',
  freshUntil: '2099-10-19T10:00:00Z',
  validThrough: null,
  description:
    'Build thoughtful developer tools with an international product team. Work across accessible interfaces and reliable services.\nThis description is synthetic browser verification data.',
  requirements: [
    'Experience with TypeScript and component architecture',
    'Comfort with API integration and automated testing',
  ],
  benefits: ['Flexible remote working', 'Dedicated learning time'],
  platform: sources[index % 6],
  source: sources[index % 6],
  url: 'https://example.com/jobs/' + index,
  applyUrl: 'https://example.com/apply/' + index,
  experienceLevel: '1-2 years',
  matchScore: 92 - index * 3,
  whyMatched: 'Your recorded TypeScript and full stack context overlap with this listing.',
  missingSkills: ['PostgreSQL'],
  salaryMetadata:
    index % 2
      ? { min: null, max: null, currency: null, period: null }
      : { min: 60000, max: 85000, currency: 'USD', period: 'year' },
  recommendedCourse: {
    title: 'PostgreSQL foundations',
    platform: 'Learning source',
    url: 'https://example.com/course',
    whyRecommended: 'Related to the PostgreSQL evidence gap in this listing.',
  },
  recommendedSprintTask: {
    title: 'Build a small relational data project',
    description: 'Practice joins and document your decisions.',
  },
}));
const emptyAction = (id) => ({
  jobId: id,
  saved: false,
  applied: false,
  hidden: false,
  updatedAt: '2026-10-19T09:00:00Z',
});
module.exports = { profile, catalog, emptyAction };
