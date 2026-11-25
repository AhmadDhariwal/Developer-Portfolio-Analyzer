export function recommendationCategoryLabel(category: string): string {
  const labels: Record<string, string> = {
    learning: 'Skills',
    projects: 'GitHub & projects',
    resume: 'Resume',
    careerPaths: 'Career',
    'Learning Recommendations': 'Skills',
    'Certification Recommendations': 'Certifications',
    'Portfolio Recommendations': 'Portfolio',
    'Resume Recommendations': 'Resume',
    'Career Growth Recommendations': 'Career',
    'Interview Recommendations': 'Interview',
    'Job Readiness Recommendations': 'Job readiness',
  };
  return labels[category] || category || 'Uncategorized';
}
