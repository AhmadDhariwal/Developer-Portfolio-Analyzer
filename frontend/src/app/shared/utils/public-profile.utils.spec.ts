import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import {
  portfolioError,
  portfolioForDisplay,
  portfolioImage,
  portfolioLink,
} from './public-profile.utils';
import { portfolioFixture } from '../../pages/public-portfolio/testing/portfolio.fixture';

describe('Portfolio presentation privacy and safe links', () => {
  it('excludes private preview fields and all hidden collections without mutating the response', () => {
    const source = portfolioFixture({
      email: 'private@example.com',
      analytics: { totalViews: 9, uniqueViews: 2, lastViewedAt: null },
      completedCourses: [{ title: 'Secret course', isVisible: false }],
      defaultResumeUrl: '/api/public-profiles/me/resume',
    });
    source.sections.contact.email = 'private@example.com';
    source.user.email = 'private@example.com';
    source.sections.visibility.projects = false;
    source.sections.visibility.cta = false;
    const display = portfolioForDisplay(source);
    expect(JSON.stringify(display)).not.toContain('private@example.com');
    expect(display.analytics).toBeUndefined();
    expect(display.projects).toEqual([]);
    expect(display.completedCourses).toEqual([]);
    expect(display.defaultResumeUrl).toBe('');
    expect(source.analytics?.totalViews).toBe(9);
    expect(source.projects).toHaveLength(1);
  });
  it('rejects executable schemes, credentials, arbitrary relative paths and inline images', () => {
    for (const link of [
      'javascript:alert(1)',
      'data:text/html,test',
      '//evil.example',
      '/private/path',
      'https://user:pass@example.com',
      'https://example.com/<script>',
    ])
      expect(portfolioLink(link)).toBe('');
    expect(portfolioImage('data:image/svg+xml,test')).toBe('');
    expect(portfolioImage('/uploads/preview/private.pdf')).toBe('');
    expect(portfolioImage('/uploads/portfolio-images/owner.png')).toContain(
      '/uploads/portfolio-images/owner.png',
    );
    expect(portfolioLink('https://example.com/work')).toBe('https://example.com/work');
  });
  it('retains genuine zero proficiency and never manufactures scores or work history', () => {
    const display = portfolioForDisplay(portfolioFixture());
    expect(display.skills[0].score).toBe(0);
    expect(display.workExperiences).toEqual([]);
    expect(display.profileStrengthScore).toBeUndefined();
    expect(display.momentum).toBeNull();
  });
  it('presents Retry-After and unavailability accurately', () => {
    expect(
      portfolioError(
        new HttpErrorResponse({ status: 429, headers: new HttpHeaders({ 'Retry-After': '30' }) }),
        'Failed',
      ),
    ).toContain('30 seconds');
    expect(portfolioError(new HttpErrorResponse({ status: 503 }), 'Failed')).toContain(
      'Temporarily unavailable',
    );
  });
});
